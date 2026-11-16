import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  Copy,
  Edit3,
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
import { MessageItem } from "@/components/MessageItem";
import { StickerDrawer } from "@/components/StickerDrawer";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type BotCommandSpec } from "@/shared/api";
import { isSingleBuiltInSticker } from "@/shared/emotes";
import { formatDateDivider, isSameCalendarDay } from "@/shared/format";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import {
  useWorkspaceStore,
  type TypingIndicatorEntry,
  type V1Message,
  type V1MessageAttachment,
} from "@/store/workspace-store";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "🔥", "👀"];
const EMPTY_MESSAGES: V1Message[] = [];
const EMPTY_TYPERS: TypingIndicatorEntry[] = [];

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

  const loadConversationMessages = useWorkspaceStore((s) => s.loadConversationMessages);
  const markRead = useWorkspaceStore((s) => s.markRead);
  const setDraft = useWorkspaceStore((s) => s.setDraft);
  const setEditingMessageId = useWorkspaceStore((s) => s.setEditingMessageId);
  const sendWorkspaceMessage = useWorkspaceStore((s) => s.sendWorkspaceMessage);
  const editWorkspaceMessage = useWorkspaceStore((s) => s.editWorkspaceMessage);
  const recallWorkspaceMessage = useWorkspaceStore((s) => s.recallWorkspaceMessage);
  const toggleReaction = useWorkspaceStore((s) => s.toggleReaction);
  const togglePinMessage = useWorkspaceStore((s) => s.togglePinMessage);

  const favoriteFromMessage = useEmoteStore((s) => s.favoriteFromMessage);

  const closeChat = useNavStore((s) => s.closeChat);
  const actionMessageId = useNavStore((s) => s.actionMessageId);
  const setActionMessageId = useNavStore((s) => s.setActionMessageId);
  const setThreadRootId = useNavStore((s) => s.setThreadRootId);
  const setChatDetailOpen = useNavStore((s) => s.setChatDetailOpen);
  const setForwardingMessageIds = useNavStore((s) => s.setForwardingMessageIds);
  const showToast = useNavStore((s) => s.showToast);

  const [stickerOpen, setStickerOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [botCommands, setBotCommands] = useState<BotCommandSpec[]>([]);
  const [slashOpen, setSlashOpen] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const pinnedConvRef = useRef<string>("");
  const nearBottomRef = useRef<boolean>(true);
  const prevTailMsgIdRef = useRef<string>("");

  const textValue = draft?.text || "";
  const replyToId = draft?.replyToMessageId;

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
    nearBottomRef.current = true;
    setShowScrollBottom(false);
    let cancelled = false;
    if (messages.length === 0) {
      setLoadingInitial(true);
    }
    void loadConversationMessages(conversationId).finally(() => {
      if (!cancelled) setLoadingInitial(false);
    });
    markRead(conversationId);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, loadConversationMessages, markRead]);

  useEffect(() => {
    if (!isBotConversation) {
      setBotCommands([]);
      return;
    }
    void mobileApi
      .listConversationBotCommands(conversationId)
      .then((res) => setBotCommands(res.commands || []))
      .catch(() => setBotCommands([]));
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
  ]);

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

  // Scroll to highlighted message when jumping from search or pin
  useEffect(() => {
    if (!highlightedMessageId) return;
    const target = document.getElementById(`msg-${highlightedMessageId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedMessageId]);

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

  // @Mention Candidate Detection
  const mentionQuery = useMemo(() => {
    if (!conv || conv.kind !== "group") return null;
    const m = textValue.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [conv, textValue]);

  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null || !conv) return [];
    return conv.memberIds
      .filter((uid) => uid !== currentUser?.id && Boolean(members[uid]))
      .map((uid) => members[uid])
      .filter((u) => u.displayName.toLowerCase().includes(mentionQuery))
      .slice(0, 6);
  }, [mentionQuery, conv, members, currentUser]);

  const insertMention = (userId: string, displayName: string) => {
    void userId;
    const replaced =
      mentionQuery !== null
        ? textValue.replace(/@([^\s@]*)$/, `@${displayName} `)
        : `${textValue}${textValue && !textValue.endsWith(" ") ? " " : ""}@${displayName} `;
    setDraft(conversationId, replaced, replyToId);
    textareaRef.current?.focus();
  };

  const handleTextChange = (val: string) => {
    setDraft(conversationId, val, replyToId);
    if (val.startsWith("/") && isBotConversation && botCommands.length > 0) {
      setSlashOpen(true);
    } else if (slashOpen && !val.startsWith("/")) {
      setSlashOpen(false);
    }
    const now = Date.now();
    if (val.trim() && now - lastTypingSentRef.current > 3200) {
      lastTypingSentRef.current = now;
      void mobileApi.sendConversationTyping(conversationId, "typing").catch(() => {});
    }
  };

  const handleSend = async () => {
    const trimmed = textValue.trim();
    if (!trimmed) return;
    nativeBridge.haptic("light");
    if (editingMsg) {
      setDraft(conversationId, "", "");
      await editWorkspaceMessage(conversationId, editingMsg.id, trimmed);
      return;
    }
    await sendWorkspaceMessage(conversationId, trimmed, replyToId);
  };

  const handleUploadPick = async (mode: "image" | "file") => {
    setAttachSheetOpen(false);
    const picked = await nativeBridge.pickMedia(mode, true);
    if (picked.length === 0) return;
    setUploading(true);
    try {
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
      await sendWorkspaceMessage(conversationId, textValue, replyToId, uploaded);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "上传文件失败", "danger");
    } finally {
      setUploading(false);
    }
  };

  if (!conv) return null;

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
              name={conv.title}
              src={conv.avatarUrl || directPeer?.avatarUrl}
              emoji={conv.avatarEmoji}
              kind={avatarKind}
              color={avatarKind === "bot" ? directPeer?.avatarColor : undefined}
              size={38}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold text-[var(--dl-text)] truncate">
                {conv.title}
              </div>
              <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                {typers.length > 0 ? (
                  <span className="text-[var(--dl-accent)] font-medium animate-pulse">
                    {typers[0].state === "thinking"
                      ? `${typers[0].displayName} 正在思考处理中…`
                      : `${typers[0].displayName} 正在输入…`}
                  </span>
                ) : conv.kind === "group" ? (
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
          nearBottomRef.current = dist < 140;
          setShowScrollBottom(dist > 360);
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
                    onQuickReply={(target) => {
                      setEditingMessageId(null);
                      setDraft(conversationId, textValue, target.id);
                      textareaRef.current?.focus();
                    }}
                    onMentionSender={insertMention}
                    onJumpToMessage={(targetId) => {
                      const el = document.getElementById(`msg-${targetId}`);
                      el?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  />
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => {
            nearBottomRef.current = true;
            setShowScrollBottom(false);
            if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
          }}
          aria-label="回到底部"
          className="absolute right-4 bottom-20 z-20 w-10 h-10 rounded-full bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-md flex items-center justify-center text-[var(--dl-text)] active:scale-95"
        >
          <ArrowDown size={18} />
        </button>
      )}

      {/* Floating @Mention Candidate Bar */}
      {mentionCandidates.length > 0 && (
        <div className="mx-3 mb-1.5 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-lg overflow-hidden divide-y divide-[var(--dl-border)]/50 max-h-48 overflow-y-auto z-20">
          {mentionCandidates.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => insertMention(u.id, u.displayName)}
              className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-left active:bg-[var(--dl-card)]"
            >
              <Avatar
                name={u.displayName}
                src={u.avatarUrl}
                kind={u.role === "bot" ? "bot" : "user"}
                color={u.avatarColor}
                size={28}
              />
              <span className="text-[14px] font-medium text-[var(--dl-text)] truncate">
                {u.displayName}
              </span>
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
      {slashOpen && isBotConversation && botCommands.length > 0 && (
        <div className="mx-3 mb-1.5 rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] shadow-lg overflow-hidden divide-y divide-[var(--dl-border)]/50 max-h-52 overflow-y-auto z-20">
          {botCommands.map((cmd) => (
            <button
              key={`${cmd.botId || "b"}_${cmd.command}`}
              type="button"
              onClick={() => {
                const token = cmd.command.startsWith("/") ? cmd.command : `/${cmd.command}`;
                setDraft(conversationId, `${token} `, replyToId);
                setSlashOpen(false);
                textareaRef.current?.focus();
              }}
              className="w-full px-3.5 py-2.5 flex items-center justify-between gap-3 text-left active:bg-[var(--dl-card)]"
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
                {editingMsg ? "编辑消息：" : `回复 ${replyTarget?.senderName}：`}
              </span>
              <span>
                {(editingMsg ? editingMsg.plainText : replyTarget?.plainText) || "[媒体消息]"}
              </span>
            </div>
          </div>
          <button
            type="button"
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

        <textarea
          ref={textareaRef}
          rows={1}
          value={textValue}
          onFocus={() => setStickerOpen(false)}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={uploading ? "正在上传附件…" : `发送消息到 ${conv.title}…`}
          className="flex-1 max-h-28 py-2 px-3.5 rounded-2xl bg-[var(--dl-card)] text-[15px] text-[var(--dl-text)] outline-none resize-none leading-snug"
        />

        <button
          type="button"
          onClick={() => setStickerOpen((v) => !v)}
          aria-label="表情与贴纸"
          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
            stickerOpen
              ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
              : "text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
          }`}
        >
          <Smile size={21} />
        </button>

        <button
          type="button"
          disabled={!textValue.trim() || uploading}
          onClick={() => void handleSend()}
          aria-label="发送消息"
          className="w-9 h-9 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center disabled:opacity-40 active:scale-95 transition shrink-0"
        >
          <Send size={16} />
        </button>
      </div>

      {/* Expandable Sticker & Emoji Drawer */}
      <StickerDrawer
        open={stickerOpen}
        conversationId={conversationId}
        onInsertToken={(tok) => setDraft(conversationId, textValue + tok, replyToId)}
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
                  setEditingMessageId(null);
                  setDraft(conversationId, textValue, actionMsg.id);
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
    </div>
  );
}
