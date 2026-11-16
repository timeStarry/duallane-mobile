import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  deriveAesKey,
  encryptP2PBytes,
  decryptP2PBytes,
  generateRoomKeyString,
  parseP2PInviteInput,
} from "@/shared/p2p-crypto";
import {
  buildTextAndMentionBlocks,
  computeOwnMessageStatus,
  parseBootstrapPayload,
  useWorkspaceStore,
} from "@/store/workspace-store";
import { useNavStore } from "@/store/nav-store";
import { normalizeEmoteTabOrder, useEmoteStore } from "@/store/emote-store";
import { EntryScreen } from "@/screens/EntryScreen";
import { App } from "@/App";
import { StickerDrawer } from "@/components/StickerDrawer";
import { nativeBridge } from "@/native/bridge";
import { compareSemver, useUpdateStore } from "@/shared/updater";
import { Avatar } from "@/components/Avatar";
import { MarkdownContent } from "@/components/MarkdownContent";
import { ChatMarkdown, ExternalLinkGuardSheet } from "@/shared/markdown";
import { mobileApi } from "@/shared/api";
import { initializeMobileTheme, resolveSystemMode, useThemeStore } from "@/shared/theme-store";

describe("DualLane Mobile Clean-Room v1.0.9 Core", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useNavStore.setState({
      entryLane: "welcome",
      activeTab: "chats",
      activeChatId: null,
      searchOpen: false,
      directOverlayOpen: false,
      updateSheetOpen: false,
      actionMessageId: null,
      threadRootId: null,
      chatDetailOpen: false,
      stickerStudioOpen: false,
      sharedPackId: null,
      botManageOpen: false,
      lightboxMedia: null,
      pendingExternalUrl: null,
    });
    useWorkspaceStore.setState({
      conversations: {},
      conversationOrder: [],
      messagesByConv: {},
      members: {},
      drafts: {},
      collapsePrefs: {
        collapseImages: false,
        collapseStickers: false,
        collapseLongMessages: false,
        localOnly: true,
      },
      messageCollapseOverrides: {},
      boundEmail: "",
      systemAnnouncement: null,
      dismissedAnnouncementKey: null,
    });
    useUpdateStore.setState({
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
    });
  });

  it("encrypts and decrypts P2P AES-256-GCM frames wire-compatibly with PC", async () => {
    const keyStr = await generateRoomKeyString();
    expect(keyStr.length).toBeGreaterThanOrEqual(43);
    const { key, fingerprint } = await deriveAesKey(keyStr);
    expect(fingerprint).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){3}$/);

    const payload = JSON.stringify({
      kind: "chat",
      id: "msg_1",
      author: "移动端",
      body: "你好 DualLane PC [bili:doge]",
      at: "2026-11-15T10:00:00.000Z",
    });
    const { nonce, ciphertext } = await encryptP2PBytes(key, payload);
    const decrypted = await decryptP2PBytes(key, nonce, ciphertext);
    expect(decrypted).toBe(payload);
  });

  it("parses both HTTPS and custom-scheme P2P invite URLs", () => {
    const httpsParsed = parseP2PInviteInput(
      "https://duallane.tsio.top/direct/room_abc123#k=0123456789abcdef0123456789abcdef"
    );
    expect(httpsParsed).toEqual({
      roomId: "room_abc123",
      keyStr: "0123456789abcdef0123456789abcdef",
    });

    const schemeParsed = parseP2PInviteInput(
      "com.timestarry.duallane://direct/room_xyz#k=key_token_42"
    );
    expect(schemeParsed).toEqual({
      roomId: "room_xyz",
      keyStr: "key_token_42",
    });
  });

  it("computes single vs double checkmarks accurately per v1.0.4 read cursor rules", () => {
    expect(computeOwnMessageStatus("saved", undefined, "2026-11-15T10:00:00Z")).toBe("read");
    expect(computeOwnMessageStatus("direct", undefined, "2026-11-15T10:00:00Z")).toBe("sent");
    expect(
      computeOwnMessageStatus(
        "direct",
        "2026-11-15T09:59:59Z",
        "2026-11-15T10:00:00Z"
      )
    ).toBe("sent");
    expect(
      computeOwnMessageStatus(
        "direct",
        "2026-11-15T10:00:05Z",
        "2026-11-15T10:00:00Z"
      )
    ).toBe("read");
  });

  it("builds @mention blocks accurately for group members and bots", () => {
    const members = {
      u_me: { id: "u_me", displayName: "我", role: "owner" as const },
      u_bot: { id: "u_bot", displayName: "Astra", role: "bot" as const },
      u_peer: { id: "u_peer", displayName: "李总", role: "member" as const },
    };
    const conv = {
      id: "c_grp",
      kind: "group" as const,
      title: "研发群",
      unreadCount: 0,
      mentionCount: 0,
      pinnedMessageIds: [],
      memberIds: ["u_me", "u_bot", "u_peer"],
    };
    const blocks = buildTextAndMentionBlocks("请 @Astra 和 @李总 看一下构建", conv, members, "u_me");
    expect(blocks).toEqual([
      { type: "text", text: "请 " },
      { type: "mention", userId: "u_bot", label: "Astra" },
      { type: "text", text: " 和 " },
      { type: "mention", userId: "u_peer", label: "李总" },
      { type: "text", text: " 看一下构建" },
    ]);
  });

  it("reorders sticker drawer tabs using PC Web parity keys and migrates legacy keys", () => {
    expect(normalizeEmoteTabOrder(["col:c1", "pack:heybox", "favorites", "pack:c1"])).toEqual([
      "pack:c1",
      "heybox",
      "favorites",
    ]);

    useEmoteStore.setState({
      collections: [
        {
          id: "c1",
          name: "猫猫包",
          originalCreatorUserId: "u1",
          originalCreator: { id: "u1", displayName: "我" },
          revision: 1,
          createdAt: "2026-11-15T00:00:00Z",
          updatedAt: "2026-11-15T00:00:00Z",
          sourceSubscription: { eligible: false, enabled: false, status: "off", readOnly: false },
          items: [],
          itemCount: 0,
        },
      ],
      tabOrder: [],
    });
    const before = useEmoteStore.getState().getOrderedTabs();
    expect(before[0].id).toBe("favorites");
    expect(before[1].id).toBe("pack:c1");
    expect(before.some((t) => t.id === "emoji")).toBe(true);

    useEmoteStore.getState().moveTab("pack:c1", "left");
    const after = useEmoteStore.getState().getOrderedTabs();
    expect(after[0].id).toBe("pack:c1");
    expect(after[1].id).toBe("favorites");
  });

  it("renders EntryScreen with GitHub PKCE login and Dual-Lane direct entry", () => {
    const spy = vi.spyOn(nativeBridge, "startGitHubOAuth").mockImplementation(() => {});
    render(<EntryScreen />);
    expect(screen.getByText("DualLane")).toBeInTheDocument();
    expect(screen.getByText("还没有账号？")).toBeInTheDocument();
    expect(screen.getByText("一对一直连")).toBeInTheDocument();

    const loginBtn = screen.getByLabelText("使用 GitHub 登录");
    fireEvent.click(loginBtn);
    expect(spy).toHaveBeenCalledWith("");
    spy.mockRestore();
  });

  it("navigates authenticated workspace tabs, chat room, hardware back stack, and omits space admin", () => {
    const parsed = parseBootstrapPayload({
      auth: {
        enabled: true,
        currentUser: { id: "u_owner", displayName: "星辰", role: "owner" },
      },
      members: [
        { id: "u_owner", displayName: "星辰", role: "owner" },
        { id: "u_astra", displayName: "Astra", role: "bot" },
      ],
      conversations: [
        {
          id: "conv_astra",
          kind: "direct",
          displayTitle: "Astra",
          unreadCount: 2,
          memberIds: ["u_owner", "u_astra"],
          latestMessages: [
            {
              id: "m_1",
              authorId: "u_astra",
              authorName: "Astra",
              kind: "bot",
              plainText: "移动端重构已就绪",
              createdAt: "2026-11-15T09:00:00Z",
            },
          ],
        },
      ],
    });

    vi.spyOn(useWorkspaceStore.getState(), "bootstrapWorkspace").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "loadConversationMessages").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "markRead").mockImplementation(() => {});

    useWorkspaceStore.setState({
      authStatus: "authenticated",
      currentUser: parsed.currentUser,
      members: parsed.members,
      conversations: parsed.conversations,
      conversationOrder: parsed.conversationOrder,
      messagesByConv: parsed.messagesByConv,
    });

    render(<App />);
    expect(screen.getByText("Astra")).toBeInTheDocument();

    // Enter full-screen chat room
    fireEvent.click(screen.getByText("Astra"));
    expect(screen.getByText("移动端重构已就绪")).toBeInTheDocument();

    // Pop hardware back from chat room -> back to conversation list
    act(() => {
      expect(useNavStore.getState().popBack()).toBe(true);
    });
    expect(useNavStore.getState().activeChatId).toBeNull();

    // Switch to Me tab and verify 3-tab bottom bar, Direct overlay, Update checker, zero meta copy, and no Space Admin
    const nav = screen.getByLabelText("主导航栏");
    expect(nav.textContent).toContain("消息");
    expect(nav.textContent).toContain("通讯录");
    expect(nav.textContent).toContain("我");
    expect(nav.textContent).not.toContain("直连");

    fireEvent.click(screen.getByText("我"));
    expect(screen.getByText("外观与主题")).toBeInTheDocument();
    expect(screen.queryByText(/与 PC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/设计语言/)).not.toBeInTheDocument();
    expect(screen.getByText("一对一加密直连")).toBeInTheDocument();
    expect(screen.getByText("检查更新")).toBeInTheDocument();
    expect(screen.getByText("表情与贴纸工坊")).toBeInTheDocument();
    expect(screen.queryByText("空间治理后台")).not.toBeInTheDocument();
    expect(screen.queryByText("审计日志")).not.toBeInTheDocument();

    // Open 1-on-1 Direct overlay from Me tab and pop back via hardware gesture
    fireEvent.click(screen.getByText("一对一加密直连"));
    expect(useNavStore.getState().directOverlayOpen).toBe(true);
    act(() => {
      expect(useNavStore.getState().popBack()).toBe(true);
    });
    expect(useNavStore.getState().directOverlayOpen).toBe(false);
  });

  it("prioritizes same-origin server APK & OTA releases, gates minNativeVersionCode, and falls back to GitHub", async () => {
    expect(compareSemver("1.0.9", "1.0.9")).toBe(0);
    expect(compareSemver("v1.0.10", "1.0.9")).toBe(1);
    expect(compareSemver("1.0.8", "1.0.9")).toBe(-1);

    const { container } = render(<Avatar name="Astra" kind="bot" color="violet" />);
    const tile = container.querySelector('[data-avatar-kind="bot"]');
    expect(tile?.getAttribute("data-bot-color")).toBe("violet");

    // 1. Native Android with compatible versionCode selects instant OTA mode ("ota")
    const isNatSpy = vi.spyOn(nativeBridge, "isNativeAndroid").mockReturnValue(true);
    const snapSpy = vi.spyOn(nativeBridge, "getSessionSnapshot").mockReturnValue({
      authenticated: true,
      apiOrigin: "https://duallane.tsio.top",
      appVersion: "1.0.9",
      nativeVersion: "1.0.9",
      versionCode: 10050,
      otaActive: false,
      platform: "android",
    });
    const srvSpy = vi.spyOn(nativeBridge, "request").mockResolvedValueOnce({
      ok: true,
      status: 200,
      bodyText: JSON.stringify({
        release: {
          enabled: true,
          version: "1.0.10",
          versionCode: 10050,
          title: "DualLane Android v1.0.10",
          notes: "### 新增与优化\n- **秒级热更新**：免安装即时生效",
          byteSize: 658000,
          sha256: "a".repeat(64),
          downloadUrl: "/api/v1/mobile/android/latest.apk",
          ota: {
            enabled: true,
            version: "1.0.10",
            bundleId: "bbbbbbbbbbbb",
            minNativeVersionCode: 10050,
            byteSize: 182000,
            sha256: "b".repeat(64),
            downloadUrl: "/api/v1/mobile/android/latest-ota.zip",
          },
        },
      }),
    });

    const stageOtaSpy = vi
      .spyOn(nativeBridge, "downloadAndStageOta")
      .mockResolvedValue({ ok: true, version: "1.0.10", bundleId: "bbbbbbbbbbbb" });
    const applyOtaSpy = vi.spyOn(nativeBridge, "applyStagedOta").mockImplementation(() => {});

    const srvResult = await useUpdateStore.getState().checkForUpdates(false);
    expect(srvResult.hasUpdate).toBe(true);
    expect(useUpdateStore.getState().recommendedMode).toBe("ota");
    expect(srvResult.release?.ota?.otaUrl).toBe(
      "https://duallane.tsio.top/api/v1/mobile/android/latest-ota.zip"
    );
    expect(srvSpy).toHaveBeenCalledTimes(1);
    // Non-release OTA hot-updates automatically stage & apply without waiting for user click!
    await vi.waitFor(() => {
      expect(stageOtaSpy).toHaveBeenCalledTimes(1);
      expect(applyOtaSpy).toHaveBeenCalledTimes(1);
    });
    stageOtaSpy.mockRestore();
    applyOtaSpy.mockRestore();

    // 2. When minNativeVersionCode exceeds current shell versionCode, safely downgrades to in-app APK install ("apk")
    srvSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      bodyText: JSON.stringify({
        release: {
          enabled: true,
          version: "1.1.0",
          versionCode: 10100,
          title: "DualLane Android v1.1.0",
          notes: "- 原生层升级",
          byteSize: 675000,
          sha256: "c".repeat(64),
          downloadUrl: "/api/v1/mobile/android/latest.apk",
          ota: {
            enabled: true,
            version: "1.1.0",
            bundleId: "cccccccccccc",
            minNativeVersionCode: 10100,
            byteSize: 185000,
            sha256: "d".repeat(64),
            downloadUrl: "/api/v1/mobile/android/latest-ota.zip",
          },
        },
      }),
    });

    await useUpdateStore.getState().checkForUpdates(false);
    expect(useUpdateStore.getState().hasUpdate).toBe(true);
    expect(useUpdateStore.getState().recommendedMode).toBe("apk");

    srvSpy.mockRestore();
    isNatSpy.mockRestore();
    snapSpy.mockRestore();

    // 3. Falls back to GitHub Releases when server returns 404
    const fbSpy = vi
      .spyOn(nativeBridge, "request")
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        bodyText: JSON.stringify({ error: { code: "v1.release_not_published" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        bodyText: JSON.stringify({
          tag_name: "v1.9.0",
          name: "DualLane Mobile v1.9.0",
          body: "- 新增功能与性能优化",
          published_at: "2026-11-16T12:00:00Z",
          html_url: "https://github.com/timeStarry/duallane-mobile/releases/tag/v1.9.0",
          assets: [
            {
              name: "app-release.apk",
              size: 660000,
              browser_download_url:
                "https://github.com/timeStarry/duallane-mobile/releases/download/v1.9.0/app-release.apk",
            },
          ],
        }),
      });

    const fbResult = await useUpdateStore.getState().checkForUpdates(false);
    expect(fbResult.hasUpdate).toBe(true);
    expect(fbResult.release?.source).toBe("github");
    expect(fbResult.release?.apkSizeBytes).toBe(660000);
    fbSpy.mockRestore();
  });

  it("renders structured MarkdownContent without raw syntax and honors native Android systemTheme", () => {
    render(
      <MarkdownContent
        content={"### 版本亮点\n- **持久图片缓存**：表情与头像离线秒开\n- 支持 `1.0.7` 同源更新"}
      />
    );
    expect(screen.getByText("版本亮点")).toBeInTheDocument();
    expect(screen.queryByText(/###/)).not.toBeInTheDocument();
    expect(screen.getByText("持久图片缓存").tagName).toBe("STRONG");
    expect(screen.getByText("1.0.7").tagName).toBe("CODE");

    // Verify native Android systemTheme="light" overrides broken dark WebView matchMedia
    const isNativeSpy = vi.spyOn(nativeBridge, "isNativeAndroid").mockReturnValue(true);
    const snapSpy = vi.spyOn(nativeBridge, "getSessionSnapshot").mockReturnValue({
      authenticated: false,
      apiOrigin: "https://duallane.tsio.top",
      appVersion: "1.0.7",
      versionCode: 10007,
      platform: "android",
      systemTheme: "light",
    });

    useThemeStore.getState().setPreference("system");
    initializeMobileTheme();
    expect(resolveSystemMode()).toBe("light");
    expect(useThemeStore.getState().resolvedMode).toBe("light");
    expect(document.documentElement.dataset.themeMode).toBe("light");

    // Simulate live OS Quick Settings toggle to dark mode
    act(() => {
      window.__duallaneOnSystemTheme?.("dark");
    });
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");

    isNativeSpy.mockRestore();
    snapSpy.mockRestore();
  });

  it("supports bound email verification code login on EntryScreen", async () => {
    const sendSpy = vi.spyOn(mobileApi, "sendLoginEmailCode").mockResolvedValue({
      challengeId: "chal_mob_1",
      maskedEmail: "t***@tsio.top",
      expiresAt: "2026-11-15T16:00:00Z",
      cooldownSec: 60,
    });
    const verifySpy = vi.spyOn(mobileApi, "verifyLoginEmail").mockResolvedValue({ ok: true });
    const bootSpy = vi
      .spyOn(useWorkspaceStore.getState(), "bootstrapWorkspace")
      .mockResolvedValue();

    render(<EntryScreen />);
    fireEvent.click(screen.getByText("已绑定邮箱"));
    expect(screen.getByText("仅限已在个人设置绑定邮箱的成员登录")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("登录邮箱"), {
      target: { value: "team@tsio.top" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("获取验证码"));
    });
    expect(sendSpy).toHaveBeenCalledWith("team@tsio.top");

    fireEvent.change(screen.getByLabelText("邮箱验证码"), {
      target: { value: "839201" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("验证并进入空间"));
    });
    expect(verifySpy).toHaveBeenCalledWith("team@tsio.top", "chal_mob_1", "839201");
    expect(bootSpy).toHaveBeenCalled();

    sendSpy.mockRestore();
    verifySpy.mockRestore();
    bootSpy.mockRestore();
  });

  it("renders post-login AnnouncementModal and handles once vs always display modes", async () => {
    const ackSpy = vi.spyOn(mobileApi, "ackAnnouncement").mockResolvedValue({ ok: true });
    vi.spyOn(useWorkspaceStore.getState(), "bootstrapWorkspace").mockResolvedValue();

    const parsed = parseBootstrapPayload({
      auth: {
        enabled: true,
        boundEmail: "owner@tsio.top",
        currentUser: { id: "u_owner", displayName: "星辰", role: "owner" },
      },
      announcement: {
        id: "ann_mobile_106",
        enabled: true,
        displayMode: "once",
        badge: "v1.0.6 更新",
        title: "DualLane Android v1.0.6 已发布",
        content: "支持已绑定邮箱验证码登录与跨端系统通告。",
        ctaLabel: "立即下载",
        ctaUrl: "https://github.com/timeStarry/duallane-mobile/releases/latest",
        updatedAt: "2026-11-15T15:30:00Z",
        shouldShow: true,
      },
      conversations: [],
    });

    expect(parsed.boundEmail).toBe("owner@tsio.top");
    expect(parsed.systemAnnouncement?.id).toBe("ann_mobile_106");

    useWorkspaceStore.setState({
      authStatus: "authenticated",
      currentUser: parsed.currentUser,
      boundEmail: parsed.boundEmail,
      systemAnnouncement: parsed.systemAnnouncement,
      dismissedAnnouncementKey: null,
      userPreferences: {},
    });

    render(<App />);
    expect(screen.getByTestId("mobile-announcement-modal")).toBeInTheDocument();
    expect(screen.getByText("DualLane Android v1.0.6 已发布")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText("我知道了"));
    });
    expect(ackSpy).toHaveBeenCalledWith("ann_mobile_106");
    expect(screen.queryByTestId("mobile-announcement-modal")).not.toBeInTheDocument();

    // Realtime broadcast with same ID in "once" mode remains hidden because ackAnnouncementId matches
    act(() => {
      useWorkspaceStore.getState().applyRealtimeEvent({
        type: "workspace.announcement_updated",
        payload: {
          announcement: {
            id: "ann_mobile_106",
            enabled: true,
            displayMode: "once",
            title: "DualLane Android v1.0.6 已发布",
            content: "同 ID 不重复弹框",
            updatedAt: "2026-11-15T15:35:00Z",
          },
        },
      });
    });
    expect(screen.queryByTestId("mobile-announcement-modal")).not.toBeInTheDocument();

    // Realtime broadcast with "always" mode (new updatedAt) shows immediately
    act(() => {
      useWorkspaceStore.getState().applyRealtimeEvent({
        type: "workspace.announcement_updated",
        payload: {
          announcement: {
            id: "ann_mobile_106",
            enabled: true,
            displayMode: "always",
            title: "强提示通告",
            content: "每次会话均会提示",
            updatedAt: "2026-11-15T15:40:00Z",
          },
        },
      });
    });
    expect(screen.getByTestId("mobile-announcement-modal")).toBeInTheDocument();
    expect(screen.getByText("强提示通告")).toBeInTheDocument();

    // Verify MeTab displays boundEmail
    await act(async () => {
      fireEvent.click(screen.getByText("我知道了"));
    });
    fireEvent.click(screen.getByText("我"));
    expect(screen.getByText("登录邮箱")).toBeInTheDocument();
    expect(screen.getByText("owner@tsio.top")).toBeInTheDocument();

    ackSpy.mockRestore();
  });

  it("sanitizes @__duallane_bot mentions, shows live botOnline status, and sends favorited built-in stickers directly", () => {
    const parsed = parseBootstrapPayload({
      auth: {
        enabled: true,
        currentUser: { id: "u_me", displayName: "星辰", role: "owner" },
      },
      members: [
        { id: "u_me", displayName: "星辰", role: "owner" },
        {
          id: "usr_bot_comet",
          displayName: "Comet",
          githubLogin: "__duallane_bot_4fd877150a26c0fa6505fe88",
          role: "bot",
          botOnline: true,
        },
      ],
      conversations: [
        {
          id: "conv_grp",
          kind: "group",
          displayTitle: "研发群",
          memberIds: ["u_me", "usr_bot_comet"],
          lastMessagePlainText: "@__duallane_bot_4fd877150a26c0fa6505fe88 能收到群聊信息吗",
          latestMessages: [
            {
              id: "m_mention",
              authorId: "u_me",
              authorName: "星辰",
              plainText: "@__duallane_bot_4fd877150a26c0fa6505fe88 能收到群聊信息吗",
              content: {
                blocks: [
                  {
                    type: "mention",
                    userId: "usr_bot_comet",
                    label: "__duallane_bot_4fd877150a26c0fa6505fe88",
                  },
                  { type: "text", text: " 能收到群聊信息吗" },
                ],
              },
              createdAt: "2026-11-16T11:07:00Z",
            },
          ],
        },
        {
          id: "conv_comet_dm",
          kind: "direct",
          displayTitle: "Comet",
          memberIds: ["u_me", "usr_bot_comet"],
          latestMessages: [],
        },
      ],
    });

    expect(parsed.members["usr_bot_comet"].handle).toBeUndefined();
    expect(parsed.members["usr_bot_comet"].botOnline).toBe(true);
    expect(parsed.messagesByConv["conv_grp"][0].blocks?.[0]).toEqual({
      type: "mention",
      userId: "usr_bot_comet",
      label: "Comet",
    });
    expect(parsed.messagesByConv["conv_grp"][0].plainText).toBe("@Comet 能收到群聊信息吗");
    expect(parsed.conversations["conv_grp"].lastMessageText).not.toContain("__duallane_");

    vi.spyOn(useWorkspaceStore.getState(), "bootstrapWorkspace").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "loadConversationMessages").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "markRead").mockImplementation(() => {});

    useWorkspaceStore.setState({
      authStatus: "authenticated",
      currentUser: parsed.currentUser,
      members: parsed.members,
      conversations: parsed.conversations,
      conversationOrder: parsed.conversationOrder,
      messagesByConv: parsed.messagesByConv,
    });
    useNavStore.setState({ activeChatId: "conv_comet_dm" });

    const { unmount } = render(<App />);
    expect(screen.getByText("在线 · AI 智能体实时通道")).toBeInTheDocument();
    unmount();

    // Favorited built-in sticker sends built-in token directly instead of custom:<uuid>
    const builtInSent: string[] = [];
    useEmoteStore.setState({
      emotes: [
        {
          id: "fav_builtin_1",
          kind: "image",
          label: "狗头",
          token: "[custom:fav_builtin_1]",
          emoteKey: "bili:doge",
          sourceType: "builtin",
          animated: false,
          createdAt: "2026-11-16T10:00:00Z",
        },
      ],
      collections: [],
    });
    render(
      <StickerDrawer
        open
        conversationId="conv_grp"
        onInsertToken={() => {}}
        onSendBuiltInSticker={(tok) => builtInSent.push(tok)}
      />
    );
    fireEvent.click(screen.getByAltText("狗头"));
    expect(builtInSent).toEqual(["[bili:doge]"]);
  });

  it("renders rich ChatMarkdown (code fences, tables, inline code, emotes, auto-links) and enforces off-site link guard", () => {
    const openSpy = vi.spyOn(nativeBridge, "openExternalUrl").mockImplementation(() => {});
    const copySpy = vi.spyOn(nativeBridge, "copyText").mockImplementation(() => {});

    const richSample = [
      "## 发布摘要",
      "> 请 @所有人 查收 **重点变更** 与 ~~旧逻辑~~ *说明* `v1.1.0` [bili:doge]",
      "",
      "| 模块 | 状态 |",
      "| --- | --- |",
      "| Native | 已就绪 |",
      "",
      "白名单地址：https://github.com/timeStarry/duallane-mobile。",
      "百科平衡括号：https://en.wikipedia.org/wiki/Rust_(programming_language)！",
      "外部非白名单：[测试外链](https://untrusted-site.example.org/demo?x=1)",
      "",
      "```ts",
      "const ready = true;",
      "```",
    ].join("\n");

    render(
      <>
        <ChatMarkdown text={richSample} tone="peer" lane="workspace" />
        <ExternalLinkGuardSheet />
      </>
    );

    expect(screen.getByText("发布摘要")).toBeInTheDocument();
    expect(screen.getByText("@所有人")).toHaveAttribute("data-mention-id", "all");
    expect(screen.getByText("重点变更").tagName).toBe("STRONG");
    expect(screen.getByText("旧逻辑").tagName).toBe("DEL");
    expect(screen.getByText("说明").tagName).toBe("EM");
    expect(screen.getByText("v1.1.0").tagName).toBe("CODE");
    expect(screen.getByText("已就绪").tagName).toBe("TD");
    expect(screen.getByAltText("doge")).toBeInTheDocument();

    // Copy fenced code block
    fireEvent.click(screen.getByLabelText("复制代码"));
    expect(copySpy).toHaveBeenCalledWith("const ready = true;");

    // Whitelisted GitHub link strips trailing CJK period and opens directly without sheet
    const ghLink = screen.getByText("https://github.com/timeStarry/duallane-mobile");
    fireEvent.click(ghLink);
    expect(openSpy).toHaveBeenCalledWith("https://github.com/timeStarry/duallane-mobile");
    expect(useNavStore.getState().pendingExternalUrl).toBeNull();

    // Balanced parentheses preserved while trailing exclamation stripped
    const wikiLink = screen.getByText("https://en.wikipedia.org/wiki/Rust_(programming_language)");
    fireEvent.click(wikiLink);
    expect(openSpy).toHaveBeenCalledWith("https://en.wikipedia.org/wiki/Rust_(programming_language)");

    // Non-whitelisted link triggers BottomSheet guard instead of opening immediately
    openSpy.mockClear();
    fireEvent.click(screen.getByText("测试外链"));
    expect(openSpy).not.toHaveBeenCalled();
    expect(screen.getByText("即将前往外部网站")).toBeInTheDocument();
    expect(screen.getByTestId("external-link-domain").textContent).toBe(
      "untrusted-site.example.org"
    );

    fireEvent.click(screen.getByText("继续访问"));
    expect(openSpy).toHaveBeenCalledWith("https://untrusted-site.example.org/demo?x=1");

    openSpy.mockRestore();
    copySpy.mockRestore();
  });

  it("supports @所有人 candidates & mention badge in group chats, sender prefixes in ChatsTab, and mute badge rules", async () => {
    const syncCtxSpy = vi
      .spyOn(nativeBridge, "syncNotificationContext")
      .mockImplementation(() => {});
    vi.spyOn(useWorkspaceStore.getState(), "bootstrapWorkspace").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "loadConversationMessages").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "markRead").mockImplementation(() => {});

    const parsed = parseBootstrapPayload({
      auth: {
        enabled: true,
        currentUser: { id: "u_me", displayName: "星辰", role: "owner" },
      },
      members: [
        { id: "u_me", displayName: "星辰", role: "owner" },
        { id: "u_alice", displayName: "李总", role: "member" },
        { id: "u_bob", displayName: "王工", role: "member" },
      ],
      conversations: [
        {
          id: "conv_grp",
          kind: "group",
          displayTitle: "核心研发群",
          unreadCount: 2,
          mentionCount: 0,
          notificationLevel: "all",
          memberIds: ["u_me", "u_alice", "u_bob"],
          lastMessagePlainText: "包已构建完成",
          lastMessageSenderId: "u_alice",
          lastMessageSenderName: "李总",
          lastMessageAt: "2026-11-16T10:00:00Z",
          latestMessages: [],
        },
        {
          id: "conv_dm_alice",
          kind: "direct",
          displayTitle: "李总",
          unreadCount: 0,
          mentionCount: 0,
          notificationLevel: "all",
          memberIds: ["u_me", "u_alice"],
          lastMessagePlainText: "好的收到",
          lastMessageSenderId: "u_me",
          lastMessageAt: "2026-11-16T09:50:00Z",
          latestMessages: [],
        },
        {
          id: "conv_muted_grp",
          kind: "group",
          displayTitle: "水群",
          unreadCount: 5,
          mentionCount: 0,
          notificationLevel: "muted",
          memberIds: ["u_me", "u_bob"],
          lastMessagePlainText: "大家中午吃啥",
          lastMessageSenderId: "u_bob",
          lastMessageAt: "2026-11-16T09:40:00Z",
          latestMessages: [],
        },
      ],
    });

    // Verify @所有人 block builder in group chat
    const mentionBlocks = buildTextAndMentionBlocks(
      "@所有人 请查看进度",
      parsed.conversations["conv_grp"],
      parsed.members,
      "u_me"
    );
    expect(mentionBlocks[0]).toEqual({
      type: "mention",
      userId: "all",
      label: "所有人",
    });

    useWorkspaceStore.setState({
      authStatus: "authenticated",
      currentUser: parsed.currentUser,
      members: parsed.members,
      conversations: parsed.conversations,
      conversationOrder: parsed.conversationOrder,
      messagesByConv: parsed.messagesByConv,
    });

    render(<App />);

    // Issue #5: Group chat shows "李总: 包已构建完成", own DM shows "我: 好的收到"
    expect(screen.getByText("李总: 包已构建完成")).toBeInTheDocument();
    expect(screen.getByText("我: 好的收到")).toBeInTheDocument();
    expect(screen.getByText("王工: 大家中午吃啥")).toBeInTheDocument();

    // Category A4: Muted conversation shows grey unread badge and is excluded from totalUnread (only 2 counted, not 2 + 5 = 7!)
    expect(screen.getByTestId("conv-unread-conv_muted_grp")).toHaveAttribute(
      "data-muted",
      "true"
    );
    const nav = screen.getByLabelText("主导航栏");
    expect(nav.textContent).toContain("2");
    expect(nav.textContent).not.toContain("7");

    // Incoming @所有人 message in group chat increments mentionCount ([有人@我])
    act(() => {
      useWorkspaceStore.getState().applyRealtimeEvent({
        type: "message.created",
        conversationId: "conv_grp",
        payload: {
          message: {
            id: "m_all_1",
            conversationId: "conv_grp",
            authorId: "u_bob",
            authorName: "王工",
            plainText: "@所有人 今晚发版",
            content: {
              blocks: [
                { type: "mention", userId: "all", label: "所有人" },
                { type: "text", text: " 今晚发版" },
              ],
            },
            createdAt: "2026-11-16T10:05:00Z",
          },
        },
      });
    });
    expect(useWorkspaceStore.getState().conversations["conv_grp"].mentionCount).toBe(1);
    expect(screen.getByText("[有人@我]")).toBeInTheDocument();
    expect(screen.getByText("王工: @所有人 今晚发版")).toBeInTheDocument();
    expect(syncCtxSpy).toHaveBeenCalled();

    // Open group chat and type "@" -> @所有人 candidate appears at top
    await act(async () => {
      fireEvent.click(screen.getByText("核心研发群"));
    });
    const composer = screen.getByPlaceholderText("发送消息到 核心研发群…");
    fireEvent.change(composer, { target: { value: "@" } });
    const candidateBar = screen.getByTestId("mention-candidate-bar");
    expect(candidateBar.textContent).toContain("@所有人");
    fireEvent.click(screen.getByText("提醒全体群成员"));
    expect(useWorkspaceStore.getState().drafts["conv_grp"]?.text).toBe("@所有人 ");

    syncCtxSpy.mockRestore();
  });

  it("supports private member remarks, boss-key collapse, huge paste .txt upload, lightbox zoom, recent emojis, and keep-alive controls", async () => {
    const remarkSpy = vi.spyOn(mobileApi, "setMemberRemark").mockResolvedValue({ ok: true });
    const uploadTxtSpy = vi.spyOn(nativeBridge, "uploadTextAttachment").mockResolvedValue({
      id: "att_txt_1",
      fileName: "pasted.txt",
      mimeType: "text/plain; charset=utf-8",
      byteSize: 6500,
      url: "/api/workspace/files/att_txt_1/download",
      downloadUrl: "/api/workspace/files/att_txt_1/download",
    });
    const sendMsgSpy = vi
      .spyOn(mobileApi, "sendMessage")
      .mockResolvedValue({ message: { id: "m_sent_txt", createdAt: "2026-11-16T12:00:00Z" } });
    vi.spyOn(useWorkspaceStore.getState(), "bootstrapWorkspace").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "loadConversationMessages").mockResolvedValue();
    vi.spyOn(useWorkspaceStore.getState(), "markRead").mockImplementation(() => {});

    const parsed = parseBootstrapPayload({
      auth: {
        enabled: true,
        currentUser: { id: "u_me", displayName: "星辰", role: "owner" },
      },
      members: [
        { id: "u_me", displayName: "星辰", role: "owner" },
        { id: "u_peer", displayName: "张三", handle: "zhangsan", role: "member" },
      ],
      conversations: [
        {
          id: "conv_dm",
          kind: "direct",
          displayTitle: "张三",
          memberIds: ["u_me", "u_peer"],
          latestMessages: [
            {
              id: "m_img_1",
              authorId: "u_peer",
              authorName: "张三",
              plainText: "[文件]",
              attachments: [
                {
                  id: "img_1",
                  fileName: "arch.png",
                  mimeType: "image/png",
                  byteSize: 2048,
                  url: "/api/workspace/files/img_1/preview",
                },
              ],
              threadReplyCount: 2,
              threadTitle: "架构演进评审",
              threadPreviewReplies: [
                {
                  id: "tr_1",
                  authorId: "u_peer",
                  authorName: "张三",
                  plainText: "同意按飞书话题卡片落地",
                  createdAt: "2026-11-16T11:02:00Z",
                },
              ],
              createdAt: "2026-11-16T11:00:00Z",
            },
          ],
        },
      ],
    });

    useWorkspaceStore.setState({
      authStatus: "authenticated",
      currentUser: parsed.currentUser,
      members: parsed.members,
      conversations: parsed.conversations,
      conversationOrder: parsed.conversationOrder,
      messagesByConv: parsed.messagesByConv,
      collapsePrefs: {
        collapseImages: true,
        collapseStickers: false,
        collapseLongMessages: true,
        localOnly: true,
      },
    });

    // Category A3: Set private member remark updates member displayName & direct conversation title
    await act(async () => {
      await useWorkspaceStore.getState().setMemberRemark("u_peer", "张总监");
    });
    expect(remarkSpy).toHaveBeenCalledWith("u_peer", "张总监");
    expect(useWorkspaceStore.getState().members["u_peer"].displayName).toBe("张总监");
    expect(useWorkspaceStore.getState().conversations["conv_dm"].title).toBe("张总监");

    useNavStore.setState({ activeChatId: "conv_dm" });
    const { unmount } = render(<App />);

    // Category A1: Auto-collapsed image renders [图片 · 点击展开] capsule, expanding on click
    const capsule = screen.getByText("[图片 · 点击展开]");
    expect(capsule).toBeInTheDocument();
    fireEvent.click(capsule);
    const imgEl = screen.getByAltText("arch.png");
    expect(imgEl).toBeInTheDocument();

    // Category A5: Lightbox double-click toggles 1.0x <-> 2.2x zoom
    fireEvent.click(imgEl);
    const lightboxImg = screen
      .getByTestId("media-lightbox")
      .querySelector("img[data-zoom-scale]") as HTMLImageElement;
    expect(lightboxImg).not.toBeNull();
    expect(lightboxImg.getAttribute("data-zoom-scale")).toBe("1.0");
    fireEvent.doubleClick(lightboxImg);
    expect(lightboxImg.getAttribute("data-zoom-scale")).toBe("2.2");
    fireEvent.doubleClick(lightboxImg);
    expect(lightboxImg.getAttribute("data-zoom-scale")).toBe("1.0");
    fireEvent.click(screen.getByLabelText("关闭预览"));

    // Feishu-style inline topic preview card & chat header topic directory button & single-line ellipsis watermark
    expect(screen.getByTestId("feishu-inline-topic-card")).toBeInTheDocument();
    expect(screen.getByText("2 条话题回复")).toBeInTheDocument();
    expect(screen.getByText("同意按飞书话题卡片落地")).toBeInTheDocument();
    expect(screen.getByLabelText("本会话话题列表")).toBeInTheDocument();
    expect(screen.getByTestId("composer-single-line-watermark")).toHaveClass("truncate");

    // Category A5: Huge paste (> 6,000 chars) prompts to send as .txt attachment
    const textarea = screen.getByPlaceholderText("发送消息到 张总监…");
    const hugeText = "A".repeat(6200);
    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => hugeText,
      },
    });
    expect(screen.getByTestId("huge-paste-banner")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("转为 .txt 发送"));
    });
    expect(uploadTxtSpy).toHaveBeenCalledTimes(1);
    expect(sendMsgSpy).toHaveBeenCalledTimes(1);

    // Continuous messaging: tapping Send prevents pointer/mouse blur and keeps textarea focused
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    fireEvent.change(textarea, { target: { value: "测试连续发送不收起输入法" } });
    const sendBtn = screen.getByLabelText("发送消息");
    const pointerDownAllowed = fireEvent.pointerDown(sendBtn);
    const mouseDownAllowed = fireEvent.mouseDown(sendBtn);
    expect(pointerDownAllowed).toBe(false);
    expect(mouseDownAllowed).toBe(false);
    await act(async () => {
      fireEvent.click(sendBtn);
    });
    expect(sendMsgSpy).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(textarea);

    // Switch to MeTab: verify zero flat switch sprawl on root MeTab & secondary sheet navigation
    act(() => {
      useNavStore.getState().closeChat();
      useNavStore.getState().setActiveTab("me");
    });
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByText("后台常驻实时连接")).not.toBeInTheDocument();
    expect(screen.getByText("消息通知与后台常驻")).toBeInTheDocument();
    expect(screen.getByText("聊天阅读与自动折叠")).toBeInTheDocument();
    expect(screen.getByText("外观与主题")).toBeInTheDocument();

    fireEvent.click(screen.getByText("消息通知与后台常驻"));
    expect(useNavStore.getState().meSubSheet).toBe("notifications");
    expect(screen.getByText("后台常驻实时连接")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")).toHaveLength(2);

    act(() => {
      expect(useNavStore.getState().popBack()).toBe(true);
    });
    expect(useNavStore.getState().meSubSheet).toBeNull();

    fireEvent.click(screen.getByText("聊天阅读与自动折叠"));
    expect(useNavStore.getState().meSubSheet).toBe("reading");
    expect(screen.getAllByRole("switch")).toHaveLength(5);

    act(() => {
      expect(useNavStore.getState().popBack()).toBe(true);
    });
    expect(useNavStore.getState().meSubSheet).toBeNull();

    // Bot management: clicking "复制配对指令" requests valid v1 scopes and copies full Agent prompt
    const listBotsSpy = vi.spyOn(mobileApi, "listBots").mockResolvedValue([
      { id: "bot_1", botUserId: "u_bot_1", name: "Astra", status: "active" },
    ]);
    const listTokensSpy = vi.spyOn(mobileApi, "listBotTokens").mockResolvedValue({ tokens: [] });
    const createSetupSpy = vi.spyOn(mobileApi, "createBotSetupSession").mockResolvedValue({
      session: {
        id: "setup_abc123",
        status: "created",
        bot: { id: "bot_1", botUserId: "u_bot_1", name: "Astra" },
        requestedScopes: [
          "messages:read_trigger",
          "messages:read_context",
          "messages:send",
          "cards:write",
          "cards:act",
          "commands:receive",
          "files:read_metadata",
          "files:write",
        ],
        approvedScopes: [],
        requestedConversations: [],
        approvedConversations: [],
        expiresAt: "2099-01-01T00:10:00Z",
        createdAt: "2099-01-01T00:00:00Z",
      },
      setupUrl: "/workspace/account/bot?setup=setup_abc123",
    });
    const copySpy = vi.spyOn(nativeBridge, "copyText").mockImplementation(() => {});

    await act(async () => {
      fireEvent.click(screen.getByText("我的机器人与解绑管理"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Astra"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("复制配对指令"));
    });
    expect(createSetupSpy).toHaveBeenCalledWith("bot_1");
    expect(copySpy).toHaveBeenCalledTimes(1);
    const copiedPrompt = copySpy.mock.calls[0]?.[0] || "";
    expect(copiedPrompt).toContain("请接入我的 DualLane 机器人「Astra」");
    expect(copiedPrompt).toContain("/integrations/duallane-agent.mjs");
    expect(copiedPrompt).toContain("/workspace?setup=setup_abc123");
    expect(screen.getByText("已复制配对指令")).toBeInTheDocument();
    expect(screen.getByText(/配对指令已就绪/)).toBeInTheDocument();
    expect(screen.getByText("权限与群聊准入")).toBeInTheDocument();
    expect(screen.getByText("已接入会话与上下文")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByText("权限与群聊准入"));
    });
    expect(screen.getByText(/创建者本人 1v1 私聊权限永久保留/)).toBeInTheDocument();

    listBotsSpy.mockRestore();
    listTokensSpy.mockRestore();
    createSetupSpy.mockRestore();
    copySpy.mockRestore();
    unmount();

    // Category B3: Recent 8 unicode emojis persisted in StickerDrawer
    const inserted: string[] = [];
    render(
      <StickerDrawer
        open
        conversationId="conv_dm"
        onInsertToken={(tok) => inserted.push(tok)}
        onSendBuiltInSticker={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Emoji"));
    const allButtons = screen.getAllByRole("button");
    const unicodeBtn = allButtons.find((b) => b.textContent === "😀") || allButtons[4];
    const pickedChar = unicodeBtn.textContent || "";
    fireEvent.click(unicodeBtn);
    expect(inserted).toEqual([pickedChar]);
    expect(screen.getByTestId("recent-emojis-section")).toBeInTheDocument();

    remarkSpy.mockRestore();
    uploadTxtSpy.mockRestore();
    sendMsgSpy.mockRestore();
  });
});
