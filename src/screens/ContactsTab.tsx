import { useMemo, useState } from "react";
import { Bookmark, Bot, ChevronRight, Edit3, Plus, Search, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore, type V1User } from "@/store/workspace-store";

export function ContactsTab() {
  const members = useWorkspaceStore((s) => s.members);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const startDirectChatWithUser = useWorkspaceStore((s) => s.startDirectChatWithUser);
  const setMemberRemark = useWorkspaceStore((s) => s.setMemberRemark);

  const openChat = useNavStore((s) => s.openChat);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const setBotManageOpen = useNavStore((s) => s.setBotManageOpen);
  const setCreateChatMode = useNavStore((s) => s.setCreateChatMode);
  const showToast = useNavStore((s) => s.showToast);

  const [query, setQuery] = useState("");
  const [remarkTargetId, setRemarkTargetId] = useState<string | null>(null);
  const [remarkDraft, setRemarkDraft] = useState("");
  const [savingRemark, setSavingRemark] = useState(false);

  const remarkTarget: V1User | undefined = remarkTargetId ? members[remarkTargetId] : undefined;

  const savedConv = useMemo(
    () => Object.values(conversations).find((c) => c.kind === "saved"),
    [conversations]
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(conversations)
      .filter((c) => c.kind === "group")
      .filter((c) => (!q ? true : c.title.toLowerCase().includes(q)));
  }, [conversations, query]);

  const { bots, humans } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.values(members).filter((m) => m.id !== currentUser?.id);
    const filtered = all.filter((m) =>
      !q
        ? true
        : m.displayName.toLowerCase().includes(q) ||
          Boolean(m.rawDisplayName && m.rawDisplayName.toLowerCase().includes(q)) ||
          Boolean(m.handle && m.handle.toLowerCase().includes(q))
    );
    return {
      bots: filtered.filter((m) => m.role === "bot"),
      humans: filtered.filter((m) => m.role !== "bot"),
    };
  }, [members, currentUser, query]);

  const openRemarkSheet = (u: V1User) => {
    setRemarkTargetId(u.id);
    setRemarkDraft(u.remark || "");
  };

  const handleSaveRemark = async (overrideVal?: string) => {
    if (!remarkTarget || savingRemark) return;
    const clean = (overrideVal !== undefined ? overrideVal : remarkDraft).trim();
    setSavingRemark(true);
    try {
      await setMemberRemark(remarkTarget.id, clean);
      setRemarkTargetId(null);
      showToast(clean ? "私人备注已更新" : "已清除私人备注", "success");
    } catch {
      showToast("保存备注失败", "danger");
    } finally {
      setSavingRemark(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[var(--dl-bg)]">
      <header className="pt-[var(--safe-top)] bg-[var(--dl-surface)] dl-glass border-b border-[var(--dl-border)] shrink-0">
        <div className="h-13 px-4 flex items-center justify-between">
          <h1 className="text-[17px] font-bold text-[var(--dl-text)]">通讯录</h1>
          <button
            type="button"
            onClick={() => setCreateChatMode("group")}
            className="px-3 py-1.5 rounded-full bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[12px] font-semibold flex items-center gap-1"
          >
            <Plus size={14} />
            <span>建群</span>
          </button>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dl-text-muted)]"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索成员、备注、机器人或群组…"
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[var(--dl-card)] text-[13px] text-[var(--dl-text)] outline-none"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Quick Utilities */}
        {savedConv && !query && (
          <button
            type="button"
            onClick={() => {
              setActiveTab("chats");
              openChat(savedConv.id);
            }}
            className="w-full rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] px-4 py-3 flex items-center gap-3 active:bg-[var(--dl-card)]"
          >
            <div className="w-10 h-10 rounded-xl bg-[var(--dl-accent)] text-white flex items-center justify-center shrink-0">
              <Bookmark size={19} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-[15px] font-semibold text-[var(--dl-text)]">我的收藏</div>
              <div className="text-[12px] text-[var(--dl-text-muted)]">
                跨端云端备忘录、文件与收藏贴纸中转
              </div>
            </div>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)]" />
          </button>
        )}

        {/* AI Bots Section */}
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
              <Bot size={13} /> AI 机器人 ({bots.length})
            </span>
            <button
              type="button"
              onClick={() => setBotManageOpen(true)}
              className="text-[12px] font-medium text-[var(--dl-accent)]"
            >
              接入与管理
            </button>
          </div>
          <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
            {bots.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-[var(--dl-text-muted)]">
                暂无可见机器人，点击右上角「接入与管理」创建
              </div>
            ) : (
              bots.map((b) => (
                <div
                  key={b.id}
                  className="px-4 py-3 flex items-center gap-3 active:bg-[var(--dl-card)]"
                >
                  <button
                    type="button"
                    onClick={() => void startDirectChatWithUser(b.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <Avatar
                      name={b.displayName}
                      src={b.avatarUrl}
                      kind="bot"
                      color={b.avatarColor}
                      size={40}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                          {b.displayName}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]">
                          BOT
                        </span>
                      </div>
                      {b.description && (
                        <div className="text-[12px] text-[var(--dl-text-muted)] truncate mt-0.5">
                          {b.description}
                        </div>
                      )}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`设置 ${b.displayName} 备注`}
                    onClick={() => openRemarkSheet(b)}
                    className="p-1.5 rounded-lg text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
                  >
                    <Edit3 size={14} />
                  </button>
                  <ChevronRight size={16} className="text-[var(--dl-text-muted)]" />
                </div>
              ))
            )}
          </div>
        </section>

        {/* Space Members */}
        <section>
          <div className="mb-2 px-1 text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
            <Users size={13} /> 空间成员 ({humans.length})
          </div>
          <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
            {humans.length === 0 ? (
              <div className="px-4 py-5 text-center text-[12px] text-[var(--dl-text-muted)]">
                未找到匹配的成员
              </div>
            ) : (
              humans.map((u) => (
                <div
                  key={u.id}
                  className="px-4 py-3 flex items-center gap-3 active:bg-[var(--dl-card)]"
                >
                  <button
                    type="button"
                    onClick={() => void startDirectChatWithUser(u.id)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <Avatar name={u.displayName} src={u.avatarUrl} kind="user" size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                        {u.displayName}
                      </div>
                      <div className="text-[12px] text-[var(--dl-text-muted)] truncate">
                        {u.remark && u.rawDisplayName && u.remark !== u.rawDisplayName
                          ? `昵称：${u.rawDisplayName}${u.handle ? ` · @${u.handle}` : ""}`
                          : u.handle
                          ? `@${u.handle}`
                          : "空间成员"}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`设置 ${u.displayName} 备注`}
                    onClick={() => openRemarkSheet(u)}
                    className="p-1.5 rounded-lg text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
                  >
                    <Edit3 size={14} />
                  </button>
                  <ChevronRight size={16} className="text-[var(--dl-text-muted)]" />
                </div>
              ))
            )}
          </div>
        </section>

        {/* Groups */}
        {groups.length > 0 && (
          <section>
            <div className="mb-2 px-1 text-[12px] font-semibold text-[var(--dl-text-muted)]">
              我的群聊 ({groups.length})
            </div>
            <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setActiveTab("chats");
                    openChat(g.id);
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <Avatar
                    name={g.title}
                    src={g.avatarUrl}
                    emoji={g.avatarEmoji}
                    kind="group"
                    size={40}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                      {g.title}
                    </div>
                    <div className="text-[12px] text-[var(--dl-text-muted)]">
                      {g.memberIds.length} 位成员
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-[var(--dl-text-muted)]" />
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Private Remark Sheet */}
      <BottomSheet
        open={Boolean(remarkTarget)}
        onClose={() => setRemarkTargetId(null)}
        title="设置私人备注"
        subtitle="仅对你自己可见，方便在群聊与通知中识别"
      >
        {remarkTarget && (
          <div className="p-4 space-y-4">
            <div className="text-[12px] text-[var(--dl-text-muted)]">
              原昵称：{" "}
              <strong className="text-[var(--dl-text)]">
                {remarkTarget.rawDisplayName || remarkTarget.displayName}
              </strong>
            </div>
            <input
              type="text"
              value={remarkDraft}
              onChange={(e) => setRemarkDraft(e.target.value)}
              placeholder="输入私人备注名…"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
            />
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
                {savingRemark ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
