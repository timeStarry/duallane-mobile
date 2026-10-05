import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import type { ApiClient } from './client';
import type { Attachment, Emote } from '../domain/contracts';
import { catalogImage, customEmoteSrc, splitImageEmotes } from '../domain/emote-catalog';
import { useWorkspace } from '../domain/store';

const memory = new Map<string, string>();
const emotes = new Map<string, string>();
let client: ApiClient | null = null;
let mediaAccount = '';
let generation = 0;

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
}

export function clearAccountPreviewCache(accountKey: string): void {
  if (accountKey === mediaAccount) generation++;
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

export async function attachmentPreviewUri(file: Attachment, context?: MediaContext): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const account = mediaAccount;
  if (!account) throw new Error('Media account unavailable');
  const started = generation;
  const current = () => {
    if (client !== api || mediaAccount !== account || generation !== started) throw new Error('Stale media session');
    if (!canPreviewAttachment(file, context)) throw new Error('permission.denied');
  };
  current();
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `preview:${api.origin}:${account}:${file.id}`);
  current();
  const dir = new Directory(Paths.cache, 'previews', account);
  const cached = new File(dir, digest);
  let response: Response;
  try {
    // A file URI is only a storage location. The current session must authorize every use.
    response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/preview`, {}, true);
  } catch (error) {
    current();
    const failure = apiFailure(error);
    if (failure && ([401, 403].includes(failure.status) || (failure.status === 404 && failure.code === 'file.not_found'))) {
      clearAccountPreviewCache(account);
      throw error;
    }
    if (!failure || ![404, 405, 415].includes(failure.status)) throw error;
    try {
      const reserved = await api.json(`/api/workspace/files/${encodeURIComponent(file.id)}/downloads/reserve`, z.object({ id: z.string().min(1) }), {});
      current();
      response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/download?downloadId=${encodeURIComponent(reserved.id)}`);
    } catch (fallbackError) {
      current();
      const failure = apiFailure(fallbackError);
      if (failure && ([401, 403].includes(failure.status) || (failure.status === 404 && failure.code === 'file.not_found'))) clearAccountPreviewCache(account);
      throw fallbackError;
    }
  }
  current();
  if (cached.exists && cached.size > 0) {
    await response.body?.cancel().catch(() => undefined);
    current();
    return cached.uri;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  current();
  if (!bytes.byteLength) throw new Error('Empty media');
  dir.create({ intermediates: true, idempotent: true });
  if (cached.exists && cached.size > 0) return cached.uri;
  cached.create({ overwrite: true });
  const handle = cached.open();
  try { handle.writeBytes(bytes); } finally { handle.close(); }
  return cached.uri;
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
  const response = await api.openMedia(url.startsWith('/') ? url : resolveMediaUrl(url, api.origin));
  const text = await response.text();
  if (client !== api || generation !== started) throw new Error('Stale media session');
  if (!text) throw new Error('Empty media');
  return text;
}

export async function localMediaUri(url: string): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const started = generation;
  const resolved = resolveMediaUrl(url, api.origin);
  const key = cacheKey(resolved);
  const hit = memory.get(key);
  if (hit) return hit;
  if (/^https:\/\/avatars\.githubusercontent\.com\//i.test(resolved)) {
    memory.set(key, resolved);
    return resolved;
  }
  const response = await api.openMedia(resolved);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (client !== api || generation !== started) throw new Error('Stale media session');
  if (!bytes.byteLength) throw new Error('Empty media');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
  if (client !== api || generation !== started) throw new Error('Stale media session');
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
}
