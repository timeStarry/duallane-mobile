import { useEffect, useState } from "react";
import { Check, LogOut, Pin, Send, UserMinus, UserPlus } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { CardKitView } from "@/components/CardKitView";
import { renderRichTextTokens } from "@/shared/emotes";
import { formatMessageClock } from "@/shared/format";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

export function ThreadAndDetailSheets() {
  const activeChatId = useNavStore((s) => s.activeChatId);
  const threadRootId = useNavStore((s) => s.threadRootId);
  const setThreadRootId = useNavStore((s) => s.setThreadRootId);
  const chatDetailOpen = useNavStore((s) => s.chatDetailOpen);
  const setChatDetailOpen = useNavStore((s) => s.setChatDetailOpen);
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
  const updateGroupProfile = useWorkspaceStore((s) => s.updateGroupProfile);
  const inviteGroupMembers = useWorkspaceStore((s) => s.inviteGroupMembers);
  const removeGroupMember = useWorkspaceStore((s) => s.removeGroupMember);
  const leaveGroup = useWorkspaceStore((s) => s.leaveGroup);

  const [replyText, setReplyText] = useState("");
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [addingMemberOpen, setAddingMemberOpen] = useState(false);

  const activeConv = activeChatId ? conversations[activeChatId] : undefined;
  const threadView = threadRootId ? threadsByRootId[threadRootId] : undefined;
  const rootMsg =
    activeChatId && threadRootId
      ? (messagesByConv[activeChatId] || []).find((m) => m.id === threadRootId)
      : undefined;

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

  const handleSendThread = async () => {
    if (!threadRootId || !replyText.trim()) return;
    const body = replyText.trim();
    setReplyText("");
    try {
      await sendThreadReply(threadRootId, body, alsoToChannel);
    } catch {
      showToast("发送话题回复失败", "danger");
    }
  };

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
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {rootMsg && (
              <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] border border-[var(--dl-border)]">
                <div className="flex items-center justify-between text-[12px] text-[var(--dl-text-muted)] mb-1">
                  <span className="font-semibold text-[var(--dl-text)]">{rootMsg.senderName}</span>
                  <span>{formatMessageClock(rootMsg.createdAt)}</span>
                </div>
                <div className="text-[14px] text-[var(--dl-text)] whitespace-pre-wrap">
                  {renderRichTextTokens(rootMsg.plainText, `root_${rootMsg.id}`)}
                </div>
              </div>
            )}

            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] pt-1">
              全部回复 ({threadView?.replies?.length || 0})
            </div>

            {(threadView?.replies || []).map((rep) => (
              <div
                key={rep.id}
                className="p-3 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)]"
              >
                <div className="flex items-center justify-between text-[11px] text-[var(--dl-text-muted)]">
                  <span className="font-semibold text-[var(--dl-text)]">{rep.authorName}</span>
                  <span>{formatMessageClock(rep.createdAt)}</span>
                </div>
                <div className="mt-1 text-[14px] text-[var(--dl-text)] whitespace-pre-wrap">
                  {renderRichTextTokens(rep.plainText, rep.id)}
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
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="回复该话题…"
                className="flex-1 px-3.5 py-2 rounded-xl bg-[var(--dl-card)] text-[14px] text-[var(--dl-text)] outline-none"
              />
              <button
                type="button"
                disabled={!replyText.trim()}
                onClick={() => void handleSendThread()}
                className="w-9 h-9 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center disabled:opacity-40"
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
      >
        {activeConv && (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-3">
              <Avatar
                name={activeConv.title}
                src={activeConv.avatarUrl}
                emoji={activeConv.avatarEmoji}
                kind={
                  activeConv.kind === "saved"
                    ? "saved"
                    : activeConv.kind === "group"
                    ? "group"
                    : "user"
                }
                size={52}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-bold text-[var(--dl-text)] truncate">
                  {activeConv.title}
                </div>
                <div className="text-[12px] text-[var(--dl-text-muted)]">
                  {activeConv.kind === "group"
                    ? `群聊 · ${activeConv.memberIds.length} 人`
                    : activeConv.kind === "saved"
                    ? "云端个人收藏夹"
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

                {/* Group Members */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px] font-semibold text-[var(--dl-text-muted)]">
                      群成员 ({activeConv.memberIds.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddingMemberOpen((v) => !v)}
                      className="text-[12px] font-semibold text-[var(--dl-accent)] flex items-center gap-1"
                    >
                      <UserPlus size={14} /> 邀请成员/机器人
                    </button>
                  </div>

                  {addingMemberOpen && (
                    <div className="mb-3 p-2.5 rounded-2xl bg-[var(--dl-card)] space-y-1 max-h-44 overflow-y-auto">
                      {Object.values(members)
                        .filter((u) => !activeConv.memberIds.includes(u.id))
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
                              {u.displayName} {u.role === "bot" ? "(BOT)" : ""}
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
                      return (
                        <div
                          key={uid}
                          className="px-3 py-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar
                              name={name}
                              src={u?.avatarUrl}
                              kind={u?.role === "bot" ? "bot" : "user"}
                              size={32}
                            />
                            <span className="text-[13px] font-medium text-[var(--dl-text)] truncate">
                              {name}
                            </span>
                            {u?.role === "bot" && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]">
                                BOT
                              </span>
                            )}
                          </div>
                          {uid !== currentUser?.id && (
                            <button
                              type="button"
                              onClick={() => void removeGroupMember(activeConv.id, uid)}
                              className="p-1.5 text-rose-500"
                              aria-label={`移除 ${name}`}
                            >
                              <UserMinus size={15} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setChatDetailOpen(false);
                    void leaveGroup(activeConv.id);
                  }}
                  className="w-full py-3 rounded-2xl bg-rose-500/12 text-rose-500 font-semibold text-[14px] flex items-center justify-center gap-2"
                >
                  <LogOut size={16} />
                  <span>退出群聊</span>
                </button>
              </>
            )}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
