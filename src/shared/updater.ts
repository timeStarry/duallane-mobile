import { create } from "zustand";
import { nativeBridge, type NativeUpdateProgressEvent } from "@/native/bridge";

export const SERVER_LATEST_RELEASE_API = "/api/v1/mobile/releases/latest";
export const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/timeStarry/duallane-mobile/releases/latest";
export const GITHUB_RELEASES_PAGE_URL =
  "https://github.com/timeStarry/duallane-mobile/releases";

export interface MobileOtaInfo {
  enabled: boolean;
  version: string;
  bundleId: string;
  minNativeVersionCode: number;
  byteSize: number;
  sha256: string;
  otaUrl: string;
}

export interface MobileReleaseInfo {
  version: string;
  versionCode?: number;
  tagName: string;
  title: string;
  notes: string;
  publishedAt: string;
  htmlUrl: string;
  apkUrl: string;
  apkName: string;
  apkSizeBytes: number;
  sha256?: string;
  source: "server" | "github";
  ota?: MobileOtaInfo;
}

export function normalizeSemver(raw: string): number[] {
  const cleaned = raw.trim().replace(/^v/i, "").split("-")[0] || "0.0.0";
  return cleaned.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
}

export function compareSemver(a: string, b: string): number {
  const pa = normalizeSemver(a);
  const pb = normalizeSemver(b);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

interface ServerOtaPayload {
  enabled?: boolean;
  version?: string;
  bundleId?: string;
  minNativeVersionCode?: number;
  byteSize?: number;
  sha256?: string;
  downloadUrl?: string;
}

interface ServerReleasePayload {
  release?: {
    enabled?: boolean;
    version?: string;
    versionCode?: number;
    tagName?: string;
    title?: string;
    notes?: string;
    fileName?: string;
    byteSize?: number;
    sha256?: string;
    downloadUrl?: string;
    publishedAt?: string;
    ota?: ServerOtaPayload;
  };
}

interface GitHubAssetPayload {
  name?: string;
  size?: number;
  browser_download_url?: string;
  content_type?: string;
}

interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  published_at?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GitHubAssetPayload[];
}

export type RecommendedUpdateMode = "ota" | "apk";

interface UpdateState {
  checking: boolean;
  hasUpdate: boolean;
  recommendedMode: RecommendedUpdateMode;
  latestRelease: MobileReleaseInfo | null;
  lastCheckedAt: string | null;
  error: string | null;
  installing: boolean;
  installKind: "ota" | "apk" | null;
  progress: NativeUpdateProgressEvent | null;
  otaStagedBundleId: string | null;
  apkPermissionPending: boolean;
  checkForUpdates: (silent?: boolean) => Promise<{
    hasUpdate: boolean;
    release: MobileReleaseInfo | null;
    error?: string;
  }>;
  performOtaUpdate: (autoReload?: boolean) => Promise<{ ok: boolean; error?: string }>;
  performApkUpdate: () => Promise<{ ok: boolean; status?: string; error?: string }>;
  resumePendingApkInstall: () => Promise<{ ok: boolean; error?: string }>;
}

function resolveDownloadUrl(
  rawUrl: string | undefined,
  apiOrigin: string,
  fallbackPath = "/api/v1/mobile/android/latest.apk"
): string {
  const clean = (rawUrl || "").trim();
  const base = apiOrigin.replace(/\/+$/, "");
  if (!clean) {
    return `${base}${fallbackPath}`;
  }
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean;
  }
  return `${base}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

let progressSubscribed = false;

export const useUpdateStore = create<UpdateState>((set, get) => {
  if (!progressSubscribed && typeof window !== "undefined") {
    progressSubscribed = true;
    nativeBridge.onUpdateProgress((ev) => {
      set({ progress: ev });
    });
  }

  return {
    checking: false,
    hasUpdate: false,
    recommendedMode: "apk",
    latestRelease: null,
    lastCheckedAt: null,
    error: null,
    installing: false,
    installKind: null,
    progress: null,
    otaStagedBundleId: null,
    apkPermissionPending: false,

    checkForUpdates: async (silent = false) => {
      if (get().checking) {
        return { hasUpdate: get().hasUpdate, release: get().latestRelease };
      }
      set({ checking: true, ...(silent ? {} : { error: null }) });
      const snap = nativeBridge.getSessionSnapshot();
      const currentVersion = snap.appVersion;
      const currentVersionCode = snap.versionCode || 0;

      // 1. Primary: Check same-origin DualLane server release endpoint
      try {
        const srvRes = await nativeBridge.request("GET", SERVER_LATEST_RELEASE_API);
        if (srvRes.ok && srvRes.bodyText) {
          const parsed = JSON.parse(srvRes.bodyText) as ServerReleasePayload;
          const rel = parsed.release;
          if (rel && rel.enabled !== false && rel.version) {
            const cleanVersion = String(rel.version).trim().replace(/^v/i, "");
            const apkUrl = resolveDownloadUrl(rel.downloadUrl, snap.apiOrigin);
            const versionCode = Number(rel.versionCode || 0);

            let otaInfo: MobileOtaInfo | undefined;
            if (rel.ota && rel.ota.enabled !== false && rel.ota.sha256) {
              const otaVer = String(rel.ota.version || cleanVersion)
                .trim()
                .replace(/^v/i, "");
              otaInfo = {
                enabled: true,
                version: otaVer,
                bundleId: String(rel.ota.bundleId || rel.ota.sha256.slice(0, 12)),
                minNativeVersionCode: Number(rel.ota.minNativeVersionCode || 0),
                byteSize: Number(rel.ota.byteSize || 0),
                sha256: String(rel.ota.sha256).trim().toLowerCase(),
                otaUrl: resolveDownloadUrl(
                  rel.ota.downloadUrl,
                  snap.apiOrigin,
                  "/api/v1/mobile/android/latest-ota.zip"
                ),
              };
            }

            const release: MobileReleaseInfo = {
              version: cleanVersion,
              versionCode: versionCode > 0 ? versionCode : undefined,
              tagName: String(rel.tagName || `v${cleanVersion}`).trim(),
              title: String(rel.title || `DualLane Android v${cleanVersion}`).trim(),
              notes: String(rel.notes || "").trim(),
              publishedAt: String(rel.publishedAt || ""),
              htmlUrl: apkUrl,
              apkUrl,
              apkName: String(rel.fileName || `duallane-v${cleanVersion}.apk`),
              apkSizeBytes: Number(rel.byteSize || 0),
              sha256: rel.sha256 ? String(rel.sha256) : undefined,
              source: "server",
              ota: otaInfo,
            };

            const canUseOta = Boolean(
              nativeBridge.isNativeAndroid() &&
                otaInfo &&
                otaInfo.enabled &&
                currentVersionCode >= otaInfo.minNativeVersionCode &&
                (compareSemver(otaInfo.version, currentVersion) > 0 ||
                  (compareSemver(otaInfo.version, currentVersion) === 0 &&
                    Boolean(snap.otaBundleId) &&
                    snap.otaBundleId !== otaInfo.bundleId))
            );

            const semverCmp = compareSemver(cleanVersion, currentVersion);
            const hasApkUpdate =
              release.apkSizeBytes > 0 &&
              (semverCmp > 0 ||
                (semverCmp === 0 &&
                  versionCode > 0 &&
                  currentVersionCode > 0 &&
                  versionCode > currentVersionCode &&
                  !snap.otaActive));

            const hasUpdate = canUseOta || hasApkUpdate;
            const recommendedMode: RecommendedUpdateMode = canUseOta ? "ota" : "apk";

            set({
              checking: false,
              hasUpdate,
              recommendedMode,
              latestRelease: release,
              lastCheckedAt: new Date().toISOString(),
              error: null,
            });

            // Silently pre-stage ~180KB OTA bundle in background so next launch or 1-tap reload is instant
            if (silent && canUseOta && otaInfo && get().otaStagedBundleId !== otaInfo.bundleId) {
              void get().performOtaUpdate(false);
            }

            return { hasUpdate, release };
          }
        }
      } catch {
        // Fall through to GitHub Releases fallback
      }

      // 2. Fallback: GitHub Releases API
      try {
        const res = await nativeBridge.request("GET", GITHUB_LATEST_RELEASE_API, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": `DualLane-Mobile/${currentVersion}`,
          },
        });

        if (!res.ok || !res.bodyText) {
          const msg =
            res.status === 403
              ? "更新检测受限，请稍后再试"
              : `检查更新失败 (${res.status || "网络异常"})`;
          set({ checking: false, ...(silent ? {} : { error: msg }) });
          return { hasUpdate: false, release: null, error: msg };
        }

        const raw = JSON.parse(res.bodyText) as GitHubReleasePayload;
        const tagName = String(raw.tag_name || "").trim();
        if (!tagName) {
          const msg = "未获取到有效版本信息";
          set({ checking: false, ...(silent ? {} : { error: msg }) });
          return { hasUpdate: false, release: null, error: msg };
        }

        const version = tagName.replace(/^v/i, "");
        const assets = Array.isArray(raw.assets) ? raw.assets : [];
        const apkAsset =
          assets.find((item) => item.name?.toLowerCase().endsWith(".apk")) || assets[0];
        const htmlUrl = raw.html_url || GITHUB_RELEASES_PAGE_URL;
        const release: MobileReleaseInfo = {
          version,
          tagName,
          title: String(raw.name || tagName).trim(),
          notes: String(raw.body || "").trim(),
          publishedAt: String(raw.published_at || ""),
          htmlUrl,
          apkUrl: apkAsset?.browser_download_url || htmlUrl,
          apkName: apkAsset?.name || `duallane-${version}.apk`,
          apkSizeBytes: Number(apkAsset?.size || 0),
          source: "github",
        };

        const hasUpdate = compareSemver(version, currentVersion) > 0;
        set({
          checking: false,
          hasUpdate,
          recommendedMode: "apk",
          latestRelease: release,
          lastCheckedAt: new Date().toISOString(),
          error: null,
        });
        return { hasUpdate, release };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "网络连接异常，无法检查更新";
        set({ checking: false, ...(silent ? {} : { error: msg }) });
        return { hasUpdate: false, release: null, error: msg };
      }
    },

    performOtaUpdate: async (autoReload = true) => {
      const ota = get().latestRelease?.ota;
      if (!ota) return { ok: false, error: "当前没有可用的热更资源包" };
      if (get().installing) return { ok: false, error: "更新正在进行中" };

      if (get().otaStagedBundleId === ota.bundleId) {
        if (autoReload) nativeBridge.applyStagedOta();
        return { ok: true };
      }

      set({
        installing: true,
        installKind: "ota",
        error: null,
        progress: {
          kind: "ota",
          phase: "downloading",
          percent: 0,
          downloadedBytes: 0,
          totalBytes: ota.byteSize,
        },
      });

      try {
        const res = await nativeBridge.downloadAndStageOta({
          url: ota.otaUrl,
          sha256: ota.sha256,
          version: ota.version,
          bundleId: ota.bundleId,
          minNativeVersionCode: ota.minNativeVersionCode,
        });
        set({
          installing: false,
          installKind: null,
          otaStagedBundleId: res.bundleId || ota.bundleId,
        });
        if (autoReload) {
          nativeBridge.applyStagedOta();
        }
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "热更新下载失败";
        set({
          installing: false,
          installKind: null,
          ...(autoReload ? { error: msg } : {}),
        });
        return { ok: false, error: msg };
      }
    },

    performApkUpdate: async () => {
      const rel = get().latestRelease;
      if (!rel) return { ok: false, error: "当前没有可用的安装包信息" };
      if (get().installing) return { ok: false, error: "正在下载更新中" };

      set({
        installing: true,
        installKind: "apk",
        error: null,
        apkPermissionPending: false,
        progress: {
          kind: "apk",
          phase: "downloading",
          percent: 0,
          downloadedBytes: 0,
          totalBytes: rel.apkSizeBytes,
        },
      });

      try {
        const res = await nativeBridge.downloadAndInstallApk({
          url: rel.apkUrl,
          sha256: rel.sha256,
          version: rel.version,
        });
        set({
          installing: false,
          installKind: null,
          apkPermissionPending: res.status === "permission_requested",
        });
        return { ok: true, status: res.status };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "下载或安装更新失败";
        set({ installing: false, installKind: null, error: msg });
        return { ok: false, error: msg };
      }
    },

    resumePendingApkInstall: async () => {
      try {
        const res = await nativeBridge.installPendingApk();
        set({ apkPermissionPending: res.status === "permission_requested" });
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "调起系统安装器失败";
        set({ error: msg });
        return { ok: false, error: msg };
      }
    },
  };
});
