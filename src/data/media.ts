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

export function rememberEmotes(items: Emote[]): void {
  for (const item of items) {
    if (!item.src) continue;
    emotes.set(item.token, item.src);
    emotes.set(`:${item.token}:`, item.src);
    if (item.emoteKey) emotes.set(item.emoteKey, item.src);
    emotes.set(`custom:${item.token}`, item.src);
  }
}

export function emoteSource(shortcode: string): string | undefined {
  return emotes.get(shortcode) ?? emotes.get(shortcode.replace(/^:|:$/g, ''));
}

export async function attachmentPreviewUri(file: Attachment): Promise<string> {
  const api = client;
  if (!api) throw new Error('Media client unavailable');
  const reserved = await api.json(`/api/workspace/files/${encodeURIComponent(file.id)}/downloads/reserve`, z.object({ id: z.string().min(1) }), {});
  const response = await api.raw(`/api/workspace/files/${encodeURIComponent(file.id)}/download?downloadId=${encodeURIComponent(reserved.id)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, file.id);
  const cached = new File(Paths.cache, digest);
  if (!cached.exists) {
    cached.create();
    const handle = cached.open();
    try { handle.writeBytes(bytes); } finally { handle.close(); }
  }
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
