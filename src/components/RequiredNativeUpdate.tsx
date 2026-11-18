import { useEffect } from "react";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import { useUpdateStore } from "@/shared/updater";
import { BrandLogo } from "./BrandLogo";

// Intent: a member must install a compatible Android host without losing their
// identity or drafts. One primary download action, existing DL semantic tokens,
// compact 4px spacing, and the same calm surface treatment as the entry screen.
export function RequiredNativeUpdate() {
  const release = useUpdateStore((s) => s.latestRelease);
  const minimum = useUpdateStore((s) => s.minimumSupportedNativeVersionCode);
  const installing = useUpdateStore((s) => s.installing);
  const checking = useUpdateStore((s) => s.checking);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const permissionPending = useUpdateStore((s) => s.apkPermissionPending);
  const snapshot = nativeBridge.getSessionSnapshot();
  const staleAPK = release?.source === "server" && (release.versionCode || 0) < minimum;
  useEffect(() => {
    const current = useUpdateStore.getState();
    if (!current.latestRelease || (current.latestRelease.source === "server" && (current.latestRelease.versionCode || 0) < minimum)) {
      void current.checkForUpdates(false);
    }
  }, [minimum]);
  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[var(--dl-bg)] px-6 py-8 flex flex-col items-center justify-center gap-6" aria-labelledby="native-upgrade-title" data-testid="required-native-update">
      <BrandLogo size={64} withTile />
      <div className="w-full max-w-sm space-y-3 text-center">
        <div className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--dl-accent)]"><ShieldCheck size={16} />需要更新应用</div>
        <h1 id="native-upgrade-title" className="text-xl font-bold text-[var(--dl-text)]">安装新版后继续使用</h1>
        <p className="text-[14px] leading-6 text-[var(--dl-text-muted)]">当前 Android 版本已不再受支持。更新会保留账号和会话，完成后即可继续聊天。</p>
        <p className="text-[11px] text-[var(--dl-text-muted)]">当前安装版本 {snapshot.nativeVersion || "未知"}{release?.apkVersion ? ` · 可用版本 ${release.apkVersion}` : ""}</p>
      </div>
      <div className="w-full max-w-sm space-y-3">
        {installing && progress && <p role="status" className="text-center text-[13px] text-[var(--dl-text-muted)]">{progress.phase === "verifying" ? "正在校验安装包…" : `正在下载安装包… ${Math.round(progress.percent)}%`}</p>}
        {error && <p role="alert" className="rounded-xl bg-[var(--dl-surface)] p-3 text-[13px] text-[var(--dl-text)]">{error}</p>}
        <button type="button" disabled={installing || checking || !release || release.apkSizeBytes <= 0 || staleAPK} onClick={() => {
          void (permissionPending ? useUpdateStore.getState().resumePendingApkInstall() : useUpdateStore.getState().performApkUpdate());
        }} className="w-full flex items-center justify-center gap-2 rounded-2xl bg-[var(--dl-accent)] px-4 py-3.5 text-[14px] font-semibold text-white disabled:opacity-50">
          <Download size={18} />{permissionPending ? "继续安装更新" : "下载并安装更新"}
        </button>
        <button type="button" disabled={checking || installing} onClick={() => void useUpdateStore.getState().checkForUpdates(false)} className="w-full flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-medium text-[var(--dl-accent)] disabled:opacity-50"><RefreshCw size={16} className={checking ? "animate-spin" : undefined} />{checking ? "正在检查…" : "重新检查更新"}</button>
        <p className="text-center text-[11px] leading-5 text-[var(--dl-text-muted)]">安装需要 Android 系统确认；若提示权限，请允许此应用安装更新。</p>
      </div>
    </main>
  );
}
