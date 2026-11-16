import { useState } from "react";
import { ArrowLeft, ArrowRight, Plus, Settings2, Share2, Sparkles } from "lucide-react";
import { mobileApi, type CustomEmoteDTO } from "@/shared/api";
import { getBuiltInEmote, resolveAssetUrl, visibleEmotePacks } from "@/shared/emotes";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

const RECENT_EMOJIS_KEY = "duallane:mobile:recent-emojis:v1";
const MAX_RECENT_EMOJIS = 8;

function loadRecentEmojis(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_EMOJIS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => String(x || "").trim())
      .filter(Boolean)
      .slice(0, MAX_RECENT_EMOJIS);
  } catch {
    return [];
  }
}

function saveRecentEmojis(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_EMOJIS_KEY, JSON.stringify(list.slice(0, MAX_RECENT_EMOJIS)));
  } catch {
    // ignore storage errors
  }
}

export function StickerDrawer({
  open,
  conversationId,
  onInsertToken,
  onSendBuiltInSticker,
}: {
  open: boolean;
  conversationId?: string;
  onInsertToken: (token: string) => void;
  onSendBuiltInSticker: (token: string) => void;
}) {
  const emotes = useEmoteStore((s) => s.emotes);
  const getOrderedTabs = useEmoteStore((s) => s.getOrderedTabs);
  const moveTab = useEmoteStore((s) => s.moveTab);
  const updateUserPreferences = useWorkspaceStore((s) => s.updateUserPreferences);
  const sendCustomSticker = useWorkspaceStore((s) => s.sendCustomSticker);
  const sendStickerPackShare = useWorkspaceStore((s) => s.sendStickerPackShare);
  const setStickerStudioOpen = useNavStore((s) => s.setStickerStudioOpen);
  const showToast = useNavStore((s) => s.showToast);

  const tabs = getOrderedTabs();
  const [selectedTabId, setSelectedTabId] = useState<string>("favorites");
  const [reorderMode, setReorderMode] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>(() => loadRecentEmojis());

  if (!open) return null;

  const activeTab = tabs.find((t) => t.id === selectedTabId) || tabs[0];
  const activeIdx = tabs.findIndex((t) => t.id === activeTab?.id);

  const handleMove = (dir: "left" | "right") => {
    if (!activeTab) return;
    const nextOrder = moveTab(activeTab.id, dir);
    void updateUserPreferences({ emoteTabOrder: nextOrder });
  };

  const handlePickUnicodeEmoji = (val: string) => {
    const clean = val.trim();
    if (!clean) return;
    const next = [clean, ...recentEmojis.filter((x) => x !== clean)].slice(0, MAX_RECENT_EMOJIS);
    setRecentEmojis(next);
    saveRecentEmojis(next);
    onInsertToken(clean);
  };

  const handleSendStickerItem = (em: CustomEmoteDTO) => {
    if (em.sourceType === "builtin" && em.emoteKey) {
      const builtIn = getBuiltInEmote(em.emoteKey);
      if (builtIn) {
        onSendBuiltInSticker(builtIn.token);
        return;
      }
    }
    if (conversationId) {
      void sendCustomSticker(conversationId, em.id);
    }
  };

  const handleShareCollection = async (collectionId: string) => {
    if (!conversationId) return;
    try {
      const res = await mobileApi.createEmoteCollectionShare(collectionId);
      await sendStickerPackShare(conversationId, res.share);
      showToast("已发送表情包卡片到当前会话", "success");
    } catch {
      showToast("生成表情包分享卡片失败", "warning");
    }
  };

  return (
    <div className="h-[268px] border-t border-[var(--dl-border)] bg-[var(--dl-surface)] flex flex-col shrink-0 select-none">
      {/* Reorderable Tab Strip */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--dl-border)] overflow-x-auto no-scrollbar shrink-0">
        {tabs.map((t) => {
          const active = t.id === activeTab?.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSelectedTabId(t.id)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium whitespace-nowrap transition ${
                active
                  ? "bg-[var(--dl-accent)] text-white shadow-2xs"
                  : "text-[var(--dl-text-muted)] bg-[var(--dl-card)]/60"
              }`}
            >
              {t.label}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-1 pl-2 shrink-0">
          <button
            type="button"
            onClick={() => setReorderMode((v) => !v)}
            aria-label="调整表情栏顺序"
            className={`p-1.5 rounded-full ${
              reorderMode
                ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
                : "text-[var(--dl-text-muted)]"
            }`}
          >
            <Settings2 size={15} />
          </button>
          {conversationId && (
            <button
              type="button"
              onClick={() => setStickerStudioOpen(true)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] flex items-center gap-1"
            >
              <Sparkles size={12} />
              <span>工坊</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Tab Reorder Controls */}
      {reorderMode && activeTab && (
        <div className="px-3 py-1.5 bg-[var(--dl-card)] border-b border-[var(--dl-border)] flex items-center justify-between text-[12px]">
          <span className="text-[var(--dl-text-muted)]">
            调整「<strong className="text-[var(--dl-text)]">{activeTab.label}</strong>」标签顺序
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={activeIdx <= 0}
              onClick={() => handleMove("left")}
              className="px-2.5 py-1 rounded-lg bg-[var(--dl-surface)] border border-[var(--dl-border)] disabled:opacity-40 flex items-center gap-1"
            >
              <ArrowLeft size={12} /> 左移
            </button>
            <button
              type="button"
              disabled={activeIdx >= tabs.length - 1}
              onClick={() => handleMove("right")}
              className="px-2.5 py-1 rounded-lg bg-[var(--dl-surface)] border border-[var(--dl-border)] disabled:opacity-40 flex items-center gap-1"
            >
              右移 <ArrowRight size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Sticker / Emoji Grid */}
      <div className="flex-1 overflow-y-auto p-2.5">
        {activeTab?.kind === "favorites" && (
          <div>
            <div className="grid grid-cols-5 gap-2">
              {conversationId && (
                <button
                  type="button"
                  onClick={() => setStickerStudioOpen(true)}
                  className="aspect-square rounded-2xl border border-dashed border-[var(--dl-border)] flex flex-col items-center justify-center gap-1 text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
                >
                  <Plus size={20} />
                  <span className="text-[10px]">添加</span>
                </button>
              )}
              {emotes.map((em) => {
                const builtInSrc =
                  em.sourceType === "builtin" && em.emoteKey
                    ? getBuiltInEmote(em.emoteKey)?.src
                    : undefined;
                return (
                  <button
                    key={em.id}
                    type="button"
                    onClick={() => handleSendStickerItem(em)}
                    className="aspect-square rounded-2xl p-1.5 flex items-center justify-center active:bg-[var(--dl-card)] active:scale-95 transition"
                  >
                    <img
                      src={resolveAssetUrl(
                        em.src ||
                          builtInSrc ||
                          `/api/workspace/emotes/${encodeURIComponent(em.id)}/content`
                      )}
                      alt={em.label}
                      className="w-full h-full object-contain"
                    />
                  </button>
                );
              })}
            </div>
            {emotes.length === 0 && (
              <p className="text-center text-[12px] text-[var(--dl-text-muted)] mt-6">
                长按聊天中的图片或贴纸即可一键收藏到这里
              </p>
            )}
          </div>
        )}

        {activeTab?.kind === "collection" && activeTab.collection && (
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[12px] font-medium text-[var(--dl-text-muted)]">
                {activeTab.collection.name} · {activeTab.collection.items?.length || 0} 枚
              </span>
              {conversationId && (
                <button
                  type="button"
                  onClick={() => void handleShareCollection(activeTab.collection!.id)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] flex items-center gap-1"
                >
                  <Share2 size={12} /> 分享到聊天
                </button>
              )}
            </div>
            <div className="grid grid-cols-5 gap-2">
              {(activeTab.collection.items || []).map((em) => {
                const builtInSrc =
                  em.sourceType === "builtin" && em.emoteKey
                    ? getBuiltInEmote(em.emoteKey)?.src
                    : undefined;
                return (
                  <button
                    key={em.id}
                    type="button"
                    onClick={() => handleSendStickerItem(em)}
                    className="aspect-square rounded-2xl p-1.5 flex items-center justify-center active:bg-[var(--dl-card)] active:scale-95 transition"
                  >
                    <img
                      src={resolveAssetUrl(
                        em.src ||
                          builtInSrc ||
                          `/api/workspace/emotes/${encodeURIComponent(em.id)}/content`
                      )}
                      alt={em.label}
                      className="w-full h-full object-contain"
                    />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab?.kind === "builtin" && (() => {
          const pack = visibleEmotePacks.find((p) => p.id === activeTab.packId);
          if (!pack) return null;
          if (pack.kind === "unicode") {
            return (
              <div className="space-y-2">
                {recentEmojis.length > 0 && (
                  <div data-testid="recent-emojis-section">
                    <div className="px-1 mb-1 text-[11px] font-medium text-[var(--dl-text-muted)]">
                      最近使用
                    </div>
                    <div className="grid grid-cols-8 gap-1 pb-1.5 border-b border-[var(--dl-border)]/60">
                      {recentEmojis.map((emoji) => (
                        <button
                          key={`recent_${emoji}`}
                          type="button"
                          onClick={() => handlePickUnicodeEmoji(emoji)}
                          className="aspect-square rounded-xl text-[22px] flex items-center justify-center active:bg-[var(--dl-card)] active:scale-90 transition"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  {recentEmojis.length > 0 && (
                    <div className="px-1 mb-1 text-[11px] font-medium text-[var(--dl-text-muted)]">
                      全部表情
                    </div>
                  )}
                  <div className="grid grid-cols-8 gap-1">
                    {pack.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handlePickUnicodeEmoji(item.value || item.token)}
                        className="aspect-square rounded-xl text-[22px] flex items-center justify-center active:bg-[var(--dl-card)] active:scale-90 transition"
                      >
                        {item.value}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div className="grid grid-cols-5 gap-2">
              {pack.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSendBuiltInSticker(item.token)}
                  className="aspect-square rounded-2xl p-1.5 flex flex-col items-center justify-center gap-1 active:bg-[var(--dl-card)] active:scale-95 transition"
                >
                  <img
                    src={resolveAssetUrl(item.src)}
                    alt={item.label}
                    className="w-11 h-11 object-contain"
                  />
                  <span className="text-[10px] text-[var(--dl-text-muted)] truncate max-w-full">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
