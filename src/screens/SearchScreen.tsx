import { useEffect, useState } from "react";
import { ArrowLeft, FileText, MessageSquare, Search, X } from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type SearchResponse } from "@/shared/api";
import { resolveAssetUrl } from "@/shared/emotes";
import { formatBytes, formatConversationTime } from "@/shared/format";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

export function SearchScreen() {
  const searchOpen = useNavStore((s) => s.searchOpen);
  const setSearchOpen = useNavStore((s) => s.setSearchOpen);
  const conversations = useWorkspaceStore((s) => s.conversations);
  const jumpToMessage = useWorkspaceStore((s) => s.jumpToMessage);

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "messages" | "files">("all");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResponse>({ messages: [], files: [] });

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults({ messages: [], files: [] });
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      void mobileApi
        .search(trimmed, scope)
        .then((res) => setResults(res))
        .catch(() => setResults({ messages: [], files: [] }))
        .finally(() => setLoading(false));
    }, 240);
    return () => clearTimeout(timer);
  }, [query, scope, searchOpen]);

  if (!searchOpen) return null;

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
              placeholder="搜索历史消息或共享文件…"
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

        <div className="flex gap-2 px-1">
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
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && (
          <div className="text-center text-[13px] text-[var(--dl-text-muted)] py-8">
            正在检索空间内容…
          </div>
        )}

        {!loading && query.trim() && results.messages.length === 0 && results.files.length === 0 && (
          <div className="text-center text-[13px] text-[var(--dl-text-muted)] py-12">
            未找到与「{query}」匹配的内容
          </div>
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
                  onClick={() => jumpToMessage(hit.conversationId, hit.id)}
                  className="w-full px-4 py-3 text-left active:bg-[var(--dl-card)]"
                >
                  <div className="flex items-center justify-between text-[12px] text-[var(--dl-text-muted)]">
                    <span className="font-semibold text-[var(--dl-text)]">
                      {conversations[hit.conversationId]?.title || hit.authorName}
                    </span>
                    <span>{formatConversationTime(hit.createdAt)}</span>
                  </div>
                  <div className="mt-1 text-[13px] text-[var(--dl-text)] line-clamp-2">
                    <span className="text-[var(--dl-text-muted)]">{hit.authorName}：</span>
                    {hit.plainText}
                  </div>
                </button>
              ))}
            </div>
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
                  onClick={() =>
                    nativeBridge.openExternalUrl(
                      resolveAssetUrl(`/api/workspace/files/${encodeURIComponent(f.id)}/download`)
                    )
                  }
                  className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
                >
                  <FileText size={20} className="text-[var(--dl-accent)] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-medium text-[var(--dl-text)] truncate">
                      {f.fileName}
                    </div>
                    <div className="text-[11px] text-[var(--dl-text-muted)]">
                      {formatBytes(f.byteSize)} · {formatConversationTime(f.createdAt)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
