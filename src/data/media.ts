import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import type { ApiClient } from './client';
import type { Attachment, Emote } from '../domain/contracts';

const memory = new Map<string, string>();
const emotes = new Map<string, string>();
let client: ApiClient | null = null;

export function setMediaClient(next: ApiClient | null): void {
  client = next;
  if (!next) memory.clear();
}

const PREVIEWABLE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
const CATALOG_PACKS = 'bili|wechat|feishu|xiaohongshu|heybox|tieba|qq|douyin';

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
  const custom = /^custom:([a-f0-9-]{36})$/i.exec(shortcode) ?? /^\[custom:([a-f0-9-]{36})\]$/i.exec(shortcode);
  if (custom) return `/api/workspace/emotes/${custom[1]}/content`;
  const catalog = new RegExp(`^\\[(${CATALOG_PACKS}):([^\\]\\s]+)\\]$`, 'i').exec(shortcode);
  if (catalog?.[1] && catalog[2]) return `/emotes/${catalog[1].toLowerCase()}/${catalog[2]}.png`;
  return undefined;
}

export function splitCatalogEmotes(text: string): Array<{ text?: string; src?: string; token?: string }> {
  const pattern = new RegExp(`\\[(${CATALOG_PACKS}):([^\\]\\s]+)\\]`, 'gi');
  const parts: Array<{ text?: string; src?: string; token?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: text.slice(last, index) });
    if (match[1] && match[2]) parts.push({ token: match[0], src: `/emotes/${match[1].toLowerCase()}/${match[2]}.png` });
    last = index + match[0].length;
  }
  if (!parts.length) return [{ text }];
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export async function attachmentPreviewUri(file: Attachment): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `preview:${file.id}`);
  const cached = new File(Paths.cache, digest);
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

export function resolveMediaUrl(url: string, origin: string): string {
  if (url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${origin.replace(/\/$/, '')}${url}`;
  throw new Error('Invalid media url');
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
