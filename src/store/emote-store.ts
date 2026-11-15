import { create } from "zustand";
import {
  mobileApi,
  type CustomEmoteDTO,
  type EmoteCollectionDTO,
  type EmoteLibraryDTO,
  type EmoteSettingsDTO,
} from "@/shared/api";
import { visibleEmotePacks } from "@/shared/emotes";

const TAB_ORDER_STORAGE_KEY = "duallane:v1:emote-tab-order";

function loadStoredTabOrder(): string[] {
  try {
    const raw = window.localStorage.getItem(TAB_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
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
}

function applyLibraryPayload(lib: EmoteLibraryDTO) {
  const emotes = Array.isArray(lib.emotes) ? lib.emotes : [];
  const collections = Array.isArray(lib.collections) ? lib.collections : [];
  const customSrcMap: Record<string, string> = {};
  for (const e of emotes) {
    if (e.id && e.src) customSrcMap[e.id] = e.src;
  }
  for (const col of collections) {
    for (const item of col.items || []) {
      if (item.id && item.src) customSrcMap[item.id] = item.src;
    }
  }
  return { emotes, collections, customSrcMap };
}

export const useEmoteStore = create<EmoteState>((set, get) => ({
  loaded: false,
  loading: false,
  emotes: [],
  collections: [],
  customSrcMap: {},
  settings: null,
  tabOrder: loadStoredTabOrder(),

  refreshLibrary: async (withSettings = true) => {
    set({ loading: true });
    try {
      const [lib, settingsRes] = await Promise.all([
        mobileApi.getEmoteLibrary(),
        withSettings ? mobileApi.getEmoteSettings().catch(() => null) : Promise.resolve(null),
      ]);
      const mapped = applyLibraryPayload(lib);
      set((s) => ({
        loaded: true,
        loading: false,
        ...mapped,
        settings: settingsRes?.settings || s.settings,
      }));
    } catch {
      set({ loading: false });
    }
  },

  hydrateTabOrderFromPreferences: (rawOrder) => {
    if (!Array.isArray(rawOrder)) return;
    const cleaned = rawOrder.map(String).filter(Boolean);
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
        id: `col:${col.id}`,
        label: col.name,
        kind: "collection" as const,
        collection: col,
      })),
      ...visibleEmotePacks
        .filter((p) => (!enabledPackIds || enabledPackIds.length === 0 ? true : enabledPackIds.includes(p.id)))
        .map((p) => ({
          id: `pack:${p.id}`,
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
    const tabs = get().getOrderedTabs().map((t) => t.id);
    const idx = tabs.indexOf(tabId);
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
}));
