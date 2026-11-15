import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

const GROUP_EMOJIS = ["🚀", "💬", "⚡", "🛠️", "🎨", "🤖", "📦", "🌟"];

export function CreateAndForwardSheets() {
  const createChatMode = useNavStore((s) => s.createChatMode);
  const setCreateChatMode = useNavStore((s) => s.setCreateChatMode);
  const forwardingMessageIds = useNavStore((s) => s.forwardingMessageIds);
  const setForwardingMessageIds = useNavStore((s) => s.setForwardingMessageIds);
  const openChat = useNavStore((s) => s.openChat);
  const showToast = useNavStore((s) => s.showToast);

  const members = useWorkspaceStore((s) => s.members);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const conversationOrder = useWorkspaceStore((s) => s.conversationOrder);
  const startDirectChatWithUser = useWorkspaceStore((s) => s.startDirectChatWithUser);
  const createGroup = useWorkspaceStore((s) => s.createGroup);
  const forwardMessage = useWorkspaceStore((s) => s.forwardMessage);

  const [groupTitle, setGroupTitle] = useState("");
  const [groupEmoji, setGroupEmoji] = useState("🚀");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const availableMembers = useMemo(
    () => Object.values(members).filter((m) => m.id !== currentUser?.id),
    [members, currentUser]
  );

  const toggleUser = (uid: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleCreateGroup = async () => {
    if (!groupTitle.trim() || busy) {
      showToast("请输入群聊名称", "warning");
      return;
    }
    setBusy(true);
    try {
      await createGroup(groupTitle.trim(), selectedUserIds, groupEmoji);
      setGroupTitle("");
      setSelectedUserIds([]);
      setCreateChatMode(null);
    } catch {
      showToast("创建群聊失败", "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Create Direct or Group Sheet */}
      <BottomSheet
        open={Boolean(createChatMode)}
        onClose={() => setCreateChatMode(null)}
        title={createChatMode === "direct" ? "发起单聊" : "创建新群聊"}
      >
        <div className="p-4 space-y-4">
          {createChatMode === "group" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                {GROUP_EMOJIS.map((em) => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setGroupEmoji(em)}
                    className={`w-10 h-10 rounded-xl text-[20px] flex items-center justify-center shrink-0 border ${
                      groupEmoji === em
                        ? "border-[var(--dl-accent)] bg-[var(--dl-accent-soft)]"
                        : "border-[var(--dl-border)] bg-[var(--dl-card)]"
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                placeholder="输入群聊名称（如：移动端研发对齐群）"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
              />
            </div>
          )}

          <div className="space-y-1 max-h-72 overflow-y-auto">
            {availableMembers.map((u) => {
              const checked = selectedUserIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    if (createChatMode === "direct") {
                      setCreateChatMode(null);
                      void startDirectChatWithUser(u.id);
                    } else {
                      toggleUser(u.id);
                    }
                  }}
                  className="w-full px-3 py-2.5 rounded-2xl flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <Avatar
                    name={u.displayName}
                    src={u.avatarUrl}
                    kind={u.role === "bot" ? "bot" : "user"}
                    size={38}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                      {u.displayName}
                    </div>
                    {u.role === "bot" && (
                      <span className="text-[11px] text-[var(--dl-accent)]">AI 机器人</span>
                    )}
                  </div>
                  {createChatMode === "group" && (
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                        checked
                          ? "bg-[var(--dl-accent)] border-[var(--dl-accent)] text-white"
                          : "border-[var(--dl-border)]"
                      }`}
                    >
                      {checked && <Check size={12} />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {createChatMode === "group" && (
            <button
              type="button"
              disabled={busy || !groupTitle.trim()}
              onClick={() => void handleCreateGroup()}
              className="w-full py-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[15px] disabled:opacity-50"
            >
              {busy ? "创建中…" : `立即创建群聊 (${selectedUserIds.length} 人)`}
            </button>
          )}
        </div>
      </BottomSheet>

      {/* Forward Message Sheet */}
      <BottomSheet
        open={Boolean(forwardingMessageIds?.length)}
        onClose={() => setForwardingMessageIds(null)}
        title="转发到会话"
      >
        <div className="p-3 space-y-1">
          {conversationOrder.map((cid) => {
            const c = conversations[cid];
            if (!c) return null;
            return (
              <button
                key={cid}
                type="button"
                onClick={async () => {
                  const ids = forwardingMessageIds || [];
                  setForwardingMessageIds(null);
                  await forwardMessage(ids, cid);
                  openChat(cid);
                }}
                className="w-full px-3.5 py-2.5 rounded-2xl flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
              >
                <Avatar
                  name={c.title}
                  src={c.avatarUrl}
                  emoji={c.avatarEmoji}
                  kind={c.kind === "saved" ? "saved" : c.kind === "group" ? "group" : "user"}
                  size={38}
                />
                <span className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                  {c.title}
                </span>
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
