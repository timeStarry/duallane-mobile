import { useEffect, useState } from "react";
import { Bot, Check, MessageSquare, Pencil, Settings2, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { mobileApi } from "@/shared/api";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore, type V1User } from "@/store/workspace-store";

function isBotMember(member: V1User): boolean {
  return (
    member.role === "bot" ||
    member.id === "usr_system_beacon" ||
    member.id === "usr_system_echo" ||
    member.id.startsWith("usr_bot_")
  );
}

export function MemberProfileSheet() {
  const profileSheetUserId = useNavStore((s) => s.profileSheetUserId);
  const setProfileSheetUserId = useNavStore((s) => s.setProfileSheetUserId);
  const openChat = useNavStore((s) => s.openChat);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const setMeSubSheet = useNavStore((s) => s.setMeSubSheet);
  const showToast = useNavStore((s) => s.showToast);

  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const members = useWorkspaceStore((s) => s.members);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const setMemberRemark = useWorkspaceStore((s) => s.setMemberRemark);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);

  const member = profileSheetUserId ? members[profileSheetUserId] : undefined;
  const isSelf = Boolean(member && currentUser && member.id === currentUser.id);
  const isBot = Boolean(member && isBotMember(member));
  const canRemark = Boolean(member && !isSelf && !isBot);

  const [editingRemark, setEditingRemark] = useState(false);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);
  const [startingDM, setStartingDM] = useState(false);

  useEffect(() => {
    setEditingRemark(false);
    setRemarkDraft(member?.remark || "");
  }, [profileSheetUserId, member?.remark]);

  if (!profileSheetUserId || !member) return null;

  const isOnline = isBot ? member.botOnline === true : member.online === true;
  const hasPresence = isBot ? typeof member.botOnline === "boolean" : typeof member.online === "boolean";
  const roleLabel = isBot
    ? "机器人"
    : member.role === "owner"
    ? "空间所有者"
    : member.role === "admin"
    ? "管理员"
    : "成员";

  const handleSaveRemark = async () => {
    setSavingRemark(true);
    try {
      await setMemberRemark(member.id, remarkDraft.trim());
      setEditingRemark(false);
      showToast(remarkDraft.trim() ? "个人备注已保存" : "已清除个人备注", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "备注保存失败", "danger");
    } finally {
      setSavingRemark(false);
    }
  };

  const handleStartDM = async () => {
    setStartingDM(true);
    try {
      const existing = Object.values(conversations).find(
        (c) => c.kind === "direct" && c.memberIds.includes(member.id)
      );
      if (existing) {
        setProfileSheetUserId(null);
        openChat(existing.id);
        return;
      }
      const res = await mobileApi.createDirectConversation(member.id);
      await bootstrapWorkspace();
      const targetId =
        (res as { conversationId?: string; id?: string; conversation?: { id?: string } })?.conversationId ||
        (res as { id?: string })?.id ||
        (res as { conversation?: { id?: string } })?.conversation?.id;
      setProfileSheetUserId(null);
      if (targetId) openChat(targetId);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "无法发起私聊", "danger");
    } finally {
      setStartingDM(false);
    }
  };

  return (
    <BottomSheet
      open={Boolean(profileSheetUserId)}
      onClose={() => setProfileSheetUserId(null)}
      title="成员名片"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3.5">
          <button
            type="button"
            disabled={!member.avatarUrl}
            onClick={() => {
              if (!member.avatarUrl) return;
              setLightboxMedia({
                src: member.avatarUrl,
                title: member.displayName,
                downloadUrl: member.avatarUrl,
              });
            }}
            className="relative shrink-0"
          >
            <Avatar
              name={member.displayName}
              src={member.avatarUrl}
              color={member.avatarColor}
              kind={isBot ? "bot" : "user"}
              size={58}
            />
            {hasPresence && (
              <span
                className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-[var(--dl-surface)] ${
                  isOnline ? "bg-emerald-500" : "bg-zinc-400"
                }`}
              />
            )}
          </button>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[17px] font-bold text-[var(--dl-text)] truncate">
                {member.displayName}
              </span>
              {isBot && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[10px] font-semibold">
                  <Bot size={10} />
                  Bot
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[var(--dl-text-muted)] flex-wrap">
              {member.handle && <span>@{member.handle}</span>}
              <span>·</span>
              <span>{roleLabel}</span>
              {hasPresence && (
                <>
                  <span>·</span>
                  <span className={isOnline ? "text-emerald-500 font-medium" : ""}>
                    {isOnline ? "在线" : "离线"}
                  </span>
                </>
              )}
            </div>
            {member.remark && member.rawDisplayName && member.remark !== member.rawDisplayName && (
              <p className="mt-1 text-[12px] text-[var(--dl-text-secondary)]">
                原昵称：{member.rawDisplayName}
              </p>
            )}
          </div>
        </div>

        {member.statusText && (
          <div className="inline-flex max-w-full items-center px-3 py-1 rounded-full bg-[var(--dl-card)] border border-[var(--dl-border)] text-[12px] text-[var(--dl-text-secondary)]">
            <span className="truncate">{member.statusText}</span>
          </div>
        )}

        {(member.bio || member.description) && (
          <div className="rounded-2xl bg-[var(--dl-card)] p-3.5 border border-[var(--dl-border)]">
            <div className="text-[11px] font-semibold text-[var(--dl-text-muted)]">
              {isBot ? "机器人简介" : "个人简介"}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--dl-text-secondary)] whitespace-pre-wrap break-words">
              {isBot ? member.description : member.bio}
            </p>
          </div>
        )}

        {canRemark && (
          <div className="rounded-2xl bg-[var(--dl-card)] p-3.5 border border-[var(--dl-border)]">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-[var(--dl-text-muted)]">
                个人备注（仅自己可见）
              </span>
              {!editingRemark && (
                <button
                  type="button"
                  onClick={() => {
                    setRemarkDraft(member.remark || "");
                    setEditingRemark(true);
                  }}
                  className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--dl-accent)]"
                >
                  <Pencil size={12} />
                  {member.remark ? "修改" : "添加备注"}
                </button>
              )}
            </div>
            {editingRemark ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={remarkDraft}
                  onChange={(e) => setRemarkDraft(e.target.value)}
                  placeholder="输入备注名，留空可清除"
                  maxLength={40}
                  autoFocus
                  className="flex-1 min-w-0 h-9 px-3 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13px] text-[var(--dl-text)] outline-none"
                />
                <button
                  type="button"
                  disabled={savingRemark}
                  onClick={() => void handleSaveRemark()}
                  className="h-9 px-3 rounded-xl bg-[var(--dl-accent)] text-white flex items-center justify-center"
                  aria-label="保存备注"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  disabled={savingRemark}
                  onClick={() => setEditingRemark(false)}
                  className="h-9 px-2.5 rounded-xl bg-[var(--dl-surface)] text-[var(--dl-text-muted)] flex items-center justify-center"
                  aria-label="取消"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <p className="mt-1 text-[13px] text-[var(--dl-text)]">
                {member.remark || <span className="text-[var(--dl-text-muted)]">未设置备注</span>}
              </p>
            )}
          </div>
        )}

        <div className="pt-1">
          {isSelf ? (
            <button
              type="button"
              onClick={() => {
                setProfileSheetUserId(null);
                setActiveTab("me");
                setMeSubSheet("profile");
              }}
              className="w-full h-11 rounded-2xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[var(--dl-text)] text-[14px] font-semibold flex items-center justify-center gap-2 active:opacity-80"
            >
              <Settings2 size={16} />
              <span>编辑个人资料</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={startingDM}
              onClick={() => void handleStartDM()}
              className="w-full h-11 rounded-2xl bg-[var(--dl-accent)] text-white text-[14px] font-semibold flex items-center justify-center gap-2 active:opacity-85 disabled:opacity-60"
            >
              <MessageSquare size={16} />
              <span>{startingDM ? "打开中…" : "发消息"}</span>
            </button>
          )}
        </div>
      </div>
    </BottomSheet>
  );
}
