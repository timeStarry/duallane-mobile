import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";

export type MobileTabId = "chats" | "contacts" | "me";
export type MeSubSheetId =
  | "profile"
  | "notifications"
  | "reading"
  | "appearance"
  | "email"
  | "devices"
  | null;

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
  searchConversationId: string | null;
  profileSheetUserId: string | null;
  directOverlayOpen: boolean;
  updateSheetOpen: boolean;
  meSubSheet: MeSubSheetId;

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
  pendingExternalUrl: string | null;

  toast: ToastNotice | null;

  setEntryLane: (lane: "welcome" | "login" | "direct_guest") => void;
  setActiveTab: (tab: MobileTabId) => void;
  openChat: (conversationId: string) => void;
  closeChat: () => void;
  setSearchOpen: (open: boolean) => void;
  openSearchInConversation: (conversationId: string | null) => void;
  setProfileSheetUserId: (userId: string | null) => void;
  setDirectOverlayOpen: (open: boolean) => void;
  setUpdateSheetOpen: (open: boolean) => void;
  setMeSubSheet: (sheet: MeSubSheetId) => void;

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
  setPendingExternalUrl: (url: string | null) => void;

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
  searchConversationId: null,
  profileSheetUserId: null,
  directOverlayOpen: false,
  updateSheetOpen: false,
  meSubSheet: null,

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
  pendingExternalUrl: null,

  toast: null,

  setEntryLane: (entryLane) => {
    set({ entryLane });
    syncHardwareBack(get());
  },

  setActiveTab: (activeTab) => {
    nativeBridge.haptic("selection");
    set({
      activeTab,
      activeChatId: null,
      searchOpen: false,
      directOverlayOpen: false,
      meSubSheet: null,
    });
    syncHardwareBack(get());
  },

  openChat: (conversationId) => {
    nativeBridge.haptic("light");
    set({
      activeChatId: conversationId,
      searchOpen: false,
      directOverlayOpen: false,
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
      chatDetailOpen: false,
      threadRootId: null,
    });
    syncHardwareBack(get());
  },

  setSearchOpen: (searchOpen) => {
    set((s) => ({
      searchOpen,
      searchConversationId: searchOpen ? s.searchConversationId : null,
    }));
    syncHardwareBack(get());
  },

  openSearchInConversation: (conversationId) => {
    set({
      searchOpen: true,
      searchConversationId: conversationId,
    });
    syncHardwareBack(get());
  },

  setProfileSheetUserId: (profileSheetUserId) => {
    set({ profileSheetUserId });
    syncHardwareBack(get());
  },

  setDirectOverlayOpen: (directOverlayOpen) => {
    if (directOverlayOpen) nativeBridge.haptic("light");
    set({ directOverlayOpen });
    syncHardwareBack(get());
  },

  setUpdateSheetOpen: (updateSheetOpen) => {
    set({ updateSheetOpen });
    syncHardwareBack(get());
  },

  setMeSubSheet: (meSubSheet) => {
    set({ meSubSheet });
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

  setPendingExternalUrl: (pendingExternalUrl) => {
    set({ pendingExternalUrl });
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
      s.pendingExternalUrl ||
        s.lightboxMedia ||
        s.serverConfigOpen ||
        s.updateSheetOpen ||
        s.meSubSheet ||
        s.profileSheetUserId ||
        s.actionMessageId ||
        s.forwardingMessageIds ||
        s.sharedPackId ||
        s.botSetupSessionId ||
        s.stickerStudioOpen ||
        s.botManageOpen ||
        s.createChatMode ||
        s.threadRootId ||
        s.chatDetailOpen ||
        s.directOverlayOpen ||
        s.activeChatId ||
        s.searchOpen ||
        s.activeTab !== "chats" ||
        s.entryLane !== "welcome"
    );
  },

  popBack: () => {
    const s = get();
    if (s.pendingExternalUrl) {
      set({ pendingExternalUrl: null });
      syncHardwareBack(get());
      return true;
    }
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
    if (s.updateSheetOpen) {
      set({ updateSheetOpen: false });
      syncHardwareBack(get());
      return true;
    }
    if (s.meSubSheet) {
      set({ meSubSheet: null });
      syncHardwareBack(get());
      return true;
    }
    if (s.profileSheetUserId) {
      set({ profileSheetUserId: null });
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
    if (s.directOverlayOpen) {
      set({ directOverlayOpen: false });
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
