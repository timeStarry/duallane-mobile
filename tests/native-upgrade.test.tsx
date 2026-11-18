import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { nativeBridge } from "@/native/bridge";
import { useUpdateStore } from "@/shared/updater";
import { beginMobileWrite, hasMobileDrafts, isMobileWritePending, setMobileDraftActivity } from "@/shared/activity";
import { nativeUpgradeRequired, readNativeUpgradePolicy, saveNativeUpgradePolicy } from "@/shared/native-upgrade";
import { RequiredNativeUpdate } from "@/components/RequiredNativeUpdate";
import { App } from "@/App";
import { useWorkspaceStore } from "@/store/workspace-store";

const origin = "https://native-upgrade.example";
const snapshot = (nativeCode = 10051) => ({ authenticated: true, apiOrigin: origin, appVersion: "1.0.14", nativeVersion: "1.0.10", versionCode: nativeCode, otaActive: true, otaBundleId: "oldbundle", platform: "android" as const });
const release = (floor = 10054) => ({ release: {
  enabled: true, version: "1.1.0", apkVersion: "1.1.0", versionCode: 10100,
  minimumSupportedNativeVersionCode: floor, byteSize: 100000, sha256: "a".repeat(64),
  ota: { enabled: true, version: "1.1.0", bundleId: "newbundle", minNativeVersionCode: 10051, byteSize: 40000, sha256: "b".repeat(64) },
} });
const json = (value: unknown, status = 200) => ({ ok: status === 200, status, bodyText: JSON.stringify(value) });

beforeEach(() => {
  vi.spyOn(nativeBridge, "isNativeAndroid").mockReturnValue(true);
  vi.spyOn(nativeBridge, "getSessionSnapshot").mockReturnValue(snapshot());
  saveNativeUpgradePolicy(origin, 0, 10100);
  useUpdateStore.setState({ checking: false, hasUpdate: false, hasApkUpdate: false, requiredNativeUpdate: false, minimumSupportedNativeVersionCode: 0, latestRelease: null, installing: false, installKind: null, progress: null, otaStagedBundleId: null, apkPermissionPending: false, error: null });
});
afterEach(() => { cleanup(); setMobileDraftActivity("draft-test", false); saveNativeUpgradePolicy(origin, 0, 10100); delete window.DualLaneNative; vi.restoreAllMocks(); });

describe("native mandatory update and OTA compatibility", () => {
  it("cannot satisfy a native minimum with a new OTA version or missing packaged native code", () => {
    vi.mocked(nativeBridge.getSessionSnapshot).mockRestore();
    Object.defineProperty(window, "DualLaneNative", { configurable: true, value: { getBootstrapInfo: () => JSON.stringify({ appVersion: "1.1.0", otaActive: true }) } });
    const missing = nativeBridge.getSessionSnapshot();
    expect(missing.versionCode).toBe(0);
    expect(missing.nativeVersion).toBe("未知");
    expect(nativeUpgradeRequired(missing.versionCode, { minimumSupportedNativeVersionCode: 10054, latestNativeVersionCode: 10100 })).toBe(true);
  });
  it("declares the actual old host code through the existing native bridge and blocks only business calls", async () => {
    const calls: Array<{ path: string; headers: Record<string, string> }> = [];
    Object.defineProperty(window, "DualLaneNative", { configurable: true, value: {
      httpRequest: (id: string, _method: string, path: string, headers: string) => {
        calls.push({ path, headers: JSON.parse(headers) as Record<string, string> });
        window.__duallaneResolveCall?.(id, true, JSON.stringify(json({})));
      },
    } });
    await nativeBridge.request("GET", "/api/v1/bootstrap", { headers: { "x-duallane-native-version-code": "10100" } });
    expect(calls[0].headers["X-DualLane-Native-Version-Code"]).toBe("10051");
    expect(calls[0].headers["x-duallane-native-version-code"]).toBeUndefined();
    saveNativeUpgradePolicy(origin, 10054, 10100);
    expect((await nativeBridge.request("POST", "/api/workspace/messages")).status).toBe(426);
    expect(calls).toHaveLength(1);
    expect((await nativeBridge.request("GET", "/api/v1/mobile/releases/latest")).ok).toBe(true);
    expect(calls).toHaveLength(2);
    const error = vi.fn();
    nativeBridge.connectSocket("/ws/workspace", true, { onError: error });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("mobile.native_upgrade_required"));
  });

  it("does not expose native metadata to external update origins or human web sessions", async () => {
    const calls: Array<Record<string, string>> = [];
    Object.defineProperty(window, "DualLaneNative", { configurable: true, value: { httpRequest: (id: string, _method: string, _path: string, headers: string) => {
      calls.push(JSON.parse(headers) as Record<string, string>);
      window.__duallaneResolveCall?.(id, true, JSON.stringify(json({})));
    } } });
    await nativeBridge.request("GET", "https://api.github.com/repos/timeStarry/duallane-mobile/releases/latest");
    expect(calls[0]["X-DualLane-Native-Version-Code"]).toBeUndefined();
    vi.spyOn(nativeBridge, "isNativeAndroid").mockReturnValue(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await nativeBridge.request("GET", "/api/v1/bootstrap");
    const options = fetch.mock.calls[0][1];
    expect(new Headers(options?.headers).has("X-DualLane-Native-Version-Code")).toBe(false);
  });
  it("distinguishes the minimum usable native host from the OTA-compatible host", async () => {
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(release()));
    const stage = vi.spyOn(nativeBridge, "downloadAndStageOta").mockResolvedValue({ ok: true, version: "1.1.0", bundleId: "newbundle" });
    await useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState()).toMatchObject({ requiredNativeUpdate: true, recommendedMode: "apk", minimumSupportedNativeVersionCode: 10054 });
    expect(stage).not.toHaveBeenCalled();
    render(<RequiredNativeUpdate />);
    expect(screen.getByRole("heading", { name: "安装新版后继续使用" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /稍后|关闭|跳过/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("required-native-update")).toBeInTheDocument();
  });

  it("keeps cold-start and foreground-resume business bootstrap behind the mandatory screen", async () => {
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(release()));
    await useUpdateStore.getState().checkForUpdates();
    const oldBootstrap = useWorkspaceStore.getState().bootstrapWorkspace;
    const oldCheck = useUpdateStore.getState().checkForUpdates;
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    const check = vi.fn().mockResolvedValue({ hasUpdate: true, release: useUpdateStore.getState().latestRelease });
    useWorkspaceStore.setState({ authStatus: "checking", bootstrapWorkspace: bootstrap });
    useUpdateStore.setState({ checkForUpdates: check });
    const back = vi.spyOn(nativeBridge, "setBackPressHandler");
    try {
      render(<App />);
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
      expect(bootstrap).not.toHaveBeenCalled();
      expect(back.mock.calls[0][0]?.()).toBe(true);
      act(() => window.__duallaneOnAppResumed?.());
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
      expect(bootstrap).not.toHaveBeenCalled();
      expect(screen.getByTestId("required-native-update")).toBeInTheDocument();
    } finally {
      cleanup();
      useWorkspaceStore.setState({ bootstrapWorkspace: oldBootstrap });
      useUpdateStore.setState({ checkForUpdates: oldCheck });
    }
  });

  for (const [description, minimum, expectedBootstraps] of [
    ["blocked old host", 10100, 0],
    ["supported host", 0, 1],
  ] as const) {
    it(`waits for the real delayed native policy under Strict Mode: ${description}`, async () => {
      let complete: ((response: ReturnType<typeof json>) => void) | undefined;
      const pending = new Promise<ReturnType<typeof json>>((resolve) => { complete = resolve; });
      const request = vi.spyOn(nativeBridge, "request").mockReturnValue(pending);
      const oldBootstrap = useWorkspaceStore.getState().bootstrapWorkspace;
      const bootstrap = vi.fn().mockResolvedValue(undefined);
      useWorkspaceStore.setState({ authStatus: "authenticated", bootstrapWorkspace: bootstrap });
      // Disable an otherwise eligible OTA; this test isolates native-policy startup.
      const body = release(minimum); body.release.ota.enabled = false;
      try {
        render(<StrictMode><App /></StrictMode>);
        await act(async () => { await Promise.resolve(); await Promise.resolve(); });
        expect(request).toHaveBeenCalledTimes(1);
        expect(bootstrap).not.toHaveBeenCalled();
        expect(screen.queryByLabelText("主导航栏")).not.toBeInTheDocument();
        if (!complete) throw new Error("native policy request never started");
        await act(async () => { complete!(json(body)); await pending; });
        await vi.waitFor(() => {
          expect(useUpdateStore.getState().checking).toBe(false);
          expect(bootstrap).toHaveBeenCalledTimes(expectedBootstraps);
        });
        if (minimum > 0) expect(screen.getByTestId("required-native-update")).toBeInTheDocument();
      } finally {
        cleanup();
        useWorkspaceStore.setState({ bootstrapWorkspace: oldBootstrap });
      }
    });
  }

  it("keeps APK upgrades visible when an older host has the newest OTA version", async () => {
    const body = release(0);
    body.release.version = "1.0.14"; body.release.apkVersion = "1.0.14"; body.release.versionCode = 10055;
    body.release.ota.version = "1.0.14"; body.release.ota.bundleId = "oldbundle";
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(body));
    await useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState()).toMatchObject({ requiredNativeUpdate: false, hasUpdate: true, hasApkUpdate: true, recommendedMode: "apk" });
  });

  it("does not repeatedly suggest the same APK just because the interface OTA is newer", async () => {
    vi.spyOn(nativeBridge, "getSessionSnapshot").mockReturnValue({ ...snapshot(10055), appVersion: "1.1.0", nativeVersion: "1.0.14", otaBundleId: "newbundle" });
    const body = release(0); body.release.apkVersion = "1.0.14"; body.release.versionCode = 10055;
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(body));
    await useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState()).toMatchObject({ hasApkUpdate: false, hasUpdate: false });
  });

  it("retains a known minimum offline, rejects invalid policies, and permits explicit rollback", async () => {
    saveNativeUpgradePolicy(origin, 10054, 10100);
    expect(nativeUpgradeRequired(0, readNativeUpgradePolicy(origin))).toBe(true);
    expect(nativeUpgradeRequired(10054, readNativeUpgradePolicy(origin))).toBe(false);
    expect(saveNativeUpgradePolicy(origin, 10054, 10051)).toBeNull();
    vi.spyOn(nativeBridge, "request").mockRejectedValue(new Error("offline"));
    await useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState().requiredNativeUpdate).toBe(true);
    saveNativeUpgradePolicy(origin, 0, 10100);
    expect(useUpdateStore.getState().requiredNativeUpdate).toBe(false);
  });

  it("does not strand a cached forced-update user when the operator withdraws distribution", async () => {
    saveNativeUpgradePolicy(origin, 10054, 10100);
    vi.spyOn(nativeBridge, "request")
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json({ minimumSupportedNativeVersionCode: 0, latestNativeVersionCode: 0 }))
      .mockResolvedValueOnce(json({ tag_name: "v1.0.14", assets: [] }));
    await useUpdateStore.getState().checkForUpdates();
    expect(useUpdateStore.getState().requiredNativeUpdate).toBe(false);
  });

  it("stages OTA but defers reload until writes and all stored drafts are idle", async () => {
    const done = beginMobileWrite();
    setMobileDraftActivity("draft-test", true);
    expect(isMobileWritePending()).toBe(true); expect(hasMobileDrafts()).toBe(true);
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(release(0)));
    vi.spyOn(nativeBridge, "downloadAndStageOta").mockResolvedValue({ ok: true, version: "1.1.0", bundleId: "newbundle" });
    const apply = vi.spyOn(nativeBridge, "applyStagedOta").mockImplementation(() => {});
    await useUpdateStore.getState().checkForUpdates();
    await vi.waitFor(() => expect(useUpdateStore.getState().otaStagedBundleId).toBe("newbundle"));
    expect(apply).not.toHaveBeenCalled();
    act(() => { done(); done(); });
    expect(isMobileWritePending()).toBe(false); expect(apply).not.toHaveBeenCalled();
    act(() => setMobileDraftActivity("draft-test", false));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("delegates installation to Android and exposes the installation-permission recovery action", async () => {
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(release()));
    const install = vi.spyOn(nativeBridge, "downloadAndInstallApk").mockResolvedValue({ ok: true, status: "permission_requested" });
    const resume = vi.spyOn(nativeBridge, "installPendingApk").mockResolvedValue({ ok: true, status: "installer_opened" });
    await useUpdateStore.getState().checkForUpdates();
    render(<RequiredNativeUpdate />);
    fireEvent.click(screen.getByRole("button", { name: "下载并安装更新" }));
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "继续安装更新" })).toBeInTheDocument());
    expect(install).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "继续安装更新" }));
    await vi.waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
  });

  it("refreshes a stale APK on mandatory-gate entry without offering a package below the new minimum", async () => {
    vi.spyOn(nativeBridge, "request").mockResolvedValue(json(release()));
    await useUpdateStore.getState().checkForUpdates();
    const stale = useUpdateStore.getState().latestRelease;
    if (!stale) throw new Error("fixture release missing");
    useUpdateStore.setState({ latestRelease: { ...stale, versionCode: 10055, apkVersion: "1.0.14" }, minimumSupportedNativeVersionCode: 10100 });
    const latest = release(10100);
    const request = vi.spyOn(nativeBridge, "request").mockResolvedValue(json(latest));
    render(<RequiredNativeUpdate />);
    await vi.waitFor(() => expect(useUpdateStore.getState().latestRelease?.versionCode).toBe(10100));
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "下载并安装更新" })).toBeEnabled();
  });
});
