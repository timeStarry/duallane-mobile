import { ArrowUpRight, Megaphone } from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import { useWorkspaceStore } from "@/store/workspace-store";

export function AnnouncementModal() {
  const authStatus = useWorkspaceStore((s) => s.authStatus);
  const systemAnnouncement = useWorkspaceStore((s) => s.systemAnnouncement);
  const dismissedAnnouncementKey = useWorkspaceStore((s) => s.dismissedAnnouncementKey);
  const dismissSystemAnnouncement = useWorkspaceStore((s) => s.dismissSystemAnnouncement);

  if (authStatus !== "authenticated" || !systemAnnouncement) {
    return null;
  }

  const currentKey = `${systemAnnouncement.id}:${systemAnnouncement.updatedAt || ""}`;
  const isOpen =
    Boolean(systemAnnouncement.enabled) &&
    systemAnnouncement.shouldShow !== false &&
    dismissedAnnouncementKey !== currentKey;

  if (!isOpen) {
    return null;
  }

  const ctaLabel = systemAnnouncement.ctaLabel?.trim() || "";
  const ctaUrl = systemAnnouncement.ctaUrl?.trim() || "";
  const hasCta = Boolean(ctaLabel && ctaUrl);

  const handleDismiss = () => {
    nativeBridge.haptic("light");
    void dismissSystemAnnouncement();
  };

  const handleCta = () => {
    nativeBridge.haptic("medium");
    if (ctaUrl) {
      const resolvedUrl = ctaUrl.startsWith("/")
        ? `${nativeBridge.getSessionSnapshot().apiOrigin}${ctaUrl}`
        : ctaUrl;
      nativeBridge.openExternalUrl(resolvedUrl);
    }
    void dismissSystemAnnouncement();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={systemAnnouncement.title || "空间通告"}
      data-testid="mobile-announcement-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-slate-950/50 backdrop-blur-[6px]"
    >
      <div className="w-full max-w-[356px] rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-2xl overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-8 h-8 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] flex items-center justify-center shrink-0">
              <Megaphone size={16} />
            </span>
            {systemAnnouncement.badge ? (
              <span className="px-2.5 py-0.5 rounded-full bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[11px] font-semibold">
                {systemAnnouncement.badge}
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-[var(--dl-text-muted)]">
                空间通告
              </span>
            )}
          </div>
          <h2 className="text-[18px] font-bold leading-snug tracking-tight text-[var(--dl-text)]">
            {systemAnnouncement.title}
          </h2>
        </div>

        <div className="px-5 pb-5 max-h-[48vh] overflow-y-auto">
          <div className="whitespace-pre-line text-[14px] leading-[1.68] text-[var(--dl-text-muted)]">
            {systemAnnouncement.content}
          </div>
        </div>

        <div className="px-5 py-3.5 bg-[var(--dl-card)]/70 border-t border-[var(--dl-border)]/70 flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleDismiss}
            className={`py-2.5 px-4 rounded-xl text-[13.5px] font-semibold transition active:scale-[0.99] ${
              hasCta
                ? "flex-1 bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[var(--dl-text)]"
                : "w-full bg-[var(--dl-accent)] text-white"
            }`}
          >
            我知道了
          </button>
          {hasCta && (
            <button
              type="button"
              onClick={handleCta}
              className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--dl-accent)] text-white text-[13.5px] font-semibold flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
            >
              <span className="truncate">{ctaLabel}</span>
              <ArrowUpRight size={15} className="shrink-0" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
