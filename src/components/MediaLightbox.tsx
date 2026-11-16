import React, { useEffect, useRef, useState } from "react";
import { Download, RotateCcw, Star, X } from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function touchDistance(t1: React.Touch, t2: React.Touch): number {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

export function MediaLightbox() {
  const media = useNavStore((s) => s.lightboxMedia);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);
  const showToast = useNavStore((s) => s.showToast);
  const favoriteFromMessage = useEmoteStore((s) => s.favoriteFromMessage);

  const [favoriting, setFavoriting] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [interacting, setInteracting] = useState(false);

  const gestureRef = useRef<{
    mode: "none" | "pinch" | "pan";
    startDist: number;
    startScale: number;
    startTouchX: number;
    startTouchY: number;
    startOffsetX: number;
    startOffsetY: number;
    moved: boolean;
    lastTapAt: number;
    lastTapX: number;
    lastTapY: number;
  }>({
    mode: "none",
    startDist: 1,
    startScale: 1,
    startTouchX: 0,
    startTouchY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
    moved: false,
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
  });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setInteracting(false);
  }, [media?.src]);

  if (!media) return null;

  const resetZoom = () => {
    setInteracting(false);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const toggleDoubleTapZoom = () => {
    nativeBridge.haptic("selection");
    setInteracting(false);
    if (scale > 1.05) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else {
      setScale(2.2);
      setOffset({ x: 0, y: 0 });
    }
  };

  const handleFavorite = async () => {
    if (!media.favoriteInput || favoriting) return;
    setFavoriting(true);
    try {
      await favoriteFromMessage(media.favoriteInput);
      showToast("已添加到收藏表情", "success");
    } catch {
      showToast("收藏表情失败", "warning");
    } finally {
      setFavoriting(false);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const g = gestureRef.current;
    if (e.touches.length === 2) {
      const dist = touchDistance(e.touches[0], e.touches[1]);
      g.mode = "pinch";
      g.startDist = Math.max(12, dist);
      g.startScale = scale;
      g.startOffsetX = offset.x;
      g.startOffsetY = offset.y;
      g.moved = true;
      setInteracting(true);
      return;
    }
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const now = Date.now();
      const dt = now - g.lastTapAt;
      const distFromLast = Math.hypot(t.clientX - g.lastTapX, t.clientY - g.lastTapY);
      if (dt > 30 && dt < 290 && distFromLast < 36) {
        g.lastTapAt = 0;
        g.mode = "none";
        toggleDoubleTapZoom();
        return;
      }
      g.lastTapAt = now;
      g.lastTapX = t.clientX;
      g.lastTapY = t.clientY;
      g.moved = false;
      if (scale > 1.02) {
        g.mode = "pan";
        g.startTouchX = t.clientX;
        g.startTouchY = t.clientY;
        g.startOffsetX = offset.x;
        g.startOffsetY = offset.y;
        setInteracting(true);
      } else {
        g.mode = "none";
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const g = gestureRef.current;
    if (e.touches.length === 2 && g.mode === "pinch") {
      e.preventDefault();
      e.stopPropagation();
      const dist = touchDistance(e.touches[0], e.touches[1]);
      const nextScale = clamp(g.startScale * (dist / g.startDist), 1, 4.5);
      setScale(nextScale);
      if (nextScale <= 1.02) {
        setOffset({ x: 0, y: 0 });
      }
      return;
    }
    if (e.touches.length === 1 && g.mode === "pan" && scale > 1.02) {
      const t = e.touches[0];
      const dx = t.clientX - g.startTouchX;
      const dy = t.clientY - g.startTouchY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        g.moved = true;
      }
      const maxX = Math.max(0, ((scale - 1) * window.innerWidth) / 1.8);
      const maxY = Math.max(0, ((scale - 1) * window.innerHeight) / 1.8);
      setOffset({
        x: clamp(g.startOffsetX + dx, -maxX, maxX),
        y: clamp(g.startOffsetY + dy, -maxY, maxY),
      });
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    const g = gestureRef.current;
    if (e.touches.length === 0) {
      g.mode = "none";
      setInteracting(false);
      if (scale < 1.05) {
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    }
  };

  return (
    <div
      data-testid="media-lightbox"
      className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between pt-[var(--safe-top)] pb-[var(--safe-bottom)] select-none"
      onClick={() => {
        if (scale <= 1.05 && !gestureRef.current.moved) {
          setLightboxMedia(null);
        }
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3 text-white z-10"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[14px] font-medium truncate max-w-[190px]">
          {media.title || "图片预览"}
        </span>
        <div className="flex items-center gap-2">
          {scale > 1.05 && (
            <button
              type="button"
              onClick={resetZoom}
              className="px-2.5 py-1.5 rounded-full bg-white/15 text-[12px] font-mono font-medium flex items-center gap-1 active:bg-white/25"
            >
              <RotateCcw size={13} />
              <span>{Math.round(scale * 100)}%</span>
            </button>
          )}
          {media.favoriteInput && (
            <button
              type="button"
              onClick={() => void handleFavorite()}
              className="px-3 py-1.5 rounded-full bg-white/15 text-[12px] font-medium flex items-center gap-1 active:bg-white/25"
            >
              <Star size={14} />
              <span>{favoriting ? "收藏中…" : "存为表情"}</span>
            </button>
          )}
          {media.downloadUrl && (
            <button
              type="button"
              onClick={() => nativeBridge.openExternalUrl(media.downloadUrl!)}
              aria-label="原图下载"
              className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25"
            >
              <Download size={17} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setLightboxMedia(null)}
            aria-label="关闭预览"
            className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="flex-1 flex items-center justify-center p-4 overflow-hidden touch-none"
      >
        <img
          src={media.src}
          alt={media.title || "预览"}
          data-zoom-scale={scale.toFixed(1)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            toggleDoubleTapZoom();
          }}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transition: interacting ? "none" : "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
          className="max-w-full max-h-full object-contain rounded-lg will-change-transform"
        />
      </div>
      <div className="h-6 flex items-center justify-center text-[11px] text-white/45 pointer-events-none">
        双击或双指捏合缩放
      </div>
    </div>
  );
}
