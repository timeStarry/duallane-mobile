import { z } from 'zod';
// Snapshot of apps/web/shared/emote-packs.json; token/src must match Web.
import rawCatalog from './emote-packs.json';

const catalogItemSchema = z.object({
  kind: z.string(),
  id: z.string(),
  label: z.string(),
  token: z.string().optional(),
  src: z.string().optional(),
  aliases: z.array(z.string()).optional(),
  value: z.string().optional(),
}).passthrough();

const catalogPackSchema = z.object({
  id: z.string(),
  label: z.string(),
  items: z.array(catalogItemSchema),
}).passthrough();

export type CatalogImage = { src: string; label: string; packId: string; id: string };

const imageByToken = new Map<string, CatalogImage>();
const imageByKey = new Map<string, CatalogImage>();
const unicodeByKey = new Map<string, string>();
const imagePackIds: string[] = [];

const parsed = z.array(catalogPackSchema).safeParse(rawCatalog);
if (!parsed.success) {
  console.warn(JSON.stringify({ src: 'duallane', event: 'emote_catalog_invalid' }));
}

for (const pack of parsed.success ? parsed.data : []) {
  if (pack.id !== 'emoji' && pack.id !== 'custom') imagePackIds.push(pack.id);
  for (const item of pack.items) {
    if (item.kind === 'unicode' && item.value) {
      unicodeByKey.set(`${pack.id}:${item.id}`, item.value);
      continue;
    }
    if (item.kind !== 'image' || !item.src) continue;
    const image: CatalogImage = { src: item.src, label: item.label, packId: pack.id, id: item.id };
    imageByKey.set(`${pack.id}:${item.id}`, image);
    if (item.token) imageByToken.set(item.token, image);
    imageByToken.set(`[${pack.id}:${item.id}]`, image);
    for (const alias of item.aliases ?? []) {
      imageByToken.set(`[${pack.id}:${alias}]`, image);
    }
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const imageTokenPattern = new RegExp(`:?\\[(${imagePackIds.map(escapeRegExp).join('|')}|custom):([^\\]\\s:]+)\\]:?`, 'gi');
const customIdPattern = /^[a-f0-9-]{36}$/i;

function unwrapToken(value: string) {
  return value.replace(/^:|:$/g, '');
}

export function catalogImage(tokenOrKey: string): CatalogImage | undefined {
  const trimmed = tokenOrKey.trim();
  const unwrapped = unwrapToken(trimmed);
  return imageByToken.get(trimmed)
    ?? imageByToken.get(unwrapped)
    ?? imageByToken.get(`[${unwrapped}]`)
    ?? imageByKey.get(unwrapped)
    ?? imageByKey.get(trimmed);
}

export function catalogUnicodeGlyph(key: string): string | undefined {
  return unicodeByKey.get(key);
}

export function customEmoteSrc(tokenOrKey: string): string | undefined {
  const unwrapped = unwrapToken(tokenOrKey.trim());
  const match = /^custom:([a-f0-9-]{36})$/i.exec(unwrapped)
    ?? /^\[custom:([a-f0-9-]{36})\]$/i.exec(unwrapped);
  return match?.[1] ? `/api/workspace/emotes/${match[1]}/content` : undefined;
}

export function splitImageEmotes(text: string, extra?: Map<string, string>): Array<{ text?: string; src?: string; token?: string }> {
  const parts: Array<{ text?: string; src?: string; token?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(imageTokenPattern)) {
    const index = match.index ?? 0;
    const pack = match[1];
    const id = match[2];
    if (!pack || !id) continue;
    const token = `[${pack}:${id}]`;
    const src = extra?.get(match[0])
      ?? extra?.get(unwrapToken(match[0]))
      ?? extra?.get(token)
      ?? extra?.get(`${pack}:${id}`)
      ?? catalogImage(token)?.src
      ?? (pack.toLowerCase() === 'custom' && customIdPattern.test(id) ? `/api/workspace/emotes/${id}/content` : undefined);
    if (!src) continue;
    if (index > last) parts.push({ text: text.slice(last, index) });
    parts.push({ token, src });
    last = index + match[0].length;
  }
  if (!parts.length) return [{ text }];
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export function containsImageEmoteToken(text: string) {
  return splitImageEmotes(text).some(part => !!part.src);
}
