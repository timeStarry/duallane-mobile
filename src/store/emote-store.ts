import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";
import {
  mobileApi,
  type CustomEmoteDTO,
  type EmoteCollectionDTO,
  type EmoteLibraryDTO,
  type EmoteSettingsDTO,
} from "@/shared/api";
import { visibleEmotePacks } from "@/shared/emotes";

const TAB_ORDER_STORAGE_KEY = "duallane:v1:emote-tab-order";
const LIBRARY_CACHE_STORAGE_KEY = "duallane:mobile:emote-library:v1";

const BUILTIN_PACK_IDS = new Set(visibleEmotePacks.map((p) => p.id));

export function normalizeEmoteTabOrder(rawOrder: unknown): string[] {
  if (!Array.isArray(rawOrder)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of rawOrder) {
    const raw = String(item || "").trim();
    if (!raw) continue;
    let normalized = raw;
    if (raw.startsWith("col:")) {
      const colId = raw.slice("col:".length).trim();
      if (!colId) continue;
      normalized = `pack:${colId}`;
    } else if (raw.startsWith("pack:")) {
      const rest = raw.slice("pack:".length).trim();
      if (!rest) continue;
      normalized = BUILTIN_PACK_IDS.has(rest) ? rest : `pack:${rest}`;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function loadStoredTabOrder(): string[] {
  try {
    const raw = window.localStorage.getItem(TAB_ORDER_STORAGE_KEY);
    if (!raw) return [];
    return normalizeEmoteTabOrder(JSON.parse(raw));
  } catch {
    return [];
  }
}

function saveStoredTabOrder(order: string[]) {
  try {
    window.localStorage.setItem(TAB_ORDER_STORAGE_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
}

interface CachedEmoteLibrarySnapshot {
  emotes: CustomEmoteDTO[];
  collections: EmoteCollectionDTO[];
  settings: EmoteSettingsDTO | null;
}

function loadCachedLibrary(): CachedEmoteLibrarySnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LIBRARY_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedEmoteLibrarySnapshot>;
    return {
      emotes: Array.isArray(parsed.emotes) ? parsed.emotes : [],
      collections: Array.isArray(parsed.collections) ? parsed.collections : [],
      settings: parsed.settings || null,
    };
  } catch {
    return null;
  }
}

function saveCachedLibrary(snapshot: CachedEmoteLibrarySnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LIBRARY_CACHE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage quota errors
  }
}

export interface EmoteTabDescriptor {
  id: string;
  label: string;
  kind: "favorites" | "collection" | "builtin";
  collection?: EmoteCollectionDTO;
  packId?: string;
}

interface EmoteState {
  loaded: boolean;
  loading: boolean;
  emotes: CustomEmoteDTO[];
  collections: EmoteCollectionDTO[];
  customSrcMap: Record<string, string>;
  settings: EmoteSettingsDTO | null;
  tabOrder: string[];

  refreshLibrary: (withSettings?: boolean) => Promise<void>;
  clearCache: () => void;
  hydrateTabOrderFromPreferences: (rawOrder: unknown) => void;
  moveTab: (tabId: string, direction: "left" | "right") => string[];
  getOrderedTabs: () => EmoteTabDescriptor[];
  favoriteFromMessage: (input: {
    messageId: string;
    customEmoteId?: string;
    attachmentId?: string;
    emoteKey?: string;
  }) => Promise<CustomEmoteDTO>;
  uploadStickers: (pickedFileIds: string[], collectionId?: string) => Promise<CustomEmoteDTO[]>;
  createPackWithFiles: (name: string, pickedFileIds: string[]) => Promise<EmoteCollectionDTO>;
  deleteSticker: (emoteId: string) => Promise<void>;
  deleteCollection: (collectionId: string, disposition?: "keep" | "remove") => Promise<void>;
  setReplyAutoMention: (enabled: boolean) => Promise<void>;
}

function buildCustomSrcMap(
  emotes: CustomEmoteDTO[],
  collections: EmoteCollectionDTO[]
): Record<string, string> {
  const customSrcMap: Record<string, string> = {};
  for (const e of emotes) {
    if (e.id && e.src) customSrcMap[e.id] = e.src;
  }
  for (const col of collections) {
    for (const item of col.items || []) {
      if (item.id && item.src) customSrcMap[item.id] = item.src;
    }
  }
  return customSrcMap;
}

function applyLibraryPayload(lib: EmoteLibraryDTO) {
  const emotes = Array.isArray(lib.emotes) ? lib.emotes : [];
  const collections = Array.isArray(lib.collections) ? lib.collections : [];
  return {
    emotes,
    collections,
    customSrcMap: buildCustomSrcMap(emotes, collections),
  };
}

function scheduleEmoteMediaPrewarm(
  emotes: CustomEmoteDTO[],
  collections: EmoteCollectionDTO[]
) {
  const urls: string[] = [];
  for (const e of emotes.slice(0, 24)) {
    urls.push(e.src || `/api/workspace/emotes/${encodeURIComponent(e.id)}/content`);
  }
  for (const col of collections.slice(0, 4)) {
    for (const item of (col.items || []).slice(0, 8)) {
      urls.push(item.src || `/api/workspace/emotes/${encodeURIComponent(item.id)}/content`);
    }
  }
  if (urls.length > 0) {
    nativeBridge.prefetchMedia(urls);
  }
}

const initialCached = loadCachedLibrary();

export const useEmoteStore = create<EmoteState>((set, get) => ({
  loaded: Boolean(initialCached),
  loading: false,
  emotes: initialCached?.emotes || [],
  collections: initialCached?.collections || [],
  customSrcMap: initialCached
    ? buildCustomSrcMap(initialCached.emotes, initialCached.collections)
    : {},
  settings: initialCached?.settings || null,
  tabOrder: loadStoredTabOrder(),

  refreshLibrary: async (withSettings = true) => {
    set({ loading: true });
    try {
      const [lib, settingsRes] = await Promise.all([
        mobileApi.getEmoteLibrary(),
        withSettings ? mobileApi.getEmoteSettings().catch(() => null) : Promise.resolve(null),
      ]);
      const mapped = applyLibraryPayload(lib);
      const nextSettings = settingsRes?.settings || get().settings;
      set({
        loaded: true,
        loading: false,
        ...mapped,
        settings: nextSettings,
      });
      saveCachedLibrary({
        emotes: mapped.emotes,
        collections: mapped.collections,
        settings: nextSettings,
      });
      scheduleEmoteMediaPrewarm(mapped.emotes, mapped.collections);
    } catch {
      set({ loading: false });
    }
  },

  clearCache: () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(LIBRARY_CACHE_STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    set({
      loaded: false,
      loading: false,
      emotes: [],
      collections: [],
      customSrcMap: {},
      settings: null,
    });
  },

  hydrateTabOrderFromPreferences: (rawOrder) => {
    const cleaned = normalizeEmoteTabOrder(rawOrder);
    if (cleaned.length > 0) {
      saveStoredTabOrder(cleaned);
      set({ tabOrder: cleaned });
    }
  },

  getOrderedTabs: () => {
    const s = get();
    const enabledPackIds = s.settings?.enabledPackIds;
    const rawTabs: EmoteTabDescriptor[] = [
      { id: "favorites", label: "收藏", kind: "favorites" },
      ...s.collections.map((col) => ({
        id: `pack:${col.id}`,
        label: col.name,
        kind: "collection" as const,
        collection: col,
      })),
      ...visibleEmotePacks
        .filter((p) =>
          !enabledPackIds || enabledPackIds.length === 0 ? true : enabledPackIds.includes(p.id)
        )
        .map((p) => ({
          id: p.id,
          label: p.label,
          kind: "builtin" as const,
          packId: p.id,
        })),
    ];

    if (s.tabOrder.length === 0) return rawTabs;
    const orderMap = new Map(s.tabOrder.map((id, idx) => [id, idx]));
    return [...rawTabs].sort((a, b) => {
      const ia = orderMap.get(a.id) ?? 9999;
      const ib = orderMap.get(b.id) ?? 9999;
      return ia - ib;
    });
  },

  moveTab: (tabId, direction) => {
    const normalizedId = normalizeEmoteTabOrder([tabId])[0] || tabId;
    const tabs = get().getOrderedTabs().map((t) => t.id);
    const idx = tabs.indexOf(normalizedId);
    if (idx < 0) return tabs;
    const swapIdx = direction === "left" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= tabs.length) return tabs;
    const next = [...tabs];
    const [item] = next.splice(idx, 1);
    next.splice(swapIdx, 0, item);
    saveStoredTabOrder(next);
    set({ tabOrder: next });
    return next;
  },

  favoriteFromMessage: async (input) => {
    const res = await mobileApi.favoriteMessageEmote(input);
    await get().refreshLibrary(false);
    return res.emote;
  },

  uploadStickers: async (pickedFileIds, collectionId = "") => {
    const uploaded: CustomEmoteDTO[] = [];
    for (const fid of pickedFileIds) {
      const res = await mobileApi.uploadCustomEmote(fid, collectionId, !collectionId);
      if (res.emote) uploaded.push(res.emote);
    }
    await get().refreshLibrary(false);
    return uploaded;
  },

  createPackWithFiles: async (name, pickedFileIds) => {
    const created = await mobileApi.createEmoteCollection(name.trim());
    const colId = created.collection.id;
    for (const fid of pickedFileIds) {
      await mobileApi.uploadCustomEmote(fid, colId, false);
    }
    await get().refreshLibrary(false);
    return get().collections.find((c) => c.id === colId) || created.collection;
  },

  deleteSticker: async (emoteId) => {
    await mobileApi.deleteCustomEmote(emoteId);
    await get().refreshLibrary(false);
  },

  deleteCollection: async (collectionId, disposition = "keep") => {
    await mobileApi.deleteEmoteCollection(collectionId, disposition);
    await get().refreshLibrary(false);
  },

  setReplyAutoMention: async (enabled) => {
    const prev = get().settings;
    const optimistic: EmoteSettingsDTO = prev
      ? { ...prev, replyAutoMention: enabled }
      : {
          availablePacks: [],
          enabledPackIds: [],
          clickImageEmoteToSend: true,
          replyAutoMention: enabled,
        };
    set({ settings: optimistic });
    saveCachedLibrary({
      emotes: get().emotes,
      collections: get().collections,
      settings: optimistic,
    });
    const res = await mobileApi.updateEmoteSettings({ replyAutoMention: enabled });
    if (res?.settings) {
      set({ settings: res.settings });
      saveCachedLibrary({
        emotes: get().emotes,
        collections: get().collections,
        settings: res.settings,
      });
    }
  },
}));
