import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mobileApi } from "@/shared/api";
import { nativeBridge } from "@/native/bridge";
import { latestReadAnchorId, useWorkspaceStore, type V1Message } from "@/store/workspace-store";
import { useNavStore } from "@/store/nav-store";
import { useEmoteStore } from "@/store/emote-store";
import { useUpdateStore } from "@/shared/updater";

const message = (id: string): V1Message => ({ id, conversationId: "chat", senderId: "peer", senderName: "测试成员", plainText: id,
  kind: "user", createdAt: "2026-11-18T00:00:01Z", status: "read", reactions: {} });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function incoming(id: string) {
  useWorkspaceStore.getState().applyRealtimeEvent({ type: "message.created", payload: { conversationId: "chat", message: {
    id, authorId: "peer", authorName: "测试成员", plainText: id, kind: "user", createdAt: "2026-11-18T00:00:02Z",
  } } });
}
function openReading() {
  useNavStore.setState({ activeChatId: "chat" });
  useWorkspaceStore.getState().setConversationReading("chat", true);
}
describe("workspace unread reads are explicit bounded writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(nativeBridge, "clearConversationNotification").mockImplementation(() => {});
    vi.spyOn(mobileApi, "markConversationRead").mockResolvedValue({ ok: true, readAt: "2026-11-18T00:00:03Z", lastReadMessageId: "last", lastReadSeq: 12, unreadCount: 0 });
    vi.spyOn(mobileApi, "listMessages").mockResolvedValue({ messages: [{ id: "last", authorId: "peer", plainText: "历史", createdAt: "2026-11-18T00:00:01Z" }] });
    useNavStore.setState({ activeChatId: null, searchOpen: false, directOverlayOpen: false, lightboxMedia: null, chatDetailOpen: false,
      threadRootId: null, serverConfigOpen: false, botManageOpen: false, updateSheetOpen: false, pendingExternalUrl: null });
    useWorkspaceStore.setState({ currentUser: { id: "me", displayName: "我", role: "member" }, authStatus: "authenticated",
      members: {}, readingConversationId: null, conversations: { chat: { id: "chat", kind: "group", title: "测试群", unreadCount: 2,
        mentionCount: 1, memberIds: ["me", "peer"], pinnedMessageIds: [], lastMessageAt: "2026-11-18T00:00:01Z" } },
      conversationOrder: ["chat"], messagesByConv: { chat: [message("last")] } });
  });
  afterEach(async () => { await settle(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it("prefetches history without a read write or clearing authoritative counts", async () => {
    await Promise.all(Array.from({ length: 8 }, () => useWorkspaceStore.getState().loadConversationMessages("chat")));
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().conversations.chat).toMatchObject({ unreadCount: 2, mentionCount: 1 });
  });

  it("bootstraps and background-prefetches the list without marking any conversation read", async () => {
    vi.spyOn(nativeBridge, "isNativeAndroid").mockReturnValue(false);
    vi.spyOn(nativeBridge, "connectSocket").mockReturnValue({ send: () => {}, close: () => {} });
    vi.spyOn(nativeBridge, "prefetchMedia").mockImplementation(() => {});
    vi.spyOn(nativeBridge, "syncNotificationContext").mockImplementation(() => {});
    vi.spyOn(useEmoteStore.getState(), "refreshLibrary").mockResolvedValue();
    vi.spyOn(useUpdateStore.getState(), "checkForUpdates").mockResolvedValue({ hasUpdate: false, release: null });
    vi.spyOn(mobileApi, "getBootstrap").mockResolvedValue({ auth: { enabled: true, currentUser: { id: "me", displayName: "我", role: "member" } }, preferences: {}, members: [],
      conversations: [{ id: "chat", type: "group", title: "测试群", unreadCount: 7, mentionCount: 2 }, { id: "saved", type: "saved", unreadCount: 0 }] });
    await useWorkspaceStore.getState().bootstrapWorkspace();
    await settle();
    expect(mobileApi.listMessages).toHaveBeenCalled();
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().conversations.chat).toMatchObject({ unreadCount: 7, mentionCount: 2 });
  });

  it("requires the current visible room at bottom, including overlay and hidden-page guards", () => {
    useWorkspaceStore.getState().markRead("chat");
    useNavStore.setState({ activeChatId: "chat" });
    useWorkspaceStore.getState().markRead("chat");
    openReading();
    useNavStore.setState({ searchOpen: true });
    useWorkspaceStore.getState().markRead("chat");
    useNavStore.setState({ searchOpen: false });
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    useWorkspaceStore.getState().markRead("chat");
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(2);
  });

  it("sends the displayed real message id once and waits for server acknowledgement", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    vi.mocked(mobileApi.markConversationRead).mockReturnValue(new Promise((done) => { resolve = done; }));
    useWorkspaceStore.setState({ messagesByConv: { chat: [message("last"), { ...message("pending"), status: "sending" }] } });
    openReading();
    useWorkspaceStore.getState().markRead("chat");
    useWorkspaceStore.getState().markRead("chat");
    expect(mobileApi.markConversationRead).toHaveBeenCalledExactlyOnceWith("chat", "last");
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(2);
    resolve({ ok: true, readAt: "2026-11-18T00:00:03Z", lastReadMessageId: "last", lastReadSeq: 12, unreadCount: 0 });
    await settle();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(0);
    expect(nativeBridge.clearConversationNotification).toHaveBeenCalledOnce();
  });

  it("keeps unread and notifications when the write fails", async () => {
    vi.mocked(mobileApi.markConversationRead).mockRejectedValue(new Error("offline"));
    openReading(); useWorkspaceStore.getState().markRead("chat"); await settle();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(2);
    expect(nativeBridge.clearConversationNotification).not.toHaveBeenCalled();
  });

  it("never acknowledges WS delivery and deduplicates replay after a cached history replacement", async () => {
    openReading(); incoming("replayed-after-cache");
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(3);
    await useWorkspaceStore.getState().loadConversationMessages("chat");
    incoming("replayed-after-cache");
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(3);
    expect(mobileApi.markConversationRead).not.toHaveBeenCalled();
  });

  it("preserves messages which arrive during a slow history response", async () => {
    let resolve!: (value: { messages: Record<string, unknown>[] }) => void;
    vi.mocked(mobileApi.listMessages).mockReturnValue(new Promise((done) => { resolve = done; }));
    const pending = useWorkspaceStore.getState().loadConversationMessages("chat");
    incoming("arrives-during-fetch");
    resolve({ messages: [{ id: "last", authorId: "peer", plainText: "历史" }] });
    await pending;
    expect(useWorkspaceStore.getState().messagesByConv.chat.map((entry) => entry.id)).toEqual(["last", "arrives-during-fetch"]);
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(3);
  });

  it("retains incoming messages beyond the confirmed boundary and ignores older receipts", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    vi.mocked(mobileApi.markConversationRead).mockReturnValue(new Promise((done) => { resolve = done; }));
    openReading(); useWorkspaceStore.getState().markRead("chat");
    incoming("newer-than-boundary");
    resolve({ ok: true, readAt: "2026-11-18T00:00:03Z", lastReadMessageId: "last", lastReadSeq: 12, unreadCount: 1 });
    await settle();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(1);
    useWorkspaceStore.getState().applyRealtimeEvent({ type: "conversation.read", payload: { conversationId: "chat", userId: "me", readAt: "2026-11-18T00:00:00Z", lastReadSeq: 10, unreadCount: 0 } });
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(1);
  });

  it("uses authoritative server counts and preserves the explicit mark-all-read command", async () => {
    vi.mocked(mobileApi.markConversationRead).mockResolvedValue({ ok: true, readAt: "2026-11-18T00:00:03Z", lastReadMessageId: "last", lastReadSeq: 12, unreadCount: 7 });
    useWorkspaceStore.getState().markRead("chat", { explicit: true }); await settle();
    expect(mobileApi.markConversationRead).toHaveBeenCalledExactlyOnceWith("chat", undefined);
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(7);
  });

  it("never replaces an explicit server zero with cached newer, recalled, thread or local rows", async () => {
    useWorkspaceStore.setState({ messagesByConv: { chat: [message("last"), message("cached-newer"),
      { ...message("recalled"), recalledAt: "2026-11-18T00:00:02Z" },
      { ...message("thread-only"), threadRootId: "root" }, { ...message("local"), status: "sending" }] } });
    openReading(); useWorkspaceStore.getState().markRead("chat", { messageId: "last" }); await settle();
    expect(useWorkspaceStore.getState().conversations.chat.unreadCount).toBe(0);
  });

  it("preserves a live creation received before an older HTTP receipt, even when its displayed timestamp is earlier", async () => {
    let resolve!: (value: Record<string, unknown>) => void;
    vi.mocked(mobileApi.markConversationRead).mockReturnValue(new Promise((done) => { resolve = done; }));
    useWorkspaceStore.setState({ messagesByConv: { chat: [{ ...message("last"), creationSeq: 12 }] } });
    openReading();
    useWorkspaceStore.getState().markRead("chat", { messageId: "last" });
    useWorkspaceStore.getState().applyRealtimeEvent({ type: "message.created", seq: 13, payload: {
      conversationId: "chat",
      message: { id: "late", authorId: "peer", plainText: "晚到消息", createdAt: "2026-11-18T00:00:00Z" },
      conversation: { unreadCount: 3, firstUnreadMessageId: "last" },
    } });
    resolve({ ok: true, readAt: "2026-11-18T00:00:01Z", lastReadMessageId: "last", lastReadSeq: 12, unreadCount: 0 });
    await settle();
    expect(useWorkspaceStore.getState().conversations.chat).toMatchObject({ unreadCount: 1, firstUnreadMessageId: "late" });
    expect(nativeBridge.clearConversationNotification).not.toHaveBeenCalled();
    const late = { ...message("late"), creationSeq: 13 };
    expect(latestReadAnchorId([late, { ...message("last"), creationSeq: 12 }])).toBe("late");
  });

  it("uses the authoritative unread projection for repeated delivery and recall", () => {
    const event = { type: "message.created", seq: 14, payload: {
      conversationId: "chat",
      message: { id: "projected", authorId: "peer", plainText: "实时消息" },
      conversation: { unreadCount: 1, firstUnreadMessageId: "projected", lastReadSeq: 12 },
    } };
    const apply = useWorkspaceStore.getState().applyRealtimeEvent;
    apply(event);
    apply(event);
    expect(useWorkspaceStore.getState().conversations.chat).toMatchObject({ unreadCount: 1, firstUnreadMessageId: "projected" });
    apply({ ...event, type: "message.recalled", seq: 15, payload: {
      ...event.payload, conversation: { unreadCount: 0, firstUnreadMessageId: null, lastReadSeq: 12 },
    } });
    expect(useWorkspaceStore.getState().conversations.chat).toMatchObject({ unreadCount: 0, firstUnreadMessageId: undefined });
  });

  it("sends a bounded API body and keeps the legacy explicit write bodyless", async () => {
    vi.mocked(mobileApi.markConversationRead).mockRestore();
    const request = vi.spyOn(nativeBridge, "request").mockResolvedValue({ ok: true, status: 200, bodyText: "{\"ok\":true}" });
    await mobileApi.markConversationRead("chat", "last");
    expect(request).toHaveBeenLastCalledWith("POST", "/api/v1/conversations/chat/read", expect.objectContaining({ body: JSON.stringify({ messageId: "last" }) }));
    await mobileApi.markConversationRead("chat");
    expect(request).toHaveBeenLastCalledWith("POST", "/api/v1/conversations/chat/read", expect.objectContaining({ body: undefined }));
  });
});
