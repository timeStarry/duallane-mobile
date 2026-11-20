import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Hash, MessageSquare, Search, User, X } from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type SearchResponse } from "@/shared/api";
import { resolveAssetUrl } from "@/shared/emotes";
import { formatBytes, formatConversationTime } from "@/shared/format";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

const PAGE_SIZE = 20;

function renderHighlighted(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length <= 1) return text;
  const lower = q.toLowerCase();
  return parts.map((part, idx) =>
    part.toLowerCase() === lower ? (
      <mark key={idx} className="rounded bg-amber-300/45 px-0.5 text-inherit">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    )
  );
}

export function SearchScreen() {
  const searchOpen = useNavStore((s) => s.searchOpen);
  const searchConversationId = useNavStore((s) => s.searchConversationId);
  const setSearchOpen = useNavStore((s) => s.setSearchOpen);
  const openSearchInConversation = useNavStore((s) => s.openSearchInConversation);
  const openChat = useNavStore((s) => s.openChat);
  const setProfileSheetUserId = useNavStore((s) => s.setProfileSheetUserId);

  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const members = useWorkspaceStore((s) => s.members);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const conversationOrder = useWorkspaceStore((s) => s.conversationOrder);
  const jumpToMessage = useWorkspaceStore((s) => s.jumpToMessage);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "messages" | "files">("all");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [results, setResults] = useState<SearchResponse>({ messages: [], files: [] });
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [hasMoreFiles, setHasMoreFiles] = useState(false);

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ messages: [], files: [] });
      setHasMoreMessages(false);
      setHasMoreFiles(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void mobileApi
        .search(trimmed, scope, {
          conversationId: searchConversationId || undefined,
          limit: PAGE_SIZE,
          offset: 0,
        })
        .then((res) => {
          if (cancelled) return;
          setResults(res);
          setHasMoreMessages((res.messages || []).length >= PAGE_SIZE);
          setHasMoreFiles((res.files || []).length >= PAGE_SIZE);
        })
        .catch(() => {
          if (!cancelled) {
            setResults({ messages: [], files: [] });
            setHasMoreMessages(false);
            setHasMoreFiles(false);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, scope, searchConversationId, searchOpen]);

  const { contactHits, groupHits } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || searchConversationId || scope !== "all") {
      return { contactHits: [], groupHits: [] };
    }
    const contacts = Object.values(members)
      .filter((m) => m.id !== currentUser?.id)
      .filter(
        (m) =>
          (m.displayName || "").toLowerCase().includes(q) ||
          (m.remark || "").toLowerCase().includes(q) ||
          (m.rawDisplayName || "").toLowerCase().includes(q) ||
          (m.handle || "").toLowerCase().includes(q)
      )
      .slice(0, 6);
    const groups = conversationOrder
      .map((id) => conversations[id])
      .filter((c): c is NonNullable<typeof c> => Boolean(c && c.kind === "group"))
      .filter((c) => c.title.toLowerCase().includes(q))
      .slice(0, 5);
    return { contactHits: contacts, groupHits: groups };
  }, [conversationOrder, conversations, currentUser?.id, members, query, scope, searchConversationId]);

  const handleLoadMore = async (kind: "messages" | "files") => {
    const trimmed = query.trim();
    if (!trimmed || loadingMore) return;
    const offset = kind === "messages" ? results.messages.length : results.files.length;
    setLoadingMore(true);
    try {
      const res = await mobileApi.search(trimmed, kind, {
        conversationId: searchConversationId || undefined,
        limit: PAGE_SIZE,
        offset,
      });
      if (kind === "messages") {
        const next = res.messages || [];
        setResults((prev) => {
          const seen = new Set(prev.messages.map((m) => m.id));
          return { ...prev, messages: [...prev.messages, ...next.filter((m) => !seen.has(m.id))] };
        });
        setHasMoreMessages(next.length >= PAGE_SIZE);
      } else {
        const next = res.files || [];
        setResults((prev) => {
          const seen = new Set(prev.files.map((f) => f.id));
          return { ...prev, files: [...prev.files, ...next.filter((f) => !seen.has(f.id))] };
        });
        setHasMoreFiles(next.length >= PAGE_SIZE);
      }
    } finally {
      setLoadingMore(false);
    }
  };

  if (!searchOpen) return null;

  const scopedConv = searchConversationId ? conversations[searchConversationId] : undefined;
  const noHits =
    !loading &&
    query.trim() &&
    contactHits.length === 0 &&
    groupHits.length === 0 &&
    results.messages.length === 0 &&
    results.files.length === 0;

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--dl-bg)] pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
      <header className="bg-[var(--dl-surface)] border-b border-[var(--dl-border)] px-3 py-2.5 space-y-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label="退出搜索"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)] shrink-0"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dl-text-muted)]"
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                scopedConv
                  ? `在「${scopedConv.title}」中搜索…`
                  : "搜索联系人、群聊、历史消息或文件…"
              }
              className="w-full pl-9 pr-8 py-2 rounded-xl bg-[var(--dl-card)] text-[14px] text-[var(--dl-text)] outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--dl-text-muted)]"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex gap-1.5">
            {(
              [
                { id: "all", label: "综合" },
                { id: "messages", label: "聊天记录" },
                { id: "files", label: "文件" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setScope(tab.id)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium ${
                  scope === tab.id
                    ? "bg-[var(--dl-accent)] text-white"
                    : "bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {scopedConv && (
            <button
              type="button"
              onClick={() => openSearchInConversation(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[11px] font-medium max-w-[140px]"
            >
              <span className="truncate">仅：{scopedConv.title}</span>
              <X size={12} className="shrink-0" />
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="text-center text-[13px] text-[var(--dl-text-muted)] py-8">
            正在检索内容…
          </div>
        )}

        {noHits && (
          <div className="text-center text-[13px] text-[var(--dl-text-muted)] py-12">
            未找到与「{query}」匹配的内容
          </div>
        )}

        {contactHits.length > 0 && (
          <section className="space-y-2">
            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
              <User size={13} /> 联系人 ({contactHits.length})
            </div>
            <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
              {contactHits.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    setProfileSheetUserId(m.id);
                  }}
                  className="w-full px-4 py-2.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <Avatar
                    name={m.displayName}
                    src={m.avatarUrl}
                    color={m.avatarColor}
                    kind={m.role === "bot" ? "bot" : "user"}
                    size={36}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-[var(--dl-text)] truncate">
                      {renderHighlighted(m.displayName, query)}
                    </div>
                    {m.handle && (
                      <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                        @{renderHighlighted(m.handle, query)}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {groupHits.length > 0 && (
          <section className="space-y-2">
            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
              <Hash size={13} /> 群聊 ({groupHits.length})
            </div>
            <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
              {groupHits.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    openChat(g.id);
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <Hash size={18} className="text-[var(--dl-accent)] shrink-0" />
                  <span className="text-[14px] font-medium text-[var(--dl-text)] truncate">
                    {renderHighlighted(g.title, query)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {results.messages.length > 0 && (
          <section className="space-y-2">
            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
              <MessageSquare size={13} /> 消息 ({results.messages.length})
            </div>
            <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
              {results.messages.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => {
                    setSearchOpen(false);
                    void jumpToMessage(hit.conversationId, hit.id);
                  }}
                  className="w-full px-4 py-3 text-left active:bg-[var(--dl-card)]"
                >
                  <div className="flex items-center justify-between text-[12px] text-[var(--dl-text-muted)]">
                    <span className="font-semibold text-[var(--dl-text)] truncate pr-2">
                      {conversations[hit.conversationId]?.title || hit.authorName}
                    </span>
                    <span className="shrink-0">{formatConversationTime(hit.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--dl-text)] line-clamp-2">
                    <span className="text-[var(--dl-text-muted)]">{hit.authorName}：</span>
                    {renderHighlighted(hit.plainText, query)}
                  </div>
                </button>
              ))}
            </div>
            {hasMoreMessages && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void handleLoadMore("messages")}
                className="w-full py-2.5 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13px] font-medium text-[var(--dl-accent)]"
              >
                {loadingMore ? "加载中…" : "加载更多消息"}
              </button>
            )}
          </section>
        )}

        {results.files.length > 0 && (
          <section className="space-y-2">
            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
              <FileText size={13} /> 文件 ({results.files.length})
            </div>
            <div className="rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden">
              {results.files.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    if (f.conversationId && f.sourceMessageId) {
                      setSearchOpen(false);
                      void jumpToMessage(f.conversationId, f.sourceMessageId);
                    } else {
                      nativeBridge.openExternalUrl(
                        resolveAssetUrl(`/api/workspace/files/${encodeURIComponent(f.id)}/download`)
                      );
                    }
                  }}
                  className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <FileText size={20} className="text-[var(--dl-accent)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-[var(--dl-text)] truncate">
                      {renderHighlighted(f.fileName, query)}
                    </div>
                    <div className="text-[11px] text-[var(--dl-text-muted)]">
                      {formatBytes(f.byteSize)} · {formatConversationTime(f.createdAt)}
                      {f.sourceMessageId ? " · 点击定位原消息" : ""}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {hasMoreFiles && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void handleLoadMore("files")}
                className="w-full py-2.5 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13px] font-medium text-[var(--dl-accent)]"
              >
                {loadingMore ? "加载中…" : "加载更多文件"}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
