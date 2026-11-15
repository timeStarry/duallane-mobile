import React, { useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  MessageSquareText,
  MoreHorizontal,
  Package,
  Reply,
} from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import {
  extractPackShareIdFromText,
  getBuiltInEmote,
  isSingleBuiltInSticker,
  ReactionGlyph,
  renderRichTextTokens,
  resolveAssetUrl,
} from "@/shared/emotes";
import { formatBytes, formatMessageClock } from "@/shared/format";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore, type V1Message } from "@/store/workspace-store";
import { Avatar } from "./Avatar";
import { CardKitView } from "./CardKitView";

function DeliveryStatusIcon({
  status,
  frameless = false,
}: {
  status?: V1Message["status"];
  frameless?: boolean;
}) {
  const mutedCls = frameless ? "text-white/90" : "opacity-80";
  if (status === "sending") return <Clock size={12} className={mutedCls} />;
  if (status === "failed") return <AlertCircle size={13} className="text-rose-400" />;
  if (status === "read") return <CheckCheck size={14} className={frameless ? "text-sky-300" : "opacity-95"} />;
  return <Check size={13} className={mutedCls} />;
}

export function MessageItem({
  msg,
  isOwn,
  isGroup,
  replyTarget,
  highlighted,
  onQuickReply,
  onMentionSender,
}: {
  msg: V1Message;
  isOwn: boolean;
  isGroup: boolean;
  replyTarget?: V1Message;
  highlighted?: boolean;
  onQuickReply: (msg: V1Message) => void;
  onMentionSender: (userId: string, displayName: string) => void;
}) {
  const customSrcMap = useEmoteStore((s) => s.customSrcMap);
  const recalledDrafts = useWorkspaceStore((s) => s.recalledDrafts);
  const restoreRecalledDraft = useWorkspaceStore((s) => s.restoreRecalledDraft);
  const toggleReaction = useWorkspaceStore((s) => s.toggleReaction);
  const setActionMessageId = useNavStore((s) => s.setActionMessageId);
  const setThreadRootId = useNavStore((s) => s.setThreadRootId);
  const setSharedPackId = useNavStore((s) => s.setSharedPackId);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);

  // Touch gestures: long-press for action sheet & swipe-left for reply
  const [swipeOffset, setSwipeOffset] = useState(0);
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
      `/api/workspace/emotes/custom/${encodeURIComponent(customStickerId)}`
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

  // User explicitly asked for standalone single images & stickers to be frameless!
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
  const isFrameless = isFramelessSticker || isFramelessSingleImage;

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

  const renderMessageRichBody = () => {
    if (msg.blocks && msg.blocks.length > 0) {
      return msg.blocks.map((b, i) => {
        if (b.type === "mention") {
          return (
            <span
              key={i}
              onClick={(ev) => {
                ev.stopPropagation();
                onMentionSender(b.userId, b.label);
              }}
              className={`font-semibold px-1 py-0.5 rounded-md mx-0.5 ${
                isOwn
                  ? "bg-white/20 text-white"
                  : "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
              }`}
            >
              @{b.label}
            </span>
          );
        }
        if (b.type === "link") {
          return (
            <button
              key={i}
              type="button"
              onClick={(ev) => {
                ev.stopPropagation();
                nativeBridge.openExternalUrl(b.url);
              }}
              className="underline break-all text-left"
            >
              {b.label || b.url}
            </button>
          );
        }
        if (b.type === "text") {
          return <React.Fragment key={i}>{renderRichTextTokens(b.text, `${msg.id}_${i}`)}</React.Fragment>;
        }
        return null;
      });
    }
    return renderRichTextTokens(msg.plainText, msg.id);
  };

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
      className={`relative flex gap-2.5 px-3 py-1.5 select-none ${
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

      {/* Peer Avatar in incoming messages */}
      {!isOwn && (
        <button
          type="button"
          onClick={() => isGroup && onMentionSender(msg.senderId, msg.senderName)}
          className="self-end mb-0.5 shrink-0"
        >
          <Avatar
            name={msg.senderName}
            src={msg.senderAvatarUrl}
            kind={msg.kind === "bot" ? "bot" : "user"}
            size={34}
          />
        </button>
      )}

      <div className={`flex flex-col max-w-[78%] ${isOwn ? "items-end" : "items-start"}`}>
        {/* Group sender name + Feishu-style @ quick mention badge */}
        {!isOwn && isGroup && (
          <div className="flex items-center gap-1.5 mb-1 pl-1">
            <span className="text-[12px] font-medium text-[var(--dl-text-muted)] truncate max-w-[160px]">
              {msg.senderName}
            </span>
            {msg.kind === "bot" && (
              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]">
                BOT
              </span>
            )}
            <button
              type="button"
              onClick={() => onMentionSender(msg.senderId, msg.senderName)}
              aria-label={`提及 ${msg.senderName}`}
              className="px-1.5 py-0.2 rounded-full text-[11px] font-medium text-[var(--dl-accent)] bg-[var(--dl-accent-soft)] active:scale-95"
            >
              @TA
            </button>
          </div>
        )}

        {/* FRAMELESS STANDALONE STICKER OR SINGLE IMAGE */}
        {isFrameless ? (
          <div className="relative inline-block group">
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
                className="w-32 h-32 object-contain drop-shadow-sm active:scale-[0.98] transition"
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
                className="max-w-[240px] max-h-[300px] rounded-2xl object-cover shadow-sm active:opacity-95"
              />
            )}
            <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-xs text-white text-[10px] flex items-center gap-1">
              <span>{clockStr}</span>
              {isOwn && <DeliveryStatusIcon status={msg.status} frameless />}
            </div>
          </div>
        ) : packShareId ? (
          /* STICKER PACK SHARE CARD */
          <button
            type="button"
            onClick={() => setSharedPackId(packShareId)}
            className="w-[244px] text-left rounded-2xl border border-[var(--dl-border)] bg-[var(--dl-surface)] p-3 shadow-xs active:scale-[0.99] transition"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] flex items-center justify-center shrink-0">
                <Package size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                  {packShareBlock?.type === "emote_collection" && packShareBlock.share?.name
                    ? packShareBlock.share.name
                    : msg.plainText.replace("[表情包]", "").trim() || "共享表情包"}
                </div>
                <div className="text-[11px] text-[var(--dl-text-muted)]">
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
            <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-[var(--dl-text-muted)]">
              <span>{clockStr}</span>
              {isOwn && <DeliveryStatusIcon status={msg.status} />}
            </div>
          </button>
        ) : (
          /* STANDARD MESSAGE BUBBLE */
          <div
            className={`relative px-3.5 py-2.5 shadow-2xs ${
              isOwn
                ? "bg-[var(--dl-bubble-own)] text-[var(--dl-bubble-own-text)] rounded-[20px] rounded-br-[6px]"
                : "bg-[var(--dl-bubble-peer)] text-[var(--dl-text)] border border-[var(--dl-border)] rounded-[20px] rounded-bl-[6px]"
            }`}
          >
            {/* Reply Quote */}
            {replyTarget && (
              <div
                className={`mb-1.5 pl-2.5 pr-2 py-1 rounded-lg border-l-2 text-[12px] ${
                  isOwn
                    ? "bg-black/15 border-white/70 text-white/90"
                    : "bg-[var(--dl-card)] border-[var(--dl-accent)] text-[var(--dl-text-muted)]"
                }`}
              >
                <div className="font-semibold text-[11px] truncate">{replyTarget.senderName}</div>
                <div className="truncate opacity-85">{replyTarget.plainText || "[媒体消息]"}</div>
              </div>
            )}

            {/* Multi-image or captioned image grid */}
            {imageAttachments.length > 0 && (
              <div
                className={`mb-1.5 grid gap-1.5 ${
                  imageAttachments.length > 1 ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                {imageAttachments.map((img) => (
                  <img
                    key={img.id}
                    src={resolveAssetUrl(img.url)}
                    alt={img.fileName}
                    onClick={() =>
                      setLightboxMedia({
                        src: resolveAssetUrl(img.url),
                        title: img.fileName,
                        downloadUrl: resolveAssetUrl(img.downloadUrl || img.url),
                        favoriteInput: { messageId: msg.id, attachmentId: img.id },
                      })
                    }
                    className="max-h-48 w-full rounded-xl object-cover"
                  />
                ))}
              </div>
            )}

            {/* File attachments */}
            {fileAttachments.length > 0 && (
              <div className="space-y-1.5 mb-1.5">
                {fileAttachments.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() =>
                      nativeBridge.openExternalUrl(resolveAssetUrl(f.downloadUrl || f.url))
                    }
                    className={`w-full flex items-center gap-2.5 p-2 rounded-xl text-left ${
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

            {/* Rich text */}
            {hasCaptionText && (
              <div className="text-[15px] leading-[1.45] whitespace-pre-wrap break-words">
                {renderMessageRichBody()}
              </div>
            )}

            {/* Interactive CardKit v1 */}
            {msg.card && <CardKitView card={msg.card} />}

            {/* Timestamp + Edited + Checkmarks */}
            <div
              className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                isOwn ? "text-white/75" : "text-[var(--dl-text-muted)]"
              }`}
            >
              {msg.editedAt && <span>已编辑</span>}
              <span>{clockStr}</span>
              {isOwn && <DeliveryStatusIcon status={msg.status} />}
              <button
                type="button"
                aria-label="消息更多操作"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setActionMessageId(msg.id);
                }}
                className="ml-0.5 p-0.5 rounded opacity-60 active:opacity-100"
              >
                <MoreHorizontal size={12} />
              </button>
            </div>
          </div>
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
                className={`px-2 py-0.5 rounded-full text-[11px] flex items-center gap-1 border transition active:scale-95 ${
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

        {/* Thread Replies Chip */}
        {(msg.threadReplyCount || 0) > 0 && (
          <button
            type="button"
            onClick={() => setThreadRootId(msg.id)}
            className="mt-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-[var(--dl-accent)] bg-[var(--dl-accent-soft)] flex items-center gap-1 active:scale-95"
          >
            <MessageSquareText size={12} />
            <span>{msg.threadReplyCount} 条话题回复</span>
          </button>
        )}
      </div>
    </div>
  );
}
