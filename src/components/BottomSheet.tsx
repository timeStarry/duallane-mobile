import React from "react";
import { X } from "lucide-react";

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  maxHeight = "85dvh",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  maxHeight?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />
      <div
        style={{ maxHeight }}
        className="relative w-full rounded-t-[22px] bg-[var(--dl-surface)] border-t border-[var(--dl-border)] shadow-2xl flex flex-col overflow-hidden pb-[var(--safe-bottom)] animate-[dlSheetUp_180ms_cubic-bezier(0.16,1,0.3,1)]"
      >
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-[var(--dl-text-muted)]/30" />
        </div>
        {title && (
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--dl-border)] shrink-0">
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold text-[var(--dl-text)] truncate">{title}</h3>
              {subtitle && (
                <p className="text-[12px] text-[var(--dl-text-muted)] truncate mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭弹窗"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
