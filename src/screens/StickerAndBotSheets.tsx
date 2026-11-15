import { useEffect, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  KeyRound,
  Link2,
  Pause,
  Play,
  Plus,
  Share2,
  Trash2,
  Unplug,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { nativeBridge } from "@/native/bridge";
import {
  mobileApi,
  type BotSetupSession,
  type BotTokenRecord,
  type EmoteCollectionShareDetailDTO,
  type MobileBotSummary,
} from "@/shared/api";
import { resolveAssetUrl } from "@/shared/emotes";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

export function StickerAndBotSheets() {
  const stickerStudioOpen = useNavStore((s) => s.stickerStudioOpen);
  const setStickerStudioOpen = useNavStore((s) => s.setStickerStudioOpen);
  const sharedPackId = useNavStore((s) => s.sharedPackId);
  const setSharedPackId = useNavStore((s) => s.setSharedPackId);
  const botManageOpen = useNavStore((s) => s.botManageOpen);
  const setBotManageOpen = useNavStore((s) => s.setBotManageOpen);
  const botSetupSessionId = useNavStore((s) => s.botSetupSessionId);
  const setBotSetupSessionId = useNavStore((s) => s.setBotSetupSessionId);
  const activeChatId = useNavStore((s) => s.activeChatId);
  const showToast = useNavStore((s) => s.showToast);

  const emotes = useEmoteStore((s) => s.emotes);
  const collections = useEmoteStore((s) => s.collections);
  const refreshLibrary = useEmoteStore((s) => s.refreshLibrary);
  const uploadStickers = useEmoteStore((s) => s.uploadStickers);
  const createPackWithFiles = useEmoteStore((s) => s.createPackWithFiles);
  const deleteSticker = useEmoteStore((s) => s.deleteSticker);
  const deleteCollection = useEmoteStore((s) => s.deleteCollection);

  const sendStickerPackShare = useWorkspaceStore((s) => s.sendStickerPackShare);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);

  // Sticker Studio state
  const [packName, setPackName] = useState("");
  const [studioBusy, setStudioBusy] = useState(false);

  // Shared Pack Preview state
  const [sharedDetail, setSharedDetail] = useState<EmoteCollectionShareDetailDTO | null>(null);
  const [importingPack, setImportingPack] = useState(false);

  // Bot Management state
  const [bots, setBots] = useState<MobileBotSummary[]>([]);
  const [newBotName, setNewBotName] = useState("");
  const [selectedBot, setSelectedBot] = useState<MobileBotSummary | null>(null);
  const [botTokens, setBotTokens] = useState<BotTokenRecord[]>([]);
  const [setupSession, setSetupSession] = useState<BotSetupSession | null>(null);

  useEffect(() => {
    if (stickerStudioOpen) void refreshLibrary(true);
  }, [stickerStudioOpen, refreshLibrary]);

  useEffect(() => {
    if (!sharedPackId) {
      setSharedDetail(null);
      return;
    }
    void mobileApi
      .getEmoteCollectionShare(sharedPackId)
      .then((res) => setSharedDetail(res.share))
      .catch(() => showToast("无法加载该表情包分享详情", "warning"));
  }, [sharedPackId, showToast]);

  const reloadBots = async () => {
    try {
      const list = await mobileApi.listBots();
      setBots(list);
    } catch {
      setBots([]);
    }
  };

  useEffect(() => {
    if (botManageOpen) void reloadBots();
  }, [botManageOpen]);

  useEffect(() => {
    if (!selectedBot) {
      setBotTokens([]);
      return;
    }
    void mobileApi
      .listBotTokens(selectedBot.id)
      .then((res) => setBotTokens((res.tokens || []).filter((t) => !t.revokedAt)))
      .catch(() => setBotTokens([]));
  }, [selectedBot]);

  useEffect(() => {
    if (!botSetupSessionId) {
      setSetupSession(null);
      return;
    }
    void mobileApi
      .getBotSetupSession(botSetupSessionId)
      .then((res) => setSetupSession(res.session))
      .catch(() => showToast("配对请求已过期或无效", "warning"));
  }, [botSetupSessionId, showToast]);

  const handleUploadFavoriteStickers = async () => {
    const picked = await nativeBridge.pickMedia("image", true);
    if (picked.length === 0) return;
    setStudioBusy(true);
    try {
      await uploadStickers(picked.map((f) => f.id));
      showToast(`已上传 ${picked.length} 枚收藏贴纸`, "success");
    } catch {
      showToast("贴纸上传失败", "danger");
    } finally {
      setStudioBusy(false);
    }
  };

  const handleCreatePack = async () => {
    if (!packName.trim()) {
      showToast("请先输入表情包名称", "warning");
      return;
    }
    const picked = await nativeBridge.pickMedia("image", true);
    if (picked.length === 0) return;
    setStudioBusy(true);
    try {
      await createPackWithFiles(packName.trim(), picked.map((f) => f.id));
      setPackName("");
      showToast("表情包合集已创建", "success");
    } catch {
      showToast("创建表情包失败", "danger");
    } finally {
      setStudioBusy(false);
    }
  };

  const handleSharePack = async (collectionId: string) => {
    try {
      const res = await mobileApi.createEmoteCollectionShare(collectionId);
      if (activeChatId) {
        await sendStickerPackShare(activeChatId, res.share);
        setStickerStudioOpen(false);
        showToast("已分享表情包卡片到当前会话", "success");
      } else {
        const origin = nativeBridge.getSessionSnapshot().apiOrigin;
        nativeBridge.shareText("分享 DualLane 表情包", `${origin}${res.share.sharePath}`);
      }
    } catch {
      showToast("生成表情包分享失败", "warning");
    }
  };

  const handleImportSharedPack = async () => {
    if (!sharedDetail || importingPack) return;
    setImportingPack(true);
    try {
      await mobileApi.importEmoteCollectionShare(sharedDetail.id, {
        asCollection: true,
        collectionName: sharedDetail.name,
        subscribeToSourceChanges: sharedDetail.canSubscribeToSourceChanges,
      });
      await refreshLibrary(false);
      setSharedPackId(null);
      showToast(`已添加「${sharedDetail.name}」到表情栏`, "success");
    } catch {
      showToast("导入表情包失败", "danger");
    } finally {
      setImportingPack(false);
    }
  };

  return (
    <>
      {/* Telegram-Style Sticker Studio Sheet */}
      <BottomSheet
        open={stickerStudioOpen}
        onClose={() => setStickerStudioOpen(false)}
        title="表情与贴纸工坊"
        subtitle="像 Telegram 一样自由创建、订阅与一键分享表情包"
        maxHeight="88dvh"
      >
        <div className="p-4 space-y-5">
          {/* Batch Create Sticker Pack */}
          <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2.5">
            <div className="text-[13px] font-semibold text-[var(--dl-text)]">
              新建专属表情包合集
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={packName}
                onChange={(e) => setPackName(e.target.value)}
                placeholder="输入表情包名称（如：猫猫日常）"
                className="flex-1 px-3 py-2 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13px] text-[var(--dl-text)] outline-none"
              />
              <button
                type="button"
                disabled={studioBusy}
                onClick={() => void handleCreatePack()}
                className="px-3.5 py-2 rounded-xl bg-[var(--dl-accent)] text-white text-[12px] font-semibold flex items-center gap-1 shrink-0"
              >
                <Plus size={14} /> 选图建包
              </button>
            </div>
          </div>

          {/* Existing Collections */}
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-[var(--dl-text-muted)]">
              我的表情包合集 ({collections.length})
            </div>
            {collections.map((col) => (
              <div
                key={col.id}
                className="p-3 rounded-2xl bg-[var(--dl-card)] space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[14px] font-semibold text-[var(--dl-text)]">
                      {col.name}
                    </div>
                    <div className="text-[11px] text-[var(--dl-text-muted)]">
                      {col.items?.length || 0} 枚贴纸
                      {col.sourceSubscription?.enabled ? " · 已开启更新订阅" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleSharePack(col.id)}
                      className="px-2.5 py-1.5 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[11px] font-semibold flex items-center gap-1"
                    >
                      <Share2 size={12} /> 分享
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteCollection(col.id, "keep")}
                      className="p-1.5 text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-6 gap-1.5">
                  {(col.items || []).slice(0, 6).map((item) => (
                    <img
                      key={item.id}
                      src={resolveAssetUrl(
                        item.src || `/api/workspace/emotes/custom/${encodeURIComponent(item.id)}`
                      )}
                      alt={item.label}
                      className="w-10 h-10 object-contain rounded-lg bg-[var(--dl-surface)] p-1"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Favorites Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[var(--dl-text-muted)]">
                单枚收藏贴纸 ({emotes.length})
              </span>
              <button
                type="button"
                disabled={studioBusy}
                onClick={() => void handleUploadFavoriteStickers()}
                className="text-[12px] font-semibold text-[var(--dl-accent)] flex items-center gap-1"
              >
                <Plus size={14} /> 批量上传图片
              </button>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {emotes.map((em) => (
                <div
                  key={em.id}
                  className="relative aspect-square rounded-2xl bg-[var(--dl-card)] p-2 flex items-center justify-center"
                >
                  <img
                    src={resolveAssetUrl(
                      em.src || `/api/workspace/emotes/custom/${encodeURIComponent(em.id)}`
                    )}
                    alt={em.label}
                    className="w-full h-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => void deleteSticker(em.id)}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </BottomSheet>

      {/* Shared Pack Preview & One-Tap Subscribe Sheet */}
      <BottomSheet
        open={Boolean(sharedPackId)}
        onClose={() => setSharedPackId(null)}
        title={sharedDetail?.name || "预览共享表情包"}
        subtitle={
          sharedDetail
            ? `由 ${sharedDetail.sharedBy.displayName} 分享 · 共 ${sharedDetail.itemCount} 枚`
            : "正在加载…"
        }
      >
        {sharedDetail && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-4 gap-2.5 max-h-64 overflow-y-auto p-2 rounded-2xl bg-[var(--dl-card)]">
              {(sharedDetail.items || []).map((em) => (
                <div key={em.id} className="aspect-square p-1.5 flex items-center justify-center">
                  <img
                    src={resolveAssetUrl(em.src)}
                    alt={em.label}
                    className="w-full h-full object-contain"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={importingPack}
              onClick={() => void handleImportSharedPack()}
              className="w-full py-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[15px] flex items-center justify-center gap-2"
            >
              <Check size={17} />
              <span>
                {importingPack ? "添加中…" : `一键添加表情包 (${sharedDetail.itemCount} 枚)`}
              </span>
            </button>
          </div>
        )}
      </BottomSheet>

      {/* Bot Management & Unbind Sheet (Feishu Agent Style) */}
      <BottomSheet
        open={botManageOpen}
        onClose={() => {
          setBotManageOpen(false);
          setSelectedBot(null);
        }}
        title={selectedBot ? `管理机器人 · ${selectedBot.name}` : "我的 AI 机器人管理"}
        subtitle="支持一键生成免 Token 配对链接、换头像、暂停与解绑凭证"
        maxHeight="88dvh"
      >
        <div className="p-4 space-y-4">
          {!selectedBot ? (
            <>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBotName}
                  onChange={(e) => setNewBotName(e.target.value)}
                  placeholder="新机器人名称（如：Astra 助手）"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newBotName.trim()) return;
                    await mobileApi.createBot(newBotName.trim());
                    setNewBotName("");
                    await reloadBots();
                    await bootstrapWorkspace();
                    showToast("机器人创建成功", "success");
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold shrink-0"
                >
                  创建
                </button>
              </div>

              <div className="space-y-2">
                {bots.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBot(b)}
                    className="w-full p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center gap-3 text-left active:opacity-85"
                  >
                    <Avatar name={b.name} src={b.avatarUrl} kind="bot" size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[15px] font-semibold text-[var(--dl-text)] truncate">
                          {b.name}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            b.status === "paused"
                              ? "bg-amber-500/15 text-amber-500"
                              : "bg-emerald-500/15 text-emerald-500"
                          }`}
                        >
                          {b.status === "paused" ? "已暂停" : "运行中"}
                        </span>
                      </div>
                      <div className="text-[12px] text-[var(--dl-text-muted)] truncate mt-0.5">
                        点击生成配对地址、更换头像或解绑凭证
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await nativeBridge.pickMedia("image", false);
                    if (picked.length === 0) return;
                    await mobileApi.uploadBotAvatar(selectedBot.id, picked[0].id);
                    await reloadBots();
                    await bootstrapWorkspace();
                    showToast("机器人头像已更新", "success");
                  }}
                  className="relative"
                >
                  <Avatar name={selectedBot.name} src={selectedBot.avatarUrl} kind="bot" size={54} />
                  <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center">
                    <Camera size={11} />
                  </span>
                </button>
                <div className="flex-1">
                  <div className="text-[16px] font-bold text-[var(--dl-text)]">
                    {selectedBot.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedBot(null)}
                    className="text-[12px] text-[var(--dl-accent)]"
                  >
                    ← 返回机器人列表
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    const res = await mobileApi.createBotSetupSession(selectedBot.id);
                    const fullUrl = res.setupUrl.startsWith("http")
                      ? res.setupUrl
                      : `${nativeBridge.getSessionSnapshot().apiOrigin}${res.setupUrl}`;
                    nativeBridge.copyText(fullUrl);
                    showToast("一次性免 Token 配对链接已复制", "success");
                  }}
                  className="p-3 rounded-2xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold text-[13px] flex items-center justify-center gap-1.5"
                >
                  <Link2 size={15} />
                  <span>复制配对地址</span>
                </button>

                <button
                  type="button"
                  onClick={async () => {
                    if (selectedBot.status === "paused") {
                      await mobileApi.resumeBot(selectedBot.id);
                      setSelectedBot({ ...selectedBot, status: "active" });
                      showToast("已恢复机器人收发", "success");
                    } else {
                      await mobileApi.pauseBot(selectedBot.id);
                      setSelectedBot({ ...selectedBot, status: "paused" });
                      showToast("已暂停机器人", "info");
                    }
                    void reloadBots();
                  }}
                  className="p-3 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[13px] flex items-center justify-center gap-1.5"
                >
                  {selectedBot.status === "paused" ? <Play size={15} /> : <Pause size={15} />}
                  <span>{selectedBot.status === "paused" ? "恢复运行" : "暂停接收"}</span>
                </button>
              </div>

              {/* Active Tokens & Unbind */}
              <div className="space-y-2">
                <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1">
                  <KeyRound size={13} /> 已绑定凭证 ({botTokens.length})
                </div>
                {botTokens.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-[var(--dl-card)] text-center text-[12px] text-[var(--dl-text-muted)]">
                    当前无活跃接入凭证，点击上方「复制配对地址」发给 Agent 即可完成接入
                  </div>
                ) : (
                  botTokens.map((tok) => (
                    <div
                      key={tok.id}
                      className="p-3 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-mono font-semibold text-[var(--dl-text)] truncate">
                          凭证 #{tok.id.slice(0, 8)}
                        </div>
                        <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                          权限：{tok.scopes.join(", ")}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await mobileApi.revokeBotToken(selectedBot.id, tok.id);
                          setBotTokens((prev) => prev.filter((x) => x.id !== tok.id));
                          showToast("已解绑并吊销该机器人凭证", "success");
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/12 text-rose-500 text-[12px] font-semibold flex items-center gap-1 shrink-0"
                      >
                        <Unplug size={13} /> 解绑
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* One-Click Bot Setup Authorization Sheet (via ?setup=setup_xxx) */}
      <BottomSheet
        open={Boolean(botSetupSessionId && setupSession)}
        onClose={() => setBotSetupSessionId(null)}
        title="确认授权接入机器人"
      >
        {setupSession && (
          <div className="p-4 space-y-4">
            <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-1.5">
              <div className="text-[15px] font-bold text-[var(--dl-text)]">
                {setupSession.bot?.name || "AI 智能体"} 请求绑定凭证
              </div>
              <div className="text-[12px] text-[var(--dl-text-muted)]">
                客户端：{setupSession.clientName || "DualLane Agent SDK"}
              </div>
              <div className="text-[12px] text-[var(--dl-text-muted)]">
                申请权限：{(setupSession.requestedScopes || []).join(", ")}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={async () => {
                  await mobileApi.denyBotSetupSession(setupSession.id);
                  setBotSetupSessionId(null);
                  showToast("已拒绝授权请求", "info");
                }}
                className="py-2.5 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[14px]"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={async () => {
                  await mobileApi.approveBotSetupSession(
                    setupSession.id,
                    setupSession.requestedScopes || ["messages:read", "messages:write"]
                  );
                  setBotSetupSessionId(null);
                  showToast("已完成授权绑定！", "success");
                }}
                className="py-2.5 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[14px] flex items-center justify-center gap-1.5"
              >
                <Copy size={14} className="hidden" />
                <Check size={16} /> 确认授权
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
