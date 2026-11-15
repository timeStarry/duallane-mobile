import { useCallback, useMemo, useState } from "react";
import {
  Bookmark,
  CheckCheck,
  ChevronRight,
  Lock,
  MessageSquarePlus,
  Pin,
  Plus,
  Search,
  Sparkles,
  Users,
  WifiOff,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { BrandLogo } from "@/components/BrandLogo";
import { nativeBridge } from "@/native/bridge";
import { formatConversationPreviewText } from "@/shared/emotes";
import { formatConversationTime } from "@/shared/format";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore, type V1Conversation } from "@/store/workspace-store";

type ChatFilter = "all" | "unread" | "mention" | "group" | "bot";

export function ChatsTab() {
  const conversations = useWorkspaceStore((s) => s.conversations);
  const conversationOrder = useWorkspaceStore((s) => s.conversationOrder);
  const pinnedConversationIds = useWorkspaceStore((s) => s.pinnedConversationIds);
  const members = useWorkspaceStore((s) => s.members);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const drafts = useWorkspaceStore((s) => s.drafts);
  const typingByConv = useWorkspaceStore((s) => s.typingByConv);
  const connectionStatus = useWorkspaceStore((s) => s.connectionStatus);
  const p2pRoom = useWorkspaceStore((s) => s.p2pRoom);
  const togglePinConversation = useWorkspaceStore((s) => s.togglePinConversation);
  const markRead = useWorkspaceStore((s) => s.markRead);
  const leaveGroup = useWorkspaceStore((s) => s.leaveGroup);

  const openChat = useNavStore((s) => s.openChat);
  const setSearchOpen = useNavStore((s) => s.setSearchOpen);
  const setCreateChatMode = useNavStore((s) => s.setCreateChatMode);
  const setBotManageOpen = useNavStore((s) => s.setBotManageOpen);
  const setDirectOverlayOpen = useNavStore((s) => s.setDirectOverlayOpen);

  const [filter, setFilter] = useState<ChatFilter>("all");
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [contextConv, setContextConv] = useState<V1Conversation | null>(null);

  const isBotDirect = useCallback(
    (conv: V1Conversation) => {
      if (conv.kind !== "direct") return false;
      const peerId = conv.memberIds.find((id) => id !== currentUser?.id);
      return Boolean(peerId && members[peerId]?.role === "bot");
    },
    [currentUser?.id, members]
  );

  const sortedConversations = useMemo(() => {
    const pinnedSet = new Set(pinnedConversationIds);
    const allIds = Array.from(new Set([...pinnedConversationIds, ...conversationOrder]));
    const list = allIds
      .map((id) => conversations[id])
      .filter((c): c is V1Conversation => Boolean(c));

    const filtered = list.filter((c) => {
      if (filter === "unread") return c.unreadCount > 0;
      if (filter === "mention") return c.mentionCount > 0;
      if (filter === "group") return c.kind === "group";
      if (filter === "bot") return isBotDirect(c);
      return true;
    });

    return filtered.sort((a, b) => {
      const aPinned = pinnedSet.has(a.id) ? 1 : 0;
      const bPinned = pinnedSet.has(b.id) ? 1 : 0;
      if (aPinned !== bPinned) return bPinned - aPinned;
      const aTime = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0;
      const bTime = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0;
      return bTime - aTime;
    });
  }, [conversations, conversationOrder, pinnedConversationIds, filter, isBotDirect]);

  const totalUnread = useMemo(
    () => Object.values(conversations).reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [conversations]
  );

  const savedConv = useMemo(
    () => Object.values(conversations).find((c) => c.kind === "saved"),
    [conversations]
  );

  return (
    <div className="h-full flex flex-col bg-[var(--dl-bg)]">
      {/* Sticky Top App Bar (Feishu / Telegram Mobile Style) */}
      <header className="pt-[var(--safe-top)] bg-[var(--dl-surface)] dl-glass border-b border-[var(--dl-border)] shrink-0 z-20">
        <div className="h-13 px-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size={28} withTile />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-[17px] font-bold tracking-tight text-[var(--dl-text)]">
                  消息
                </h1>
                {totalUnread > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[var(--dl-accent)] text-white text-[11px] font-semibold">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                )}
                {connectionStatus !== "connected" && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-medium flex items-center gap-1">
                    <WifiOff size={10} />
                    {connectionStatus === "reconnecting" ? "重连中" : "离线"}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="全局搜索"
              className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)]"
            >
              <Search size={19} />
            </button>
            <button
              type="button"
              onClick={() => setPlusMenuOpen(true)}
              aria-label="新建会话与快捷操作"
              className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)]"
            >
              <Plus size={21} />
            </button>
          </div>
        </div>

        {/* Filter Chips */}
        <div className="px-3.5 pb-2.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              { id: "all", label: "全部" },
              { id: "unread", label: "未读" },
              { id: "mention", label: "@我" },
              { id: "group", label: "群聊" },
              { id: "bot", label: "机器人" },
            ] as const
          ).map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium whitespace-nowrap transition ${
                  active
                    ? "bg-[var(--dl-accent)] text-white shadow-2xs"
                    : "bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </header>

      {p2pRoom && (
        <button
          type="button"
          onClick={() => setDirectOverlayOpen(true)}
          className="px-4 py-2 bg-amber-500/14 border-b border-amber-500/25 flex items-center justify-between gap-2 text-left shrink-0 active:opacity-85"
        >
          <span className="flex items-center gap-2 text-[12px] font-semibold text-amber-700 dark:text-amber-300 truncate">
            <Lock size={14} className="shrink-0" />
            <span className="truncate">
              一对一加密直连进行中 · 房间 #{p2pRoom.roomId.slice(0, 8)}
            </span>
          </span>
          <ChevronRight size={15} className="text-amber-600 dark:text-amber-300 shrink-0" />
        </button>
      )}

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[var(--dl-border)]/50">
        {sortedConversations.length === 0 ? (
          <div className="py-20 px-6 text-center">
            <p className="text-[14px] font-medium text-[var(--dl-text-muted)]">
              当前筛选下暂无会话
            </p>
            <button
              type="button"
              onClick={() => setCreateChatMode("group")}
              className="mt-4 px-4 py-2 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[13px] font-semibold"
            >
              发起新群聊
            </button>
          </div>
        ) : (
          sortedConversations.map((conv) => {
            const isPinned = pinnedConversationIds.includes(conv.id);
            const draft = drafts[conv.id];
            const typers = typingByConv[conv.id] || [];
            const botChat = isBotDirect(conv);
            const peerId =
              conv.kind === "direct"
                ? conv.memberIds.find((id) => id !== currentUser?.id)
                : undefined;
            const directPeer = peerId ? members[peerId] : undefined;
            const avatarKind =
              conv.kind === "saved"
                ? "saved"
                : conv.kind === "group"
                ? "group"
                : botChat
                ? "bot"
                : "user";

            let longPressTimer: ReturnType<typeof setTimeout> | null = null;

            return (
              <div
                key={conv.id}
                onClick={() => openChat(conv.id)}
                onTouchStart={() => {
                  longPressTimer = setTimeout(() => {
                    nativeBridge.haptic("medium");
                    setContextConv(conv);
                  }, 450);
                }}
                onTouchEnd={() => {
                  if (longPressTimer) clearTimeout(longPressTimer);
                }}
                onTouchMove={() => {
                  if (longPressTimer) clearTimeout(longPressTimer);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextConv(conv);
                }}
                className={`px-4 py-3 flex items-center gap-3 active:bg-[var(--dl-card)] transition-colors select-none ${
                  isPinned ? "bg-[var(--dl-card)]/35" : "bg-[var(--dl-surface)]"
                }`}
              >
                <Avatar
                  name={conv.title}
                  src={conv.avatarUrl || directPeer?.avatarUrl}
                  emoji={conv.avatarEmoji}
                  kind={avatarKind}
                  color={botChat ? directPeer?.avatarColor : undefined}
                  size={48}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[15px] font-semibold text-[var(--dl-text)] truncate">
                        {conv.title}
                      </span>
                      {botChat && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] shrink-0">
                          BOT
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-[var(--dl-text-muted)] shrink-0">
                      {isPinned && <Pin size={11} className="text-[var(--dl-accent)]" />}
                      <span>{formatConversationTime(conv.lastMessageAt)}</span>
                    </div>
                  </div>

                  <div className="mt-1 flex items-center justify-between gap-2">
                    <div className="text-[13px] text-[var(--dl-text-muted)] truncate flex-1">
                      {typers.length > 0 ? (
                        <span className="text-[var(--dl-accent)] font-medium">
                          {typers[0].state === "thinking"
                            ? `${typers[0].displayName} 正在思考…`
                            : `${typers[0].displayName} 正在输入…`}
                        </span>
                      ) : draft?.text ? (
                        <span>
                          <span className="text-rose-500 font-medium">[草稿] </span>
                          {draft.text}
                        </span>
                      ) : (
                        <>
                          {conv.mentionCount > 0 && (
                            <span className="text-rose-500 font-semibold mr-1">[有人@我]</span>
                          )}
                          <span>{formatConversationPreviewText(conv.lastMessageText)}</span>
                        </>
                      )}
                    </div>

                    {conv.unreadCount > 0 && (
                      <span
                        className={`px-1.5 min-w-[20px] h-5 rounded-full text-[11px] font-bold flex items-center justify-center text-white shrink-0 ${
                          conv.mentionCount > 0 ? "bg-rose-500" : "bg-[var(--dl-accent)]"
                        }`}
                      >
                        {conv.unreadCount > 99 ? "99+" : conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick + Action Sheet */}
      <BottomSheet open={plusMenuOpen} onClose={() => setPlusMenuOpen(false)} title="快捷操作">
        <div className="p-3 space-y-1">
          <button
            type="button"
            onClick={() => {
              setPlusMenuOpen(false);
              setCreateChatMode("direct");
            }}
            className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-[var(--dl-text)] active:bg-[var(--dl-card)]"
          >
            <MessageSquarePlus size={19} className="text-[var(--dl-accent)]" />
            <span>发起单聊</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setPlusMenuOpen(false);
              setCreateChatMode("group");
            }}
            className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-[var(--dl-text)] active:bg-[var(--dl-card)]"
          >
            <Users size={19} className="text-[var(--dl-accent)]" />
            <span>创建群组</span>
          </button>
          {savedConv && (
            <button
              type="button"
              onClick={() => {
                setPlusMenuOpen(false);
                openChat(savedConv.id);
              }}
              className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-[var(--dl-text)] active:bg-[var(--dl-card)]"
            >
              <Bookmark size={19} className="text-[var(--dl-accent)]" />
              <span>打开我的收藏</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPlusMenuOpen(false);
              setBotManageOpen(true);
            }}
            className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-[var(--dl-text)] active:bg-[var(--dl-card)]"
          >
            <Sparkles size={19} className="text-[var(--dl-accent)]" />
            <span>管理我的机器人</span>
          </button>
        </div>
      </BottomSheet>

      {/* Long-Press Conversation Context Sheet */}
      <BottomSheet
        open={Boolean(contextConv)}
        onClose={() => setContextConv(null)}
        title={contextConv?.title}
      >
        {contextConv && (
          <div className="p-3 space-y-1">
            <button
              type="button"
              onClick={() => {
                void togglePinConversation(contextConv.id);
                setContextConv(null);
              }}
              className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-[var(--dl-text)] active:bg-[var(--dl-card)]"
            >
              <Pin size={18} className="text-[var(--dl-accent)]" />
              <span>
                {pinnedConversationIds.includes(contextConv.id) ? "取消置顶会话" : "置顶该会话"}
              </span>
            </button>
            {contextConv.unreadCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  markRead(contextConv.id);
                  setContextConv(null);
                }}
                className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-[var(--dl-text)] active:bg-[var(--dl-card)]"
              >
                <CheckCheck size={18} className="text-emerald-500" />
                <span>标为已读</span>
              </button>
            )}
            {contextConv.kind === "group" && (
              <button
                type="button"
                onClick={() => {
                  void leaveGroup(contextConv.id);
                  setContextConv(null);
                }}
                className="w-full px-4 py-3 rounded-2xl flex items-center gap-3 text-[15px] font-medium text-rose-500 active:bg-rose-500/10"
              >
                <span>退出群聊</span>
              </button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
