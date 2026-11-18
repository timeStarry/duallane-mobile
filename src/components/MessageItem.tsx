import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Eye,
  FileText,
  Image as ImageIcon,
  MessageSquareText,
  Package,
  Reply,
  Smile,
} from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import {
  extractPackShareIdFromText,
  formatConversationPreviewText,
  getBuiltInEmote,
  isSingleBuiltInSticker,
  ReactionGlyph,
  resolveAssetUrl,
} from "@/shared/emotes";
import { formatBytes, formatMessageClock } from "@/shared/format";
import { ChatMarkdown, type MarkdownMentionTarget } from "@/shared/markdown";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import {
  useWorkspaceStore,
  type CollapsePreferences,
  type V1Message,
} from "@/store/workspace-store";
import { Avatar } from "./Avatar";
import { CardKitView } from "./CardKitView";
import { WorkspaceCardView } from "./WorkspaceCardView";

export function isLongChatMessageText(text: string): boolean {
  if (!text) return false;
  const lineCount = text.replace(/\r\n/g, "\n").split("\n").length;
  return lineCount > 12 || text.length > 720;
}

export function isMessageEffectivelyCollapsed(
  msg: V1Message,
  collapsePrefs: CollapsePreferences,
  overrides: Record<string, boolean>
): boolean {
  const manual = overrides[msg.id];
  if (typeof manual === "boolean") return manual;

  const emojiBlock =
    msg.blocks?.length === 1 && msg.blocks[0].type === "emoji" ? msg.blocks[0] : null;
  const isSticker = Boolean(
    !msg.attachments?.length &&
      (emojiBlock || isSingleBuiltInSticker(msg.plainText))
  );
  if (isSticker && collapsePrefs.collapseStickers) return true;

  const hasImages = (msg.attachments || []).some((a) => a.mimeType.startsWith("image/"));
  if (hasImages && collapsePrefs.collapseImages) return true;

  if (collapsePrefs.collapseLongMessages && isLongChatMessageText(msg.plainText)) {
    return true;
  }
  return false;
}

function DeliveryStatusIcon({
  status,
  frameless = false,
  external = false,
}: {
  status?: V1Message["status"];
  frameless?: boolean;
  external?: boolean;
}) {
  if (external) {
    if (status === "sending") {
      return <Clock size={12} className="text-[var(--dl-text-muted)] opacity-75" />;
    }
    if (status === "failed") {
      return <AlertCircle size={13} className="text-rose-500" />;
    }
    if (status === "read") {
      return <CheckCheck size={14} className="text-[var(--dl-accent)]" />;
    }
    return <Check size={13} className="text-[var(--dl-text-muted)] opacity-80" />;
  }
  const mutedCls = frameless ? "text-white/90" : "opacity-80";
  if (status === "sending") return <Clock size={12} className={mutedCls} />;
  if (status === "failed") return <AlertCircle size={13} className="text-rose-400" />;
  if (status === "read") {
    return <CheckCheck size={14} className={frameless ? "text-sky-300" : "opacity-95"} />;
  }
  return <Check size={13} className={mutedCls} />;
}

export function MessageItem({
  msg,
  isOwn,
  isGroup,
  senderColor,
  replyTarget,
  highlighted,
  groupedWithPrev = false,
  groupedWithNext = false,
  onQuickReply,
  onMentionSender,
  onJumpToMessage,
}: {
  msg: V1Message;
  isOwn: boolean;
  isGroup: boolean;
  senderColor?: string;
  replyTarget?: V1Message;
  highlighted?: boolean;
  groupedWithPrev?: boolean;
  groupedWithNext?: boolean;
  onQuickReply: (msg: V1Message) => void;
  onMentionSender: (userId: string, displayName: string) => void;
  onJumpToMessage?: (messageId: string) => void;
}) {
  const customSrcMap = useEmoteStore((s) => s.customSrcMap);
  const members = useWorkspaceStore((s) => s.members);
  const recalledDrafts = useWorkspaceStore((s) => s.recalledDrafts);
  const collapsePrefs = useWorkspaceStore((s) => s.collapsePrefs);
  const manualOverride = useWorkspaceStore((s) => s.messageCollapseOverrides[msg.id]);
  const setLocalMessageCollapsed = useWorkspaceStore((s) => s.setLocalMessageCollapsed);
  const restoreRecalledDraft = useWorkspaceStore((s) => s.restoreRecalledDraft);
  const toggleReaction = useWorkspaceStore((s) => s.toggleReaction);
  const setActionMessageId = useNavStore((s) => s.setActionMessageId);
  const setThreadRootId = useNavStore((s) => s.setThreadRootId);
  const setSharedPackId = useNavStore((s) => s.setSharedPackId);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);

  // Touch gestures: long-press for action sheet, swipe-left for reply, tap for Feishu-style time reveal
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [showTime, setShowTime] = useState(false);
  const [mediaExpandedSession, setMediaExpandedSession] = useState(false);
  const [longTextExpanded, setLongTextExpanded] = useState(false);

  const touchState = useRef<{
    startX: number;
    startY: number;
    triggeredHaptic: boolean;
    longPressTimer: ReturnType<typeof setTimeout> | null;
  }>({ startX: 0, startY: 0, triggeredHaptic: false, longPressTimer: null });

  const clearLongPress = () => {
    if (touchState.current.longPressTimer) {
      clearTimeout(touchState.current.longPressTimer);
      touchState.current.longPressTimer = null;
    }
  };

  const { markdownSource, mentionTargets } = useMemo(() => {
    const targets: MarkdownMentionTarget[] = [];
    if (msg.blocks && msg.blocks.length > 0) {
      let rebuilt = "";
      for (const b of msg.blocks) {
        if (b.type === "text") {
          rebuilt += b.text;
        } else if (b.type === "mention") {
          const resolved =
            b.userId === "all" || b.label === "所有人"
              ? "所有人"
              : members[b.userId]?.displayName ||
                (b.label.startsWith("__duallane_") ? "机器人" : b.label);
          targets.push({ userId: b.userId, label: resolved });
          rebuilt += `@${resolved}`;
        } else if (b.type === "link") {
          rebuilt += b.label && b.label !== b.url ? `[${b.label}](${b.url})` : b.url;
        } else if (b.type === "emoji" && msg.blocks.length > 1) {
          rebuilt += `[${b.shortcode}]`;
        }
      }
      if (rebuilt.trim()) {
        return { markdownSource: rebuilt, mentionTargets: targets };
      }
    }
    return { markdownSource: msg.plainText, mentionTargets: targets };
  }, [msg.blocks, msg.plainText, members]);

  if (msg.kind === "system") {
    return (
      <div className="my-2 flex justify-center px-6">
        <span className="px-3 py-1 rounded-full text-[11px] text-[var(--dl-text-muted)] bg-[var(--dl-card)]/80 border border-[var(--dl-border)]/60 text-center">
          {msg.plainText}
        </span>
      </div>
    );
  }

  if (msg.recalledAt) {
    const canReEdit = isOwn && Boolean(recalledDrafts[msg.id]);
    return (
      <div className="my-2 flex justify-center items-center gap-2 px-6 text-[12px] text-[var(--dl-text-muted)]">
        <span>{isOwn ? "你撤回了一条消息" : `${msg.senderName} 撤回了一条消息`}</span>
        {canReEdit && (
          <button
            type="button"
            onClick={() => restoreRecalledDraft(msg.conversationId, msg.id)}
            className="text-[var(--dl-accent)] font-medium active:opacity-70"
          >
            重新编辑
          </button>
        )}
      </div>
    );
  }

  // Inspect blocks for standalone sticker / pack share / single frameless image
  const emojiBlock =
    msg.blocks?.length === 1 && msg.blocks[0].type === "emoji" ? msg.blocks[0] : null;
  const builtInSticker = !msg.attachments?.length
    ? emojiBlock && !emojiBlock.shortcode.startsWith("custom:")
      ? getBuiltInEmote(emojiBlock.shortcode) || null
      : isSingleBuiltInSticker(msg.plainText)
    : null;
  const customStickerId =
    emojiBlock && emojiBlock.shortcode.startsWith("custom:")
      ? emojiBlock.shortcode.slice("custom:".length)
      : null;
  const customStickerSrc = customStickerId
    ? customSrcMap[customStickerId] ||
      `/api/workspace/emotes/${encodeURIComponent(customStickerId)}/content`
    : null;

  const packShareBlock = msg.blocks?.find((b) => b.type === "emote_collection");
  const packShareId =
    (packShareBlock?.type === "emote_collection" ? packShareBlock.shareId : null) ||
    extractPackShareIdFromText(msg.plainText);

  const imageAttachments = (msg.attachments || []).filter((a) => a.mimeType.startsWith("image/"));
  const fileAttachments = (msg.attachments || []).filter((a) => !a.mimeType.startsWith("image/"));

  const hasCaptionText = Boolean(
    msg.plainText &&
      msg.plainText !== "[文件]" &&
      msg.plainText !== "[表情]" &&
      !msg.plainText.startsWith("[附件]") &&
      !builtInSticker &&
      !customStickerId &&
      !packShareId
  );

  const isFramelessSticker = Boolean(
    (builtInSticker || customStickerSrc) && !msg.replyToId && !msg.card && !fileAttachments.length
  );
  const isFramelessSingleImage = Boolean(
    imageAttachments.length === 1 &&
      fileAttachments.length === 0 &&
      !hasCaptionText &&
      !msg.replyToId &&
      !msg.card
  );

  // Collapse logic (A1: Boss-Key Auto-Hide + Local Per-Message Collapse)
  const manuallyCollapsed = manualOverride === true;
  const manuallyExpanded = manualOverride === false;

  const stickerCollapsed =
    manuallyCollapsed ||
    (!manuallyExpanded &&
      !mediaExpandedSession &&
      collapsePrefs.collapseStickers &&
      Boolean(builtInSticker || customStickerSrc));

  const imagesCollapsed =
    manuallyCollapsed ||
    (!manuallyExpanded &&
      !mediaExpandedSession &&
      collapsePrefs.collapseImages &&
      imageAttachments.length > 0);

  const isLongText = hasCaptionText && isLongChatMessageText(markdownSource);
  const shouldClampLongText =
    !manuallyExpanded &&
    !longTextExpanded &&
    collapsePrefs.collapseLongMessages &&
    isLongText;

  const isWholeCapsuleCollapsed =
    manuallyCollapsed ||
    (isFramelessSticker && stickerCollapsed) ||
    (isFramelessSingleImage && imagesCollapsed);

  const isFrameless = !isWholeCapsuleCollapsed && (isFramelessSticker || isFramelessSingleImage);

  const handleExpandCollapsedCapsule = (ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (manuallyCollapsed) {
      setLocalMessageCollapsed(msg.id, false);
    }
    setMediaExpandedSession(true);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchState.current.startX = t.clientX;
    touchState.current.startY = t.clientY;
    touchState.current.triggeredHaptic = false;
    clearLongPress();
    touchState.current.longPressTimer = setTimeout(() => {
      setActionMessageId(msg.id);
    }, 420);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - touchState.current.startX;
    const dy = t.clientY - touchState.current.startY;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      clearLongPress();
    }
    if (dx < -10 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      const clamped = Math.max(-64, dx);
      setSwipeOffset(clamped);
      if (clamped <= -48 && !touchState.current.triggeredHaptic) {
        touchState.current.triggeredHaptic = true;
        nativeBridge.haptic("medium");
      }
    }
  };

  const handleTouchEnd = () => {
    clearLongPress();
    if (swipeOffset <= -48) {
      onQuickReply(msg);
    }
    if (swipeOffset !== 0) {
      setSwipeOffset(0);
    }
  };

  const reactionEntries = Object.entries(msg.reactions || {}).filter(([, v]) => v.count > 0);
  const clockStr = formatMessageClock(msg.createdAt);

  const bubbleRadiusCls = isOwn
    ? groupedWithPrev
      ? "rounded-[18px] rounded-tr-[6px] rounded-br-[6px]"
      : "rounded-[18px] rounded-br-[6px]"
    : groupedWithPrev
    ? "rounded-[18px] rounded-tl-[6px] rounded-bl-[6px]"
    : "rounded-[18px] rounded-bl-[6px]";

  const wholeCapsuleLabel =
    builtInSticker || customStickerSrc
      ? "[贴纸 · 点击展开]"
      : imageAttachments.length > 0 && !hasCaptionText
      ? "[图片 · 点击展开]"
      : "[消息已折叠 · 点击展开]";

  return (
    <div
      id={`msg-${msg.id}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onContextMenu={(e) => {
        e.preventDefault();
        setActionMessageId(msg.id);
      }}
      style={{
        transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined,
        transition: swipeOffset ? "none" : "transform 180ms cubic-bezier(0.16,1,0.3,1)",
      }}
      className={`relative flex w-full max-w-full min-w-0 gap-2.5 px-3 select-none ${
        groupedWithPrev ? "pt-0.5" : "pt-1.5"
      } ${groupedWithNext ? "pb-0.5" : "pb-1.5"} ${
        isOwn ? "flex-row-reverse" : "flex-row"
      } ${highlighted ? "bg-[var(--dl-accent-soft)] rounded-2xl transition-colors" : ""}`}
    >
      {/* Swipe-to-reply indicator */}
      {swipeOffset < -14 && (
        <div
          style={{ opacity: Math.min(1, Math.abs(swipeOffset) / 48) }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-[var(--dl-card)] border border-[var(--dl-border)] flex items-center justify-center text-[var(--dl-accent)]"
        >
          <Reply size={14} />
        </div>
      )}

      {/* Feishu-style Peer Avatar on first message of burst, or timestamp gutter on follow-ups */}
      {!isOwn &&
        (!groupedWithPrev ? (
          <button
            type="button"
            onClick={() => isGroup && onMentionSender(msg.senderId, msg.senderName)}
            className="self-start mt-0.5 shrink-0"
          >
            <Avatar
              name={msg.senderName}
              src={msg.senderAvatarUrl}
              kind={msg.kind === "bot" ? "bot" : "user"}
              color={senderColor}
              size={34}
            />
          </button>
        ) : (
          <div className="w-[34px] shrink-0 self-center flex items-center justify-end pr-0.5">
            {showTime && (
              <span className="text-[10px] font-medium tabular-nums text-[var(--dl-text-muted)] leading-none">
                {clockStr}
              </span>
            )}
          </div>
        ))}

      <div
        className={`flex flex-col min-w-0 max-w-[78%] ${
          isOwn ? "items-end" : "items-start"
        }`}
      >
        {/* Group sender name + Feishu-style @ quick mention badge + first-message inline time */}
        {!isOwn && isGroup && !groupedWithPrev && (
          <div className="flex items-center gap-1.5 mb-1 pl-0.5 max-w-full min-w-0">
            <span className="text-[12px] font-medium text-[var(--dl-text-muted)] truncate max-w-[150px]">
              {members[msg.senderId]?.displayName || msg.senderName}
            </span>
            {msg.kind === "bot" && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] shrink-0">
                BOT
              </span>
            )}
            <button
              type="button"
              onClick={() =>
                onMentionSender(
                  msg.senderId,
                  members[msg.senderId]?.displayName || msg.senderName
                )
              }
              aria-label={`提及 ${members[msg.senderId]?.displayName || msg.senderName}`}
              className="px-1.5 py-0.2 rounded-full text-[11px] font-medium text-[var(--dl-accent)] bg-[var(--dl-accent-soft)] active:scale-95 shrink-0"
            >
              @TA
            </button>
            <span className="text-[10px] tabular-nums text-[var(--dl-text-muted)]/80 shrink-0">
              {clockStr}
            </span>
          </div>
        )}

        {/* First message top timestamp on tap in 1-on-1 DM or own message */}
        {showTime && (!groupedWithPrev && (!isGroup || isOwn)) && (
          <div className="mb-0.5 px-1 text-[10px] tabular-nums text-[var(--dl-text-muted)]">
            {clockStr}
          </div>
        )}

        {/* COLLAPSED CAPSULE (Auto-Hide / Boss-Key / Local Collapse) */}
        {isWholeCapsuleCollapsed ? (
          <div className="flex items-end gap-1.5 min-w-0 max-w-full">
            {isOwn && (
              <span className="shrink-0 mb-1 flex items-center gap-1">
                <DeliveryStatusIcon status={msg.status} external />
              </span>
            )}
            <button
              type="button"
              onClick={handleExpandCollapsedCapsule}
              className="px-3 py-1.5 rounded-full border border-dashed border-[var(--dl-border)] bg-[var(--dl-surface)] text-[12.5px] font-medium text-[var(--dl-text-muted)] flex items-center gap-1.5 active:scale-95 transition"
            >
              {builtInSticker || customStickerSrc ? (
                <Smile size={14} className="text-[var(--dl-accent)] shrink-0" />
              ) : imageAttachments.length > 0 ? (
                <ImageIcon size={14} className="text-[var(--dl-accent)] shrink-0" />
              ) : (
                <Eye size={14} className="text-[var(--dl-accent)] shrink-0" />
              )}
              <span>{wholeCapsuleLabel}</span>
            </button>
          </div>
        ) : isFrameless ? (
          /* FRAMELESS STANDALONE STICKER OR SINGLE IMAGE */
          <div className="relative inline-block max-w-full group">
            {isFramelessSticker ? (
              <img
                src={resolveAssetUrl(builtInSticker?.src || customStickerSrc || "")}
                alt={builtInSticker?.label || "贴纸"}
                onClick={() =>
                  setLightboxMedia({
                    src: resolveAssetUrl(builtInSticker?.src || customStickerSrc || ""),
                    title: builtInSticker?.label || "贴纸",
                    favoriteInput: {
                      messageId: msg.id,
                      ...(customStickerId ? { customEmoteId: customStickerId } : {}),
                      ...(builtInSticker
                        ? { emoteKey: `${builtInSticker.packId}:${builtInSticker.id}` }
                        : {}),
                    },
                  })
                }
                className="w-32 h-32 max-w-full object-contain drop-shadow-sm active:scale-[0.98] transition"
              />
            ) : (
              <img
                src={resolveAssetUrl(imageAttachments[0].url)}
                alt={imageAttachments[0].fileName}
                onClick={() =>
                  setLightboxMedia({
                    src: resolveAssetUrl(imageAttachments[0].url),
                    title: imageAttachments[0].fileName,
                    downloadUrl: resolveAssetUrl(
                      imageAttachments[0].downloadUrl || imageAttachments[0].url
                    ),
                    favoriteInput: {
                      messageId: msg.id,
                      attachmentId: imageAttachments[0].id,
                    },
                  })
                }
                className="max-w-[min(240px,100%)] max-h-[300px] rounded-2xl object-cover shadow-sm active:opacity-95"
              />
            )}
            <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-xs text-white text-[10px] flex items-center gap-1">
              <span>{clockStr}</span>
              {isOwn && <DeliveryStatusIcon status={msg.status} frameless />}
            </div>
          </div>
        ) : packShareId ? (
          /* STICKER PACK SHARE CARD */
          <div className="flex items-end gap-1.5 min-w-0 max-w-full">
            {isOwn && (
              <span className="shrink-0 mb-1 flex items-center gap-1">
                {showTime && groupedWithPrev && (
                  <span className="text-[10px] tabular-nums text-[var(--dl-text-muted)]">
                    {clockStr}
                  </span>
                )}
                <DeliveryStatusIcon status={msg.status} external />
              </span>
            )}
            <button
              type="button"
              onClick={() => setSharedPackId(packShareId)}
              className="w-[244px] max-w-full overflow-hidden text-left rounded-2xl border border-[var(--dl-border)] bg-[var(--dl-surface)] p-3 shadow-xs active:scale-[0.99] transition"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] flex items-center justify-center shrink-0">
                  <Package size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                    {packShareBlock?.type === "emote_collection" && packShareBlock.share?.name
                      ? packShareBlock.share.name
                      : msg.plainText.replace("[表情包]", "").trim() || "共享表情包"}
                  </div>
                  <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                    {packShareBlock?.type === "emote_collection" && packShareBlock.share?.itemCount
                      ? `共 ${packShareBlock.share.itemCount} 枚贴纸 · 点击预览添加`
                      : "点击预览并一键添加表情包"}
                  </div>
                </div>
              </div>
              {packShareBlock?.type === "emote_collection" &&
                packShareBlock.share?.covers &&
                packShareBlock.share.covers.length > 0 && (
                  <div className="mt-2.5 grid grid-cols-4 gap-1.5 bg-[var(--dl-card)] p-2 rounded-xl">
                    {packShareBlock.share.covers.slice(0, 4).map((cov) => (
                      <img
                        key={cov.id}
                        src={resolveAssetUrl(cov.src)}
                        alt={cov.label}
                        className="w-10 h-10 object-contain mx-auto"
                      />
                    ))}
                  </div>
                )}
            </button>
          </div>
        ) : (
          /* COMPACT FEISHU / TG STANDARD MESSAGE BUBBLE */
          <div className="flex items-end gap-1.5 min-w-0 max-w-full">
            {isOwn && (
              <span
                data-testid={`msg-status-${msg.id}`}
                className="shrink-0 mb-1 flex items-center gap-1"
              >
                {showTime && groupedWithPrev && (
                  <span className="text-[10px] tabular-nums text-[var(--dl-text-muted)]">
                    {clockStr}
                  </span>
                )}
                <DeliveryStatusIcon status={msg.status} external />
              </span>
            )}
            <div
              onClick={() => setShowTime((v) => !v)}
              className={`relative max-w-full min-w-0 overflow-hidden px-3.5 py-2 shadow-2xs [overflow-wrap:anywhere] break-words ${bubbleRadiusCls} ${
                isOwn
                  ? "bg-[var(--dl-bubble-own)] text-[var(--dl-bubble-own-text)]"
                  : "bg-[var(--dl-bubble-peer)] text-[var(--dl-text)] border border-[var(--dl-border)]"
              }`}
            >
              {/* Feishu-Inspired Lightweight DualLane Reply Quote */}
              {(replyTarget || msg.replyToId) && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    if (msg.replyToId) onJumpToMessage?.(msg.replyToId);
                  }}
                  onKeyDown={(ev) => {
                    if ((ev.key === "Enter" || ev.key === " ") && msg.replyToId) {
                      ev.preventDefault();
                      ev.stopPropagation();
                      onJumpToMessage?.(msg.replyToId);
                    }
                  }}
                  className={`mb-1.5 -mx-1 flex w-full max-w-full min-w-0 items-stretch gap-2 overflow-hidden rounded-md px-1 py-0.5 text-left transition ${
                    isOwn ? "active:bg-white/10" : "active:bg-black/5 dark:active:bg-white/5"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`my-[2.5px] w-[2px] shrink-0 rounded-full ${
                      isOwn ? "bg-white/45" : "bg-[var(--dl-text-muted)]/40"
                    }`}
                  />
                  <span
                    className={`min-w-0 flex-1 line-clamp-2 text-[12.5px] leading-[1.45] [overflow-wrap:anywhere] break-all ${
                      isOwn ? "text-white/78" : "text-[var(--dl-text-muted)]"
                    }`}
                  >
                    <span className={`font-medium ${isOwn ? "text-white/90" : "text-[var(--dl-text)]/80"}`}>
                      {replyTarget
                        ? `回复 ${members[replyTarget.senderId]?.displayName || replyTarget.senderName}：`
                        : "引用消息："}
                    </span>
                    <span>
                      {replyTarget
                        ? formatConversationPreviewText(replyTarget.plainText) || "[媒体消息]"
                        : "原消息已不在当前窗口"}
                    </span>
                  </span>
                </div>
              )}

              {/* Sticker inside replied bubble */}
              {(builtInSticker || customStickerSrc) && (
                <div className="mb-1">
                  {stickerCollapsed ? (
                    <button
                      type="button"
                      onClick={handleExpandCollapsedCapsule}
                      className={`px-2.5 py-1 rounded-full text-[12px] font-medium flex items-center gap-1 ${
                        isOwn ? "bg-black/20 text-white" : "bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
                      }`}
                    >
                      <Smile size={13} />
                      <span>[贴纸 · 点击展开]</span>
                    </button>
                  ) : (
                    <img
                      src={resolveAssetUrl(builtInSticker?.src || customStickerSrc || "")}
                      alt={builtInSticker?.label || "贴纸"}
                      className="w-24 h-24 object-contain"
                    />
                  )}
                </div>
              )}

              {/* Multi-image or captioned image grid */}
              {imageAttachments.length > 0 && (
                <div className="mb-1.5">
                  {imagesCollapsed ? (
                    <button
                      type="button"
                      onClick={handleExpandCollapsedCapsule}
                      className={`px-3 py-1.5 rounded-xl text-[12.5px] font-medium flex items-center gap-1.5 ${
                        isOwn
                          ? "bg-black/20 text-white"
                          : "bg-[var(--dl-card)] text-[var(--dl-text-muted)] border border-dashed border-[var(--dl-border)]"
                      }`}
                    >
                      <ImageIcon size={14} />
                      <span>
                        {imageAttachments.length > 1
                          ? `[图片 ×${imageAttachments.length} · 点击展开]`
                          : "[图片 · 点击展开]"}
                      </span>
                    </button>
                  ) : (
                    <div
                      className={`grid gap-1.5 ${
                        imageAttachments.length > 1 ? "grid-cols-2" : "grid-cols-1"
                      }`}
                    >
                      {imageAttachments.map((img) => (
                        <img
                          key={img.id}
                          src={resolveAssetUrl(img.url)}
                          alt={img.fileName}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setLightboxMedia({
                              src: resolveAssetUrl(img.url),
                              title: img.fileName,
                              downloadUrl: resolveAssetUrl(img.downloadUrl || img.url),
                              favoriteInput: { messageId: msg.id, attachmentId: img.id },
                            });
                          }}
                          className="max-h-48 w-full max-w-full rounded-xl object-cover"
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* File attachments */}
              {fileAttachments.length > 0 && (
                <div className="space-y-1.5 mb-1.5 max-w-full min-w-0">
                  {fileAttachments.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        nativeBridge.openExternalUrl(resolveAssetUrl(f.downloadUrl || f.url));
                      }}
                      className={`w-full max-w-full min-w-0 flex items-center gap-2.5 p-2 rounded-xl text-left overflow-hidden ${
                        isOwn ? "bg-black/15" : "bg-[var(--dl-card)]"
                      }`}
                    >
                      <FileText size={20} className="shrink-0 opacity-85" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium truncate">{f.fileName}</div>
                        <div className="text-[11px] opacity-75">{formatBytes(f.byteSize)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Rich Markdown & Auto-Link Body */}
              {hasCaptionText && (
                <div className="text-[15px] max-w-full min-w-0">
                  <div
                    className={
                      shouldClampLongText ? "max-h-[216px] overflow-hidden relative" : ""
                    }
                  >
                    <ChatMarkdown
                      text={markdownSource}
                      tone={isOwn ? "own" : "peer"}
                      lane="workspace"
                      mentions={mentionTargets}
                      onMentionClick={(uid, label) => {
                        if (uid === "all" && !isGroup) return;
                        onMentionSender(uid, label);
                      }}
                    />
                  </div>
                  {shouldClampLongText && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setLongTextExpanded(true);
                      }}
                      className={`mt-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold flex items-center gap-1 ${
                        isOwn
                          ? "bg-white/20 text-white"
                          : "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
                      }`}
                    >
                      <ChevronDown size={13} />
                      <span>展开全文</span>
                    </button>
                  )}
                  {!shouldClampLongText && longTextExpanded && isLongText && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setLongTextExpanded(false);
                      }}
                      className={`mt-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium flex items-center gap-1 ${
                        isOwn
                          ? "bg-white/15 text-white/90"
                          : "bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
                      }`}
                    >
                      <ChevronUp size={13} />
                      <span>收起长文</span>
                    </button>
                  )}
                  {msg.editedAt && (
                    <span className="mt-0.5 inline-block text-[11px] opacity-65 select-none">
                      (已编辑)
                    </span>
                  )}
                </div>
              )}

              {/* Interactive CardKit v1 */}
              {msg.card && <CardKitView card={msg.card} />}
              {!msg.recalledAt && msg.cardReferences?.map((reference) =>
                <WorkspaceCardView key={reference.cardId} reference={reference} />)}

              {!hasCaptionText && msg.editedAt && (
                <div className="mt-0.5 text-[11px] opacity-65 text-right select-none">(已编辑)</div>
              )}
            </div>
          </div>
        )}

        {/* Channel-forwarded thread reply backlink */}
        {msg.threadRootId && !msg.recalledAt && (
          <button
            type="button"
            onClick={() => setThreadRootId(msg.threadRootId!)}
            className="mt-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium text-[var(--dl-accent)] bg-[var(--dl-accent-soft)] inline-flex items-center gap-1 active:opacity-80"
          >
            <MessageSquareText size={11} className="shrink-0" />
            <span>源自话题讨论 · 查看话题</span>
            <ChevronRight size={11} className="shrink-0" />
          </button>
        )}

        {/* Reactions Row */}
        {reactionEntries.length > 0 && (
          <div
            className={`mt-1 flex flex-wrap gap-1 ${isOwn ? "justify-end" : "justify-start"}`}
          >
            {reactionEntries.map(([key, info]) => (
              <button
                key={key}
                type="button"
                onClick={() => void toggleReaction(msg.conversationId, msg.id, key)}
                className={`px-2 py-0.5 rounded-full text-[11px] flex items-center gap-1 border transition-transform duration-150 active:scale-95 tabular-nums ${
                  info.reactedByMe
                    ? "bg-[var(--dl-accent-soft)] border-[var(--dl-accent)] text-[var(--dl-accent)] font-semibold"
                    : "bg-[var(--dl-surface)] border-[var(--dl-border)] text-[var(--dl-text-muted)]"
                }`}
              >
                <ReactionGlyph emoteKey={key} customSrcMap={customSrcMap} />
                <span>{info.count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Feishu-Style Inline Topic Summary & Preview Card */}
        {(msg.threadReplyCount || 0) > 0 && (
          <button
            type="button"
            data-testid="feishu-inline-topic-card"
            onClick={() => setThreadRootId(msg.id)}
            className="mt-1.5 w-fit min-w-[196px] max-w-[min(320px,78vw)] rounded-xl border border-[var(--dl-accent)]/25 bg-[var(--dl-surface)]/95 px-2.5 py-2 text-left flex flex-col gap-1 shadow-2xs active:opacity-85 transition-opacity duration-150"
          >
            {(msg.threadPreviewReplies || []).length > 0 && (
              <div className="space-y-0.5 border-l-2 border-[var(--dl-accent)]/45 pl-2 w-full">
                {(msg.threadPreviewReplies || []).slice(-3).map((rep) => (
                  <div
                    key={rep.id}
                    className="truncate text-[11.5px] leading-snug text-[var(--dl-text-muted)]"
                  >
                    <span className="font-medium text-[var(--dl-text)]">
                      {rep.authorName}:{" "}
                    </span>
                    <span>{rep.plainText}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between gap-2 w-full text-[11px] font-medium text-[var(--dl-accent)]">
              <span className="inline-flex items-center gap-1 tabular-nums min-w-0">
                <MessageSquareText size={12} className="shrink-0" />
                <span className="shrink-0">{msg.threadReplyCount} 条话题回复</span>
                {msg.threadTitle && (
                  <span className="truncate text-[var(--dl-text-muted)] font-normal">
                    · {msg.threadTitle}
                  </span>
                )}
              </span>
              <span className="inline-flex items-center gap-0.5 text-[10.5px] opacity-85 shrink-0">
                <span>参与讨论</span>
                <ChevronRight size={12} />
              </span>
            </div>
          </button>
        )}
      </div>
    </div>
  );
}
