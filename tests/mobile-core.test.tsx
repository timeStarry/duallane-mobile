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
import { useEmoteStore } from "@/store/emote-store";
import { EntryScreen } from "@/screens/EntryScreen";
import { App } from "@/App";
import { nativeBridge } from "@/native/bridge";

describe("DualLane Mobile Clean-Room v1.0.4 Core", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useNavStore.setState({
      entryLane: "welcome",
      activeTab: "chats",
      activeChatId: null,
      searchOpen: false,
      actionMessageId: null,
      threadRootId: null,
      chatDetailOpen: false,
      stickerStudioOpen: false,
      sharedPackId: null,
      botManageOpen: null as unknown as boolean,
    });
    useNavStore.setState({ botManageOpen: false });
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

  it("reorders sticker drawer tabs and persists custom order", () => {
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
    expect(before[1].id).toBe("col:c1");

    useEmoteStore.getState().moveTab("col:c1", "left");
    const after = useEmoteStore.getState().getOrderedTabs();
    expect(after[0].id).toBe("col:c1");
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

    // Switch to Me tab and verify Space Governance Admin Console is NOT present on mobile
    fireEvent.click(screen.getByText("我"));
    expect(screen.getByText("表情与贴纸工坊")).toBeInTheDocument();
    expect(screen.queryByText("空间治理后台")).not.toBeInTheDocument();
    expect(screen.queryByText("审计日志")).not.toBeInTheDocument();
  });
});
