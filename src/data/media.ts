import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import type { ApiClient } from './client';
import type { Attachment, Emote } from '../domain/contracts';
import { catalogImage, customEmoteSrc, splitImageEmotes } from '../domain/emote-catalog';

const memory = new Map<string, string>();
const emotes = new Map<string, string>();
let client: ApiClient | null = null;
let mediaAccount = '';

export function setMediaClient(next: ApiClient | null): void {
  client = next;
  if (!next) {
    memory.clear();
    emotes.clear();
    mediaAccount = '';
  }
}

export function setMediaAccount(accountKey: string): void {
  if (mediaAccount && mediaAccount !== accountKey) {
    clearAccountPreviewCache(mediaAccount);
    emotes.clear();
  }
  mediaAccount = accountKey;
}

export function clearAccountPreviewCache(accountKey: string): void {
  memory.clear();
  try {
    if (!accountKey || !Paths.cache) return;
    const dir = new Directory(Paths.cache, 'previews', accountKey);
    if (dir.exists) dir.delete();
  } catch {
    /* Native FS is unavailable in unit tests. */
  }
}

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

export async function attachmentPreviewUri(file: Attachment): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const account = mediaAccount;
  if (!account) throw new Error('Media account unavailable');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `preview:${api.origin}:${account}:${file.id}`);
  const dir = new Directory(Paths.cache, 'previews', account);
  dir.create({ intermediates: true, idempotent: true });
  const cached = new File(dir, digest);
  if (cached.exists && cached.size > 0) return cached.uri;
  if (cached.exists) cached.delete();
  let response: Response;
  try {
    response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/preview`, {}, true);
  } catch {
    const reserved = await api.json(`/api/workspace/files/${encodeURIComponent(file.id)}/downloads/reserve`, z.object({ id: z.string().min(1) }), {});
    response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/download?downloadId=${encodeURIComponent(reserved.id)}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error('Empty media');
  cached.create();
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
  const response = await api.openMedia(url.startsWith('/') ? url : resolveMediaUrl(url, api.origin));
  const text = await response.text();
  if (!text) throw new Error('Empty media');
  return text;
}

export async function localMediaUri(url: string): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
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
  if (!bytes.byteLength) throw new Error('Empty media');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, key);
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
