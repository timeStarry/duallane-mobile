import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";

export const SERVER_LATEST_RELEASE_API = "/api/v1/mobile/releases/latest";
export const GITHUB_LATEST_RELEASE_API =
  "https://api.github.com/repos/timeStarry/duallane-mobile/releases/latest";
export const GITHUB_RELEASES_PAGE_URL =
  "https://github.com/timeStarry/duallane-mobile/releases";

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

interface UpdateState {
  checking: boolean;
  hasUpdate: boolean;
  latestRelease: MobileReleaseInfo | null;
  lastCheckedAt: string | null;
  error: string | null;
  checkForUpdates: (silent?: boolean) => Promise<{
    hasUpdate: boolean;
    release: MobileReleaseInfo | null;
    error?: string;
  }>;
}

function resolveDownloadUrl(rawUrl: string | undefined, apiOrigin: string): string {
  const clean = (rawUrl || "").trim();
  const base = apiOrigin.replace(/\/+$/, "");
  if (!clean) {
    return `${base}/api/v1/mobile/android/latest.apk`;
  }
  if (clean.startsWith("http://") || clean.startsWith("https://")) {
    return clean;
  }
  return `${base}${clean.startsWith("/") ? clean : `/${clean}`}`;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  checking: false,
  hasUpdate: false,
  latestRelease: null,
  lastCheckedAt: null,
  error: null,

  checkForUpdates: async (silent = false) => {
    if (get().checking) {
      return { hasUpdate: get().hasUpdate, release: get().latestRelease };
    }
    set({ checking: true, ...(silent ? {} : { error: null }) });
    const snap = nativeBridge.getSessionSnapshot();
    const currentVersion = snap.appVersion;
    const currentVersionCode = snap.versionCode || 0;

    // 1. Primary: Check same-origin DualLane server release endpoint (zero external network dependency)
    try {
      const srvRes = await nativeBridge.request("GET", SERVER_LATEST_RELEASE_API);
      if (srvRes.ok && srvRes.bodyText) {
        const parsed = JSON.parse(srvRes.bodyText) as ServerReleasePayload;
        const rel = parsed.release;
        if (rel && rel.enabled !== false && rel.version) {
          const cleanVersion = String(rel.version).trim().replace(/^v/i, "");
          const apkUrl = resolveDownloadUrl(rel.downloadUrl, snap.apiOrigin);
          const versionCode = Number(rel.versionCode || 0);
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
          };
          const semverCmp = compareSemver(cleanVersion, currentVersion);
          const hasUpdate =
            semverCmp > 0 ||
            (semverCmp === 0 &&
              versionCode > 0 &&
              currentVersionCode > 0 &&
              versionCode > currentVersionCode);
          set({
            checking: false,
            hasUpdate,
            latestRelease: release,
            lastCheckedAt: new Date().toISOString(),
            error: null,
          });
          return { hasUpdate, release };
        }
      }
    } catch {
      // Fall through to GitHub Releases fallback
    }

    // 2. Fallback: GitHub Releases API (when current server has not hosted an APK yet)
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
}));
