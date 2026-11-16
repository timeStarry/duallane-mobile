import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Copy,
  FileText,
  Image as ImageIcon,
  Link2,
  Lock,
  LogOut,
  Plus,
  Send,
  Share2,
  ShieldAlert,
  Smile,
} from "lucide-react";
import { StickerDrawer } from "@/components/StickerDrawer";
import { nativeBridge } from "@/native/bridge";
import { isSingleBuiltInSticker, resolveAssetUrl } from "@/shared/emotes";
import { formatBytes, formatMessageClock } from "@/shared/format";
import { ChatMarkdown } from "@/shared/markdown";
import { parseP2PInviteInput, safeInlineImageMime } from "@/shared/p2p-crypto";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

export function DirectTab({
  guestMode = false,
  onExitGuest,
  onClose,
}: {
  guestMode?: boolean;
  onExitGuest?: () => void;
  onClose?: () => void;
}) {
  const p2pRoom = useWorkspaceStore((s) => s.p2pRoom);
  const p2pMessages = useWorkspaceStore((s) => s.p2pMessages);
  const p2pDraft = useWorkspaceStore((s) => s.p2pDraft);
  const setP2PDraft = useWorkspaceStore((s) => s.setP2PDraft);
  const createP2PRoom = useWorkspaceStore((s) => s.createP2PRoom);
  const joinP2PRoom = useWorkspaceStore((s) => s.joinP2PRoom);
  const leaveP2PRoom = useWorkspaceStore((s) => s.leaveP2PRoom);
  const sendP2PMessage = useWorkspaceStore((s) => s.sendP2PMessage);
  const sendP2PPickedFile = useWorkspaceStore((s) => s.sendP2PPickedFile);

  const showToast = useNavStore((s) => s.showToast);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);

  const [joinInput, setJoinInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [isComposingIme, setIsComposingIme] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [p2pMessages.length]);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const shareUrl = await createP2PRoom();
      nativeBridge.copyText(shareUrl);
      showToast("加密直连房间已创建，邀请链接已复制", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "创建直连房间失败", "danger");
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    const parsed = parseP2PInviteInput(joinInput);
    if (!parsed) {
      showToast("请粘贴包含 #k= 密钥的完整直连链接", "warning");
      return;
    }
    try {
      await joinP2PRoom(parsed.roomId, parsed.keyStr);
      setJoinInput("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "加入房间失败", "danger");
    }
  };

  const handleAttach = async (mode: "image" | "file") => {
    const files = await nativeBridge.pickMedia(mode, false);
    if (files.length === 0) return;
    const f = files[0];
    await sendP2PPickedFile(f.id, f.name, f.mimeType);
  };

  if (!p2pRoom) {
    return (
      <div className="h-full flex flex-col bg-[var(--dl-bg)]">
        <header
          className={`${
            guestMode ? "" : "pt-[var(--safe-top)]"
          } bg-[var(--dl-surface)] border-b border-[var(--dl-border)] shrink-0`}
        >
          <div className="h-13 px-4 flex items-center gap-2.5">
            {(onClose || (guestMode && onExitGuest)) && (
              <button
                type="button"
                onClick={onClose || onExitGuest}
                aria-label="返回"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)]"
              >
                <ArrowLeft size={19} />
              </button>
            )}
            <Lock size={19} className="text-amber-500" />
            <h1 className="text-[17px] font-bold text-[var(--dl-text)]">一对一端到端直连</h1>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-5 shadow-2xs">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center mb-3">
              <Lock size={22} />
            </div>
            <h2 className="text-[17px] font-bold text-[var(--dl-text)]">
              零服务端落盘 · 纯内存加密房间
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--dl-text-muted)]">
              密钥仅存在于分享链接的 <code className="text-amber-500">#k=</code>{" "}
              片段与双方设备内存中，支持文字、内置表情与 8 MB 内加密图片/文件直传，退出房间立即销毁。
            </p>
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreate()}
              className="mt-4 w-full py-3 rounded-2xl bg-amber-500 text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-xs active:scale-[0.99] disabled:opacity-60"
            >
              <Plus size={18} />
              <span>{creating ? "正在分配加密房间…" : "新建一对一直连房间"}</span>
            </button>
          </div>

          <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-5 shadow-2xs space-y-3">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--dl-text)]">
              <Link2 size={16} className="text-[var(--dl-accent)]" />
              <span>通过邀请链接加入</span>
            </div>
            <input
              type="text"
              value={joinInput}
              onChange={(e) => setJoinInput(e.target.value)}
              placeholder="粘贴 https://.../direct/xxx#k=..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[13px] text-[var(--dl-text)] outline-none focus:border-amber-500"
            />
            <button
              type="button"
              onClick={() => void handleJoin()}
              className="w-full py-2.5 rounded-xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[14px] active:opacity-80"
            >
              立即加入加密房间
            </button>
          </div>
        </div>
      </div>
    );
  }

  const peerConnected = p2pRoom.status === "peer_connected";

  return (
    <div className="h-full flex flex-col bg-[var(--dl-bg)] pb-[var(--ime-height)]">
      {/* Room Header */}
      <header
        className={`${
          guestMode ? "" : "pt-[var(--safe-top)]"
        } bg-[var(--dl-surface)] border-b border-[var(--dl-border)] shrink-0`}
      >
        <div className="h-14 px-3 flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            {(onClose || (guestMode && onExitGuest)) && (
              <button
                type="button"
                onClick={onClose || onExitGuest}
                aria-label="返回"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--dl-text)] active:bg-[var(--dl-card)] shrink-0"
              >
                <ArrowLeft size={19} />
              </button>
            )}
            <div className="w-9 h-9 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
              <Lock size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-bold text-[var(--dl-text)] truncate">
                直连 #{p2pRoom.roomId.slice(0, 8)}
              </div>
              <div className="text-[11px] text-[var(--dl-text-muted)] flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    peerConnected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                  }`}
                />
                <span>
                  {peerConnected ? "对端已连接 · E2EE" : "等待对方加入"} · 指纹{" "}
                  {p2pRoom.keyFingerprint}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                nativeBridge.copyText(p2pRoom.shareUrl);
                showToast("加密邀请链接已复制", "success");
              }}
              aria-label="复制直连链接"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              onClick={() =>
                nativeBridge.shareText("DualLane 端到端加密直连邀请", p2pRoom.shareUrl)
              }
              aria-label="系统分享直连链接"
              className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
            >
              <Share2 size={16} />
            </button>
            <button
              type="button"
              onClick={leaveP2PRoom}
              aria-label="销毁并离开直连房间"
              className="px-2.5 py-1.5 rounded-xl bg-rose-500/12 text-rose-500 text-[12px] font-semibold flex items-center gap-1"
            >
              <LogOut size={13} />
              <span>销毁</span>
            </button>
          </div>
        </div>
      </header>

      {p2pRoom.keyMismatchWarning && (
        <div className="px-4 py-2 bg-rose-500/15 text-rose-600 dark:text-rose-300 text-[12px] flex items-center gap-2">
          <ShieldAlert size={15} />
          <span>检测到密钥不匹配，无法解密对端消息，请重新分享完整链接。</span>
        </div>
      )}

      {p2pRoom.errorMessage && (
        <div className="px-4 py-2 bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[12px]">
          {p2pRoom.errorMessage}
        </div>
      )}

      {/* Encrypted Message Stream */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 px-3 py-3 space-y-2"
      >
        {!peerConnected && p2pMessages.length === 0 && (
          <div className="my-6 mx-auto max-w-[300px] rounded-2xl bg-[var(--dl-surface)] border border-[var(--dl-border)] p-4 text-center space-y-2.5">
            <div className="text-[13px] font-semibold text-[var(--dl-text)]">
              邀请一位伙伴加入加密直连
            </div>
            <p className="text-[12px] text-[var(--dl-text-muted)] break-all line-clamp-2">
              {p2pRoom.shareUrl}
            </p>
            <div className="flex gap-2 justify-center pt-1">
              <button
                type="button"
                onClick={() => {
                  nativeBridge.copyText(p2pRoom.shareUrl);
                  showToast("邀请链接已复制", "success");
                }}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--dl-card)] text-[12px] font-medium"
              >
                复制链接
              </button>
              <button
                type="button"
                onClick={() =>
                  nativeBridge.shareText("DualLane 加密直连", p2pRoom.shareUrl)
                }
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 text-white text-[12px] font-semibold"
              >
                系统分享
              </button>
            </div>
          </div>
        )}

        {p2pMessages.map((m) => {
          const singleSticker = !m.attachment ? isSingleBuiltInSticker(m.text) : null;
          const isSingleImage =
            m.attachment && safeInlineImageMime(m.attachment.mimeType) && !m.text;

          return (
            <div
              key={m.id}
              className={`flex ${m.isOwn ? "justify-end" : "justify-start"}`}
            >
              {singleSticker ? (
                <div className="relative">
                  <img
                    src={resolveAssetUrl(singleSticker.src)}
                    alt={singleSticker.label}
                    className="w-28 h-28 object-contain"
                  />
                </div>
              ) : isSingleImage && m.attachment ? (
                <div className="relative">
                  <img
                    src={m.attachment.blobUrl}
                    alt={m.attachment.fileName}
                    onClick={() =>
                      setLightboxMedia({
                        src: m.attachment!.blobUrl,
                        title: m.attachment!.fileName,
                      })
                    }
                    className="max-w-[230px] max-h-[280px] rounded-2xl object-cover shadow-xs"
                  />
                  <div className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/50 text-white text-[10px] flex items-center gap-1">
                    <span>{formatMessageClock(m.createdAt)}</span>
                    {m.isOwn &&
                      (m.deliveryStatus === "delivered" ? (
                        <CheckCheck size={13} className="text-amber-300" />
                      ) : (
                        <Check size={12} />
                      ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-end gap-1.5 min-w-0 max-w-[78%]">
                  {m.isOwn && (
                    <span className="shrink-0 mb-1 text-[var(--dl-text-muted)]">
                      {m.deliveryStatus === "delivered" ? (
                        <CheckCheck size={13} className="text-amber-500" />
                      ) : (
                        <Check size={12} />
                      )}
                    </span>
                  )}
                  <div
                    className={`max-w-full min-w-0 overflow-hidden px-3.5 py-2 rounded-[18px] [overflow-wrap:anywhere] break-words ${
                      m.isOwn
                        ? "bg-amber-500 text-white rounded-br-[6px]"
                        : "bg-[var(--dl-surface)] text-[var(--dl-text)] border border-[var(--dl-border)] rounded-bl-[6px]"
                    }`}
                  >
                    {m.attachment && (
                      <div className="mb-1.5 flex items-center gap-2 p-2 rounded-xl bg-black/10 min-w-0 overflow-hidden">
                        <FileText size={18} className="shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium truncate">
                            {m.attachment.fileName}
                          </div>
                          <div className="text-[10px] opacity-75">
                            {formatBytes(m.attachment.byteSize)}
                          </div>
                        </div>
                      </div>
                    )}
                    {m.text && (
                      <div className="text-[15px] max-w-full min-w-0">
                        <ChatMarkdown
                          text={m.text}
                          tone={m.isOwn ? "own" : "peer"}
                          lane="direct"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <div className="bg-[var(--dl-surface)] border-t border-[var(--dl-border)] px-2.5 py-2 flex items-end gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => void handleAttach("image")}
          aria-label="发送加密图片"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text-muted)] active:bg-[var(--dl-card)] shrink-0"
        >
          <ImageIcon size={20} />
        </button>
        <button
          type="button"
          onClick={() => setStickerOpen((v) => !v)}
          aria-label="打开表情面板"
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--dl-text-muted)] active:bg-[var(--dl-card)] shrink-0"
        >
          <Smile size={20} />
        </button>
        <div className="relative flex-1 min-w-0 flex items-center">
          {!p2pDraft && !isComposingIme && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-3 right-3 flex items-center truncate text-[15px] text-[var(--dl-text-muted)] select-none"
            >
              发送端到端加密消息…
            </span>
          )}
          <textarea
            ref={composerRef}
            rows={1}
            enterKeyHint="send"
            value={p2pDraft}
            onFocus={() => setStickerOpen(false)}
            onCompositionStart={() => setIsComposingIme(true)}
            onCompositionEnd={() => setIsComposingIme(false)}
            onChange={(e) => setP2PDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (p2pDraft.trim()) {
                  composerRef.current?.focus({ preventScroll: true });
                  void sendP2PMessage(p2pDraft);
                }
              }
            }}
            placeholder="发送端到端加密消息…"
            className="w-full max-h-28 py-2 px-3 rounded-2xl bg-[var(--dl-card)] text-[15px] text-[var(--dl-text)] placeholder:text-transparent outline-none resize-none"
          />
        </div>
        <button
          type="button"
          tabIndex={-1}
          aria-disabled={!p2pDraft.trim()}
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (!p2pDraft.trim()) return;
            composerRef.current?.focus({ preventScroll: true });
            void sendP2PMessage(p2pDraft);
          }}
          aria-label="发送直连消息"
          className={`w-9 h-9 rounded-full bg-amber-500 text-white flex items-center justify-center shrink-0 transition-transform duration-150 ${
            !p2pDraft.trim() ? "opacity-40 pointer-events-none" : "active:scale-95"
          }`}
        >
          <Send size={16} />
        </button>
      </div>

      <StickerDrawer
        open={stickerOpen}
        onInsertToken={(tok) => setP2PDraft(p2pDraft + tok)}
        onSendBuiltInSticker={(tok) => {
          void sendP2PMessage(tok);
          setStickerOpen(false);
        }}
      />
    </div>
  );
}
