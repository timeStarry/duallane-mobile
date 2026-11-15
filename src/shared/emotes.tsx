import React from "react";
import rawPacks from "./emote-packs.json";
import { nativeBridge } from "@/native/bridge";

export interface EmoteItem {
  id: string;
  label: string;
  kind: "unicode" | "image";
  token: string;
  value?: string;
  src?: string;
  packId: string;
  packLabel: string;
}

export interface EmotePack {
  id: string;
  label: string;
  kind: "unicode" | "image";
  defaultEnabled: boolean;
  items: EmoteItem[];
}

interface RawEmoteItem {
  id: string;
  label: string;
  kind: string;
  token?: string;
  value?: string;
  src?: string;
}

interface RawEmotePack {
  id: string;
  label: string;
  defaultEnabled?: boolean;
  items: RawEmoteItem[];
}

export function resolveAssetUrl(pathOrUrl: string | undefined): string {
  if (!pathOrUrl) return "";
  if (
    pathOrUrl.startsWith("http://") ||
    pathOrUrl.startsWith("https://") ||
    pathOrUrl.startsWith("blob:") ||
    pathOrUrl.startsWith("data:")
  ) {
    return pathOrUrl;
  }
  if (nativeBridge.isNativeAndroid()) {
    // Native OkHttp shouldInterceptRequest proxies /api/* and /emotes/* with auth & disk cache!
    return pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  }
  const origin = nativeBridge.getSessionSnapshot().apiOrigin.replace(/\/+$/, "");
  return `${origin}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

const rawPackList: RawEmotePack[] = Array.isArray(rawPacks)
  ? (rawPacks as RawEmotePack[])
  : [];

export const emotePacks: EmotePack[] = rawPackList.map((pack) => {
  const isUnicode = pack.id === "emoji" || pack.items?.[0]?.kind === "unicode";
  return {
    id: pack.id,
    label: pack.label,
    kind: isUnicode ? "unicode" : "image",
    defaultEnabled: pack.defaultEnabled ?? true,
    items: (pack.items || []).map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind === "unicode" ? "unicode" : "image",
      value: item.value,
      src: item.src,
      packId: pack.id,
      packLabel: pack.label,
      token:
        item.token ||
        (item.kind === "unicode" && item.value ? item.value : `[${pack.id}:${item.id}]`),
    })),
  };
});

export const visibleEmotePacks: EmotePack[] = emotePacks.filter((p) => p.id !== "feishu");

const emoteByKey = new Map<string, EmoteItem>();
const unicodeToKey = new Map<string, string>();

for (const pack of emotePacks) {
  for (const item of pack.items) {
    const key = `${pack.id}:${item.id}`;
    emoteByKey.set(key, item);
    if (pack.id === "emoji" && item.kind === "unicode" && item.value) {
      unicodeToKey.set(item.value, key);
    }
  }
}

export function getBuiltInEmote(key: string): EmoteItem | undefined {
  return emoteByKey.get(key);
}

export function normalizeReactionEmoteKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":")) return trimmed;
  return unicodeToKey.get(trimmed) || trimmed;
}

const TOKEN_PATTERN = /\[([a-z0-9_-]+:[a-z0-9_-]+)\]/gi;
const PACK_SHARE_PATTERN = /\[duallane-pack:([a-zA-Z0-9_-]+)\]/g;

export function extractPackShareIdFromText(text: string): string | null {
  const m = text.match(/\[duallane-pack:([a-zA-Z0-9_-]+)\]/);
  return m ? m[1] : null;
}

export function isSingleBuiltInSticker(text: string): EmoteItem | null {
  const trimmed = text.trim();
  const m = trimmed.match(/^\[([a-z0-9_-]+:[a-z0-9_-]+)\]$/i);
  if (!m) return null;
  const item = emoteByKey.get(m[1].toLowerCase()) || emoteByKey.get(m[1]);
  if (item && item.kind === "image" && item.src) return item;
  return null;
}

export function formatConversationPreviewText(text: string | undefined): string {
  if (!text) return "暂无消息";
  const cleaned = text
    .replace(PACK_SHARE_PATTERN, "[表情包分享]")
    .replace(TOKEN_PATTERN, (_full, rawKey: string) => {
      const found = emoteByKey.get(rawKey) || emoteByKey.get(rawKey.toLowerCase());
      if (!found) return "[表情]";
      return found.kind === "unicode" && found.value ? found.value : `[${found.label}]`;
    });
  return cleaned.trim() || "暂无消息";
}

export function ReactionGlyph({
  emoteKey,
  customSrcMap,
}: {
  emoteKey: string;
  customSrcMap?: Record<string, string>;
}) {
  if (emoteKey.startsWith("custom:")) {
    const id = emoteKey.slice("custom:".length);
    const src = customSrcMap?.[id] || `/api/workspace/emotes/custom/${encodeURIComponent(id)}`;
    return (
      <img
        src={resolveAssetUrl(src)}
        alt="贴纸"
        className="w-4 h-4 object-contain inline-block"
      />
    );
  }
  const item = emoteByKey.get(emoteKey);
  if (item) {
    if (item.kind === "unicode" && item.value) {
      return <span className="text-[13px] leading-none">{item.value}</span>;
    }
    if (item.src) {
      return (
        <img
          src={resolveAssetUrl(item.src)}
          alt={item.label}
          className="w-4 h-4 object-contain inline-block"
        />
      );
    }
  }
  return <span className="text-[13px] leading-none">{emoteKey}</span>;
}

export function renderRichTextTokens(
  text: string,
  keyPrefix = "rt"
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(TOKEN_PATTERN.source, "gi");
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const rawKey = match[1];
    const item = emoteByKey.get(rawKey) || emoteByKey.get(rawKey.toLowerCase());
    if (item && item.kind === "image" && item.src) {
      out.push(
        <img
          key={`${keyPrefix}_em_${idx++}`}
          src={resolveAssetUrl(item.src)}
          alt={item.label}
          title={item.label}
          className="inline-block w-6 h-6 mx-0.5 align-[-5px] object-contain select-none"
        />
      );
    } else if (item && item.kind === "unicode" && item.value) {
      out.push(item.value);
    } else {
      out.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}
