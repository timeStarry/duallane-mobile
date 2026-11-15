import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";

export type MobileTabId = "chats" | "direct" | "contacts" | "me";

export interface ToastNotice {
  id: string;
  tone: "info" | "success" | "warning" | "danger";
  message: string;
}

export interface LightboxMediaPayload {
  src: string;
  title?: string;
  downloadUrl?: string;
  favoriteInput?: {
    messageId: string;
    customEmoteId?: string;
    attachmentId?: string;
    emoteKey?: string;
  };
}

interface NavState {
  entryLane: "welcome" | "login" | "direct_guest";
  activeTab: MobileTabId;
  activeChatId: string | null;
  searchOpen: boolean;

  // Sheets & Modals
  actionMessageId: string | null;
  threadRootId: string | null;
  chatDetailOpen: boolean;
  stickerStudioOpen: boolean;
  sharedPackId: string | null;
  botManageOpen: boolean;
  botSetupSessionId: string | null;
  createChatMode: "direct" | "group" | null;
  forwardingMessageIds: string[] | null;
  serverConfigOpen: boolean;
  lightboxMedia: LightboxMediaPayload | null;

  toast: ToastNotice | null;

  setEntryLane: (lane: "welcome" | "login" | "direct_guest") => void;
  setActiveTab: (tab: MobileTabId) => void;
  openChat: (conversationId: string) => void;
  closeChat: () => void;
  setSearchOpen: (open: boolean) => void;

  setActionMessageId: (messageId: string | null) => void;
  setThreadRootId: (rootId: string | null) => void;
  setChatDetailOpen: (open: boolean) => void;
  setStickerStudioOpen: (open: boolean) => void;
  setSharedPackId: (shareId: string | null) => void;
  setBotManageOpen: (open: boolean) => void;
  setBotSetupSessionId: (sessionId: string | null) => void;
  setCreateChatMode: (mode: "direct" | "group" | null) => void;
  setForwardingMessageIds: (ids: string[] | null) => void;
  setServerConfigOpen: (open: boolean) => void;
  setLightboxMedia: (media: LightboxMediaPayload | null) => void;

  showToast: (message: string, tone?: ToastNotice["tone"]) => void;
  canPopBack: () => boolean;
  popBack: () => boolean;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function syncHardwareBack(state: NavState) {
  nativeBridge.setCanGoBack(state.canPopBack());
}

export const useNavStore = create<NavState>((set, get) => ({
  entryLane: "welcome",
  activeTab: "chats",
  activeChatId: null,
  searchOpen: false,

  actionMessageId: null,
  threadRootId: null,
  chatDetailOpen: false,
  stickerStudioOpen: false,
  sharedPackId: null,
  botManageOpen: false,
  botSetupSessionId: null,
  createChatMode: null,
  forwardingMessageIds: null,
  serverConfigOpen: false,
  lightboxMedia: null,

  toast: null,

  setEntryLane: (entryLane) => {
    set({ entryLane });
    syncHardwareBack(get());
  },

  setActiveTab: (activeTab) => {
    nativeBridge.haptic("selection");
    set({ activeTab, activeChatId: null, searchOpen: false });
    syncHardwareBack(get());
  },

  openChat: (conversationId) => {
    nativeBridge.haptic("light");
    set({
      activeChatId: conversationId,
      searchOpen: false,
      actionMessageId: null,
      chatDetailOpen: false,
      threadRootId: null,
    });
    syncHardwareBack(get());
  },

  closeChat: () => {
    set({
      activeChatId: null,
      actionMessageId: null,
      chatDetailOpen: null as unknown as boolean,
      threadRootId: null,
    });
    set({ chatDetailOpen: false });
    syncHardwareBack(get());
  },

  setSearchOpen: (searchOpen) => {
    set({ searchOpen });
    syncHardwareBack(get());
  },

  setActionMessageId: (actionMessageId) => {
    if (actionMessageId) nativeBridge.haptic("medium");
    set({ actionMessageId });
    syncHardwareBack(get());
  },

  setThreadRootId: (threadRootId) => {
    set({ threadRootId, actionMessageId: null });
    syncHardwareBack(get());
  },

  setChatDetailOpen: (chatDetailOpen) => {
    set({ chatDetailOpen });
    syncHardwareBack(get());
  },

  setStickerStudioOpen: (stickerStudioOpen) => {
    set({ stickerStudioOpen });
    syncHardwareBack(get());
  },

  setSharedPackId: (sharedPackId) => {
    set({ sharedPackId });
    syncHardwareBack(get());
  },

  setBotManageOpen: (botManageOpen) => {
    set({ botManageOpen });
    syncHardwareBack(get());
  },

  setBotSetupSessionId: (botSetupSessionId) => {
    set({ botSetupSessionId });
    syncHardwareBack(get());
  },

  setCreateChatMode: (createChatMode) => {
    set({ createChatMode });
    syncHardwareBack(get());
  },

  setForwardingMessageIds: (forwardingMessageIds) => {
    set({ forwardingMessageIds, actionMessageId: null });
    syncHardwareBack(get());
  },

  setServerConfigOpen: (serverConfigOpen) => {
    set({ serverConfigOpen });
    syncHardwareBack(get());
  },

  setLightboxMedia: (lightboxMedia) => {
    set({ lightboxMedia });
    syncHardwareBack(get());
  },

  showToast: (message, tone = "info") => {
    if (toastTimer) clearTimeout(toastTimer);
    const id = `t_${Date.now()}`;
    set({ toast: { id, tone, message } });
    toastTimer = setTimeout(() => {
      if (get().toast?.id === id) {
        set({ toast: null });
      }
    }, 2800);
  },

  canPopBack: () => {
    const s = get();
    return Boolean(
      s.lightboxMedia ||
        s.serverConfigOpen ||
        s.actionMessageId ||
        s.forwardingMessageIds ||
        s.sharedPackId ||
        s.botSetupSessionId ||
        s.stickerStudioOpen ||
        s.botManageOpen ||
        s.createChatMode ||
        s.threadRootId ||
        s.chatDetailOpen ||
        s.activeChatId ||
        s.searchOpen ||
        s.activeTab !== "chats" ||
        s.entryLane !== "welcome"
    );
  },

  popBack: () => {
    const s = get();
    if (s.lightboxMedia) {
      set({ lightboxMedia: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.serverConfigOpen) {
      set({ serverConfigOpen: false });
      syncHardwareBack(get());
      return true;
    }
    if (s.actionMessageId) {
      set({ actionMessageId: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.forwardingMessageIds) {
      set({ forwardingMessageIds: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.sharedPackId) {
      set({ sharedPackId: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.botSetupSessionId) {
      set({ botSetupSessionId: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.stickerStudioOpen) {
      set({ stickerStudioOpen: false });
      syncHardwareBack(get());
      return true;
    }
    if (s.botManageOpen) {
      set({ botManageOpen: false });
      syncHardwareBack(get());
      return true;
    }
    if (s.createChatMode) {
      set({ createChatMode: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.threadRootId) {
      set({ threadRootId: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.chatDetailOpen) {
      set({ chatDetailOpen: false });
      syncHardwareBack(get());
      return true;
    }
    if (s.activeChatId) {
      set({ activeChatId: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.searchOpen) {
      set({ searchOpen: false });
      syncHardwareBack(get());
      return true;
    }
    if (s.activeTab !== "chats") {
      set({ activeTab: "chats" });
      syncHardwareBack(get());
      return true;
    }
    if (s.entryLane !== "welcome") {
      set({ entryLane: "welcome" });
      syncHardwareBack(get());
      return true;
    }
    return false;
  },
}));
