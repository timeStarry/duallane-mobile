import React, { useEffect, useMemo } from "react";
import { Lock, MessageCircle, User, Users } from "lucide-react";
import { BrandLogo } from "./components/BrandLogo";
import { MediaLightbox } from "./components/MediaLightbox";
import { nativeBridge } from "./native/bridge";
import { ChatRoomScreen } from "./screens/ChatRoomScreen";
import { ChatsTab } from "./screens/ChatsTab";
import { ContactsTab } from "./screens/ContactsTab";
import { CreateAndForwardSheets } from "./screens/CreateAndForwardSheets";
import { DirectTab } from "./screens/DirectTab";
import { EntryScreen } from "./screens/EntryScreen";
import { MeTab } from "./screens/MeTab";
import { SearchScreen } from "./screens/SearchScreen";
import { StickerAndBotSheets } from "./screens/StickerAndBotSheets";
import { ThreadAndDetailSheets } from "./screens/ThreadAndDetailSheets";
import { useNavStore, type MobileTabId } from "./store/nav-store";
import { useWorkspaceStore } from "./store/workspace-store";

export function App() {
  const authStatus = useWorkspaceStore((s) => s.authStatus);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const p2pRoom = useWorkspaceStore((s) => s.p2pRoom);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);
  const handleDeepLink = useWorkspaceStore((s) => s.handleDeepLink);

  const activeTab = useNavStore((s) => s.activeTab);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const activeChatId = useNavStore((s) => s.activeChatId);
  const toast = useNavStore((s) => s.toast);
  const popBack = useNavStore((s) => s.popBack);

  useEffect(() => {
    void bootstrapWorkspace();
  }, [bootstrapWorkspace]);

  useEffect(() => {
    nativeBridge.setBackPressHandler(() => popBack());
    return () => nativeBridge.setBackPressHandler(null);
  }, [popBack]);

  useEffect(() => {
    const off = nativeBridge.onDeepLink((url) => {
      void handleDeepLink(url);
    });
    if (typeof window !== "undefined" && (window.location.search || window.location.hash)) {
      void handleDeepLink(window.location.href);
    }
    return off;
  }, [handleDeepLink]);

  const totalUnread = useMemo(
    () => Object.values(conversations).reduce((sum, c) => sum + (c.unreadCount || 0), 0),
    [conversations]
  );

  const renderToast = () => {
    if (!toast) return null;
    const toneCls =
      toast.tone === "success"
        ? "bg-emerald-600 text-white"
        : toast.tone === "danger"
        ? "bg-rose-600 text-white"
        : toast.tone === "warning"
        ? "bg-amber-600 text-white"
        : "bg-slate-900/90 dark:bg-slate-100/95 text-white dark:text-slate-900";
    return (
      <div className="fixed top-[calc(var(--safe-top)+12px)] left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full text-[13px] font-medium shadow-lg pointer-events-none max-w-[88vw] truncate">
        <span className={`px-3.5 py-1.5 rounded-full inline-block ${toneCls}`}>
          {toast.message}
        </span>
      </div>
    );
  };

  if (authStatus === "checking") {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center bg-[var(--dl-bg)] gap-3">
        <BrandLogo size={56} withTile />
        <span className="text-[13px] text-[var(--dl-text-muted)]">正在载入 DualLane…</span>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    return (
      <>
        <EntryScreen />
        <MediaLightbox />
        {renderToast()}
      </>
    );
  }

  const tabs: Array<{
    id: MobileTabId;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    badge?: number | "dot";
  }> = [
    {
      id: "chats",
      label: "消息",
      icon: MessageCircle,
      badge: totalUnread > 0 ? totalUnread : undefined,
    },
    {
      id: "direct",
      label: "直连",
      icon: Lock,
      badge: p2pRoom ? "dot" : undefined,
    },
    {
      id: "contacts",
      label: "通讯录",
      icon: Users,
    },
    {
      id: "me",
      label: "我",
      icon: User,
    },
  ];

  return (
    <div className="h-full w-full flex flex-col bg-[var(--dl-bg)] overflow-hidden">
      {/* Main Tab Viewport */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "chats" && <ChatsTab />}
        {activeTab === "direct" && <DirectTab />}
        {activeTab === "contacts" && <ContactsTab />}
        {activeTab === "me" && <MeTab />}
      </main>

      {/* Bottom Tab Navigation (Hidden when inside full-screen ChatRoom or active P2P Room with keyboard) */}
      {!activeChatId && (
        <nav
          aria-label="主导航栏"
          className="bg-[var(--dl-surface)] dl-glass border-t border-[var(--dl-border)] pb-[var(--safe-bottom)] shrink-0 z-20"
        >
          <div className="h-14 grid grid-cols-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex flex-col items-center justify-center gap-0.5 transition ${
                    active ? "text-[var(--dl-accent)]" : "text-[var(--dl-text-muted)]"
                  }`}
                >
                  <div className="relative">
                    <Icon size={21} />
                    {typeof tab.badge === "number" && (
                      <span className="absolute -top-1.5 -right-2.5 px-1 min-w-[16px] h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                        {tab.badge > 99 ? "99+" : tab.badge}
                      </span>
                    )}
                    {tab.badge === "dot" && (
                      <span className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full bg-amber-500" />
                    )}
                  </div>
                  <span className="text-[11px] font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {/* Full-Screen Chat Room Stack */}
      {activeChatId && <ChatRoomScreen conversationId={activeChatId} />}

      {/* Global Search Screen */}
      <SearchScreen />

      {/* Sheets & Modals */}
      <CreateAndForwardSheets />
      <ThreadAndDetailSheets />
      <StickerAndBotSheets />
      <MediaLightbox />
      {renderToast()}
    </div>
  );
}
