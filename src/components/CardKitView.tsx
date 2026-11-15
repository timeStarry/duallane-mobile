import { useState } from "react";
import type { DualLaneCardKitDocument } from "@/shared/card-kit";
import { useWorkspaceStore } from "@/store/workspace-store";

const TONE_STYLES: Record<string, string> = {
  shared: "bg-sky-500/12 text-sky-600 dark:text-sky-300 border-sky-500/20",
  direct: "bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/20",
  success: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 border-emerald-500/20",
  warning: "bg-amber-500/12 text-amber-600 dark:text-amber-300 border-amber-500/20",
  danger: "bg-rose-500/12 text-rose-600 dark:text-rose-300 border-rose-500/20",
  neutral: "bg-[var(--dl-card)] text-[var(--dl-text)] border-[var(--dl-border)]",
};

export function CardKitView({ card }: { card: DualLaneCardKitDocument }) {
  const triggerCardAction = useWorkspaceStore((s) => s.triggerCardAction);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const disabledAll = card.status !== "active";

  const handleAction = async (actionId: string, payload?: Record<string, unknown>) => {
    if (disabledAll || busyActionId) return;
    setBusyActionId(actionId);
    try {
      await triggerCardAction(card.cardId, actionId, payload, card.revision);
    } finally {
      setBusyActionId(null);
    }
  };

  return (
    <div className="mt-1.5 rounded-2xl border border-[var(--dl-border)] bg-[var(--dl-surface)] overflow-hidden shadow-xs text-[var(--dl-text)] min-w-[230px] max-w-[300px]">
      {card.blocks.map((block, idx) => {
        if (block.type === "header") {
          const tone = TONE_STYLES[block.tone || "shared"] || TONE_STYLES.neutral;
          return (
            <div key={idx} className={`px-3.5 py-2.5 border-b ${tone}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold text-[14px] leading-snug">{block.title}</div>
                {block.badge && (
                  <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/10 dark:bg-white/10 shrink-0">
                    {block.badge}
                  </span>
                )}
              </div>
              {block.subtitle && (
                <div className="text-[11px] opacity-80 mt-0.5">{block.subtitle}</div>
              )}
            </div>
          );
        }

        if (block.type === "markdown") {
          return (
            <div
              key={idx}
              className="px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words"
            >
              {block.content}
            </div>
          );
        }

        if (block.type === "fields") {
          return (
            <div key={idx} className="px-3.5 py-2 grid grid-cols-2 gap-2">
              {block.items.map((item, fIdx) => (
                <div
                  key={fIdx}
                  className={item.short ? "col-span-1" : "col-span-2"}
                >
                  <div className="text-[11px] text-[var(--dl-text-muted)]">{item.label}</div>
                  <div className="text-[13px] font-medium mt-0.5 break-words">{item.value}</div>
                </div>
              ))}
            </div>
          );
        }

        if (block.type === "poll") {
          const total = Math.max(1, block.totalVotes || 0);
          return (
            <div key={idx} className="px-3.5 py-2 space-y-1.5">
              {block.options.map((opt) => {
                const pct = block.totalVotes > 0 ? Math.round((opt.votes / total) * 100) : 0;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={disabledAll || block.closed}
                    onClick={() =>
                      void handleAction(`poll:${block.pollId}`, { optionId: opt.id })
                    }
                    className={`w-full text-left px-3 py-2 rounded-xl border text-[12px] relative overflow-hidden transition ${
                      opt.selected
                        ? "border-[var(--dl-accent)] bg-[var(--dl-accent-soft)]"
                        : "border-[var(--dl-border)] bg-[var(--dl-card)]"
                    }`}
                  >
                    <div className="relative z-10 flex items-center justify-between gap-2">
                      <span className="font-medium truncate">{opt.label}</span>
                      <span className="text-[11px] text-[var(--dl-text-muted)] shrink-0">
                        {opt.votes} 票 ({pct}%)
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        }

        if (block.type === "divider") {
          return <div key={idx} className="my-1 border-t border-[var(--dl-border)]" />;
        }

        if (block.type === "actions") {
          return (
            <div key={idx} className="px-3.5 py-2.5 flex flex-wrap gap-2 border-t border-[var(--dl-border)]/60">
              {block.elements.map((el) => {
                if (el.type === "button") {
                  const isBusy = busyActionId === el.actionId;
                  const btnStyle =
                    el.style === "primary"
                      ? "bg-[var(--dl-accent)] text-white"
                      : el.style === "danger"
                      ? "bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30"
                      : "bg-[var(--dl-card)] text-[var(--dl-text)] border border-[var(--dl-border)]";
                  return (
                    <button
                      key={el.actionId}
                      type="button"
                      disabled={disabledAll || el.disabled || isBusy}
                      onClick={() => void handleAction(el.actionId, el.payload)}
                      className={`px-3 py-1.5 rounded-xl text-[12px] font-medium active:scale-[0.98] transition disabled:opacity-50 ${btnStyle}`}
                    >
                      {isBusy ? "处理中…" : el.label}
                    </button>
                  );
                }
                return (
                  <select
                    key={el.actionId}
                    disabled={disabledAll || el.disabled}
                    value={el.value || ""}
                    onChange={(e) => void handleAction(el.actionId, { value: e.target.value })}
                    className="px-2.5 py-1.5 rounded-xl text-[12px] bg-[var(--dl-card)] border border-[var(--dl-border)] text-[var(--dl-text)]"
                  >
                    {el.placeholder && <option value="">{el.placeholder}</option>}
                    {el.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                );
              })}
            </div>
          );
        }

        return null;
      })}
      {card.status !== "active" && (
        <div className="px-3.5 py-1.5 text-[11px] text-[var(--dl-text-muted)] bg-[var(--dl-card)] border-t border-[var(--dl-border)]">
          {card.status === "expired" ? "卡片已过期" : "卡片已失效"}
        </div>
      )}
    </div>
  );
}
