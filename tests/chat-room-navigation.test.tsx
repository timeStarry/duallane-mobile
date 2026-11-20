import React, { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatRoomScreen } from "@/screens/ChatRoomScreen";
import { mobileApi } from "@/shared/api";
import { nativeBridge } from "@/native/bridge";
import { useWorkspaceStore, type V1Message } from "@/store/workspace-store";
import { useNavStore } from "@/store/nav-store";
import { useThemeStore } from "@/shared/theme-store";
import { hasMobileDrafts } from "@/shared/activity";
import { useUpdateStore } from "@/shared/updater";

vi.mock("@/components/MessageItem", () => ({
  isMessageEffectivelyCollapsed: () => false,
  MessageItem: ({ msg }: { msg: V1Message }) => <article id={`msg-${msg.id}`}>{msg.plainText}</article>,
}));
vi.mock("@/components/StickerDrawer", () => ({ StickerDrawer: () => null }));
vi.mock("@/components/BottomSheet", () => ({
  BottomSheet: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <section>{children}</section> : null,
}));

const rawMessages = [
  { id: "old", authorId: "peer", authorName: "同名", plainText: "早先消息", kind: "user", createdAt: "2026-11-18T00:00:01Z" },
  { id: "own", authorId: "me", authorName: "我", plainText: "自己发送", kind: "user", createdAt: "2026-11-18T00:00:02Z" },
  { id: "new-1", authorId: "bot_twin", authorName: "同名", plainText: "第一条未读", kind: "bot", createdAt: "2026-11-18T00:00:03Z" },
  { id: "new-2", authorId: "peer", authorName: "同名", plainText: "第二条未读", kind: "user", createdAt: "2026-11-18T00:00:04Z" },
];

function incoming(id: string, createdAt = "2026-11-18T00:00:05Z") {
  useWorkspaceStore.getState().applyRealtimeEvent({
    type: "message.created",
    payload: { conversationId: "chat", message: {
      id, authorId: "peer", authorName: "同名", plainText: `实时消息 ${id}`,
      kind: "user", createdAt,
    } },
  });
}

describe("mobile conversation navigation", () => {
  it("keeps a staged OTA from reloading over a pending large paste", async () => {
    render(<ChatRoomScreen conversationId="chat" />);
    fireEvent.paste(screen.getByRole("combobox", { name: "消息输入框" }), {
      clipboardData: { getData: () => "尚未发送的长文本".repeat(5000) },
    });
    expect(hasMobileDrafts()).toBe(true);
    vi.spyOn(nativeBridge, "isNativeAndroid").mockReturnValue(true);
    vi.spyOn(nativeBridge, "downloadAndStageOta").mockResolvedValue({ ok: true, version: "1.1.0", bundleId: "paste-safe-bundle" });
    const apply = vi.spyOn(nativeBridge, "applyStagedOta").mockImplementation(() => {});
    useUpdateStore.setState({ latestRelease: { version: "1.1.0", tagName: "v1.1.0", title: "合成热更", notes: "", publishedAt: "", htmlUrl: "", apkUrl: "", apkName: "", apkSizeBytes: 0, source: "server",
      ota: { enabled: true, version: "1.1.0", bundleId: "paste-safe-bundle", minNativeVersionCode: 10051, byteSize: 100, sha256: "a".repeat(64), otaUrl: "https://example.test/ota.zip" } } });
    await act(async () => { await useUpdateStore.getState().performOtaUpdate(true); });
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "忽略长文本提示" }));
    expect(hasMobileDrafts()).toBe(false);
    expect(apply).toHaveBeenCalledOnce();
  });
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    vi.spyOn(mobileApi, "listMessages").mockResolvedValue({ messages: rawMessages });
    vi.spyOn(mobileApi, "markConversationRead").mockResolvedValue({});
    vi.spyOn(mobileApi, "listConversationBotCommands").mockResolvedValue({ commands: [] });
    vi.spyOn(mobileApi, "sendConversationTyping").mockResolvedValue({ ok: true });
    vi.spyOn(mobileApi, "sendMessage").mockResolvedValue({ message: { id: "sent", authorId: "me", plainText: "已发送" } });
    vi.spyOn(nativeBridge, "clearConversationNotification").mockImplementation(() => {});
    vi.spyOn(nativeBridge, "haptic").mockImplementation(() => {});
    useThemeStore.setState({ reducedMotion: false });
    useNavStore.setState({ activeChatId: "chat", actionMessageId: null, threadRootId: null, chatDetailOpen: false });
    useWorkspaceStore.setState({
      currentUser: { id: "me", displayName: "我", role: "member" },
      members: {
        me: { id: "me", displayName: "我", role: "member" },
        peer: { id: "peer", displayName: "同名", role: "member" },
        bot_twin: { id: "bot_twin", displayName: "同名", role: "bot" },
      },
      conversations: { chat: {
        id: "chat", kind: "group", title: "测试群", unreadCount: 2, mentionCount: 0,
        pinnedMessageIds: [], memberIds: ["me", "peer", "bot_twin"],
      } },
      messagesByConv: { chat: [{
        id: "cache", conversationId: "chat", senderId: "peer", senderName: "同名", plainText: "旧缓存",
        createdAt: "2026-11-17T00:00:00Z", status: "read", reactions: {},
      }] },
      readingConversationId: null,
      drafts: {}, editingMessageId: null, highlightedMessageId: null, typingByConv: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("captures unread before markRead, waits for fresh data and jumps upward without moving editor focus", async () => {
    let resolveLoad!: (result: { messages: typeof rawMessages }) => void;
    vi.mocked(mobileApi.listMessages).mockReturnValue(new Promise((resolve) => { resolveLoad = resolve; }));
    render(<StrictMode><ChatRoomScreen conversationId="chat" /></StrictMode>);
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(2);
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "2 条新消息" })).not.toBeInTheDocument();
    await act(async () => { resolveLoad({ messages: rawMessages }); });
    const prompt = await screen.findByRole("button", { name: "2 条新消息" });
    await waitFor(() => expect(mobileApi.markConversationRead).toHaveBeenCalledWith("chat", "new-2"));
    const list = screen.getByTestId("chat-message-scroll");
    expect(list.scrollTop).toBe(1200);
    vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
    const first = document.getElementById("msg-new-1")!;
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({ top: -300 } as DOMRect);
    fireEvent.click(prompt);
    expect(list.scrollTop).toBe(788);
    expect(useWorkspaceStore.getState().readingConversationId).toBeNull();
    expect(screen.queryByRole("button", { name: "2 条新消息" })).not.toBeInTheDocument();
  });

  it("does not invent an unread target from cached data after a failed refresh", async () => {
    vi.mocked(mobileApi.listMessages).mockRejectedValue(new Error("synthetic offline"));
    render(<ChatRoomScreen conversationId="chat" />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText("旧缓存")).toBeInTheDocument();
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(2);
    expect(screen.queryByRole("button", { name: /条新消息/u })).not.toBeInTheDocument();
  });

  it("preserves the reading position and server unread count for unique incoming messages until returning to bottom", async () => {
    render(<ChatRoomScreen conversationId="chat" />);
    await screen.findByRole("button", { name: "2 条新消息" });
    fireEvent.click(screen.getByRole("button", { name: "关闭新消息回看提示" }));
    const list = screen.getByTestId("chat-message-scroll");
    list.scrollTop = 200;
    fireEvent.scroll(list);
    expect(useWorkspaceStore.getState().readingConversationId).toBeNull();
    vi.mocked(mobileApi.markConversationRead).mockClear();
    act(() => { incoming("live-1"); });
    expect(list.scrollTop).toBe(200);
    expect(screen.getByRole("button", { name: "回到底部，查看 1 条新消息" })).toBeInTheDocument();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(1);
    act(() => { incoming("live-1"); });
    expect(screen.getByRole("button", { name: "回到底部，查看 1 条新消息" })).toBeInTheDocument();
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    act(() => { incoming("delayed", "2026-11-18T00:00:02Z"); });
    expect(screen.getByRole("button", { name: "回到底部，查看 2 条新消息" })).toBeInTheDocument();
    expect(list.scrollTop).toBe(200);
    fireEvent.click(screen.getByRole("button", { name: "回到底部，查看 2 条新消息" }));
    expect(list.scrollTop).toBe(1200);
    expect(useWorkspaceStore.getState().readingConversationId).toBe("chat");
    await waitFor(() => expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(0));
    expect(mobileApi.markConversationRead).toHaveBeenCalledOnce();
  });

  it("does not read a freshly loaded conversation while the document is hidden", async () => {
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<ChatRoomScreen conversationId="chat" />);
    await screen.findByRole("button", { name: "2 条新消息" });
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().readingConversationId).toBeNull();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(2);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(mobileApi.markConversationRead).toHaveBeenCalledWith("chat", "new-2");
  });

  it("states the loaded-window boundary when the unread count exceeds available incoming messages", async () => {
    useWorkspaceStore.setState((state) => ({ conversations: {
      ...state.conversations, chat: { ...state.conversations.chat, unreadCount: 20 },
    } }));
    render(<ChatRoomScreen conversationId="chat" />);
    expect(await screen.findByRole("button", { name: "20 条新消息 · 当前可回看 3 条" })).toBeInTheDocument();
  });

  it("captures a new unread snapshot when leaving and returning to the conversation", async () => {
    const view = render(<ChatRoomScreen conversationId="chat" />);
    await screen.findByRole("button", { name: "2 条新消息" });
    view.unmount();
    expect(useWorkspaceStore.getState().readingConversationId).toBeNull();
    act(() => { useWorkspaceStore.setState((state) => ({ conversations: {
      ...state.conversations, chat: { ...state.conversations.chat, unreadCount: 1 },
    } })); });
    render(<ChatRoomScreen conversationId="chat" />);
    expect(await screen.findByRole("button", { name: "1 条新消息" })).toBeInTheDocument();
    expect(screen.getByTestId("chat-message-scroll").scrollTop).toBe(1200);
  });

  it("selects the exact same-name Bot with arrow keys, preserves draft identity across reopen and sends it as a mention", async () => {
    const view = render(<ChatRoomScreen conversationId="chat" />);
    await screen.findByRole("button", { name: "2 条新消息" });
    const input = screen.getByRole("combobox", { name: "消息输入框" });
    fireEvent.change(input, { target: { value: "@" } });
    const list = screen.getByRole("listbox", { name: "提及成员" });
    expect(within(list).getAllByRole("option")).toHaveLength(3);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(within(list).getAllByRole("option")[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mobileApi.sendMessage).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().drafts.chat.mentions?.[0].userId).toBe("bot_twin");
    view.unmount();
    render(<ChatRoomScreen conversationId="chat" />);
    const restored = screen.getByRole("combobox", { name: "消息输入框" });
    expect(restored).toHaveValue("@同名 ");
    fireEvent.change(restored, { target: { value: "@同名 处理一下" } });
    fireEvent.keyDown(restored, { key: "Enter" });
    await waitFor(() => expect(mobileApi.sendMessage).toHaveBeenCalledOnce());
    expect(vi.mocked(mobileApi.sendMessage).mock.calls[0][2]?.blocks).toEqual([
      { type: "mention", userId: "bot_twin", label: "同名" },
      { type: "text", text: " 处理一下" },
    ]);
  });

  it("leaves IME Enter to the editor, dismisses suggestions with Escape and selects slash commands without sending", async () => {
    vi.mocked(mobileApi.listConversationBotCommands).mockResolvedValue({ commands: [
      { command: "/help", description: "帮助" }, { command: "/status", description: "状态" },
    ] });
    render(<ChatRoomScreen conversationId="chat" />);
    await screen.findByRole("button", { name: "2 条新消息" });
    const input = screen.getByRole("combobox", { name: "消息输入框" });
    fireEvent.change(input, { target: { value: "@" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    expect(input).toHaveValue("@");
    expect(mobileApi.sendMessage).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "/" } });
    await screen.findByRole("listbox", { name: "机器人指令" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("/status ");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(mobileApi.sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(mobileApi.sendMessage).not.toHaveBeenCalled();
  });

  it("shows the thinking strip above the composer, renews its lease and removes it after expiry with reduced motion", async () => {
    render(<ChatRoomScreen conversationId="chat" />);
    await screen.findByRole("button", { name: "2 条新消息" });
    vi.useFakeTimers();
    act(() => {
      useThemeStore.setState({ reducedMotion: true });
      useWorkspaceStore.getState().applyRealtimeEvent({ type: "conversation.typing", payload: {
        conversationId: "chat", userId: "bot_twin", displayName: "星河助手", kind: "bot", state: "thinking",
        expiresAt: new Date(Date.now() + 5000).toISOString(),
      } });
    });
    const status = screen.getByTestId("composer-typing-status");
    expect(status).toHaveTextContent("星河助手正在思考");
    expect(status.compareDocumentPosition(screen.getByRole("combobox")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(status.querySelector(".animate-bounce")).toBeNull();
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { useWorkspaceStore.getState().applyRealtimeEvent({ type: "conversation.typing", payload: {
      conversationId: "chat", userId: "bot_twin", displayName: "星河助手", kind: "bot", state: "thinking",
      expiresAt: new Date(Date.now() + 5000).toISOString(),
    } }); });
    act(() => { vi.advanceTimersByTime(2100); });
    expect(screen.getByTestId("composer-typing-status")).toHaveTextContent("星河助手正在思考");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByTestId("composer-typing-status")).not.toBeInTheDocument();
    act(() => { useWorkspaceStore.getState().applyRealtimeEvent({ type: "conversation.typing", payload: {
      conversationId: "chat", userId: "peer", displayName: "测试成员", kind: "human", state: "typing",
      expiresAt: new Date(Date.now() + 5000).toISOString(),
    } }); });
    expect(screen.getByTestId("composer-typing-status")).toHaveTextContent("测试成员正在输入");
    act(() => { incoming("typing-finished"); });
    expect(screen.queryByTestId("composer-typing-status")).not.toBeInTheDocument();
  });
});
