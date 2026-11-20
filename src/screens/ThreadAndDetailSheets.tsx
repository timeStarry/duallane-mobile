import { useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Bell,
  BellOff,
  Check,
  Edit3,
  FileText,
  Image as ImageIcon,
  LogOut,
  MessageSquare,
  Pin,
  Send,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { BotGroupRequests } from "@/components/BotGroupRequests";
import { CardKitView } from "@/components/CardKitView";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type SearchFileHit } from "@/shared/api";
import { resolveAssetUrl } from "@/shared/emotes";
import { formatBytes, formatConversationTime, formatMessageClock } from "@/shared/format";
import { ChatMarkdown } from "@/shared/markdown";
import { useNavStore } from "@/store/nav-store";
import {
  useWorkspaceStore,
  type ConversationNotificationLevel,
  type V1User,
} from "@/store/workspace-store";

interface ConversationMediaItem {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  previewUrl: string;
  downloadUrl: string;
  sourceMessageId?: string;
  createdAt: string;
}

export function ThreadAndDetailSheets() {
  const activeChatId = useNavStore((s) => s.activeChatId);
  const threadRootId = useNavStore((s) => s.threadRootId);
  const setThreadRootId = useNavStore((s) => s.setThreadRootId);
  const chatDetailOpen = useNavStore((s) => s.chatDetailOpen);
  const setChatDetailOpen = useNavStore((s) => s.setChatDetailOpen);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);
  const showToast = useNavStore((s) => s.showToast);

  const conversations = useWorkspaceStore((s) => s.conversations);
  const pinnedConversationIds = useWorkspaceStore((s) => s.pinnedConversationIds);
  const messagesByConv = useWorkspaceStore((s) => s.messagesByConv);
  const members = useWorkspaceStore((s) => s.members);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const threadsByRootId = useWorkspaceStore((s) => s.threadsByRootId);
  const loadThread = useWorkspaceStore((s) => s.loadThread);
  const sendThreadReply = useWorkspaceStore((s) => s.sendThreadReply);
  const togglePinConversation = useWorkspaceStore((s) => s.togglePinConversation);
  const setConversationNotificationLevel = useWorkspaceStore(
    (s) => s.setConversationNotificationLevel
  );
  const setMemberRemark = useWorkspaceStore((s) => s.setMemberRemark);
  const startDirectChatWithUser = useWorkspaceStore((s) => s.startDirectChatWithUser);
  const updateGroupProfile = useWorkspaceStore((s) => s.updateGroupProfile);
  const inviteGroupMembers = useWorkspaceStore((s) => s.inviteGroupMembers);
  const removeGroupMember = useWorkspaceStore((s) => s.removeGroupMember);
  const leaveGroup = useWorkspaceStore((s) => s.leaveGroup);

  const [replyText, setReplyText] = useState("");
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [addingMemberOpen, setAddingMemberOpen] = useState(false);
  const [detailSegment, setDetailSegment] = useState<"info" | "media">("info");
  const [remoteFiles, setRemoteFiles] = useState<SearchFileHit[]>([]);
  const [hasMoreMedia, setHasMoreMedia] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [confirmRemoveUid, setConfirmRemoveUid] = useState<string | null>(null);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const [remarkTargetId, setRemarkTargetId] = useState<string | null>(null);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const threadInputRef = useRef<HTMLInputElement | null>(null);

  const activeConv = activeChatId ? conversations[activeChatId] : undefined;
  const threadView = threadRootId ? threadsByRootId[threadRootId] : undefined;
  const rootMsg =
    activeChatId && threadRootId
      ? (messagesByConv[activeChatId] || []).find((m) => m.id === threadRootId)
      : undefined;

  const directPeerId =
    activeConv?.kind === "direct"
      ? activeConv.memberIds.find((uid) => uid !== currentUser?.id)
      : undefined;
  const directPeer = directPeerId ? members[directPeerId] : undefined;
  const remarkTarget: V1User | undefined = remarkTargetId ? members[remarkTargetId] : undefined;

  useEffect(() => {
    if (threadRootId) {
      void loadThread(threadRootId).catch(() => {});
    }
  }, [threadRootId, loadThread]);

  useEffect(() => {
    if (activeConv) {
      setTitleDraft(activeConv.title);
    }
  }, [activeConv]);

  useEffect(() => {
    if (!chatDetailOpen) {
      setDetailSegment("info");
      setAddingMemberOpen(false);
      setConfirmRemoveUid(null);
      setConfirmLeaveOpen(false);
      return;
    }
    if (detailSegment === "media" && activeConv?.id) {
      let cancelled = false;
      setLoadingMedia(true);
      void mobileApi
        .listConversationMedia(activeConv.id, "all", 40, 0)
        .then((res) => {
          if (!cancelled) {
            setRemoteFiles(res.items || []);
            setHasMoreMedia(Boolean(res.hasMore));
          }
        })
        .catch(() => {
          if (!cancelled) {
            setRemoteFiles([]);
            setHasMoreMedia(false);
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingMedia(false);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [chatDetailOpen, detailSegment, activeConv?.id]);

  const handleLoadMoreMedia = async () => {
    if (!activeConv?.id || loadingMedia || !hasMoreMedia) return;
    setLoadingMedia(true);
    try {
      const res = await mobileApi.listConversationMedia(activeConv.id, "all", 40, remoteFiles.length);
      setRemoteFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...(res.items || []).filter((f) => !seen.has(f.id))];
      });
      setHasMoreMedia(Boolean(res.hasMore));
    } finally {
      setLoadingMedia(false);
    }
  };

  const { mediaImages, mediaFiles } = useMemo(() => {
    if (!activeConv) return { mediaImages: [], mediaFiles: [] };
    const byId = new Map<string, ConversationMediaItem>();
    const localMsgs = messagesByConv[activeConv.id] || [];
    for (const m of localMsgs) {
      if (m.recalledAt || !m.attachments) continue;
      for (const a of m.attachments) {
        if (!a.id) continue;
        byId.set(a.id, {
          id: a.id,
          fileName: a.fileName,
          mimeType: a.mimeType,
          byteSize: a.byteSize,
          previewUrl: a.url,
          downloadUrl: a.downloadUrl || a.url,
          sourceMessageId: a.sourceMessageId || m.id,
          createdAt: m.createdAt,
        });
      }
    }
    for (const rf of remoteFiles) {
      if (!rf.id || byId.has(rf.id)) continue;
      const dl = `/api/workspace/files/${encodeURIComponent(rf.id)}/download`;
      const prev = rf.mimeType.startsWith("image/")
        ? `/api/workspace/files/${encodeURIComponent(rf.id)}/preview`
        : dl;
      byId.set(rf.id, {
        id: rf.id,
        fileName: rf.fileName,
        mimeType: rf.mimeType,
        byteSize: rf.byteSize,
        previewUrl: prev,
        downloadUrl: dl,
        sourceMessageId: rf.sourceMessageId,
        createdAt: rf.createdAt,
      });
    }
    const sorted = Array.from(byId.values()).sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    return {
      mediaImages: sorted.filter((x) => x.mimeType.startsWith("image/")),
      mediaFiles: sorted.filter((x) => !x.mimeType.startsWith("image/")),
    };
  }, [activeConv, messagesByConv, remoteFiles]);

  const openRemarkEditor = (user: V1User) => {
    setRemarkTargetId(user.id);
    setRemarkDraft(user.remark || "");
  };

  const handleSaveRemark = async (overrideValue?: string) => {
    if (!remarkTarget || savingRemark) return;
    const nextVal = (overrideValue !== undefined ? overrideValue : remarkDraft).trim();
    setSavingRemark(true);
    try {
      await setMemberRemark(remarkTarget.id, nextVal);
      setRemarkTargetId(null);
      showToast(nextVal ? "成员备注已保存" : "已恢复默认昵称", "success");
    } catch {
      showToast("保存成员备注失败", "danger");
    } finally {
      setSavingRemark(false);
    }
  };

  const handleChangeMute = async (level: ConversationNotificationLevel) => {
    if (!activeConv) return;
    try {
      await setConversationNotificationLevel(activeConv.id, level);
      const label =
        level === "muted" ? "免打扰" : level === "mentions" ? "仅 @我" : "全部提醒";
      showToast(`已切换为「${label}」`, "success");
    } catch {
      showToast("更新消息提醒失败", "danger");
    }
  };

  const handleSendThread = async () => {
    if (!threadRootId || !replyText.trim()) return;
    threadInputRef.current?.focus({ preventScroll: true });
    const body = replyText.trim();
    setReplyText("");
    threadInputRef.current?.focus({ preventScroll: true });
    try {
      await sendThreadReply(threadRootId, body, alsoToChannel);
    } catch {
      showToast("发送话题回复失败", "danger");
    }
  };

  const displayActiveTitle =
    activeConv?.kind === "direct" && directPeer?.displayName
      ? directPeer.displayName
      : activeConv?.title || "";

  return (
    <>
      {/* Thread Discussion Sheet */}
      <BottomSheet
        open={Boolean(threadRootId)}
        onClose={() => setThreadRootId(null)}
        title="话题讨论"
        subtitle={rootMsg ? `源消息：${rootMsg.senderName}` : undefined}
        maxHeight="88dvh"
      >
        <div className="flex flex-col h-[72dvh]">
          <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-3 min-w-0">
            {rootMsg && (
              <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] border border-[var(--dl-border)] min-w-0 overflow-hidden">
                <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--dl-text-muted)] mb-1">
                  <span className="font-semibold text-[var(--dl-text)] truncate">
                    {members[rootMsg.senderId]?.displayName || rootMsg.senderName}
                  </span>
                  <span className="shrink-0">{formatMessageClock(rootMsg.createdAt)}</span>
                </div>
                <div className="text-[14px] text-[var(--dl-text)]">
                  <ChatMarkdown text={rootMsg.plainText} tone="peer" lane="workspace" />
                </div>
              </div>
            )}

            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] pt-1">
              全部回复 ({threadView?.replies?.length || 0})
            </div>

            {(threadView?.replies || []).map((rep) => (
              <div
                key={rep.id}
                className="p-3 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] min-w-0 overflow-hidden"
              >
                <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--dl-text-muted)]">
                  <span className="font-semibold text-[var(--dl-text)] truncate">
                    {members[rep.authorId]?.displayName || rep.authorName}
                  </span>
                  <span className="shrink-0">{formatMessageClock(rep.createdAt)}</span>
                </div>
                <div className="mt-1 text-[14px] text-[var(--dl-text)]">
                  <ChatMarkdown text={rep.plainText} tone="peer" lane="workspace" />
                </div>
                {rep.card && <CardKitView card={rep.card} />}
              </div>
            ))}
          </div>

          <div className="p-3 border-t border-[var(--dl-border)] bg-[var(--dl-surface)] space-y-2 shrink-0">
            <label className="flex items-center gap-2 text-[12px] text-[var(--dl-text-muted)]">
              <input
                type="checkbox"
                checked={alsoToChannel}
                onChange={(e) => setAlsoToChannel(e.target.checked)}
              />
              <span>同时发送到主会话流</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                ref={threadInputRef}
                type="text"
                enterKeyHint="send"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    void handleSendThread();
                  }
                }}
                placeholder="回复该话题…"
                className="flex-1 px-3.5 py-2 rounded-xl bg-[var(--dl-card)] text-[14px] text-[var(--dl-text)] outline-none"
              />
              <button
                type="button"
                tabIndex={-1}
                aria-disabled={!replyText.trim()}
                onPointerDown={(e) => e.preventDefault()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleSendThread()}
                className={`w-9 h-9 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center transition-transform duration-150 ${
                  !replyText.trim() ? "opacity-40 pointer-events-none" : "active:scale-95"
                }`}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* Conversation / Group Detail Sheet */}
      <BottomSheet
        open={chatDetailOpen && Boolean(activeConv)}
        onClose={() => {
          setChatDetailOpen(false);
          setAddingMemberOpen(false);
        }}
        title="会话详情"
        maxHeight="86dvh"
      >
        {activeConv && (
          <div className="p-4 space-y-4">
            {/* Segmented Control: 详情 | 媒体与文件 */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-[var(--dl-card)]">
              <button
                type="button"
                onClick={() => setDetailSegment("info")}
                className={`py-2 rounded-xl text-[13px] font-semibold transition ${
                  detailSegment === "info"
                    ? "bg-[var(--dl-surface)] text-[var(--dl-text)] shadow-2xs"
                    : "text-[var(--dl-text-muted)]"
                }`}
              >
                详情
              </button>
              <button
                type="button"
                onClick={() => setDetailSegment("media")}
                className={`py-2 rounded-xl text-[13px] font-semibold transition ${
                  detailSegment === "media"
                    ? "bg-[var(--dl-surface)] text-[var(--dl-text)] shadow-2xs"
                    : "text-[var(--dl-text-muted)]"
                }`}
              >
                媒体与文件
              </button>
            </div>

            {detailSegment === "info" ? (
              <>
                <div className="flex items-center gap-3">
                  <Avatar
                    name={displayActiveTitle}
                    src={activeConv.avatarUrl || directPeer?.avatarUrl}
                    emoji={activeConv.avatarEmoji}
                    kind={
                      activeConv.kind === "saved"
                        ? "saved"
                        : activeConv.kind === "group"
                        ? "group"
                        : directPeer?.role === "bot"
                        ? "bot"
                        : "user"
                    }
                    color={directPeer?.avatarColor}
                    size={52}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[16px] font-bold text-[var(--dl-text)] truncate">
                      {displayActiveTitle}
                    </div>
                    <div className="text-[12px] text-[var(--dl-text-muted)] truncate">
                      {activeConv.kind === "group"
                        ? `群聊 · ${activeConv.memberIds.length} 人`
                        : activeConv.kind === "saved"
                        ? "云端个人收藏夹"
                        : directPeer?.remark && directPeer.rawDisplayName
                        ? `原昵称：${directPeer.rawDisplayName}`
                        : "一对一私聊"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void togglePinConversation(activeConv.id)}
                    className={`px-3 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1 ${
                      pinnedConversationIds.includes(activeConv.id)
                        ? "bg-[var(--dl-accent)] text-white"
                        : "bg-[var(--dl-card)] text-[var(--dl-text)]"
                    }`}
                  >
                    <Pin size={13} />
                    <span>{pinnedConversationIds.includes(activeConv.id) ? "已置顶" : "置顶"}</span>
                  </button>
                </div>

                {/* Conversation Notification Level Selector (A4) */}
                {activeConv.kind !== "saved" && (
                  <div className="p-3 rounded-2xl bg-[var(--dl-card)] space-y-2">
                    <div className="text-[12px] font-semibold text-[var(--dl-text-muted)]">
                      消息提醒级别
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {(
                        [
                          { id: "all", label: "全部提醒", icon: Bell },
                          { id: "mentions", label: "仅 @我", icon: AtSign },
                          { id: "muted", label: "免打扰", icon: BellOff },
                        ] as const
                      ).map((item) => {
                        const Icon = item.icon;
                        const cur = activeConv.notificationLevel || "all";
                        const active = cur === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => void handleChangeMute(item.id)}
                            className={`py-2 rounded-xl border text-[12px] font-medium flex items-center justify-center gap-1 transition ${
                              active
                                ? "border-[var(--dl-accent)] bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold"
                                : "border-[var(--dl-border)] bg-[var(--dl-surface)] text-[var(--dl-text-muted)]"
                            }`}
                          >
                            <Icon size={13} />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Direct Peer Remark Action (A3) */}
                {activeConv.kind === "direct" && directPeer && (
                  <button
                    type="button"
                    onClick={() => openRemarkEditor(directPeer)}
                    className="w-full px-3.5 py-3 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-2 text-left active:opacity-80"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Edit3 size={16} className="text-[var(--dl-accent)] shrink-0" />
                      <span className="text-[14px] font-medium text-[var(--dl-text)]">
                        设置好友备注
                      </span>
                    </div>
                    <span className="text-[12px] text-[var(--dl-text-muted)] truncate max-w-[140px]">
                      {directPeer.remark || "未设置（仅自己可见）"}
                    </span>
                  </button>
                )}

                {activeConv.kind === "group" && (
                  <>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!titleDraft.trim()) return;
                          await updateGroupProfile(activeConv.id, { title: titleDraft.trim() });
                          showToast("群名称已更新", "success");
                        }}
                        className="px-3 py-2 rounded-xl bg-[var(--dl-accent)] text-white text-[12px] font-semibold flex items-center gap-1"
                      >
                        <Check size={14} /> 保存
                      </button>
                    </div>

                    <BotGroupRequests key={activeConv.id} conversationId={activeConv.id} />

                    {/* Group Members */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-semibold text-[var(--dl-text-muted)]">
                          群成员 ({activeConv.memberIds.length}) · 点击成员可设备注
                        </span>
                        <button
                          type="button"
                          onClick={() => setAddingMemberOpen((v) => !v)}
                          className="text-[12px] font-semibold text-[var(--dl-accent)] flex items-center gap-1"
                        >
                          <UserPlus size={14} /> 邀请成员
                        </button>
                      </div>

                      {addingMemberOpen && (
                        <div className="mb-3 p-2.5 rounded-2xl bg-[var(--dl-card)] space-y-1 max-h-44 overflow-y-auto">
                          <p className="px-2.5 py-1 text-[11px] leading-5 text-[var(--dl-text-muted)]">
                            机器人由其创建者在“已接入会话”中发起入群请求，群管理员在本页批准。
                          </p>
                          {Object.values(members)
                            .filter((u) => u.role !== "bot" && !activeConv.memberIds.includes(u.id))
                            .map((u) => (
                              <button
                                key={u.id}
                                type="button"
                                onClick={async () => {
                                  await inviteGroupMembers(activeConv.id, [u.id]);
                                  setAddingMemberOpen(false);
                                  showToast(`已邀请 ${u.displayName}`, "success");
                                }}
                                className="w-full px-2.5 py-2 rounded-xl flex items-center justify-between text-left active:bg-[var(--dl-surface)]"
                              >
                                <span className="text-[13px] font-medium text-[var(--dl-text)]">
                                  {u.displayName}
                                </span>
                                <span className="text-[12px] text-[var(--dl-accent)]">添加</span>
                              </button>
                            ))}
                        </div>
                      )}

                      <div className="rounded-2xl bg-[var(--dl-card)] divide-y divide-[var(--dl-border)]/60 max-h-56 overflow-y-auto">
                        {activeConv.memberIds.map((uid) => {
                          const u = members[uid];
                          const name = u?.displayName || uid;
                          const isSelf = uid === currentUser?.id;
                          const canRemove =
                            !isSelf &&
                            !uid.startsWith("usr_system_") &&
                            (u?.role === "bot" ||
                              Boolean(activeConv.capabilities?.canRemoveMembers) ||
                              currentUser?.role === "owner" ||
                              currentUser?.role === "admin");
                          const confirmingThis = confirmRemoveUid === uid;
                          return (
                            <div
                              key={uid}
                              className="px-3 py-2.5 flex items-center justify-between gap-2"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setChatDetailOpen(false);
                                  useNavStore.getState().setProfileSheetUserId(uid);
                                }}
                                className="flex items-center gap-2.5 min-w-0 flex-1 text-left active:opacity-75"
                              >
                                <Avatar
                                  name={name}
                                  src={u?.avatarUrl}
                                  kind={u?.role === "bot" ? "bot" : "user"}
                                  color={u?.avatarColor}
                                  size={32}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[13px] font-medium text-[var(--dl-text)] truncate">
                                      {name}
                                    </span>
                                    {u?.role === "bot" && (
                                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]">
                                        BOT
                                      </span>
                                    )}
                                    {isSelf && (
                                      <span className="text-[11px] text-[var(--dl-text-muted)]">
                                        (我)
                                      </span>
                                    )}
                                  </div>
                                  {u?.remark && u.rawDisplayName && u.remark !== u.rawDisplayName && (
                                    <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                                      昵称：{u.rawDisplayName}
                                    </div>
                                  )}
                                </div>
                              </button>
                              {canRemove &&
                                (confirmingThis ? (
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setConfirmRemoveUid(null);
                                        void removeGroupMember(activeConv.id, uid);
                                      }}
                                      className="px-2 py-1 rounded-lg bg-rose-500 text-white text-[11px] font-semibold"
                                    >
                                      确认移除
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setConfirmRemoveUid(null)}
                                      className="px-2 py-1 rounded-lg bg-[var(--dl-surface)] text-[var(--dl-text-muted)] text-[11px]"
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmRemoveUid(uid)}
                                    className="p-1.5 text-rose-500 shrink-0"
                                    aria-label={`移除 ${name}`}
                                  >
                                    <UserMinus size={15} />
                                  </button>
                                ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {confirmLeaveOpen ? (
                      <div className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-3 space-y-2.5">
                        <div className="text-[12px] text-rose-500 font-medium">
                          确定要退出群聊「{activeConv.title}」吗？若你是群主，群主将自动移交给其他成员。
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmLeaveOpen(false)}
                            className="flex-1 py-2 rounded-xl bg-[var(--dl-card)] text-[var(--dl-text)] text-[13px] font-medium"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmLeaveOpen(false);
                              setChatDetailOpen(false);
                              void leaveGroup(activeConv.id);
                            }}
                            className="flex-1 py-2 rounded-xl bg-rose-500 text-white text-[13px] font-semibold"
                          >
                            确认退出
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmLeaveOpen(true)}
                        className="w-full py-3 rounded-2xl bg-rose-500/12 text-rose-500 font-semibold text-[14px] flex items-center justify-center gap-2"
                      >
                        <LogOut size={16} />
                        <span>退出群聊</span>
                      </button>
                    )}
                  </>
                )}
              </>
            ) : (
              /* Media & Files Tab (B1) */
              <div className="space-y-4 max-h-[60dvh] overflow-y-auto pr-0.5">
                {loadingMedia && mediaImages.length === 0 && mediaFiles.length === 0 ? (
                  <div className="py-10 text-center text-[13px] text-[var(--dl-text-muted)]">
                    正在加载会话媒体与文件…
                  </div>
                ) : mediaImages.length === 0 && mediaFiles.length === 0 ? (
                  <div className="py-10 text-center text-[13px] text-[var(--dl-text-muted)]">
                    当前会话暂无图片或文件
                  </div>
                ) : (
                  <>
                    {mediaImages.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--dl-text-muted)]">
                          <ImageIcon size={13} />
                          <span>图片 ({mediaImages.length})</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {mediaImages.map((img) => (
                            <button
                              key={img.id}
                              type="button"
                              onClick={() =>
                                setLightboxMedia({
                                  src: resolveAssetUrl(img.previewUrl),
                                  title: img.fileName,
                                  downloadUrl: resolveAssetUrl(img.downloadUrl),
                                  ...(img.sourceMessageId
                                    ? {
                                        favoriteInput: {
                                          messageId: img.sourceMessageId,
                                          attachmentId: img.id,
                                        },
                                      }
                                    : {}),
                                })
                              }
                              className="aspect-square rounded-xl overflow-hidden bg-[var(--dl-card)] active:opacity-85"
                            >
                              <img
                                src={resolveAssetUrl(img.previewUrl)}
                                alt={img.fileName}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {mediaFiles.length > 0 && (
                      <div>
                        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--dl-text-muted)]">
                          <FileText size={13} />
                          <span>文件 ({mediaFiles.length})</span>
                        </div>
                        <div className="space-y-2">
                          {mediaFiles.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() =>
                                nativeBridge.openExternalUrl(resolveAssetUrl(f.downloadUrl))
                              }
                              className="w-full p-3 rounded-2xl bg-[var(--dl-card)] flex items-center gap-3 text-left active:opacity-85"
                            >
                              <div className="w-9 h-9 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] flex items-center justify-center shrink-0">
                                <FileText size={18} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[13.5px] font-medium text-[var(--dl-text)] truncate">
                                  {f.fileName}
                                </div>
                                <div className="text-[11px] text-[var(--dl-text-muted)]">
                                  {formatBytes(f.byteSize)} · {formatConversationTime(f.createdAt)}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {hasMoreMedia && (
                      <button
                        type="button"
                        disabled={loadingMedia}
                        onClick={() => void handleLoadMoreMedia()}
                        className="w-full py-2.5 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-accent)] text-[13px] font-medium active:opacity-75 disabled:opacity-50"
                      >
                        {loadingMedia ? "正在加载更多…" : "加载更多历史图片与文件"}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {/* Private Member Remark Sheet (A3) */}
      <BottomSheet
        open={Boolean(remarkTarget)}
        onClose={() => setRemarkTargetId(null)}
        title="成员资料与私人备注"
        subtitle="备注仅对你自己可见，不会通知对方"
      >
        {remarkTarget && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Avatar
                name={remarkTarget.displayName}
                src={remarkTarget.avatarUrl}
                kind={remarkTarget.role === "bot" ? "bot" : "user"}
                color={remarkTarget.avatarColor}
                size={48}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-[var(--dl-text)] truncate">
                  {remarkTarget.rawDisplayName || remarkTarget.displayName}
                </div>
                {remarkTarget.handle && (
                  <div className="text-[12px] text-[var(--dl-text-muted)] truncate">
                    @{remarkTarget.handle}
                  </div>
                )}
              </div>
              {activeConv?.kind === "group" && (
                <button
                  type="button"
                  onClick={() => {
                    const uid = remarkTarget.id;
                    setRemarkTargetId(null);
                    setChatDetailOpen(false);
                    void startDirectChatWithUser(uid);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[12px] font-semibold flex items-center gap-1"
                >
                  <MessageSquare size={13} />
                  <span>私聊</span>
                </button>
              )}
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[var(--dl-text-muted)] mb-1.5">
                私人备注名
              </label>
              <input
                type="text"
                value={remarkDraft}
                onChange={(e) => setRemarkDraft(e.target.value)}
                placeholder={`输入备注（留空恢复为 ${
                  remarkTarget.rawDisplayName || remarkTarget.displayName
                }）`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              {remarkTarget.remark && (
                <button
                  type="button"
                  disabled={savingRemark}
                  onClick={() => void handleSaveRemark("")}
                  className="px-3.5 py-2 rounded-xl bg-[var(--dl-card)] text-[13px] font-medium text-rose-500"
                >
                  清除备注
                </button>
              )}
              <button
                type="button"
                disabled={savingRemark}
                onClick={() => void handleSaveRemark()}
                className="px-4 py-2 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold disabled:opacity-50"
              >
                {savingRemark ? "保存中…" : "保存备注"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
