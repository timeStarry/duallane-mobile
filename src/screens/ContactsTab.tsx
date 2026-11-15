import { useMemo, useState } from "react";
import { Bookmark, Bot, ChevronRight, Plus, Search, Users } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

export function ContactsTab() {
  const members = useWorkspaceStore((s) => s.members);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const startDirectChatWithUser = useWorkspaceStore((s) => s.startDirectChatWithUser);

  const openChat = useNavStore((s) => s.openChat);
  const setActiveTab = useNavStore((s) => s.setActiveTab);
  const setBotManageOpen = useNavStore((s) => s.setBotManageOpen);
  const setCreateChatMode = useNavStore((s) => s.setCreateChatMode);

  const [query, setQuery] = useState("");

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
          (m.handle && m.handle.toLowerCase().includes(q))
    );
    return {
      bots: filtered.filter((m) => m.role === "bot"),
      humans: filtered.filter((m) => m.role !== "bot"),
    };
  }, [members, currentUser, query]);

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
              placeholder="搜索成员、机器人或群组…"
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
                <button
                  key={b.id}
                  type="button"
                  onClick={() => void startDirectChatWithUser(b.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <Avatar name={b.displayName} src={b.avatarUrl} kind="bot" size={40} />
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
                  <ChevronRight size={16} className="text-[var(--dl-text-muted)]" />
                </button>
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
                <button
                  key={u.id}
                  type="button"
                  onClick={() => void startDirectChatWithUser(u.id)}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <Avatar name={u.displayName} src={u.avatarUrl} kind="user" size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                      {u.displayName}
                    </div>
                    {u.handle && (
                      <div className="text-[12px] text-[var(--dl-text-muted)] truncate">
                        @{u.handle}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} className="text-[var(--dl-text-muted)]" />
                </button>
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
    </div>
  );
}
