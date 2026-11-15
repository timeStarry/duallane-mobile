import { useState } from "react";
import { Download, Star, X } from "lucide-react";
import { nativeBridge } from "@/native/bridge";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";

export function MediaLightbox() {
  const media = useNavStore((s) => s.lightboxMedia);
  const setLightboxMedia = useNavStore((s) => s.setLightboxMedia);
  const showToast = useNavStore((s) => s.showToast);
  const favoriteFromMessage = useEmoteStore((s) => s.favoriteFromMessage);
  const [favoriting, setFavoriting] = useState(false);

  if (!media) return null;

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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between pt-[var(--safe-top)] pb-[var(--safe-bottom)]"
      onClick={() => setLightboxMedia(null)}
    >
      <div
        className="flex items-center justify-between px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-[14px] font-medium truncate max-w-[220px]">
          {media.title || "图片预览"}
        </span>
        <div className="flex items-center gap-2">
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

      <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
        <img
          src={media.src}
          alt={media.title || "预览"}
          onClick={(e) => e.stopPropagation()}
          className="max-w-full max-h-full object-contain rounded-lg"
        />
      </div>
      <div className="h-6" />
    </div>
  );
}
