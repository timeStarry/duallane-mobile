import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { ApiError, type ApiClient } from './client';
import type { Attachment, Emote } from '../domain/contracts';
import { catalogImage, customEmoteSrc, splitImageEmotes } from '../domain/emote-catalog';
import { useWorkspace } from '../domain/store';

const memory = new Map<string, string>();
const emotes = new Map<string, string>();
let client: ApiClient | null = null;
let mediaAccount = '';
let generation = 0;
const pendingMedia = new Map<AbortController, () => void>();

function abortObsoleteMedia() {
  for (const [controller, validate] of pendingMedia) {
    try { validate(); } catch { controller.abort(); }
  }
}

async function withMediaScope<T>(api: ApiClient, validate: () => void, work: (controller: AbortController, current: () => void) => Promise<T>): Promise<T> {
  validate();
  const controller = new AbortController();
  const release = api.bindAbortScope?.(controller);
  const current = () => { validate(); if (controller.signal.aborted) throw new Error('Stale media session'); };
  pendingMedia.set(controller, current);
  try { current(); const value = await work(controller, current); current(); return value; }
  finally { pendingMedia.delete(controller); controller.abort(); release?.(); }
}

async function readMediaBody<T>(read: () => Promise<T>, controller: AbortController, validate: () => void): Promise<T> {
  if (controller.signal.aborted) throw new Error('Stale media session');
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Stale media session'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  let rejectDeadline!: (error: ApiError) => void;
  const timeout = setTimeout(() => {
    rejectDeadline(new ApiError('request.timeout', 0, 'net.timeout'));
    controller.abort();
  }, 30000);
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
  try {
    const value = await Promise.race([read(), cancelled, deadline]);
    if (controller.signal.aborted) throw new Error('Stale media session');
    return value;
  } catch (error) { validate(); throw error; }
  finally { clearTimeout(timeout); controller.signal.removeEventListener('abort', onAbort); }
}

export type MediaContext = { accountKey: string; conversationId?: string; topicId?: string; messageId?: string };

function apiFailure(error: unknown) {
  const result = z.object({ status: z.number(), code: z.string() }).safeParse(error);
  return result.success ? result.data : null;
}

export function canPreviewAttachment(file: Attachment, context?: MediaContext): boolean {
  const s = useWorkspace.getState();
  if (!s.accountKey || !s.bootstrap?.permissions.canDownload || file.status !== 'available' || !file.capabilities.canDownload) return false;
  const readable = (conversationId: string, topicId?: string | null) => !!s.bootstrap?.permissions.canReadConversations && !!s.conversations[conversationId] && (!topicId || (!!s.topics[topicId]?.joined && s.topics[topicId]?.conversationId === conversationId));
  if (context) {
    if (context.accountKey !== s.accountKey) return false;
    const currentFile = s.files.find(item => item.id === file.id);
    if (currentFile && (currentFile.status !== 'available' || !currentFile.capabilities.canDownload)) return false;
    const conversationId = context.conversationId ?? (context.topicId ? s.topics[context.topicId]?.conversationId : undefined);
    if (context.messageId) {
      const message = s.messages[context.topicId ? `topic:${context.topicId}` : conversationId ?? '']?.find(item => item.id === context.messageId);
      // A latest-page refresh may evict an authorized history item. Absence from the
      // local window is not a revocation; the preview endpoint still authorizes its use.
      if (message && (message.hiddenByCurrentUser || message.recalledAt || message.deletedAt || !message.attachments.some(item => item.id === file.id && item.status === 'available' && item.capabilities.canDownload))) return false;
    }
    return conversationId ? readable(conversationId, context.topicId) : s.files.some(item => item.id === file.id && item.status === 'available' && item.capabilities.canDownload);
  }
  return s.files.some(item => item.id === file.id && item.status === 'available' && item.capabilities.canDownload) || Object.values(s.messages).some(messages => messages.some(message => readable(message.conversationId, message.topicId) && !message.hiddenByCurrentUser && !message.recalledAt && !message.deletedAt && message.attachments.some(item => item.id === file.id && item.status === 'available' && item.capabilities.canDownload)));
}

export function setMediaClient(next: ApiClient | null): void {
  if (client !== next) generation++;
  client = next;
  abortObsoleteMedia();
  if (!next) {
    memory.clear();
    emotes.clear();
    mediaAccount = '';
  }
}

export function setMediaAccount(accountKey: string): void {
  if (mediaAccount !== accountKey) generation++;
  if (mediaAccount && mediaAccount !== accountKey) {
    clearAccountPreviewCache(mediaAccount);
    emotes.clear();
  }
  mediaAccount = accountKey;
  abortObsoleteMedia();
}

export function clearAccountPreviewCache(accountKey: string): void {
  if (accountKey === mediaAccount) generation++;
  abortObsoleteMedia();
  memory.clear();
  try {
    if (!accountKey || !Paths.cache) return;
    const dir = new Directory(Paths.cache, 'previews', accountKey);
    if (dir.exists) dir.delete();
  } catch {
    /* Native FS is unavailable in unit tests. */
  }
}

// Attachment DTOs do not retain their authorization scope on disk. Clear the account's
// preview directory whenever an authorized conversation/topic scope is revoked.
useWorkspace.subscribe((next, previous) => {
  abortObsoleteMedia();
  if (!mediaAccount || previous.accountKey !== mediaAccount) return;
  const revoked = next.accountKey !== previous.accountKey || next.bootstrap?.space.id !== previous.bootstrap?.space.id
    || (!!previous.bootstrap?.permissions.canDownload && !next.bootstrap?.permissions.canDownload)
    || (!!previous.bootstrap?.permissions.canReadConversations && !next.bootstrap?.permissions.canReadConversations)
    || Object.keys(previous.conversations).some(id => !next.conversations[id])
    || Object.values(previous.topics).some(topic => topic.joined && (!next.topics[topic.id]?.joined || !next.conversations[topic.conversationId]));
  if (revoked) clearAccountPreviewCache(mediaAccount);
});

const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);

export function isPreviewableImage(file: { mimeType: string; fileName?: string }): boolean {
  if (PREVIEWABLE.has(file.mimeType.toLowerCase())) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(file.fileName ?? '');
}

export function rememberEmotes(items: Emote[]): void {
  for (const item of items) {
    if (!item.src) continue;
    emotes.set(item.token, item.src);
    emotes.set(`:${item.token}:`, item.src);
    if (item.emoteKey) emotes.set(item.emoteKey, item.src);
    const custom = /^\[custom:([a-f0-9-]{36})\]$/i.exec(item.token) ?? /^custom:([a-f0-9-]{36})$/i.exec(item.token);
    if (custom) emotes.set(`custom:${custom[1]}`, item.src);
  }
}

export function emoteSource(shortcode: string): string | undefined {
  const mapped = emotes.get(shortcode) ?? emotes.get(shortcode.replace(/^:|:$/g, ''));
  if (mapped) return mapped;
  return customEmoteSrc(shortcode) ?? catalogImage(shortcode)?.src;
}

export function splitCatalogEmotes(text: string): Array<{ text?: string; src?: string; token?: string }> {
  return splitImageEmotes(text, emotes);
}

function emoteKey(value: string): string {
  return value.trim().replace(/^:|:$/g, '').replace(/^\[|\]$/g, '').toLowerCase();
}

export function canPreviewEmote(shortcode: string, context: MediaContext): boolean {
  const s = useWorkspace.getState();
  if (!s.accountKey || context.accountKey !== s.accountKey || !s.bootstrap?.permissions.canReadConversations
    || !context.conversationId || !s.conversations[context.conversationId] || !context.messageId || !emoteSource(shortcode)) return false;
  if (context.topicId && (!s.topics[context.topicId]?.joined || s.topics[context.topicId]?.conversationId !== context.conversationId)) return false;
  const message = s.messages[context.topicId ? `topic:${context.topicId}` : context.conversationId]?.find(item => item.id === context.messageId);
  // A preview is an action on the currently visible message, not a registry browser.
  if (!message || message.hiddenByCurrentUser || message.recalledAt || message.deletedAt || message.fallback) return false;
  const key = emoteKey(shortcode);
  return message.blocks.some(block => block.type === 'emoji' ? emoteKey(block.shortcode) === key
    : block.type === 'text' && splitCatalogEmotes(block.text).some(part => part.token && emoteKey(part.token) === key));
}

export async function emotePreviewUri(shortcode: string, context: MediaContext): Promise<string> {
  const api = client, account = mediaAccount, started = generation;
  if (!api || !account) throw new Error('Media client unavailable');
  const source = emoteSource(shortcode);
  if (!source) throw new Error('Emote unavailable');
  const hadSession = !!api.session;
  const current = () => {
    if (client !== api || mediaAccount !== account || generation !== started || (hadSession && !api.session)) throw new Error('Stale media session');
    if (context.accountKey !== account || useWorkspace.getState().accountKey !== account || !canPreviewEmote(shortcode, context)) throw new Error('permission.denied');
  };
  return withMediaScope(api, current, async (controller, currentScope) => {
    // Reauthorize the logical resource before using an account-scoped cached image.
    let response: Response;
    try { response = await api.openMedia(source, controller.signal); }
    catch (error) {
      currentScope();
      const failure = apiFailure(error);
      if (failure && [401, 403, 404, 410].includes(failure.status)) clearAccountPreviewCache(account);
      throw error;
    }
    currentScope();
    if (/\.svg(\?|$)/i.test(source)) {
      void response.body?.cancel().catch(() => undefined);
      return source;
    }
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `emote-preview:${api.origin}:${account}:${emoteKey(shortcode)}`);
    currentScope();
    const dir = new Directory(Paths.cache, 'previews', account);
    const cached = new File(dir, digest);
    if (cached.exists && cached.size > 0) {
      void response.body?.cancel().catch(() => undefined);
      return cached.uri;
    }
    const bytes = new Uint8Array(await readMediaBody(() => response.arrayBuffer(), controller, current));
    currentScope();
    if (!bytes.byteLength) throw new Error('Empty media');
    dir.create({ intermediates: true, idempotent: true });
    if (cached.exists && cached.size > 0) return cached.uri;
    cached.create({ overwrite: true });
    const handle = cached.open();
    try { handle.writeBytes(bytes); } finally { handle.close(); }
    return cached.uri;
  });
}

export async function attachmentPreviewUri(file: Attachment, context?: MediaContext): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const account = mediaAccount;
  if (!account) throw new Error('Media account unavailable');
  const started = generation;
  const hadSession = !!api.session;
  const current = () => {
    if (client !== api || mediaAccount !== account || generation !== started || (hadSession && !api.session)) throw new Error('Stale media session');
    if (useWorkspace.getState().accountKey !== account || (context && context.accountKey !== account) || !canPreviewAttachment(file, context)) throw new Error('permission.denied');
  };
  return withMediaScope(api, current, async (controller, currentScope) => {
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `preview:${api.origin}:${account}:${file.id}`);
    currentScope();
    const dir = new Directory(Paths.cache, 'previews', account);
    const cached = new File(dir, digest);
    let response: Response;
    try {
      // A file URI is only a storage location. The current session must authorize every use.
      response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/preview`, { signal: controller.signal }, true);
    } catch (error) {
      currentScope();
      const failure = apiFailure(error);
      if (failure && ([401, 403].includes(failure.status) || (failure.status === 404 && failure.code === 'file.not_found'))) {
        clearAccountPreviewCache(account);
        throw error;
      }
      if (!failure || ![404, 405, 415].includes(failure.status)) throw error;
      try {
        const reserved = await api.json(`/api/workspace/files/${encodeURIComponent(file.id)}/downloads/reserve`, z.object({ id: z.string().min(1) }), {});
        currentScope();
        response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/download?downloadId=${encodeURIComponent(reserved.id)}`, { signal: controller.signal });
      } catch (fallbackError) {
        currentScope();
        const failure = apiFailure(fallbackError);
        if (failure && ([401, 403].includes(failure.status) || (failure.status === 404 && failure.code === 'file.not_found'))) clearAccountPreviewCache(account);
        throw fallbackError;
      }
    }
    currentScope();
    if (cached.exists && cached.size > 0) {
      void response.body?.cancel().catch(() => undefined);
      currentScope();
      return cached.uri;
    }
    const bytes = new Uint8Array(await readMediaBody(() => response.arrayBuffer(), controller, current));
    currentScope();
    if (!bytes.byteLength) throw new Error('Empty media');
    dir.create({ intermediates: true, idempotent: true });
    if (cached.exists && cached.size > 0) return cached.uri;
    cached.create({ overwrite: true });
    const handle = cached.open();
    try { handle.writeBytes(bytes); } finally { handle.close(); }
    return cached.uri;
  });
}

function cacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export { botAssetAvatar, isAllowedSameOriginMediaPath, sanitizeWorkspaceAvatarUrl } from '../domain/media-path';

export function resolveMediaUrl(url: string, origin: string): string {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${origin.replace(/\/$/, '')}${url}`;
  throw new Error('Invalid media url');
}

export async function localMediaText(url: string): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const started = generation;
  const hadSession = !!api.session;
  const current = () => { if (client !== api || generation !== started || (hadSession && !api.session)) throw new Error('Stale media session'); };
  return withMediaScope(api, current, async (controller, currentScope) => {
    const response = await api.openMedia(url.startsWith('/') ? url : resolveMediaUrl(url, api.origin), controller.signal);
    currentScope();
    const text = await readMediaBody(() => response.text(), controller, current);
    currentScope();
    if (!text) throw new Error('Empty media');
    return text;
  });
}

export async function localMediaUri(url: string): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const started = generation;
  const hadSession = !!api.session;
  const resolved = resolveMediaUrl(url, api.origin);
  const key = cacheKey(resolved);
  const hit = memory.get(key);
  if (hit) return hit;
  if (/^https:\/\/avatars\.githubusercontent\.com\//i.test(resolved)) {
    memory.set(key, resolved);
    return resolved;
  }
  const current = () => { if (client !== api || generation !== started || (hadSession && !api.session)) throw new Error('Stale media session'); };
  return withMediaScope(api, current, async (controller, currentScope) => {
    const response = await api.openMedia(resolved, controller.signal);
    currentScope();
    const bytes = new Uint8Array(await readMediaBody(() => response.arrayBuffer(), controller, current));
    currentScope();
    if (!bytes.byteLength) throw new Error('Empty media');
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
    currentScope();
    const file = new File(Paths.cache, digest);
    if (file.exists && file.size > 0) {
      memory.set(key, file.uri);
      return file.uri;
    }
    if (file.exists) file.delete();
    file.create();
    const handle = file.open();
    try { handle.writeBytes(bytes); } finally { handle.close(); }
    memory.set(key, file.uri);
    return file.uri;
  });
}
