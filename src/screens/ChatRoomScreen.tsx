import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AtSign,
  BellOff,
  Copy,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Forward,
  Image as ImageIcon,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pin,
  Reply,
  RotateCcw,
  Send,
  Slash,
  Smile,
  Star,
  X,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { isMessageEffectivelyCollapsed, MessageItem } from "@/components/MessageItem";
import { StickerDrawer } from "@/components/StickerDrawer";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type BotCommandSpec } from "@/shared/api";
import { beginMobileWrite, setMobileDraftActivity } from "@/shared/activity";
import {
  buildSelectedMentionBlocks,
  captureUnreadNavigation,
  chatAutocompleteKeyAction,
  insertComposerMention,
  reconcileComposerMentions,
  revealChatAutocompleteOption,
  type UnreadNavigation,
} from "@/shared/chat-navigation";
import { isSingleBuiltInSticker } from "@/shared/emotes";
import { formatBytes, formatDateDivider, isSameCalendarDay } from "@/shared/format";
import { useThemeStore } from "@/shared/theme-store";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import {
  latestReadAnchorId,
  useWorkspaceStore,
  type TypingIndicatorEntry,
  type V1Message,
  type V1MessageAttachment,
} from "@/store/workspace-store";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"];
const EMPTY_MESSAGES: V1Message[] = [];
const EMPTY_TYPERS: TypingIndicatorEntry[] = [];
const HUGE_PASTE_CHAR_THRESHOLD = 6000;

interface MentionCandidateItem {
  id: string;
  displayName: string;
  isAll?: boolean;
  avatarUrl?: string;
  avatarColor?: string;
  role?: "owner" | "admin" | "member" | "bot";
}

export function ChatRoomScreen({ conversationId }: { conversationId: string }) {
  const conv = useWorkspaceStore((s) => s.conversations[conversationId]);
  const messages = useWorkspaceStore(
    (s) => s.messagesByConv[conversationId] || EMPTY_MESSAGES
  );
  const members = useWorkspaceStore((s) => s.members);
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const draft = useWorkspaceStore((s) => s.drafts[conversationId]);
  const editingMessageId = useWorkspaceStore((s) => s.editingMessageId);
  const highlightedMessageId = useWorkspaceStore((s) => s.highlightedMessageId);
  const typers = useWorkspaceStore((s) => s.typingByConv[conversationId] || EMPTY_TYPERS);
  const collapsePrefs = useWorkspaceStore((s) => s.collapsePrefs);
  const messageCollapseOverrides = useWorkspaceStore((s) => s.messageCollapseOverrides);

  const loadConversationMessages = useWorkspaceStore((s) => s.loadConversationMessages);
  const loadOlderMessages = useWorkspaceStore((s) => s.loadOlderMessages);
  const loadMessagesAround = useWorkspaceStore((s) => s.loadMessagesAround);
  const hasMoreBefore = useWorkspaceStore((s) => s.hasMoreBeforeByConv[conversationId]);
  const loadingOlder = useWorkspaceStore((s) => s.loadingOlderByConv[conversationId]);
  const markRead = useWorkspaceStore((s) => s.markRead);
  const setConversationReading = useWorkspaceStore((s) => s.setConversationReading);
  const setDraft = useWorkspaceStore((s) => s.setDraft);
  const setEditingMessageId = useWorkspaceStore((s) => s.setEditingMessageId);
  const jumpToMessage = useWorkspaceStore((s) => s.jumpToMessage);
  const clearHighlightedMessage = useWorkspaceStore((s) => s.clearHighlightedMessage);
  const setLocalMessageCollapsed = useWorkspaceStore((s) => s.setLocalMessageCollapsed);
  const sendWorkspaceMessage = useWorkspaceStore((s) => s.sendWorkspaceMessage);
  const editWorkspaceMessage = useWorkspaceStore((s) => s.editWorkspaceMessage);
  const recallWorkspaceMessage = useWorkspaceStore((s) => s.recallWorkspaceMessage);
  const toggleReaction = useWorkspaceStore((s) => s.toggleReaction);
  const togglePinMessage = useWorkspaceStore((s) => s.togglePinMessage);

  const favoriteFromMessage = useEmoteStore((s) => s.favoriteFromMessage);
  const replyAutoMention = useEmoteStore((s) => s.settings?.replyAutoMention !== false);

  const closeChat = useNavStore((s) => s.closeChat);
  const actionMessageId = useNavStore((s) => s.actionMessageId);
  const setActionMessageId = useNavStore((s) => s.setActionMessageId);
  const setThreadRootId = useNavStore((s) => s.setThreadRootId);
  const setChatDetailOpen = useNavStore((s) => s.setChatDetailOpen);
  const setForwardingMessageIds = useNavStore((s) => s.setForwardingMessageIds);
  const showToast = useNavStore((s) => s.showToast);
  const [topicsSheetOpen, setTopicsSheetOpen] = useState(false);
  const navObscured = useNavStore(
    (s) =>
      s.searchOpen ||
      s.directOverlayOpen ||
      Boolean(s.lightboxMedia) ||
      s.chatDetailOpen ||
      Boolean(s.threadRootId) ||
      s.serverConfigOpen ||
      s.botManageOpen ||
      s.updateSheetOpen ||
      Boolean(s.pendingExternalUrl) ||
      Boolean(s.actionMessageId) ||
      Boolean(s.forwardingMessageIds) ||
      Boolean(s.sharedPackId) ||
      Boolean(s.botSetupSessionId) ||
      s.stickerStudioOpen ||
      Boolean(s.createChatMode)
  );
  const obscured = navObscured || topicsSheetOpen;
  const obscuredRef = useRef(obscured);
  obscuredRef.current = obscured;
  const latestRenderedMessageId = latestReadAnchorId(messages);
  const latestRenderedMessageIdRef = useRef(latestRenderedMessageId);
  latestRenderedMessageIdRef.current = latestRenderedMessageId;

  const [stickerOpen, setStickerOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [liveBelowCount, setLiveBelowCount] = useState(0);
  const [botCommands, setBotCommands] = useState<BotCommandSpec[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);
  const [dismissedMentionText, setDismissedMentionText] = useState<string | null>(null);
  const [menuSelection, setMenuSelection] = useState({ key: "", index: 0 });
  const [unreadNavigation, setUnreadNavigation] = useState<UnreadNavigation | null>(null);
  const programmaticScrollLockUntilRef = useRef(0);
  const [hugePaste, setHugePasteState] = useState<{
    text: string;
    charCount: number;
    byteSize: number;
  } | null>(null);
  const setHugePaste = useCallback((value: typeof hugePaste) => {
    setMobileDraftActivity(`large-paste:${conversationId}`, Boolean(value));
    setHugePasteState(value);
  }, [conversationId]);
  useEffect(() => () => setMobileDraftActivity(`large-paste:${conversationId}`, false), [conversationId]);
  const [isComposingIme, setIsComposingIme] = useState(false);
  const [remoteThreads, setRemoteThreads] = useState<
    Array<{
      rootMessageId: string;
      threadTitle?: string;
      rootAuthorName: string;
      rootPlainText: string;
      replyCount: number;
      lastRepliedAt: string;
      lastAuthorName: string;
      lastPlainText: string;
    }>
  >([]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autocompleteRef = useRef<HTMLDivElement | null>(null);
  const visitRef = useRef<{
    conversationId: string;
    unreadCount: number;
    firstUnreadMessageId?: string;
    settled: boolean;
    seenIds: Set<string>;
    newestCreatedAt: number;
  } | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const pinnedConvRef = useRef<string>("");
  const nearBottomRef = useRef<boolean>(true);
  const prevTailMsgIdRef = useRef<string>("");

  const textValue = draft?.text || "";
  const replyToId = draft?.replyToMessageId;
  const reducedMotion = useThemeStore((s) => s.reducedMotion);

  const directPeer = useMemo(() => {
    if (!conv || conv.kind !== "direct") return undefined;
    const peerId = conv.memberIds.find((uid) => uid !== currentUser?.id);
    return peerId ? members[peerId] : undefined;
  }, [conv, members, currentUser]);

  const isBotConversation = useMemo(() => {
    if (!conv) return false;
    return conv.memberIds.some(
      (uid) =>
        uid !== currentUser?.id &&
        (members[uid]?.role === "bot" ||
          uid.startsWith("usr_bot_") ||
          uid.startsWith("usr_system_"))
    );
  }, [conv, members, currentUser]);

  useEffect(() => {
    const state = useWorkspaceStore.getState();
    // Preserve the pre-markRead snapshot across React Strict Mode's second setup.
    const visit = visitRef.current?.conversationId === conversationId
      ? visitRef.current
      : {
          conversationId,
          unreadCount: state.highlightedMessageId ? 0 : state.conversations[conversationId]?.unreadCount || 0,
          firstUnreadMessageId: state.highlightedMessageId ? undefined : state.conversations[conversationId]?.firstUnreadMessageId,
          settled: false,
          seenIds: new Set<string>(),
          newestCreatedAt: 0,
        };
    visitRef.current = visit;
    visit.settled = false;
    nearBottomRef.current = !state.highlightedMessageId;
    setConversationReading(conversationId, false);
    setShowScrollBottom(false);
    setLiveBelowCount(0);
    setUnreadNavigation(null);
    setDismissedMentionText(null);
    setSlashOpen(false);
    setHugePaste(null);
    let cancelled = false;
    setLoadingInitial(true);
    void loadConversationMessages(conversationId)
      .then((loaded) => {
        if (cancelled || visitRef.current !== visit || !loaded) return;
        const fresh = useWorkspaceStore.getState();
        const freshMessages = fresh.messagesByConv[conversationId] || [];
        visit.seenIds = new Set(freshMessages.map((message) => message.id));
        visit.newestCreatedAt = Math.max(0, ...freshMessages.map((message) => Date.parse(message.createdAt) || 0));
        visit.settled = true;
        setUnreadNavigation(
          captureUnreadNavigation(
            freshMessages,
            visit.unreadCount,
            fresh.currentUser?.id,
            visit.firstUnreadMessageId
          )
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });
    const onVisibilityChange = () => {
      const reading = !document.hidden && !obscuredRef.current && visit.settled && nearBottomRef.current;
      setConversationReading(conversationId, reading);
      if (reading && latestRenderedMessageIdRef.current) markRead(conversationId, { messageId: latestRenderedMessageIdRef.current });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      setConversationReading(conversationId, false);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [conversationId, loadConversationMessages, markRead, setConversationReading, setHugePaste]);

  useEffect(() => {
    const visit = visitRef.current;
    if (!visit?.settled || visit.conversationId !== conversationId) return;
    const lastKnownIndex = messages.findLastIndex((message) => visit.seenIds.has(message.id));
    const incoming = messages.filter((message, index) => !visit.seenIds.has(message.id) && index > lastKnownIndex &&
      message.senderId !== currentUser?.id && message.kind !== "system" &&
      (lastKnownIndex >= 0 || Date.parse(message.createdAt) >= visit.newestCreatedAt));
    for (const message of messages) visit.seenIds.add(message.id);
    visit.newestCreatedAt = Math.max(visit.newestCreatedAt, ...messages.map((message) => Date.parse(message.createdAt) || 0));
    if (incoming.length > 0 && !nearBottomRef.current) {
      setLiveBelowCount((prev) => prev + incoming.length);
    }
  }, [conversationId, currentUser?.id, messages]);

  useEffect(() => {
    if (!isBotConversation) {
      setBotCommands([]);
      return;
    }
    let cancelled = false;
    void mobileApi
      .listConversationBotCommands(conversationId)
      .then((res) => { if (!cancelled) setBotCommands(res.commands || []); })
      .catch(() => { if (!cancelled) setBotCommands([]); });
    return () => { cancelled = true; };
  }, [conversationId, isBotConversation]);

  // Synchronous pre-paint bottom pinning on conversation open & incoming/outgoing messages
  const tailMsg = messages.length > 0 ? messages[messages.length - 1] : undefined;
  const tailMsgId = tailMsg?.id || "";
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || highlightedMessageId) return;

    const isInitialForConv = pinnedConvRef.current !== conversationId;
    const isOwnNewTail =
      tailMsgId !== prevTailMsgIdRef.current && tailMsg?.senderId === currentUser?.id;

    if (isInitialForConv || nearBottomRef.current || isOwnNewTail) {
      el.scrollTop = el.scrollHeight;
      nearBottomRef.current = true;
      setConversationReading(conversationId, Boolean(visitRef.current?.settled) && !document.hidden && !obscuredRef.current);
      setShowScrollBottom(false);
      if (messages.length > 0) {
        pinnedConvRef.current = conversationId;
      }
    }
    prevTailMsgIdRef.current = tailMsgId;
  }, [
    conversationId,
    messages.length,
    tailMsgId,
    tailMsg?.senderId,
    currentUser?.id,
    stickerOpen,
    highlightedMessageId,
    setConversationReading,
  ]);

  // Rendering a successfully loaded latest page is the only automatic read
  // boundary. Prefetching, cached shells and merely receiving WS frames are not.
  useEffect(() => {
    const reading = !loadingInitial && visitRef.current?.settled === true && nearBottomRef.current &&
      !document.hidden && !obscured && !highlightedMessageId;
    setConversationReading(conversationId, reading);
    if (reading && latestRenderedMessageId) markRead(conversationId, { messageId: latestRenderedMessageId });
  }, [conversationId, loadingInitial, latestRenderedMessageId, obscured, highlightedMessageId, markRead, setConversationReading]);

  // Keep bottom locked when images/stickers decode or IME keyboard / drawer resizes viewport
  useEffect(() => {
    const listEl = listRef.current;
    const contentEl = contentRef.current;
    if (!listEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current && !highlightedMessageId && listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    });
    observer.observe(listEl);
    if (contentEl) observer.observe(contentEl);
    return () => observer.disconnect();
  }, [conversationId, highlightedMessageId]);

  // Scroll to highlighted message when jumping from search, pin, quote, or unread banner
  useEffect(() => {
    if (!highlightedMessageId) return;
    nearBottomRef.current = false;
    pinnedConvRef.current = conversationId;
    setConversationReading(conversationId, false);
    const target = document.getElementById(`msg-${highlightedMessageId}`);
    if (target) {
      programmaticScrollLockUntilRef.current = Date.now() + 800;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const timer = window.setTimeout(() => {
        clearHighlightedMessage();
      }, 2400);
      return () => window.clearTimeout(timer);
    }
  }, [conversationId, highlightedMessageId, messages, setConversationReading, clearHighlightedMessage]);

  const msgById = useMemo(() => {
    const map = new Map<string, V1Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const actionMsg = actionMessageId ? msgById.get(actionMessageId) || null : null;
  const editingMsg = editingMessageId ? msgById.get(editingMessageId) || null : null;
  const replyTarget = replyToId ? msgById.get(replyToId) : undefined;
  const latestPinnedId = conv?.pinnedMessageIds?.[0];
  const latestPinnedMsg = latestPinnedId ? msgById.get(latestPinnedId) : undefined;

  // @Mention Candidate Detection (including @所有人 at top of group chats!)
  const mentionQuery = useMemo(() => {
    if (!conv || conv.kind !== "group") return null;
    const m = textValue.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [conv, textValue]);

  const mentionCandidates = useMemo<MentionCandidateItem[]>(() => {
    if (mentionQuery === null || !conv || conv.kind !== "group") return [];
    const includeAll =
      !mentionQuery || "所有人".includes(mentionQuery) || "all".includes(mentionQuery);
    const memberHits: MentionCandidateItem[] = conv.memberIds
      .filter((uid) => uid !== currentUser?.id && Boolean(members[uid]))
      .map((uid) => members[uid])
      .filter((u) => u.displayName.toLowerCase().includes(mentionQuery))
      .slice(0, 6)
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        avatarColor: u.avatarColor,
        role: u.role,
      }));
    if (includeAll) {
      return [{ id: "all", displayName: "所有人", isAll: true }, ...memberHits];
    }
    return memberHits;
  }, [mentionQuery, conv, members, currentUser]);

  const insertMention = (userId: string, displayName: string) => {
    const next = insertComposerMention(textValue, draft?.mentions || [], userId, displayName, mentionQuery !== null);
    setDraft(conversationId, next.text, replyToId, next.mentions);
    setDismissedMentionText(null);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const visibleBotCommands = useMemo(() => {
    const query = /^\/([^\s]*)$/u.exec(textValue)?.[1]?.toLowerCase() || "";
    return botCommands.filter((command) => command.command.replace(/^\//u, "").toLowerCase().startsWith(query));
  }, [botCommands, textValue]);
  const mentionMenuVisible = mentionCandidates.length > 0 && dismissedMentionText !== textValue;
  const slashMenuVisible = !mentionMenuVisible && slashOpen && isBotConversation && visibleBotCommands.length > 0;
  const menuCount = mentionMenuVisible ? mentionCandidates.length : slashMenuVisible ? visibleBotCommands.length : 0;
  const menuIds = mentionMenuVisible
    ? mentionCandidates.map((candidate) => candidate.id).join(",")
    : visibleBotCommands.map((command) => `${command.botId || ""}/${command.command}`).join(",");
  const menuKey = `${conversationId}:${mentionMenuVisible ? "mention" : "slash"}:${textValue}:${menuIds}`;
  const activeMenuIndex = menuSelection.key === menuKey ? Math.min(menuSelection.index, menuCount - 1) : 0;
  const menuId = `chat-autocomplete-${conversationId}`;

  useLayoutEffect(() => {
    const list = autocompleteRef.current;
    if (!list || menuCount <= 0) return;
    const option = list.querySelector<HTMLElement>(`[data-autocomplete-index="${activeMenuIndex}"]`);
    if (option) revealChatAutocompleteOption(list, option);
  }, [activeMenuIndex, menuCount, menuKey]);

  const insertBotCommand = (command: BotCommandSpec) => {
    const token = command.command.startsWith("/") ? command.command : `/${command.command}`;
    setDraft(conversationId, `${token} `, replyToId, []);
    setSlashOpen(false);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const returnToLatest = () => {
    nearBottomRef.current = true;
    setConversationReading(conversationId, Boolean(visitRef.current?.settled) && !document.hidden && !obscured);
    setShowScrollBottom(false);
    setUnreadNavigation(null);
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    if (visitRef.current?.settled && latestRenderedMessageId) markRead(conversationId, { messageId: latestRenderedMessageId });
  };

  const startReplyToMessage = (target: V1Message) => {
    setEditingMessageId(null);
    let nextDraft = textValue;
    let nextMentions = draft?.mentions || [];
    if (
      conv?.kind === "group" &&
      replyAutoMention &&
      target.senderId &&
      target.senderId !== currentUser?.id
    ) {
      const targetName = members[target.senderId]?.displayName || target.senderName;
      if (targetName && !nextDraft.includes(`@${targetName}`)) {
        nextDraft = nextDraft
          ? `@${targetName} ${nextDraft.replace(/^\s+/, "")}`
          : `@${targetName} `;
        nextMentions = [
          ...reconcileComposerMentions(textValue, nextDraft, nextMentions),
          { userId: target.senderId, label: targetName, start: 0, end: targetName.length + 1 },
        ];
      }
    }
    setDraft(conversationId, nextDraft, target.id, nextMentions);
    setTimeout(() => textareaRef.current?.focus(), 40);
  };

  const handleTextChange = (val: string) => {
    setDraft(conversationId, val, replyToId, reconcileComposerMentions(textValue, val, draft?.mentions || []));
    setDismissedMentionText(null);
    if (/^\/[^\s]*$/u.test(val) && isBotConversation && botCommands.length > 0) {
      setSlashOpen(true);
    } else if (slashOpen) {
      setSlashOpen(false);
    }
    const now = Date.now();
    if (val.trim() && now - lastTypingSentRef.current > 3200) {
      lastTypingSentRef.current = now;
      void mobileApi.sendConversationTyping(conversationId, "typing").catch(() => {});
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData?.getData("text/plain") || "";
    if (pasted.length > HUGE_PASTE_CHAR_THRESHOLD) {
      e.preventDefault();
      setHugePaste({
        text: pasted,
        charCount: pasted.length,
        byteSize: new TextEncoder().encode(pasted).byteLength,
      });
    }
  };

  const handleSendHugePasteAsTxt = async () => {
    if (!hugePaste || uploading) return;
    const releaseWrite = beginMobileWrite();
    const payload = hugePaste;
    setHugePaste(null);
    setUploading(true);
    returnToLatest();
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fileName = `pasted-${stamp}.txt`;
      const att = await nativeBridge.uploadTextAttachment(conversationId, fileName, payload.text);
      await sendWorkspaceMessage(conversationId, textValue, replyToId, [
        {
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          byteSize: att.byteSize,
          url: att.url,
          downloadUrl: att.downloadUrl,
        },
      ], buildSelectedMentionBlocks(textValue, draft?.mentions || []));
      showToast("长文本已转为 .txt 附件发送", "success");
    } catch (err) {
      setHugePaste(payload);
      showToast(err instanceof Error ? err.message : "上传文本附件失败", "danger");
    } finally {
      setUploading(false);
      releaseWrite();
    }
  };

  const handleSend = async () => {
    const trimmed = textValue.trim();
    if (!trimmed || uploading) return;
    const releaseWrite = beginMobileWrite();
    // Keep soft keyboard open continuously like native chat apps (prevent WebView blur)
    textareaRef.current?.focus({ preventScroll: true });
    nativeBridge.haptic("light");
    try {
      returnToLatest();
      if (editingMsg) {
        setDraft(conversationId, "", "");
        textareaRef.current?.focus({ preventScroll: true });
        await editWorkspaceMessage(conversationId, editingMsg.id, trimmed);
        return;
      }
      const sendPromise = sendWorkspaceMessage(
        conversationId, trimmed, replyToId, undefined,
        buildSelectedMentionBlocks(textValue, draft?.mentions || [])
      );
      textareaRef.current?.focus({ preventScroll: true });
      await sendPromise;
    } finally {
      releaseWrite();
    }
  };

  const handleUploadPick = async (mode: "image" | "file") => {
    setAttachSheetOpen(false);
    const releaseWrite = beginMobileWrite();
    try {
      const picked = await nativeBridge.pickMedia(mode, true);
      if (picked.length === 0) return;
      setUploading(true);
      returnToLatest();
      const uploaded: V1MessageAttachment[] = [];
      for (const f of picked) {
        const att = await nativeBridge.uploadConversationFile(conversationId, f.id);
        uploaded.push({
          id: att.id,
          fileName: att.fileName,
          mimeType: att.mimeType,
          byteSize: att.byteSize,
          url: att.url,
          downloadUrl: att.downloadUrl,
        });
      }
      await sendWorkspaceMessage(conversationId, textValue, replyToId, uploaded,
        buildSelectedMentionBlocks(textValue, draft?.mentions || []));
    } catch (err) {
      showToast(err instanceof Error ? err.message : "上传文件失败", "danger");
    } finally {
      setUploading(false);
      releaseWrite();
    }
  };

  const jumpToUnread = () => {
    if (!unreadNavigation || !listRef.current) return;
    const list = listRef.current;
    const targetId = unreadNavigation.firstMessageId;
    const target = document.getElementById(`msg-${targetId}`);
    if (!target || !list.contains(target)) {
      setUnreadNavigation(null);
      void loadMessagesAround(conversationId, targetId).then((found) => {
        if (found) {
          jumpToMessage(conversationId, targetId);
        } else {
          showToast("这条消息已不在当前历史窗口，可通过搜索查找", "info");
        }
      });
      return;
    }
    nearBottomRef.current = false;
    setConversationReading(conversationId, false);
    programmaticScrollLockUntilRef.current = Date.now() + 750;
    const top = Math.max(0, list.scrollTop + target.getBoundingClientRect().top - list.getBoundingClientRect().top - 12);
    const motionReduced = reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof list.scrollTo === "function") list.scrollTo({ top, behavior: motionReduced ? "auto" : "smooth" });
    else list.scrollTop = top;
    setUnreadNavigation(null);
  };

  const visibleTypers = typers.filter((entry) => entry.expiresAt > Date.now());
  const thinkingTypers = visibleTypers.filter((entry) => entry.state === "thinking");
  const statusTypers = thinkingTypers.length > 0 ? thinkingTypers : visibleTypers;
  const typingNames = statusTypers.slice(0, 2).map((entry) => entry.displayName).join("、");
  const typingStatus = `${typingNames}${statusTypers.length > 2 ? `等 ${statusTypers.length} 人` : ""}${thinkingTypers.length > 0 ? "正在思考" : "正在输入"}`;

  if (!conv) return null;

  const displayConvTitle =
    conv.kind === "direct" && directPeer?.displayName ? directPeer.displayName : conv.title;

  const avatarKind =
    conv.kind === "saved"
      ? "saved"
      : conv.kind === "group"
      ? "group"
      : isBotConversation
      ? "bot"
      : "user";

  // Check if actionMsg has favoritable sticker/image
  const getFavoriteInputForMsg = (m: V1Message) => {
    const emBlock = m.blocks?.length === 1 && m.blocks[0].type === "emoji" ? m.blocks[0] : null;
    if (emBlock) {
      if (emBlock.shortcode.startsWith("custom:")) {
        return { messageId: m.id, customEmoteId: emBlock.shortcode.slice("custom:".length) };
      }
      return { messageId: m.id, emoteKey: emBlock.shortcode };
    }
    const singleBuilt = isSingleBuiltInSticker(m.plainText);
    if (singleBuilt) {
      return { messageId: m.id, emoteKey: `${singleBuilt.packId}:${singleBuilt.id}` };
    }
    const imgAtt = m.attachments?.find((a) => a.mimeType.startsWith("image/"));
    if (imgAtt) {
      return { messageId: m.id, attachmentId: imgAtt.id };
    }
    return null;
  };

  const actionMsgCollapsed = actionMsg
    ? isMessageEffectivelyCollapsed(actionMsg, collapsePrefs, messageCollapseOverrides)
    : false;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-[var(--dl-bg)] pb-[var(--ime-height)]">
      {/* Sticky Glass Chat Header */}
      <header className="pt-[var(--safe-top)] bg-[var(--dl-surface)] dl-glass border-b border-[var(--dl-border)] shrink-0 z-20">
        <div className="h-14 px-2.5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={closeChat}
            aria-label="返回会话列表"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)] shrink-0"
          >
            <ArrowLeft size={21} />
          </button>

          <button
            type="button"
            onClick={() => setChatDetailOpen(true)}
            className="flex-1 min-w-0 flex items-center gap-2.5 text-left active:opacity-80"
          >
            <Avatar
              name={displayConvTitle}
              src={conv.avatarUrl || directPeer?.avatarUrl}
              emoji={conv.avatarEmoji}
              kind={avatarKind}
              color={avatarKind === "bot" ? directPeer?.avatarColor : undefined}
              size={38}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[15px] font-bold text-[var(--dl-text)] truncate">
                  {displayConvTitle}
                </span>
                {conv.notificationLevel === "muted" && (
                  <BellOff size={13} className="text-[var(--dl-text-muted)] shrink-0" />
                )}
              </div>
              <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                {conv.kind === "group" ? (
                  `${conv.memberIds.length} 位成员`
                ) : conv.kind === "saved" ? (
                  "仅自己可见 · 跨端同步"
                ) : isBotConversation ? (
                  directPeer?.botOnline === true ? (
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span>在线 · AI 智能体实时通道</span>
                    </span>
                  ) : directPeer?.botOnline === false ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      <span className="truncate">离线 · 监听未连接（上线后自动处理）</span>
                    </span>
                  ) : (
                    "AI 智能体实时通道"
                  )
                ) : (
                  "加密传输会话"
                )}
              </div>
            </div>
          </button>

          {(() => {
            const localTopicCount = messages.filter(
              (m) => !m.recalledAt && (m.threadReplyCount || 0) > 0
            ).length;
            return (
              <button
                type="button"
                onClick={() => {
                  setTopicsSheetOpen(true);
                  void mobileApi
                    .listConversationThreads(conversationId)
                    .then((res) => setRemoteThreads(res.threads || []))
                    .catch(() => {});
                }}
                aria-label="本会话话题列表"
                className="relative w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)] shrink-0"
              >
                <MessageSquareText size={19} />
                {localTopicCount > 0 && (
                  <span className="absolute top-0.5 right-0.5 px-1 min-w-[14px] h-3.5 rounded-full bg-[var(--dl-accent)] text-white text-[9.5px] font-bold flex items-center justify-center tabular-nums">
                    {localTopicCount}
                  </span>
                )}
              </button>
            );
          })()}

          <button
            type="button"
            onClick={() => setChatDetailOpen(true)}
            aria-label="打开会话详情"
            className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)] shrink-0"
          >
            <MoreHorizontal size={20} />
          </button>
        </div>

        {/* Pinned Message Banner */}
        {latestPinnedMsg && (
          <div className="px-3.5 py-2 border-t border-[var(--dl-border)] bg-[var(--dl-card)]/65 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById(`msg-${latestPinnedMsg.id}`);
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
              className="min-w-0 flex-1 flex items-center gap-2 text-left"
            >
              <Pin size={13} className="text-[var(--dl-accent)] shrink-0" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold text-[var(--dl-accent)]">置顶消息</div>
                <div className="text-[12px] text-[var(--dl-text)] truncate">
                  {latestPinnedMsg.plainText}
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => void togglePinMessage(conversationId, latestPinnedMsg.id)}
              aria-label="取消置顶"
              className="p-1 text-[var(--dl-text-muted)]"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </header>

      {unreadNavigation && (
        <div className="flex justify-center px-3 py-1 shrink-0">
          <div className="inline-flex max-w-full items-center rounded-full bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]">
            <button
              type="button"
              onClick={jumpToUnread}
              className="min-h-9 px-3 flex items-center gap-1.5 text-[12px] font-semibold truncate"
            >
              <ArrowUp size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">
                {unreadNavigation.count} 条新消息
                {unreadNavigation.count > unreadNavigation.availableCount && ` · 当前可回看 ${unreadNavigation.availableCount} 条`}
              </span>
            </button>
            <button
              type="button"
              aria-label="关闭新消息回看提示"
              onClick={() => setUnreadNavigation(null)}
              className="w-9 h-9 flex items-center justify-center shrink-0 rounded-full"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Message Stream */}
      <div
        ref={listRef}
        data-testid="chat-message-scroll"
        onClick={() => {
          if (stickerOpen) setStickerOpen(false);
          if (slashOpen) setSlashOpen(false);
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
          const wasNearBottom = nearBottomRef.current;
          const isBottom = dist <= 48;
          if (Date.now() >= programmaticScrollLockUntilRef.current || !isBottom) {
            nearBottomRef.current = isBottom;
            setConversationReading(conversationId, isBottom && Boolean(visitRef.current?.settled) && !document.hidden && !obscured);
            if (!wasNearBottom && isBottom) {
              setLiveBelowCount(0);
              if (visitRef.current?.settled && latestRenderedMessageId) markRead(conversationId, { messageId: latestRenderedMessageId });
            }
          }
          setShowScrollBottom(dist > 300);
          if (
            el.scrollTop < 120 &&
            hasMoreBefore !== false &&
            !loadingOlder &&
            messages.length >= 20
          ) {
            const prevHeight = el.scrollHeight;
            const prevTop = el.scrollTop;
            void loadOlderMessages(conversationId).then((added) => {
              if (added > 0 && listRef.current) {
                const delta = listRef.current.scrollHeight - prevHeight;
                if (delta > 0) listRef.current.scrollTop = prevTop + delta;
              }
            });
          }
        }}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 py-2 overscroll-contain relative"
      >
        <div ref={contentRef} className="min-h-full w-full min-w-0 flex flex-col justify-end">
          {messages.length === 0 && loadingInitial ? (
            <div className="py-12 text-center text-[12px] text-[var(--dl-text-muted)]">
              正在同步近期消息…
            </div>
          ) : (
            messages.map((msg, idx) => {
              const prev = idx > 0 ? messages[idx - 1] : null;
              const next = idx < messages.length - 1 ? messages[idx + 1] : null;
              const showDate = !prev || !isSameCalendarDay(prev.createdAt, msg.createdAt);
              const canBurst = (a: V1Message | null, b: V1Message | null) => {
                if (!a || !b) return false;
                if (a.kind === "system" || b.kind === "system" || a.recalledAt || b.recalledAt) {
                  return false;
                }
                if (a.senderId !== b.senderId) return false;
                if (!isSameCalendarDay(a.createdAt, b.createdAt)) return false;
                const diff = Math.abs(Date.parse(b.createdAt) - Date.parse(a.createdAt));
                return Number.isFinite(diff) && diff <= 5 * 60 * 1000;
              };
              const groupedWithPrev = !showDate && canBurst(prev, msg);
              const groupedWithNext = canBurst(msg, next);
              return (
                <React.Fragment key={msg.id}>
                  {showDate && (
                    <div className="my-2.5 flex justify-center">
                      <span className="px-3 py-0.5 rounded-full text-[11px] font-medium text-[var(--dl-text-muted)] bg-[var(--dl-card)]/85">
                        {formatDateDivider(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <MessageItem
                    msg={msg}
                    isOwn={msg.senderId === currentUser?.id}
                    isGroup={conv.kind === "group"}
                    senderColor={members[msg.senderId]?.avatarColor}
                    replyTarget={msg.replyToId ? msgById.get(msg.replyToId) : undefined}
                    highlighted={highlightedMessageId === msg.id}
                    groupedWithPrev={groupedWithPrev}
                    groupedWithNext={groupedWithNext}
                    onQuickReply={startReplyToMessage}
                    onMentionSender={insertMention}
                    onJumpToMessage={(targetId) => {
                      jumpToMessage(conversationId, targetId);
                    }}
                  />
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>

      {/* Floating Scroll-to-Bottom Button (with live unread-below badge) */}
      {(showScrollBottom || liveBelowCount > 0) && (
        <button
          type="button"
          onClick={() => {
            setLiveBelowCount(0);
            returnToLatest();
          }}
          aria-label={liveBelowCount > 0 ? `回到底部，查看 ${liveBelowCount} 条新消息` : "回到底部"}
          className="absolute right-4 bottom-20 z-20 min-w-10 h-10 px-3 rounded-full bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-md flex items-center justify-center gap-1.5 text-[var(--dl-text)] active:scale-95"
        >
          {liveBelowCount > 0 && (
            <span className="text-[12px] font-semibold text-[var(--dl-accent)] tabular-nums">
              {liveBelowCount > 99 ? "99+" : liveBelowCount}
            </span>
          )}
          <ArrowDown size={18} />
        </button>
      )}

      {/* Floating @Mention Candidate Bar */}
      {mentionMenuVisible && (
        <div
          ref={autocompleteRef}
          id={menuId}
          role="listbox"
          aria-label="提及成员"
          data-testid="mention-candidate-bar"
          className="mx-3 mb-1.5 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-lg overflow-hidden divide-y divide-[var(--dl-border)]/50 max-h-48 overflow-y-auto z-20"
        >
          {mentionCandidates.map((u, index) => (
            <button
              key={u.id}
              id={`${menuId}-${index}`}
              role="option"
              aria-selected={activeMenuIndex === index}
              data-autocomplete-index={index}
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertMention(u.id, u.displayName)}
              className={`w-full px-3.5 py-2.5 flex items-center gap-2.5 text-left active:bg-[var(--dl-card)] ${activeMenuIndex === index ? "bg-[var(--dl-accent-soft)]" : ""}`}
            >
              {u.isAll ? (
                <div className="w-7 h-7 rounded-full bg-amber-500/18 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
                  <AtSign size={15} />
                </div>
              ) : (
                <Avatar
                  name={u.displayName}
                  src={u.avatarUrl}
                  kind={u.role === "bot" ? "bot" : "user"}
                  color={u.avatarColor}
                  size={28}
                />
              )}
              <span className="text-[14px] font-medium text-[var(--dl-text)] truncate">
                {u.isAll ? "@所有人" : u.displayName}
              </span>
              {u.isAll && (
                <span className="ml-auto text-[11px] text-[var(--dl-text-muted)] shrink-0">
                  提醒全体群成员
                </span>
              )}
              {u.role === "bot" && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]">
                  BOT
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Floating / Bot Command Picker (ONLY in bot conversations!) */}
      {slashMenuVisible && (
        <div
          ref={autocompleteRef}
          id={menuId}
          role="listbox"
          aria-label="机器人指令"
          className="mx-3 mb-1.5 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-lg overflow-hidden divide-y divide-[var(--dl-border)]/50 max-h-52 overflow-y-auto z-20"
        >
          {visibleBotCommands.map((cmd, index) => (
            <button
              key={`${cmd.botId || "b"}_${cmd.command}`}
              id={`${menuId}-${index}`}
              role="option"
              aria-selected={activeMenuIndex === index}
              data-autocomplete-index={index}
              type="button"
              tabIndex={-1}
              onPointerDown={(e) => e.preventDefault()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertBotCommand(cmd)}
              className={`w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left active:bg-[var(--dl-card)] ${activeMenuIndex === index ? "bg-[var(--dl-accent-soft)]" : ""}`}
            >
              <span className="font-mono text-[13px] font-semibold text-[var(--dl-accent)]">
                {cmd.command.startsWith("/") ? cmd.command : `/${cmd.command}`}
              </span>
              <span className="text-[12px] text-[var(--dl-text-muted)] truncate">
                {cmd.description}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Huge Paste -> .txt Attachment Prompt Banner */}
      {hugePaste && (
        <div
          data-testid="huge-paste-banner"
          className="px-3.5 py-2.5 bg-[var(--dl-surface)] border-t border-[var(--dl-border)] flex items-center justify-between gap-2 shrink-0"
        >
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <FileText size={16} className="text-[var(--dl-accent)] shrink-0" />
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-[var(--dl-text)] truncate">
                检测到长文本粘贴（{hugePaste.charCount.toLocaleString()} 字 ·{" "}
                {formatBytes(hugePaste.byteSize)}）
              </div>
              <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                建议转为 .txt 附件发送，保持群聊清晰易读
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                const text = hugePaste.text;
                setHugePaste(null);
                setDraft(conversationId, textValue + text, replyToId,
                  reconcileComposerMentions(textValue, textValue + text, draft?.mentions || []));
              }}
              className="px-2.5 py-1.5 rounded-xl bg-[var(--dl-card)] text-[11.5px] font-medium text-[var(--dl-text-muted)]"
            >
              直接粘贴
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => void handleSendHugePasteAsTxt()}
              className="px-2.5 py-1.5 rounded-xl bg-[var(--dl-accent)] text-white text-[11.5px] font-semibold disabled:opacity-50"
            >
              转为 .txt 发送
            </button>
            <button
              type="button"
              aria-label="忽略长文本提示"
              onClick={() => setHugePaste(null)}
              className="p-1 text-[var(--dl-text-muted)]"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Feishu-Inspired Lightweight Reply / Edit Banner */}
      {(replyTarget || editingMsg) && (
        <div className="px-3.5 py-2 bg-[var(--dl-surface)] border-t border-[var(--dl-border)] flex items-center justify-between gap-2 shrink-0 overflow-hidden">
          <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
            {editingMsg ? (
              <Edit3 size={14} className="text-[var(--dl-accent)] shrink-0" />
            ) : (
              <Reply size={14} className="text-[var(--dl-text-muted)] shrink-0" />
            )}
            <span
              aria-hidden="true"
              className="h-3.5 w-[2px] shrink-0 rounded-full bg-[var(--dl-text-muted)]/40"
            />
            <div className="min-w-0 flex-1 truncate text-[12.5px] leading-snug text-[var(--dl-text-muted)]">
              <span className="font-medium text-[var(--dl-text)]/80">
                {editingMsg
                  ? "编辑消息："
                  : `回复 ${
                      replyTarget
                        ? members[replyTarget.senderId]?.displayName || replyTarget.senderName
                        : ""
                    }：`}
              </span>
              <span>
                {(editingMsg ? editingMsg.plainText : replyTarget?.plainText) || "[媒体消息]"}
              </span>
            </div>
          </div>
          <button
            type="button"
            tabIndex={-1}
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (editingMsg) {
                setEditingMessageId(null);
                setDraft(conversationId, "", "");
              } else {
                setDraft(conversationId, textValue, "");
              }
            }}
            className="p-1 text-[var(--dl-text-muted)] shrink-0"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {statusTypers.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="composer-typing-status"
          className="min-h-7 px-4 py-1 flex items-center gap-2 text-[12px] text-[var(--dl-accent)] shrink-0"
        >
          <span aria-hidden="true" className="inline-flex items-center gap-1 shrink-0">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className={`w-1 h-1 rounded-full bg-current ${reducedMotion ? "" : "animate-bounce motion-reduce:animate-none"}`}
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </span>
          <span className="truncate">{typingStatus}</span>
        </div>
      )}

      {/* Bottom Composer Bar */}
      <div
        className={`bg-[var(--dl-surface)] border-t border-[var(--dl-border)] px-2 py-2 flex items-end gap-1.5 shrink-0 ${
          stickerOpen ? "" : "pb-[calc(var(--safe-bottom)+8px)]"
        }`}
      >
        <button
          type="button"
          disabled={uploading}
          onClick={() => setAttachSheetOpen(true)}
          aria-label="发送图片或文件"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text-muted)] active:bg-[var(--dl-card)] shrink-0"
        >
          <Paperclip size={20} />
        </button>

        {/* Slash button ONLY shown when bot is in conversation */}
        {isBotConversation && botCommands.length > 0 && (
          <button
            type="button"
            onClick={() => setSlashOpen((v) => !v)}
            aria-label="机器人指令"
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
              slashOpen
                ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
                : "text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
            }`}
          >
            <Slash size={18} />
          </button>
        )}

        <div className="relative flex-1 min-w-0 flex items-center">
          {!textValue && !isComposingIme && (
            <span
              aria-hidden="true"
              data-testid="composer-single-line-watermark"
              className="pointer-events-none absolute inset-y-0 left-3.5 right-3.5 flex items-center truncate text-[15px] text-[var(--dl-text-muted)] select-none"
            >
              {uploading ? "正在上传附件…" : `发送消息到 ${displayConvTitle}…`}
            </span>
          )}
          <textarea
            ref={textareaRef}
            rows={1}
            enterKeyHint="send"
            role="combobox"
            aria-label="消息输入框"
            aria-autocomplete="list"
            aria-expanded={menuCount > 0}
            aria-controls={menuCount > 0 ? menuId : undefined}
            aria-activedescendant={menuCount > 0 ? `${menuId}-${activeMenuIndex}` : undefined}
            value={textValue}
            onFocus={() => setStickerOpen(false)}
            onCompositionStart={() => setIsComposingIme(true)}
            onCompositionEnd={() => setIsComposingIme(false)}
            onPaste={handlePaste}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              const composing = isComposingIme || e.nativeEvent.isComposing || e.keyCode === 229;
              const action = chatAutocompleteKeyAction({
                key: e.key, shiftKey: e.shiftKey, isComposing: composing, keyCode: e.keyCode,
              }, menuCount);
              if (action) {
                e.preventDefault();
                if (action === "next" || action === "previous") {
                  setMenuSelection({ key: menuKey, index: (activeMenuIndex + (action === "next" ? 1 : -1) + menuCount) % menuCount });
                } else if (action === "dismiss") {
                  setDismissedMentionText(textValue);
                  setSlashOpen(false);
                } else if (mentionMenuVisible) {
                  const selected = mentionCandidates[activeMenuIndex];
                  if (selected) insertMention(selected.id, selected.displayName);
                } else {
                  const selected = visibleBotCommands[activeMenuIndex];
                  if (selected) insertBotCommand(selected);
                }
                return;
              }
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !composing
              ) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={uploading ? "正在上传附件…" : `发送消息到 ${displayConvTitle}…`}
            className="w-full max-h-28 py-2 px-3.5 rounded-2xl bg-[var(--dl-card)] text-[15px] text-[var(--dl-text)] placeholder:text-transparent outline-none resize-none leading-snug"
          />
        </div>

        <button
          type="button"
          onClick={() => setStickerOpen((v) => !v)}
          aria-label="表情与贴纸"
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors duration-150 ${
            stickerOpen
              ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
              : "text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
          }`}
        >
          <Smile size={21} />
        </button>

        <button
          type="button"
          tabIndex={-1}
          aria-disabled={!textValue.trim() || uploading}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void handleSend()}
          aria-label="发送消息"
          className={`w-9 h-9 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center shrink-0 transition-transform duration-150 ${
            !textValue.trim() || uploading
              ? "opacity-40 pointer-events-none"
              : "active:scale-95"
          }`}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Expandable Sticker & Emoji Drawer */}
      <StickerDrawer
        open={stickerOpen}
        conversationId={conversationId}
        onInsertToken={(tok) => setDraft(conversationId, textValue + tok, replyToId,
          reconcileComposerMentions(textValue, textValue + tok, draft?.mentions || []))}
        onSendBuiltInSticker={(tok) => {
          void sendWorkspaceMessage(conversationId, tok, replyToId);
        }}
      />

      {/* Photo / File Attach Sheet */}
      <BottomSheet
        open={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        title="发送附件"
      >
        <div className="p-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => void handleUploadPick("image")}
            className="p-4 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-2 active:scale-[0.98]"
          >
            <ImageIcon size={24} className="text-[var(--dl-accent)]" />
            <span className="text-[14px] font-medium text-[var(--dl-text)]">相册图片</span>
          </button>
          <button
            type="button"
            onClick={() => void handleUploadPick("file")}
            className="p-4 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-2 active:scale-[0.98]"
          >
            <Paperclip size={24} className="text-[var(--dl-accent)]" />
            <span className="text-[14px] font-medium text-[var(--dl-text)]">本地文件</span>
          </button>
        </div>
      </BottomSheet>

      {/* Telegram / Feishu Message Bottom Action Sheet */}
      <BottomSheet
        open={Boolean(actionMsg)}
        onClose={() => setActionMessageId(null)}
      >
        {actionMsg && (
          <div className="p-3 space-y-2">
            {/* Quick Emoji Reactions Bar */}
            <div className="px-2 py-2 rounded-2xl bg-[var(--dl-card)] flex items-center justify-around">
              {QUICK_REACTIONS.map((em) => (
                <button
                  key={em}
                  type="button"
                  onClick={() => {
                    void toggleReaction(conversationId, actionMsg.id, em);
                    setActionMessageId(null);
                  }}
                  className="text-[24px] active:scale-125 transition"
                >
                  {em}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  startReplyToMessage(actionMsg);
                  setActionMessageId(null);
                }}
                className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
              >
                <Reply size={18} />
                <span>回复</span>
              </button>

              <button
                type="button"
                onClick={() => setThreadRootId(actionMsg.threadRootId || actionMsg.id)}
                className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
              >
                <MessageSquareText size={18} />
                <span>话题</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  nativeBridge.copyText(actionMsg.plainText);
                  setActionMessageId(null);
                  showToast("已复制消息文本", "success");
                }}
                className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
              >
                <Copy size={18} />
                <span>复制</span>
              </button>

              <button
                type="button"
                onClick={() => setForwardingMessageIds([actionMsg.id])}
                className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
              >
                <Forward size={18} />
                <span>转发</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  void togglePinMessage(conversationId, actionMsg.id);
                  setActionMessageId(null);
                }}
                className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
              >
                <Pin size={18} />
                <span>
                  {conv.pinnedMessageIds.includes(actionMsg.id) ? "取消置顶" : "置顶"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLocalMessageCollapsed(actionMsg.id, !actionMsgCollapsed);
                  setActionMessageId(null);
                }}
                className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
              >
                {actionMsgCollapsed ? <Eye size={18} /> : <EyeOff size={18} />}
                <span>{actionMsgCollapsed ? "在本机展开" : "在本机折叠"}</span>
              </button>

              {(() => {
                const fav = getFavoriteInputForMsg(actionMsg);
                if (!fav) return null;
                return (
                  <button
                    key="fav"
                    type="button"
                    onClick={async () => {
                      setActionMessageId(null);
                      try {
                        await favoriteFromMessage(fav);
                        showToast("已添加到收藏表情", "success");
                      } catch {
                        showToast("收藏表情失败", "warning");
                      }
                    }}
                    className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-accent)]"
                  >
                    <Star size={18} />
                    <span>存为表情</span>
                  </button>
                );
              })()}

              {actionMsg.senderId === currentUser?.id && !actionMsg.attachments?.length && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingMessageId(actionMsg.id);
                    setDraft(conversationId, actionMsg.plainText, "");
                    setActionMessageId(null);
                    setTimeout(() => textareaRef.current?.focus(), 60);
                  }}
                  className="p-3 rounded-2xl bg-[var(--dl-card)] flex flex-col items-center gap-1.5 text-[12px] font-medium text-[var(--dl-text)]"
                >
                  <Edit3 size={18} />
                  <span>编辑</span>
                </button>
              )}

              {actionMsg.senderId === currentUser?.id && (
                <button
                  type="button"
                  onClick={() => {
                    void recallWorkspaceMessage(conversationId, actionMsg.id);
                    setActionMessageId(null);
                  }}
                  className="p-3 rounded-2xl bg-rose-500/12 flex flex-col items-center gap-1.5 text-[12px] font-medium text-rose-500"
                >
                  <RotateCcw size={18} />
                  <span>撤回</span>
                </button>
              )}
            </div>
          </div>
        )}
      </BottomSheet>

      {/* Active Conversation Topics Directory Sheet (Feishu Topic List) */}
      <BottomSheet
        open={topicsSheetOpen}
        onClose={() => setTopicsSheetOpen(false)}
        title="本会话话题讨论"
        subtitle="点击任意话题查看讨论串并参与回复"
        maxHeight="80dvh"
      >
        {(() => {
          const localTopics = messages
            .filter((m) => !m.recalledAt && (m.threadReplyCount || 0) > 0)
            .map((m) => {
              const lastPrev =
                m.threadPreviewReplies && m.threadPreviewReplies.length > 0
                  ? m.threadPreviewReplies[m.threadPreviewReplies.length - 1]
                  : undefined;
              return {
                rootMessageId: m.id,
                threadTitle: m.threadTitle,
                rootAuthorName: m.senderName,
                rootPlainText: m.plainText || "[富媒体消息]",
                replyCount: m.threadReplyCount || 0,
                lastRepliedAt: m.threadLastRepliedAt || lastPrev?.createdAt || m.createdAt,
                lastAuthorName: lastPrev?.authorName || "",
                lastPlainText: lastPrev?.plainText || "",
              };
            });
          const byRoot = new Map(localTopics.map((t) => [t.rootMessageId, t]));
          for (const rt of remoteThreads) {
            if (!byRoot.has(rt.rootMessageId)) {
              byRoot.set(rt.rootMessageId, { ...rt, threadTitle: rt.threadTitle });
            }
          }
          const mergedTopics = Array.from(byRoot.values()).sort(
            (a, b) => Date.parse(b.lastRepliedAt) - Date.parse(a.lastRepliedAt)
          );

          return (
            <div className="p-4 space-y-2.5">
              {mergedTopics.length === 0 ? (
                <div className="py-10 text-center text-[13px] text-[var(--dl-text-muted)]">
                  本会话暂无活跃话题。长按任意消息选择「话题」即可开启串消息讨论。
                </div>
              ) : (
                mergedTopics.map((topic) => (
                  <button
                    key={topic.rootMessageId}
                    type="button"
                    onClick={() => {
                      setTopicsSheetOpen(false);
                      setThreadRootId(topic.rootMessageId);
                    }}
                    className="w-full p-3.5 rounded-2xl bg-[var(--dl-card)] text-left space-y-1.5 active:opacity-85 transition-opacity duration-150"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[14px] font-semibold text-[var(--dl-text)]">
                        {topic.threadTitle || `${topic.rootAuthorName}: ${topic.rootPlainText}`}
                      </span>
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[11px] font-semibold tabular-nums">
                        {topic.replyCount} 条回复
                      </span>
                    </div>
                    {topic.lastPlainText && (
                      <div className="truncate text-[12px] text-[var(--dl-text-muted)] border-l-2 border-[var(--dl-accent)]/40 pl-2">
                        <span className="font-medium text-[var(--dl-text)]">
                          {topic.lastAuthorName ? `${topic.lastAuthorName}: ` : ""}
                        </span>
                        <span>{topic.lastPlainText}</span>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          );
        })()}
      </BottomSheet>
    </div>
  );
}
