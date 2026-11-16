export interface NativeHttpResponse {
  status: number;
  ok: boolean;
  bodyText: string;
  headers?: Record<string, string>;
}

export interface PickedNativeFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  previewDataUrl?: string;
}

export interface NativeSessionSnapshot {
  authenticated: boolean;
  apiOrigin: string;
  appVersion: string;
  nativeVersion?: string;
  versionCode: number;
  otaActive?: boolean;
  otaBundleId?: string;
  platform: string;
  systemTheme?: "light" | "dark";
}

export interface NativeUpdateProgressEvent {
  kind: "ota" | "apk";
  phase: "downloading" | "verifying" | "ready";
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

export interface BackgroundPushStatus {
  keepAliveEnabled: boolean;
  notificationsGranted: boolean;
  ignoringBatteryOptimizations: boolean;
}

export interface NotificationContextPayload {
  currentUserId: string;
  currentUserDisplayName: string;
  muteMap: Record<string, "all" | "mentions" | "muted">;
  memberNames: Record<string, string>;
  convTitles?: Record<string, string>;
  convKinds?: Record<string, string>;
}

interface RawAndroidBridge {
  getBootstrapInfo(): string;
  setApiOrigin(origin: string): string;
  startGitHubOAuth(inviteCode: string): void;
  loginWithEmailCode(callId: string, email: string, challengeId: string, code: string): void;
  logout(): void;
  httpRequest(callId: string, method: string, path: string, headersJson: string, bodyText: string): void;
  pickMedia(callId: string, mode: "image" | "file", multiple: boolean): void;
  uploadConversationFile(callId: string, conversationId: string, pickedFileId: string): void;
  uploadTextAttachment?(
    callId: string,
    conversationId: string,
    fileName: string,
    content: string
  ): void;
  uploadCustomEmote(callId: string, pickedFileId: string, collectionId: string, addToLibrary: boolean): void;
  uploadBinaryAvatar(callId: string, targetPath: string, pickedFileId: string): void;
  readPickedFileBase64(callId: string, pickedFileId: string): void;
  wsConnect(socketId: string, path: string, authenticated: boolean): void;
  wsSend(socketId: string, data: string): void;
  wsClose(socketId: string): void;
  syncNotificationContext?(json: string): void;
  clearConversationNotification?(conversationId: string): void;
  getBackgroundPushStatus?(): string;
  setKeepAliveEnabled?(enabled: boolean): string;
  requestIgnoreBatteryOptimizations?(): void;
  requestNotificationPermission?(): void;
  haptic(kind: "light" | "medium" | "heavy" | "selection"): void;
  shareText(title: string, text: string): void;
  copyText(text: string): void;
  openExternalUrl(url: string): void;
  syncSystemBars(mode: "light" | "dark", bgHex: string): void;
  setCanGoBack(canGoBack: boolean): void;
  prefetchMedia?(urlsJson: string): void;
  markBundleHealthy?(): void;
  downloadAndStageOta?(
    callId: string,
    url: string,
    sha256: string,
    version: string,
    bundleId: string,
    minNativeVersionCode: number
  ): void;
  applyStagedOta?(): void;
  rollbackOta?(): void;
  downloadAndInstallApk?(callId: string, url: string, sha256: string, version: string): void;
  installPendingApk?(callId: string): void;
}

declare global {
  interface Window {
    DualLaneNative?: RawAndroidBridge;
    __duallaneResolveCall?: (callId: string, ok: boolean, payloadJson: string) => void;
    __duallaneOnWsEvent?: (socketId: string, eventType: "open" | "message" | "close" | "error", payload: string) => void;
    __duallaneOnOAuthResult?: (ok: boolean, errorMsg: string) => void;
    __duallaneOnDeepLink?: (url: string) => void;
    __duallaneOnBackPressed?: () => void;
    __duallaneSetInsets?: (safeTop: number, safeBottom: number, imeHeight: number) => void;
    __duallaneOnSystemTheme?: (mode: string) => void;
    __duallaneOnUpdateProgress?: (payloadJson: string) => void;
    __duallaneOnAppResumed?: () => void;
  }
}

type PendingCall = {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
};

const pendingCalls = new Map<string, PendingCall>();

type WsListener = {
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: () => void;
  onError?: (err: string) => void;
};

const wsListeners = new Map<string, WsListener>();
const browserSockets = new Map<string, WebSocket>();
const browserPickedFiles = new Map<string, File>();

let oauthListeners: Array<(res: { ok: boolean; error?: string }) => void> = [];
let deepLinkListeners: Array<(url: string) => void> = [];
let systemThemeListeners: Array<(mode: "light" | "dark") => void> = [];
let updateProgressListeners: Array<(ev: NativeUpdateProgressEvent) => void> = [];
let appResumeListeners: Array<() => void> = [];
let backPressHandler: (() => boolean) | null = null;

function ensureGlobalCallbacks() {
  if (typeof window === "undefined") return;

  if (!window.__duallaneResolveCall) {
    window.__duallaneResolveCall = (callId, ok, payloadJson) => {
      const entry = pendingCalls.get(callId);
      if (!entry) return;
      pendingCalls.delete(callId);
      if (!ok) {
        entry.reject(new Error(payloadJson || "Native call failed"));
        return;
      }
      try {
        entry.resolve(payloadJson ? JSON.parse(payloadJson) : {});
      } catch {
        entry.resolve(payloadJson);
      }
    };
  }

  if (!window.__duallaneOnWsEvent) {
    window.__duallaneOnWsEvent = (socketId, eventType, payload) => {
      const listener = wsListeners.get(socketId);
      if (!listener) return;
      if (eventType === "open") listener.onOpen?.();
      else if (eventType === "message") listener.onMessage?.(payload);
      else if (eventType === "close") {
        wsListeners.delete(socketId);
        listener.onClose?.();
      } else if (eventType === "error") listener.onError?.(payload);
    };
  }

  if (!window.__duallaneOnOAuthResult) {
    window.__duallaneOnOAuthResult = (ok, errorMsg) => {
      for (const cb of oauthListeners) {
        cb({ ok, error: errorMsg || undefined });
      }
    };
  }

  if (!window.__duallaneOnDeepLink) {
    window.__duallaneOnDeepLink = (url) => {
      for (const cb of deepLinkListeners) {
        cb(url);
      }
    };
  }

  if (!window.__duallaneOnBackPressed) {
    window.__duallaneOnBackPressed = () => {
      backPressHandler?.();
    };
  }

  if (!window.__duallaneSetInsets) {
    window.__duallaneSetInsets = (safeTop, safeBottom, imeHeight) => {
      const root = document.documentElement;
      root.style.setProperty("--safe-top", `${Math.max(0, safeTop)}px`);
      root.style.setProperty("--safe-bottom", `${Math.max(0, safeBottom)}px`);
      root.style.setProperty("--ime-height", `${Math.max(0, imeHeight)}px`);
    };
  }

  if (!window.__duallaneOnSystemTheme) {
    window.__duallaneOnSystemTheme = (rawMode) => {
      const mode: "light" | "dark" = rawMode === "dark" ? "dark" : "light";
      for (const cb of systemThemeListeners) {
        cb(mode);
      }
    };
  }

  if (!window.__duallaneOnUpdateProgress) {
    window.__duallaneOnUpdateProgress = (payloadJson) => {
      try {
        const parsed = JSON.parse(payloadJson) as NativeUpdateProgressEvent;
        for (const cb of updateProgressListeners) {
          cb(parsed);
        }
      } catch {
        // ignore malformed progress event
      }
    };
  }

  if (!window.__duallaneOnAppResumed) {
    window.__duallaneOnAppResumed = () => {
      for (const cb of appResumeListeners) {
        cb();
      }
    };
  }
}

ensureGlobalCallbacks();

function nextCallId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function invokeNativeAsync<T>(fn: (callId: string) => void): Promise<T> {
  ensureGlobalCallbacks();
  const callId = nextCallId("nc");
  return new Promise<T>((resolve, reject) => {
    pendingCalls.set(callId, {
      resolve: resolve as (val: unknown) => void,
      reject,
    });
    try {
      fn(callId);
    } catch (err) {
      pendingCalls.delete(callId);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

const DEFAULT_ORIGIN = "https://duallane.tsio.top";
const BROWSER_ORIGIN_KEY = "duallane:mobile:api-origin";
const BROWSER_KEEPALIVE_KEY = "duallane:mobile:keepalive-enabled";

export const nativeBridge = {
  isNativeAndroid(): boolean {
    return typeof window !== "undefined" && Boolean(window.DualLaneNative);
  },

  getSessionSnapshot(): NativeSessionSnapshot {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      try {
        const raw = JSON.parse(window.DualLaneNative.getBootstrapInfo()) as Partial<NativeSessionSnapshot>;
        return {
          authenticated: Boolean(raw.authenticated),
          apiOrigin: raw.apiOrigin || DEFAULT_ORIGIN,
          appVersion: raw.appVersion || "1.0.12",
          nativeVersion: raw.nativeVersion || raw.appVersion || "1.0.12",
          versionCode: raw.versionCode || 10012,
          otaActive: Boolean(raw.otaActive),
          otaBundleId: raw.otaBundleId ? String(raw.otaBundleId) : undefined,
          platform: raw.platform || "android",
          systemTheme:
            raw.systemTheme === "dark" || raw.systemTheme === "light"
              ? raw.systemTheme
              : undefined,
        };
      } catch {
        // Fallback below
      }
    }
    const storedOrigin =
      typeof window !== "undefined" ? window.localStorage.getItem(BROWSER_ORIGIN_KEY) : null;
    return {
      authenticated: false,
      apiOrigin: storedOrigin || DEFAULT_ORIGIN,
      appVersion: "1.0.12",
      nativeVersion: "1.0.12",
      versionCode: 10012,
      otaActive: false,
      platform: "web",
    };
  },

  setApiOrigin(origin: string): { ok: boolean; apiOrigin?: string; error?: string } {
    const trimmed = origin.trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
        return { ok: false, error: "服务地址必须使用 HTTPS 协议" };
      }
      if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
        return { ok: false, error: "请输入纯域名根地址（不含路径或参数）" };
      }
    } catch {
      return { ok: false, error: "服务地址格式无效" };
    }
    if (this.isNativeAndroid() && window.DualLaneNative) {
      try {
        const res = JSON.parse(window.DualLaneNative.setApiOrigin(trimmed)) as {
          ok: boolean;
          apiOrigin?: string;
          error?: string;
        };
        return res;
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "设置失败" };
      }
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BROWSER_ORIGIN_KEY, trimmed);
    }
    return { ok: true, apiOrigin: trimmed };
  },

  startGitHubOAuth(inviteCode = ""): void {
    const cleanInvite = inviteCode.trim();
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.startGitHubOAuth(cleanInvite);
      return;
    }
    const base = this.getSessionSnapshot().apiOrigin;
    const qs = cleanInvite ? `?invite=${encodeURIComponent(cleanInvite)}` : "";
    window.location.assign(`${base}/api/auth/github/start${qs}`);
  },

  async loginWithEmailCode(
    email: string,
    challengeId: string,
    code: string
  ): Promise<{ ok: boolean }> {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      return invokeNativeAsync<{ ok: boolean }>((callId) => {
        window.DualLaneNative!.loginWithEmailCode(
          callId,
          email.trim(),
          challengeId.trim(),
          code.trim()
        );
      });
    }
    const res = await this.request("POST", "/api/v1/auth/email/verify", {
      body: JSON.stringify({
        email: email.trim(),
        challengeId: challengeId.trim(),
        code: code.trim(),
        client: "web",
      }),
    });
    if (!res.ok) {
      let msg = `验证码登录失败 (${res.status})`;
      try {
        const parsed = JSON.parse(res.bodyText || "{}") as {
          error?: { message?: string };
          message?: string;
        };
        msg = parsed.error?.message || parsed.message || msg;
      } catch {
        // keep fallback
      }
      throw new Error(msg);
    }
    return { ok: true };
  },

  logout(): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.logout();
      return;
    }
    const base = this.getSessionSnapshot().apiOrigin;
    void fetch(`${base}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => {});
  },

  async request(
    method: string,
    path: string,
    options?: { headers?: Record<string, string>; body?: string }
  ): Promise<NativeHttpResponse> {
    const headers = options?.headers || {};
    const bodyText = options?.body || "";
    if (this.isNativeAndroid() && window.DualLaneNative) {
      return invokeNativeAsync<NativeHttpResponse>((callId) => {
        window.DualLaneNative!.httpRequest(
          callId,
          method.toUpperCase(),
          path,
          JSON.stringify(headers),
          bodyText
        );
      });
    }
    const origin = path.startsWith("http") ? "" : this.getSessionSnapshot().apiOrigin;
    const res = await fetch(`${origin}${path}`, {
      method: method.toUpperCase(),
      credentials: "include",
      headers: {
        ...(bodyText && !headers["Content-Type"] ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: bodyText ? bodyText : undefined,
    });
    const text = await res.text();
    return {
      status: res.status,
      ok: res.ok,
      bodyText: text,
    };
  },

  async pickMedia(mode: "image" | "file", multiple = false): Promise<PickedNativeFile[]> {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      const res = await invokeNativeAsync<{ files?: PickedNativeFile[] }>((callId) => {
        window.DualLaneNative!.pickMedia(callId, mode, multiple);
      });
      return Array.isArray(res.files) ? res.files : [];
    }
    return new Promise<PickedNativeFile[]>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = multiple;
      if (mode === "image") input.accept = "image/*";
      input.onchange = () => {
        const list = Array.from(input.files || []);
        const picked: PickedNativeFile[] = list.map((f) => {
          const id = nextCallId("bf");
          browserPickedFiles.set(id, f);
          return {
            id,
            name: f.name,
            mimeType: f.type || "application/octet-stream",
            size: f.size,
            previewDataUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
          };
        });
        resolve(picked);
      };
      input.oncancel = () => resolve([]);
      input.click();
    });
  },

  async uploadConversationFile(
    conversationId: string,
    pickedFileId: string
  ): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    url: string;
    downloadUrl: string;
    usedToday?: number;
  }> {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      return invokeNativeAsync((callId) => {
        window.DualLaneNative!.uploadConversationFile(callId, conversationId, pickedFileId);
      });
    }
    const file = browserPickedFiles.get(pickedFileId);
    if (!file) throw new Error("未找到待上传文件");
    const reserveRes = await this.request("POST", "/api/workspace/files/uploads/reserve", {
      body: JSON.stringify({
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        visibility: "conversation",
        conversationId,
      }),
    });
    const reserved = JSON.parse(reserveRes.bodyText || "{}") as {
      upload?: { id: string };
      attachment?: { id: string; fileName: string; mimeType: string; byteSize: number };
    };
    if (!reserveRes.ok || !reserved.upload?.id) {
      throw new Error("文件上传配额不足或初始化失败");
    }
    const origin = this.getSessionSnapshot().apiOrigin;
    const raw = await file.arrayBuffer();
    const putRes = await fetch(
      `${origin}/api/workspace/files/uploads/${encodeURIComponent(reserved.upload.id)}/content`,
      {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/octet-stream" },
        body: raw,
      }
    );
    const done = (await putRes.json()) as {
      usedToday?: number;
      attachment?: { id: string; fileName: string; mimeType: string; byteSize: number };
    };
    const att = done.attachment || reserved.attachment!;
    const downloadUrl = `/api/workspace/files/${encodeURIComponent(att.id)}/download`;
    const previewUrl = att.mimeType.startsWith("image/")
      ? `/api/workspace/files/${encodeURIComponent(att.id)}/preview`
      : downloadUrl;
    return {
      id: att.id,
      fileName: att.fileName,
      mimeType: att.mimeType,
      byteSize: att.byteSize,
      url: previewUrl,
      downloadUrl,
      usedToday: done.usedToday,
    };
  },

  async uploadTextAttachment(
    conversationId: string,
    fileName: string,
    content: string
  ): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    url: string;
    downloadUrl: string;
    usedToday?: number;
  }> {
    const cleanName = fileName.trim() || "pasted.txt";
    if (this.isNativeAndroid() && window.DualLaneNative?.uploadTextAttachment) {
      return invokeNativeAsync((callId) => {
        window.DualLaneNative!.uploadTextAttachment!(callId, conversationId, cleanName, content);
      });
    }
    const byteSize = new TextEncoder().encode(content).byteLength;
    const mimeType = "text/plain; charset=utf-8";
    const reserveRes = await this.request("POST", "/api/workspace/files/uploads/reserve", {
      body: JSON.stringify({
        fileName: cleanName,
        mimeType,
        byteSize,
        visibility: "conversation",
        conversationId,
      }),
    });
    const reserved = JSON.parse(reserveRes.bodyText || "{}") as {
      upload?: { id: string };
      attachment?: { id: string; fileName: string; mimeType: string; byteSize: number };
      error?: { message?: string };
      message?: string;
    };
    if (!reserveRes.ok || !reserved.upload?.id) {
      throw new Error(
        reserved.error?.message || reserved.message || "长文本附件上传配额不足或初始化失败"
      );
    }
    const putRes = await this.request(
      "PUT",
      `/api/workspace/files/uploads/${encodeURIComponent(reserved.upload.id)}/content`,
      {
        headers: { "Content-Type": "application/octet-stream" },
        body: content,
      }
    );
    if (!putRes.ok) {
      throw new Error("长文本附件上传失败");
    }
    const done = JSON.parse(putRes.bodyText || "{}") as {
      usedToday?: number;
      attachment?: { id: string; fileName: string; mimeType: string; byteSize: number };
    };
    const att = done.attachment || reserved.attachment;
    if (!att?.id) {
      throw new Error("长文本附件上传未返回附件标识");
    }
    const downloadUrl = `/api/workspace/files/${encodeURIComponent(att.id)}/download`;
    return {
      id: att.id,
      fileName: att.fileName || cleanName,
      mimeType: att.mimeType || mimeType,
      byteSize: att.byteSize || byteSize,
      url: downloadUrl,
      downloadUrl,
      usedToday: done.usedToday,
    };
  },

  async uploadCustomEmote(
    pickedFileId: string,
    collectionId = "",
    addToLibrary = true
  ): Promise<{ emote: Record<string, unknown> }> {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      return invokeNativeAsync((callId) => {
        window.DualLaneNative!.uploadCustomEmote(callId, pickedFileId, collectionId, addToLibrary);
      });
    }
    const file = browserPickedFiles.get(pickedFileId);
    if (!file) throw new Error("未找到贴纸图片");
    const params = new URLSearchParams();
    if (collectionId) {
      params.set("collectionId", collectionId);
      if (!addToLibrary) params.set("addToLibrary", "false");
    }
    const qs = params.toString();
    const origin = this.getSessionSnapshot().apiOrigin;
    const res = await fetch(`${origin}/api/workspace/me/emotes${qs ? `?${qs}` : ""}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": file.type || "image/png",
        "X-DualLane-File-Name": encodeURIComponent(file.name),
      },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error("贴纸上传失败");
    return (await res.json()) as { emote: Record<string, unknown> };
  },

  async uploadBinaryAvatar(targetPath: string, pickedFileId: string): Promise<Record<string, unknown>> {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      return invokeNativeAsync((callId) => {
        window.DualLaneNative!.uploadBinaryAvatar(callId, targetPath, pickedFileId);
      });
    }
    const file = browserPickedFiles.get(pickedFileId);
    if (!file) throw new Error("未找到头像文件");
    const origin = this.getSessionSnapshot().apiOrigin;
    const res = await fetch(`${origin}${targetPath}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": file.type || "image/png" },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error("头像上传失败");
    return (await res.json()) as Record<string, unknown>;
  },

  async readPickedFileBytes(pickedFileId: string): Promise<Uint8Array> {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      const res = await invokeNativeAsync<{ base64: string }>((callId) => {
        window.DualLaneNative!.readPickedFileBase64(callId, pickedFileId);
      });
      const bin = atob(res.base64 || "");
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    const file = browserPickedFiles.get(pickedFileId);
    if (!file) throw new Error("未找到文件");
    return new Uint8Array(await file.arrayBuffer());
  },

  connectSocket(
    path: string,
    authenticated: boolean,
    listener: WsListener
  ): { send: (data: string) => void; close: () => void } {
    ensureGlobalCallbacks();
    const socketId = nextCallId("ws");
    wsListeners.set(socketId, listener);

    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.wsConnect(socketId, path, authenticated);
      return {
        send: (data: string) => {
          window.DualLaneNative?.wsSend(socketId, data);
        },
        close: () => {
          wsListeners.delete(socketId);
          window.DualLaneNative?.wsClose(socketId);
        },
      };
    }

    const origin = this.getSessionSnapshot().apiOrigin;
    const wsUrl = origin.replace(/^http/, "ws") + path;
    const ws = new WebSocket(wsUrl);
    browserSockets.set(socketId, ws);
    ws.onopen = () => wsListeners.get(socketId)?.onOpen?.();
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") wsListeners.get(socketId)?.onMessage?.(ev.data);
    };
    ws.onerror = () => wsListeners.get(socketId)?.onError?.("socket_error");
    ws.onclose = () => {
      browserSockets.delete(socketId);
      const l = wsListeners.get(socketId);
      wsListeners.delete(socketId);
      l?.onClose?.();
    };
    return {
      send: (data: string) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      },
      close: () => {
        wsListeners.delete(socketId);
        browserSockets.delete(socketId);
        try {
          ws.close(1000, "closed");
        } catch {
          // ignore
        }
      },
    };
  },

  haptic(kind: "light" | "medium" | "heavy" | "selection" = "selection"): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.haptic(kind);
    } else if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(kind === "heavy" ? 18 : 8);
    }
  },

  shareText(title: string, text: string): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.shareText(title, text);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      void navigator.share({ title, text }).catch(() => {});
    } else {
      this.copyText(text);
    }
  },

  copyText(text: string): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.copyText(text);
      return;
    }
    void navigator.clipboard?.writeText(text).catch(() => {});
  },

  openExternalUrl(url: string): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.openExternalUrl(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  syncSystemBars(mode: "light" | "dark", bgHex: string): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.syncSystemBars(mode, bgHex);
    }
  },

  setCanGoBack(canGoBack: boolean): void {
    if (this.isNativeAndroid() && window.DualLaneNative) {
      window.DualLaneNative.setCanGoBack(canGoBack);
    }
  },

  syncNotificationContext(payload: NotificationContextPayload): void {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.syncNotificationContext) return;
    try {
      window.DualLaneNative.syncNotificationContext(JSON.stringify(payload));
    } catch {
      // non-fatal
    }
  },

  clearConversationNotification(conversationId: string): void {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.clearConversationNotification) return;
    try {
      window.DualLaneNative.clearConversationNotification(conversationId);
    } catch {
      // non-fatal
    }
  },

  getBackgroundPushStatus(): BackgroundPushStatus {
    if (this.isNativeAndroid() && window.DualLaneNative?.getBackgroundPushStatus) {
      try {
        const parsed = JSON.parse(
          window.DualLaneNative.getBackgroundPushStatus()
        ) as Partial<BackgroundPushStatus>;
        return {
          keepAliveEnabled: parsed.keepAliveEnabled !== false,
          notificationsGranted: Boolean(parsed.notificationsGranted),
          ignoringBatteryOptimizations: Boolean(parsed.ignoringBatteryOptimizations),
        };
      } catch {
        // fallback below
      }
    }
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(BROWSER_KEEPALIVE_KEY) : null;
    const browserNotifGranted =
      typeof Notification !== "undefined" && Notification.permission === "granted";
    return {
      keepAliveEnabled: stored !== "false",
      notificationsGranted: browserNotifGranted,
      ignoringBatteryOptimizations: !this.isNativeAndroid(),
    };
  },

  setKeepAliveEnabled(enabled: boolean): BackgroundPushStatus {
    if (this.isNativeAndroid() && window.DualLaneNative?.setKeepAliveEnabled) {
      try {
        const parsed = JSON.parse(
          window.DualLaneNative.setKeepAliveEnabled(enabled)
        ) as Partial<BackgroundPushStatus>;
        return {
          keepAliveEnabled: parsed.keepAliveEnabled ?? enabled,
          notificationsGranted: Boolean(parsed.notificationsGranted),
          ignoringBatteryOptimizations: Boolean(parsed.ignoringBatteryOptimizations),
        };
      } catch {
        // fallback below
      }
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(BROWSER_KEEPALIVE_KEY, enabled ? "true" : "false");
    }
    return {
      ...this.getBackgroundPushStatus(),
      keepAliveEnabled: enabled,
    };
  },

  requestIgnoreBatteryOptimizations(): void {
    if (this.isNativeAndroid() && window.DualLaneNative?.requestIgnoreBatteryOptimizations) {
      window.DualLaneNative.requestIgnoreBatteryOptimizations();
    }
  },

  requestNotificationPermission(): void {
    if (this.isNativeAndroid() && window.DualLaneNative?.requestNotificationPermission) {
      window.DualLaneNative.requestNotificationPermission();
      return;
    }
    if (typeof Notification !== "undefined" && Notification.requestPermission) {
      void Notification.requestPermission();
    }
  },

  onAppResumed(cb: () => void): () => void {
    ensureGlobalCallbacks();
    appResumeListeners.push(cb);
    return () => {
      appResumeListeners = appResumeListeners.filter((x) => x !== cb);
    };
  },

  prefetchMedia(urls: string[]): void {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.prefetchMedia) return;
    const deduped = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean))).slice(0, 48);
    if (deduped.length === 0) return;
    try {
      window.DualLaneNative.prefetchMedia(JSON.stringify(deduped));
    } catch {
      // non-fatal
    }
  },

  markBundleHealthy(): void {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.markBundleHealthy) return;
    try {
      window.DualLaneNative.markBundleHealthy();
    } catch {
      // non-fatal
    }
  },

  downloadAndStageOta(input: {
    url: string;
    sha256: string;
    version: string;
    bundleId: string;
    minNativeVersionCode: number;
  }): Promise<{ ok: boolean; version: string; bundleId: string }> {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.downloadAndStageOta) {
      return Promise.reject(new Error("当前环境不支持原生热更新"));
    }
    return invokeNativeAsync((callId) => {
      window.DualLaneNative!.downloadAndStageOta!(
        callId,
        input.url,
        input.sha256,
        input.version,
        input.bundleId,
        input.minNativeVersionCode
      );
    });
  },

  applyStagedOta(): void {
    if (this.isNativeAndroid() && window.DualLaneNative?.applyStagedOta) {
      window.DualLaneNative.applyStagedOta();
    } else if (typeof window !== "undefined") {
      window.location.reload();
    }
  },

  rollbackOta(): void {
    if (this.isNativeAndroid() && window.DualLaneNative?.rollbackOta) {
      window.DualLaneNative.rollbackOta();
    }
  },

  downloadAndInstallApk(input: {
    url: string;
    sha256?: string;
    version: string;
  }): Promise<{ ok: boolean; status: string }> {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.downloadAndInstallApk) {
      this.openExternalUrl(input.url);
      return Promise.resolve({ ok: true, status: "external" });
    }
    return invokeNativeAsync((callId) => {
      window.DualLaneNative!.downloadAndInstallApk!(
        callId,
        input.url,
        input.sha256 || "",
        input.version
      );
    });
  },

  installPendingApk(): Promise<{ ok: boolean; status: string }> {
    if (!this.isNativeAndroid() || !window.DualLaneNative?.installPendingApk) {
      return Promise.reject(new Error("未找到待安装文件"));
    }
    return invokeNativeAsync((callId) => {
      window.DualLaneNative!.installPendingApk!(callId);
    });
  },

  onUpdateProgress(cb: (ev: NativeUpdateProgressEvent) => void): () => void {
    ensureGlobalCallbacks();
    updateProgressListeners.push(cb);
    return () => {
      updateProgressListeners = updateProgressListeners.filter((x) => x !== cb);
    };
  },

  onSystemThemeChange(cb: (mode: "light" | "dark") => void): () => void {
    ensureGlobalCallbacks();
    systemThemeListeners.push(cb);
    return () => {
      systemThemeListeners = systemThemeListeners.filter((x) => x !== cb);
    };
  },

  onOAuthResult(cb: (res: { ok: boolean; error?: string }) => void): () => void {
    oauthListeners.push(cb);
    return () => {
      oauthListeners = oauthListeners.filter((x) => x !== cb);
    };
  },

  onDeepLink(cb: (url: string) => void): () => void {
    deepLinkListeners.push(cb);
    return () => {
      deepLinkListeners = deepLinkListeners.filter((x) => x !== cb);
    };
  },

  setBackPressHandler(handler: (() => boolean) | null): void {
    backPressHandler = handler;
  },
};
