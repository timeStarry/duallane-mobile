import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpCircle,
  Camera,
  Check,
  ChevronRight,
  Copy,
  KeyRound,
  Link2,
  Lock,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unplug,
  Users,
  X,
} from "lucide-react";
import { Avatar, BOT_AVATAR_COLORS } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { nativeBridge } from "@/native/bridge";
import {
  DEFAULT_BOT_PAIRING_SCOPES,
  mobileApi,
  type BotConnectionInfo,
  type BotSetupSession,
  type BotTokenRecord,
  type EmoteCollectionShareDetailDTO,
  type MobileBotConversationItem,
  type MobileBotSummary,
} from "@/shared/api";
import { resolveAssetUrl } from "@/shared/emotes";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

type MobileBotSubView = "root" | "permissions" | "conversations" | "persona" | "credentials";
type MobileGroupPreset = "disabled" | "owner_only" | "approval_required" | "open";

function buildPairingPrompt(botName: string, origin: string, sessionId: string): string {
  const cleanOrigin = origin.replace(/\/+$/, "") || "https://duallane.tsio.top";
  const skillUrl = `${cleanOrigin}/integrations/duallane-channel.md`;
  const runtimeUrl = `${cleanOrigin}/integrations/duallane-agent.mjs`;
  const setupUrl = `${cleanOrigin}/workspace?setup=${encodeURIComponent(sessionId)}`;
  return [
    `请接入我的 DualLane 机器人「${botName}」：`,
    `1. 先阅读接入规范：${skillUrl}`,
    `2. 无需 npm，直接从当前实例下载零依赖单文件运行时（含 CLI / MCP / 空闲自动热更）：`,
    `   mkdir -p ~/.duallane/bin && curl -fsSL "${runtimeUrl}" -o ~/.duallane/bin/duallane-agent.mjs && chmod +x ~/.duallane/bin/duallane-agent.mjs`,
    `3. 使用一次性配对地址发起绑定（无需手动粘贴 Token）：${setupUrl}`,
    `发起请求后提醒我点击「确认授权」；授权完成后请运行 node ~/.duallane/bin/duallane-agent.mjs daemon install --profile default --agent auto 注册常驻后台守护服务（支持断线自愈、空闲静默热更新与群聊安全隔离）。`,
  ].join("\n");
}

function copyTextReliable(text: string): void {
  nativeBridge.copyText(text);
  if (!nativeBridge.isNativeAndroid() && typeof document !== "undefined") {
    try {
      const el = document.createElement("textarea");
      el.value = text;
      el.setAttribute("readonly", "true");
      el.style.position = "fixed";
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    } catch {
      // Ignore DOM fallback errors
    }
  }
}

function normalizeVisibility(raw?: string): "private" | "specified_members" | "space_members" {
  if (raw === "space_members") return "space_members";
  if (raw === "specified_members") return "specified_members";
  return "private";
}

function resolveGroupPreset(
  allowGroup: boolean,
  inviterPolicy: string,
  requireApproval: boolean
): MobileGroupPreset {
  if (!allowGroup) return "disabled";
  if (inviterPolicy === "owner") return "owner_only";
  if (requireApproval) return "approval_required";
  return "open";
}

function buildGroupPresetPatch(preset: MobileGroupPreset): Record<string, unknown> {
  switch (preset) {
    case "disabled":
      return { allowGroup: false, groupInviterPolicy: "owner", requireOwnerApproval: true };
    case "owner_only":
      return { allowGroup: true, groupInviterPolicy: "owner", requireOwnerApproval: true };
    case "approval_required":
      return { allowGroup: true, groupInviterPolicy: "any_member", requireOwnerApproval: true };
    case "open":
      return { allowGroup: true, groupInviterPolicy: "any_member", requireOwnerApproval: false };
  }
}

function extractSemver(adapterVersion?: string | null): string {
  if (!adapterVersion) return "";
  const m = /(\d+\.\d+\.\d+)/u.exec(adapterVersion);
  return m ? m[1] : "";
}

function isOlderSemver(cur: string, latest: string): boolean {
  if (!cur || !latest) return false;
  const pa = cur.split(".").map((x) => Number.parseInt(x, 10) || 0);
  const pb = latest.split(".").map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

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
  const openChat = useNavStore((s) => s.openChat);
  const showToast = useNavStore((s) => s.showToast);

  const emotes = useEmoteStore((s) => s.emotes);
  const collections = useEmoteStore((s) => s.collections);
  const refreshLibrary = useEmoteStore((s) => s.refreshLibrary);
  const uploadStickers = useEmoteStore((s) => s.uploadStickers);
  const createPackWithFiles = useEmoteStore((s) => s.createPackWithFiles);
  const deleteSticker = useEmoteStore((s) => s.deleteSticker);
  const deleteCollection = useEmoteStore((s) => s.deleteCollection);

  const members = useWorkspaceStore((s) => s.members);
  const patchMemberLocal = useWorkspaceStore((s) => s.patchMemberLocal);
  const sendStickerPackShare = useWorkspaceStore((s) => s.sendStickerPackShare);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);

  // Sticker Studio state
  const [packName, setPackName] = useState("");
  const [studioBusy, setStudioBusy] = useState(false);

  // Shared Pack Preview state
  const [sharedDetail, setSharedDetail] = useState<EmoteCollectionShareDetailDTO | null>(null);
  const [importingPack, setImportingPack] = useState(false);

  // Bot Management state (Hierarchical — never flat)
  const [bots, setBots] = useState<MobileBotSummary[]>([]);
  const [newBotName, setNewBotName] = useState("");
  const [selectedBot, setSelectedBot] = useState<MobileBotSummary | null>(null);
  const [botSubView, setBotSubView] = useState<MobileBotSubView>("root");
  const [botTokens, setBotTokens] = useState<BotTokenRecord[]>([]);
  const [botConnection, setBotConnection] = useState<BotConnectionInfo | null>(null);
  const [botConversations, setBotConversations] = useState<MobileBotConversationItem[]>([]);
  const [latestSdkVer, setLatestSdkVer] = useState("1.0.14");

  // Selected Bot Settings state
  const [visPolicy, setVisPolicy] = useState<"private" | "specified_members" | "space_members">("private");
  const [allowedMemberIds, setAllowedMemberIds] = useState<string[]>([]);
  const [allowGroup, setAllowGroup] = useState(true);
  const [groupInviterPolicy, setGroupInviterPolicy] = useState("owner");
  const [requireOwnerApproval, setRequireOwnerApproval] = useState(true);
  const [triggerPolicy, setTriggerPolicy] = useState("mention-or-command");
  const [nameDraft, setNameDraft] = useState("");
  const [bioDraft, setBioDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [setupSession, setSetupSession] = useState<BotSetupSession | null>(null);
  const [inlineSetupSession, setInlineSetupSession] = useState<BotSetupSession | null>(null);
  const [pairingPromptText, setPairingPromptText] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [copiedKind, setCopiedKind] = useState<"" | "prompt" | "url">("");

  const markCopiedKind = (kind: "prompt" | "url") => {
    setCopiedKind(kind);
    window.setTimeout(() => {
      setCopiedKind((prev) => (prev === kind ? "" : prev));
    }, 2200);
  };

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

  const reloadBots = useCallback(async () => {
    try {
      const list = await mobileApi.listBots();
      setBots(list);
    } catch {
      setBots([]);
    }
  }, []);

  useEffect(() => {
    if (botManageOpen) void reloadBots();
  }, [botManageOpen, reloadBots]);

  const refreshSelectedBotDetail = useCallback(async (botId: string) => {
    const [tokRes, connRes, setRes, ovRes] = await Promise.all([
      mobileApi.listBotTokens(botId).catch(() => ({ tokens: [] })),
      mobileApi.getBotConnection(botId).catch(() => ({ connection: null })),
      mobileApi.getBotSettings(botId).catch(() => null),
      mobileApi.getBotOverview(botId).catch(() => null),
    ]);
    setBotTokens((tokRes.tokens || []).filter((t) => !t.revokedAt));
    setBotConnection(connRes.connection || null);
    if (setRes?.settings) {
      const s = setRes.settings;
      const rawVis = String(s.visibilityPolicy || "private");
      setVisPolicy(normalizeVisibility(rawVis));
      setAllowedMemberIds(
        Array.isArray(s.allowedMemberIds) ? s.allowedMemberIds.map(String) : []
      );
      setAllowGroup(rawVis === "groups" ? true : s.allowGroup !== false);
      setGroupInviterPolicy(String(s.groupInviterPolicy || "owner"));
      setRequireOwnerApproval(s.requireOwnerApproval !== false);
      setTriggerPolicy(String(s.triggerPolicy || "mention-or-command"));
      if (typeof s.description === "string") {
        setBioDraft(s.description);
      }
    }
    if (ovRes) {
      setBotConversations(Array.isArray(ovRes.conversations) ? ovRes.conversations : []);
      if (ovRes.latestSdkVersion) setLatestSdkVer(ovRes.latestSdkVersion);
    }
  }, []);

  useEffect(() => {
    if (!selectedBot) {
      setBotTokens([]);
      setBotConnection(null);
      setBotConversations([]);
      setInlineSetupSession(null);
      setPairingPromptText("");
      setBotSubView("root");
      setConfirmDelete(false);
      return;
    }
    setNameDraft(selectedBot.name);
    setBioDraft(selectedBot.description || "");
    void refreshSelectedBotDetail(selectedBot.id);
  }, [refreshSelectedBotDetail, selectedBot]);

  useEffect(() => {
    const activeId = inlineSetupSession?.id;
    const status = inlineSetupSession?.status;
    if (
      !activeId ||
      (status !== "created" && status !== "awaiting_user" && status !== "approved")
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void mobileApi
        .getBotSetupSession(activeId)
        .then((res) => {
          if (!res.session) return;
          setInlineSetupSession((prev) => {
            const next = res.session;
            if (prev?.status !== "exchanged" && next.status === "exchanged") {
              showToast("Agent 已完成凭证换取并成功绑定！", "success");
              if (next.bot?.id) {
                void refreshSelectedBotDetail(next.bot.id);
              }
            }
            return next;
          });
        })
        .catch(() => {});
    }, 2200);
    return () => window.clearInterval(timer);
  }, [inlineSetupSession?.id, inlineSetupSession?.status, refreshSelectedBotDetail, showToast]);

  const completeBotApproveFlow = async (session: BotSetupSession) => {
    const validScopes =
      session.requestedScopes && session.requestedScopes.length > 0
        ? session.requestedScopes
        : [...DEFAULT_BOT_PAIRING_SCOPES];
    const res = await mobileApi.approveBotSetupSession(session.id, validScopes);
    const targetBotId = session.bot?.id || selectedBot?.id;
    const targetBotUserId =
      session.bot?.botUserId ||
      bots.find((b) => b.id === targetBotId)?.botUserId ||
      selectedBot?.botUserId;
    if (targetBotId && targetBotUserId) {
      await mobileApi.updateBotSettings(targetBotId, { allowDirect: true }).catch(() => {});
      const dmRes = await mobileApi.createDirectConversation(targetBotUserId).catch(() => null);
      const convObj = (dmRes?.conversation || dmRes) as Record<string, unknown> | null;
      const dmConvId = convObj?.id ? String(convObj.id) : "";
      if (dmConvId) {
        await mobileApi
          .updateBotContextGrant(targetBotId, dmConvId, {
            allowTrigger: true,
            allowContext: true,
            maxMessages: 50,
          })
          .catch(() => {});
      }
      void bootstrapWorkspace().catch(() => {});
    }
    if (targetBotId) {
      void refreshSelectedBotDetail(targetBotId);
    }
    return res.session;
  };

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

  const handleOpenBotDirectChat = async () => {
    if (!selectedBot?.botUserId) return;
    try {
      await mobileApi.updateBotSettings(selectedBot.id, { allowDirect: true }).catch(() => {});
      const dmRes = await mobileApi.createDirectConversation(selectedBot.botUserId);
      const convObj = (dmRes?.conversation || dmRes) as Record<string, unknown>;
      const dmConvId = String(convObj?.id || "");
      if (dmConvId) {
        await mobileApi
          .updateBotContextGrant(selectedBot.id, dmConvId, {
            allowTrigger: true,
            allowContext: true,
            maxMessages: 50,
          })
          .catch(() => {});
        await bootstrapWorkspace().catch(() => {});
        setBotManageOpen(false);
        setSelectedBot(null);
        openChat(dmConvId);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "打开机器人私聊失败", "warning");
    }
  };

  const connectedVer = extractSemver(botConnection?.adapterVersion);
  const updateAvailable = isOlderSemver(connectedVer, latestSdkVer);
  const groupPreset = resolveGroupPreset(allowGroup, groupInviterPolicy, requireOwnerApproval);

  const visibilitySummaryLabel =
    visPolicy === "space_members"
      ? "全员可用"
      : visPolicy === "specified_members"
      ? `指定 ${allowedMemberIds.length} 人`
      : "仅创建者";

  const sheetTitle = !selectedBot
    ? "我的 AI 机器人管理"
    : botSubView === "permissions"
    ? `权限与准入 · ${selectedBot.name}`
    : botSubView === "conversations"
    ? `已接入会话 · ${selectedBot.name}`
    : botSubView === "persona"
    ? `资料与主题色 · ${selectedBot.name}`
    : botSubView === "credentials"
    ? `凭证与运行管理 · ${selectedBot.name}`
    : `管理机器人 · ${selectedBot.name}`;

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
                        item.src || `/api/workspace/emotes/${encodeURIComponent(item.id)}/content`
                      )}
                      alt={item.label}
                      className="w-10 h-10 object-contain rounded-lg bg-[var(--dl-surface)] p-1"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

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
                      em.src || `/api/workspace/emotes/${encodeURIComponent(em.id)}/content`
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

      {/* Hierarchical Bot Management Sheet (Restrained Sub-Views — Never Flat) */}
      <BottomSheet
        open={botManageOpen}
        onClose={() => {
          setBotManageOpen(false);
          setSelectedBot(null);
          setBotSubView("root");
        }}
        title={sheetTitle}
        subtitle="创建者私聊永久保留 · 守护进程空闲自动静默热更"
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
                  placeholder="新机器人名称（如：Comet 助手）"
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!newBotName.trim()) return;
                    try {
                      await mobileApi.createBot(newBotName.trim());
                      setNewBotName("");
                      await reloadBots();
                      await bootstrapWorkspace();
                      showToast("机器人已创建，专属私聊已自动开通", "success");
                    } catch (err) {
                      showToast(err instanceof Error ? err.message : "创建机器人失败", "warning");
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold shrink-0 active:opacity-85 transition-opacity duration-150"
                >
                  创建
                </button>
              </div>

              <div className="space-y-2">
                {bots.map((b) => {
                  const botColor =
                    (b.botUserId ? members[b.botUserId]?.avatarColor : undefined) ??
                    b.avatarColor;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setSelectedBot(b);
                        setBotSubView("root");
                      }}
                      className="w-full p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center gap-3 text-left active:opacity-85 transition-opacity duration-150"
                    >
                      <Avatar
                        name={b.name}
                        src={b.avatarUrl}
                        kind="bot"
                        color={botColor}
                        size={44}
                      />
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
                          {b.description || "点击进入私聊、复制配对指令或调整权限"}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-[var(--dl-text-muted)] shrink-0" />
                    </button>
                  );
                })}
              </div>
            </>
          ) : botSubView === "root" ? (
            <div className="space-y-4">
              {/* Identity & Status Header */}
              <div className="flex items-center gap-3">
                <Avatar
                  name={selectedBot.name}
                  src={selectedBot.avatarUrl}
                  kind="bot"
                  color={
                    (selectedBot.botUserId
                      ? members[selectedBot.botUserId]?.avatarColor
                      : undefined) ??
                    selectedBot.avatarColor ??
                    ""
                  }
                  size={52}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[16px] font-bold text-[var(--dl-text)] truncate">
                      {selectedBot.name}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0 tabular-nums ${
                        botConnection?.status === "connected"
                          ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)]"
                          : "bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
                      }`}
                    >
                      {botConnection?.status === "connected"
                        ? `实时在线${connectedVer ? ` · v${connectedVer}` : ""}`
                        : "待机 / 按需"}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <button
                      type="button"
                      onClick={() => setSelectedBot(null)}
                      className="text-[12px] text-[var(--dl-accent)] font-medium"
                    >
                      ← 返回机器人列表
                    </button>
                  </div>
                </div>
              </div>

              {/* Remote Upgrade Banner (Only shown when connected daemon runs an older version) */}
              {botConnection?.status === "connected" && updateAvailable && (
                <div className="p-3 rounded-2xl bg-amber-500/12 border border-amber-500/25 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold text-[var(--dl-text)] tabular-nums">
                      可升级至 SDK v{latestSdkVer}
                    </div>
                    <div className="text-[11px] text-[var(--dl-text-muted)]">
                      空闲时会自动升级，也可立即推送热更新
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await mobileApi.requestBotRuntimeUpgrade(selectedBot.id);
                        showToast(`已下发 v${res.targetVersion} 热更信号`, "success");
                      } catch {
                        showToast("下发升级通知失败", "warning");
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-[var(--dl-accent)] text-white text-[12px] font-semibold flex items-center gap-1 shrink-0 active:opacity-85 transition-opacity duration-150"
                  >
                    <ArrowUpCircle size={13} /> 立即热更
                  </button>
                </div>
              )}

              {/* Primary Dual Actions: Open DM + Copy Pairing Command */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleOpenBotDirectChat()}
                  className="p-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[13px] flex items-center justify-center gap-1.5 active:opacity-85 transition-opacity duration-150"
                >
                  <MessageSquare size={15} />
                  <span>发起私聊</span>
                </button>

                <button
                  type="button"
                  disabled={pairingBusy}
                  onClick={async () => {
                    if (selectedBot.status === "paused") {
                      showToast("机器人处于暂停状态，请先在运行管理中恢复运行", "warning");
                      return;
                    }
                    setPairingBusy(true);
                    try {
                      const res = await mobileApi.createBotSetupSession(selectedBot.id);
                      const origin =
                        nativeBridge.getSessionSnapshot().apiOrigin ||
                        (typeof window !== "undefined" ? window.location.origin : "") ||
                        "https://duallane.tsio.top";
                      const prompt = buildPairingPrompt(selectedBot.name, origin, res.session.id);
                      setInlineSetupSession(res.session);
                      setPairingPromptText(prompt);
                      copyTextReliable(prompt);
                      markCopiedKind("prompt");
                      showToast("Agent 配对指令已复制，发给任意 AI 即可接入", "success");
                    } catch (err) {
                      showToast(
                        err instanceof Error ? err.message : "生成配对指令失败，请重试",
                        "warning"
                      );
                    } finally {
                      setPairingBusy(false);
                    }
                  }}
                  className="p-3 rounded-2xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-60 active:opacity-85 transition-opacity duration-150"
                >
                  {pairingBusy ? (
                    <RefreshCw size={15} className="animate-spin" />
                  ) : copiedKind === "prompt" ? (
                    <Check size={15} />
                  ) : (
                    <Copy size={15} />
                  )}
                  <span>
                    {pairingBusy
                      ? "生成中…"
                      : copiedKind === "prompt"
                      ? "已复制配对指令"
                      : "复制配对指令"}
                  </span>
                </button>
              </div>

              {/* Inline Pairing Session Prompt & Live Approval Card */}
              {inlineSetupSession &&
                inlineSetupSession.status !== "denied" &&
                inlineSetupSession.status !== "expired" &&
                inlineSetupSession.status !== "revoked" && (
                  <div className="p-3.5 rounded-2xl border border-[var(--dl-accent)]/35 bg-[var(--dl-accent-soft)]/35 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-[var(--dl-text)] flex items-center gap-1.5">
                          <ShieldCheck size={15} className="text-[var(--dl-accent)] shrink-0" />
                          <span>
                            {inlineSetupSession.status === "exchanged"
                              ? "Agent 配对已完成"
                              : inlineSetupSession.status === "approved"
                              ? "已授权，等待 Agent 换取凭证…"
                              : inlineSetupSession.status === "awaiting_user"
                              ? "收到 Agent 配对请求，请确认授权"
                              : "配对指令已就绪，等待 Agent 发起请求…"}
                          </span>
                        </div>
                        {inlineSetupSession.clientName && (
                          <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                            客户端：{inlineSetupSession.clientName}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        aria-label="关闭配对卡片"
                        onClick={() => {
                          setInlineSetupSession(null);
                          setPairingPromptText("");
                        }}
                        className="p-1 rounded-lg text-[var(--dl-text-muted)] active:bg-[var(--dl-card)]"
                      >
                        <X size={15} />
                      </button>
                    </div>

                    {pairingPromptText && inlineSetupSession.status === "created" && (
                      <div className="p-2.5 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] space-y-2">
                        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-[var(--dl-text-muted)] max-h-28 overflow-y-auto select-all">
                          {pairingPromptText}
                        </pre>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              copyTextReliable(pairingPromptText);
                              markCopiedKind("prompt");
                              showToast("配对指令已复制", "success");
                            }}
                            className="px-3 py-1.5 rounded-xl bg-[var(--dl-accent)] text-white text-[12px] font-semibold flex items-center gap-1 active:opacity-85 transition-opacity duration-150"
                          >
                            {copiedKind === "prompt" ? <Check size={13} /> : <Copy size={13} />}
                            <span>{copiedKind === "prompt" ? "已复制指令" : "再次复制指令"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const origin =
                                nativeBridge.getSessionSnapshot().apiOrigin ||
                                (typeof window !== "undefined" ? window.location.origin : "") ||
                                "https://duallane.tsio.top";
                              const url = `${origin.replace(/\/+$/, "")}/workspace?setup=${encodeURIComponent(
                                inlineSetupSession.id
                              )}`;
                              copyTextReliable(url);
                              markCopiedKind("url");
                              showToast("一次性配对链接已复制", "success");
                            }}
                            className="px-3 py-1.5 rounded-xl bg-[var(--dl-card)] text-[var(--dl-text)] text-[12px] font-medium flex items-center gap-1 active:opacity-85 transition-opacity duration-150"
                          >
                            {copiedKind === "url" ? <Check size={13} /> : <Link2 size={13} />}
                            <span>{copiedKind === "url" ? "已复制链接" : "仅复制链接"}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {(inlineSetupSession.status === "created" ||
                      inlineSetupSession.status === "awaiting_user") && (
                      <div className="grid grid-cols-2 gap-2.5 pt-0.5">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await mobileApi.denyBotSetupSession(inlineSetupSession.id);
                              setInlineSetupSession(null);
                              setPairingPromptText("");
                              showToast("已取消本次配对会话", "info");
                            } catch (err) {
                              showToast(
                                err instanceof Error ? err.message : "拒绝配对失败",
                                "warning"
                              );
                            }
                          }}
                          className="py-2 rounded-xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[12.5px] active:opacity-85 transition-opacity duration-150"
                        >
                          取消 / 拒绝
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const next = await completeBotApproveFlow(inlineSetupSession);
                              setInlineSetupSession(next);
                              showToast("已确认授权，等待 Agent 完成凭证换取", "success");
                            } catch (err) {
                              showToast(
                                err instanceof Error ? err.message : "确认授权失败",
                                "warning"
                              );
                            }
                          }}
                          className="py-2 rounded-xl bg-[var(--dl-accent)] text-white font-semibold text-[12.5px] flex items-center justify-center gap-1 active:opacity-85 transition-opacity duration-150"
                        >
                          <Check size={14} /> 确认授权
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* 4 Clean Categorized Entry Rows (No Flat Dumping) */}
              <div className="rounded-2xl bg-[var(--dl-card)] divide-y divide-[var(--dl-border)] overflow-hidden">
                <button
                  type="button"
                  onClick={() => setBotSubView("permissions")}
                  className="w-full px-3.5 py-3.5 flex items-center justify-between gap-3 text-left active:opacity-80 transition-opacity duration-150"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Users size={17} className="text-[var(--dl-accent)] shrink-0" />
                    <span className="text-[14px] font-medium text-[var(--dl-text)]">
                      权限与群聊准入
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[12px] text-[var(--dl-text-muted)] shrink-0">
                    <span>
                      {visibilitySummaryLabel} · {allowGroup ? "可入群" : "仅私聊"}
                    </span>
                    <ChevronRight size={15} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setBotSubView("conversations")}
                  className="w-full px-3.5 py-3.5 flex items-center justify-between gap-3 text-left active:opacity-80 transition-opacity duration-150"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <MessageSquare size={17} className="text-[var(--dl-accent)] shrink-0" />
                    <span className="text-[14px] font-medium text-[var(--dl-text)]">
                      已接入会话与上下文
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[12px] text-[var(--dl-text-muted)] shrink-0 tabular-nums">
                    <span>{botConversations.length} 个会话</span>
                    <ChevronRight size={15} />
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setBotSubView("persona")}
                  className="w-full px-3.5 py-3.5 flex items-center justify-between gap-3 text-left active:opacity-80 transition-opacity duration-150"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Sparkles size={17} className="text-[var(--dl-accent)] shrink-0" />
                    <span className="text-[14px] font-medium text-[var(--dl-text)]">
                      资料、头像与主题色
                    </span>
                  </div>
                  <ChevronRight size={15} className="text-[var(--dl-text-muted)] shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setBotSubView("credentials")}
                  className="w-full px-3.5 py-3.5 flex items-center justify-between gap-3 text-left active:opacity-80 transition-opacity duration-150"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <KeyRound size={17} className="text-[var(--dl-accent)] shrink-0" />
                    <span className="text-[14px] font-medium text-[var(--dl-text)]">
                      绑定凭证与运行管理
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[12px] text-[var(--dl-text-muted)] shrink-0 tabular-nums">
                    <span>{botTokens.length} 把凭证</span>
                    <ChevronRight size={15} />
                  </div>
                </button>
              </div>
            </div>
          ) : botSubView === "permissions" ? (
            /* Sub-view 1: Orthogonal Permissions */
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setBotSubView("root")}
                className="text-[13px] font-medium text-[var(--dl-accent)]"
              >
                ← 返回机器人主页
              </button>

              <div className="p-3 rounded-2xl bg-[var(--dl-accent-soft)]/50 flex items-center gap-2 text-[12px] text-[var(--dl-text)]">
                <Lock size={14} className="text-[var(--dl-accent)] shrink-0" />
                <span>创建者本人 1v1 私聊权限永久保留，不受下方范围影响</span>
              </div>

              <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2">
                <div className="text-[12.5px] font-semibold text-[var(--dl-text)]">
                  1. 成员可用范围（谁可私聊）
                </div>
                {(
                  [
                    { id: "private", label: "仅创建者本人可用（默认）" },
                    { id: "specified_members", label: "创建者 + 指定空间成员" },
                    { id: "space_members", label: "全空间成员可用" },
                  ] as const
                ).map((opt) => {
                  const checked = visPolicy === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={async () => {
                        setVisPolicy(opt.id);
                        try {
                          await mobileApi.updateBotSettings(selectedBot.id, {
                            visibilityPolicy: opt.id,
                            allowDirect: true,
                          });
                          void refreshSelectedBotDetail(selectedBot.id);
                          showToast("成员可用范围已更新", "success");
                        } catch {
                          showToast("保存失败", "warning");
                        }
                      }}
                      className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between text-[13px] ${
                        checked
                          ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold"
                          : "bg-[var(--dl-surface)] text-[var(--dl-text)]"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {checked && <Check size={15} />}
                    </button>
                  );
                })}

                {visPolicy === "specified_members" && (
                  <div className="max-h-36 overflow-y-auto pt-1 space-y-1">
                    {Object.values(members)
                      .filter((m) => m.role !== "bot")
                      .map((m) => {
                        const checked = allowedMemberIds.includes(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={async () => {
                              const next = checked
                                ? allowedMemberIds.filter((id) => id !== m.id)
                                : [...allowedMemberIds, m.id];
                              setAllowedMemberIds(next);
                              await mobileApi
                                .updateBotSettings(selectedBot.id, { allowedMemberIds: next })
                                .catch(() => {});
                            }}
                            className="w-full px-3 py-2 rounded-xl bg-[var(--dl-surface)] flex items-center justify-between text-[12.5px] text-[var(--dl-text)]"
                          >
                            <span>{m.displayName}</span>
                            <span className="text-[var(--dl-accent)]">
                              {checked ? "✓ 已授权" : "授权"}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2">
                <div className="text-[12.5px] font-semibold text-[var(--dl-text)]">
                  2. 群聊准入与唤醒规则
                </div>
                {(
                  [
                    { id: "owner_only", label: "允许入群 · 仅创建者可拉入" },
                    { id: "approval_required", label: "允许入群 · 成员拉入需审批" },
                    { id: "open", label: "允许入群 · 获准成员可直接拉入" },
                    { id: "disabled", label: "禁止加入群聊" },
                  ] as const
                ).map((opt) => {
                  const checked = groupPreset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={async () => {
                        const patch = buildGroupPresetPatch(opt.id);
                        setAllowGroup(Boolean(patch.allowGroup));
                        setGroupInviterPolicy(String(patch.groupInviterPolicy));
                        setRequireOwnerApproval(Boolean(patch.requireOwnerApproval));
                        try {
                          await mobileApi.updateBotSettings(selectedBot.id, patch);
                          void refreshSelectedBotDetail(selectedBot.id);
                          showToast("群聊准入策略已更新", "success");
                        } catch {
                          showToast("保存失败", "warning");
                        }
                      }}
                      className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between text-[13px] ${
                        checked
                          ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold"
                          : "bg-[var(--dl-surface)] text-[var(--dl-text)]"
                      }`}
                    >
                      <span>{opt.label}</span>
                      {checked && <Check size={15} />}
                    </button>
                  );
                })}

                {allowGroup && (
                  <button
                    type="button"
                    onClick={async () => {
                      const nextPrivacy = triggerPolicy === "all-messages";
                      const nextMode = nextPrivacy ? "mention-or-command" : "all-messages";
                      setTriggerPolicy(nextMode);
                      await mobileApi
                        .updateBotSettings(selectedBot.id, { triggerPolicy: nextMode })
                        .catch(() => {});
                      showToast(
                        nextPrivacy ? "已设为仅 @提及/回复唤醒" : "已设为群聊全量消息响应",
                        "success"
                      );
                    }}
                    className="w-full mt-1 px-3 py-2.5 rounded-xl bg-[var(--dl-surface)] flex items-center justify-between text-[12.5px]"
                  >
                    <span className="text-[var(--dl-text)]">群内仅 `@提及` / 回复唤醒</span>
                    <span className="font-semibold text-[var(--dl-accent)]">
                      {triggerPolicy !== "all-messages" ? "已开启" : "全量响应"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ) : botSubView === "conversations" ? (
            /* Sub-view 2: Connected Conversations & Effective Trigger Status */
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setBotSubView("root")}
                className="text-[13px] font-medium text-[var(--dl-accent)]"
              >
                ← 返回机器人主页
              </button>

              {botConversations.length === 0 ? (
                <div className="p-4 rounded-2xl bg-[var(--dl-card)] text-center text-[12.5px] text-[var(--dl-text-muted)]">
                  暂无已接入会话，点击主页「发起私聊」即可开始对话
                </div>
              ) : (
                botConversations.map((conv) => (
                  <div
                    key={conv.id}
                    className="p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold text-[var(--dl-text)] truncate">
                        {conv.type === "direct" ? `私聊 · ${conv.title}` : `群聊 · ${conv.title}`}
                      </div>
                      <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                        {conv.allowTrigger
                          ? conv.type === "direct"
                            ? "🟢 私聊实时响应"
                            : conv.triggerMode === "all_messages"
                            ? "🟢 群内全量响应"
                            : "🟢 群内 @提及唤醒"
                          : "🟡 待授权或已暂停"}
                        {conv.allowContext ? ` · 上下文 ${conv.maxMessages} 条` : " · 仅单条消息"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const nextCtx = !conv.allowContext;
                          if (conv.type === "group") {
                            await mobileApi.updateBotGroupPolicy(selectedBot.id, conv.id, {
                              status: "active",
                              allowTrigger: true,
                              allowContext: nextCtx,
                              maxMessages: 50,
                            });
                          } else {
                            await mobileApi.updateBotContextGrant(selectedBot.id, conv.id, {
                              allowTrigger: true,
                              allowContext: nextCtx,
                              maxMessages: 50,
                            });
                          }
                          await refreshSelectedBotDetail(selectedBot.id);
                          showToast("会话授权已更新", "success");
                        } catch {
                          showToast("更新失败", "warning");
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[var(--dl-surface)] text-[12px] font-semibold text-[var(--dl-accent)] shrink-0"
                    >
                      {conv.type === "group" && conv.groupPolicyStatus !== "active"
                        ? "批准入群"
                        : conv.allowContext
                        ? "关闭上下文"
                        : "开启上下文"}
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : botSubView === "persona" ? (
            /* Sub-view 3: Persona, Avatar & Theme Color */
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setBotSubView("root")}
                className="text-[13px] font-medium text-[var(--dl-accent)]"
              >
                ← 返回机器人主页
              </button>

              {(() => {
                const selectedBotColor =
                  (selectedBot.botUserId
                    ? members[selectedBot.botUserId]?.avatarColor
                    : undefined) ??
                  selectedBot.avatarColor ??
                  "";
                const handleSelectBotColor = async (nextColor: string) => {
                  const prevColor = selectedBotColor;
                  setSelectedBot({ ...selectedBot, avatarColor: nextColor || undefined });
                  if (selectedBot.botUserId) {
                    patchMemberLocal(selectedBot.botUserId, {
                      avatarColor: nextColor || undefined,
                    });
                  }
                  try {
                    await mobileApi.updateBotProfile(selectedBot.id, { color: nextColor });
                    void reloadBots();
                    showToast("机器人主题色已更新", "success");
                  } catch {
                    setSelectedBot({ ...selectedBot, avatarColor: prevColor || undefined });
                    if (selectedBot.botUserId) {
                      patchMemberLocal(selectedBot.botUserId, {
                        avatarColor: prevColor || undefined,
                      });
                    }
                    showToast("更新机器人主题色失败", "warning");
                  }
                };

                return (
                  <>
                    <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const picked = await nativeBridge.pickMedia("image", false);
                            if (picked.length === 0) return;
                            await mobileApi.uploadBotAvatar(selectedBot.id, picked[0].id);
                            await reloadBots();
                            await bootstrapWorkspace();
                            showToast("机器人头像已更新", "success");
                          } catch (err) {
                            showToast(
                              err instanceof Error ? err.message : "上传机器人头像失败",
                              "warning"
                            );
                          }
                        }}
                        className="relative shrink-0"
                      >
                        <Avatar
                          name={selectedBot.name}
                          src={selectedBot.avatarUrl}
                          kind="bot"
                          color={selectedBotColor}
                          size={54}
                        />
                        <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center">
                          <Camera size={11} />
                        </span>
                      </button>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-[13px] font-semibold text-[var(--dl-text)]">
                          点击左侧图标上传自定义头像
                        </div>
                        {selectedBot.avatarUrl && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await mobileApi.deleteBotAvatar(selectedBot.id);
                                setSelectedBot({ ...selectedBot, avatarUrl: undefined });
                                await reloadBots();
                                await bootstrapWorkspace();
                                showToast("已恢复默认彩色机器人图标", "success");
                              } catch {
                                showToast("恢复默认图标失败", "warning");
                              }
                            }}
                            className="text-[12px] text-[var(--dl-accent)]"
                          >
                            恢复默认彩色图标
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2.5">
                      <input
                        type="text"
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder="机器人显示名称"
                        className="w-full px-3 py-2 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13.5px] text-[var(--dl-text)] outline-none"
                      />
                      <input
                        type="text"
                        value={bioDraft}
                        onChange={(e) => setBioDraft(e.target.value)}
                        placeholder="职责简介（选填）"
                        className="w-full px-3 py-2 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13.5px] text-[var(--dl-text)] outline-none"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          if (!nameDraft.trim()) return;
                          try {
                            await mobileApi.updateBotProfile(selectedBot.id, {
                              name: nameDraft.trim(),
                              description: bioDraft.trim(),
                            });
                            setSelectedBot({
                              ...selectedBot,
                              name: nameDraft.trim(),
                              description: bioDraft.trim(),
                            });
                            void reloadBots();
                            void bootstrapWorkspace();
                            showToast("机器人资料已保存", "success");
                          } catch (err) {
                            showToast(err instanceof Error ? err.message : "保存失败", "warning");
                          }
                        }}
                        className="w-full py-2.5 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold active:opacity-85 transition-opacity duration-150"
                      >
                        保存名称与简介
                      </button>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[12.5px] font-semibold text-[var(--dl-text)]">
                          机器人主题色
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleSelectBotColor("")}
                          className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                            !selectedBotColor
                              ? "bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold"
                              : "text-[var(--dl-text-muted)]"
                          }`}
                        >
                          自动分配
                        </button>
                      </div>
                      <div className="grid grid-cols-8 gap-2">
                        {BOT_AVATAR_COLORS.map((preset) => {
                          const active = selectedBotColor === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              aria-label={preset.label}
                              onClick={() => void handleSelectBotColor(preset.id)}
                              style={{ backgroundImage: preset.gradient }}
                              className={`aspect-square rounded-xl flex items-center justify-center text-white shadow-2xs transition-transform duration-150 ${
                                active
                                  ? "ring-2 ring-offset-2 ring-[var(--dl-accent)] scale-105"
                                  : "opacity-88"
                              }`}
                            >
                              {active && <Check size={13} />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            /* Sub-view 4: Bound Credentials & Lifecycle Controls */
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => setBotSubView("root")}
                className="text-[13px] font-medium text-[var(--dl-accent)]"
              >
                ← 返回机器人主页
              </button>

              <div className="space-y-2">
                <div className="text-[12px] font-semibold text-[var(--dl-text-muted)] flex items-center gap-1 tabular-nums">
                  <KeyRound size={13} /> 已绑定凭证 ({botTokens.length})
                </div>
                {botTokens.length === 0 ? (
                  <div className="p-4 rounded-2xl bg-[var(--dl-card)] text-center text-[12px] text-[var(--dl-text-muted)]">
                    当前无活跃接入凭证，可在机器人主页点击「复制配对指令」完成绑定
                  </div>
                ) : (
                  botTokens.map((tok) => (
                    <div
                      key={tok.id}
                      className="p-3 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-mono font-semibold text-[var(--dl-text)] truncate tabular-nums">
                          凭证 #{tok.id.slice(-8)}
                        </div>
                        <div className="text-[11px] text-[var(--dl-text-muted)] truncate tabular-nums">
                          已授予 {tok.scopes.length} 项能力权限
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await mobileApi.revokeBotToken(selectedBot.id, tok.id);
                            setBotTokens((prev) => prev.filter((x) => x.id !== tok.id));
                            showToast("已解绑并吊销该机器人凭证", "success");
                          } catch (err) {
                            showToast(
                              err instanceof Error ? err.message : "解绑凭证失败",
                              "warning"
                            );
                          }
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-500/12 text-rose-500 text-[12px] font-semibold flex items-center gap-1 shrink-0 active:opacity-85 transition-opacity duration-150"
                      >
                        <Unplug size={13} /> 解绑
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="pt-2 space-y-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (selectedBot.status === "paused") {
                        await mobileApi.resumeBot(selectedBot.id);
                        setSelectedBot({ ...selectedBot, status: "active" });
                        showToast("已恢复机器人运行", "success");
                      } else {
                        await mobileApi.pauseBot(selectedBot.id);
                        setSelectedBot({ ...selectedBot, status: "paused" });
                        showToast("已暂停机器人响应", "info");
                      }
                      void reloadBots();
                    } catch (err) {
                      showToast(
                        err instanceof Error ? err.message : "切换运行状态失败",
                        "warning"
                      );
                    }
                  }}
                  className="w-full p-3 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[13.5px] flex items-center justify-center gap-1.5 active:opacity-85 transition-opacity duration-150"
                >
                  {selectedBot.status === "paused" ? <Play size={15} /> : <Pause size={15} />}
                  <span>{selectedBot.status === "paused" ? "恢复机器人运行" : "暂停机器人响应"}</span>
                </button>

                {!confirmDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    className="w-full p-3 rounded-2xl bg-rose-500/10 text-rose-500 font-semibold text-[13.5px] flex items-center justify-center gap-1.5 active:opacity-85 transition-opacity duration-150"
                  >
                    <Trash2 size={15} />
                    <span>永久删除该机器人</span>
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="p-3 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[13px]"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await mobileApi.beginDeleteBot(selectedBot.id);
                          await mobileApi.confirmDeleteBot(selectedBot.id);
                          setSelectedBot(null);
                          setConfirmDelete(false);
                          await reloadBots();
                          await bootstrapWorkspace();
                          showToast("机器人已永久删除", "success");
                        } catch (err) {
                          showToast(err instanceof Error ? err.message : "删除失败", "warning");
                        }
                      }}
                      className="p-3 rounded-2xl bg-rose-500 text-white font-semibold text-[13px]"
                    >
                      确认永久删除
                    </button>
                  </div>
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
                  try {
                    await mobileApi.denyBotSetupSession(setupSession.id);
                    setBotSetupSessionId(null);
                    showToast("已拒绝授权请求", "info");
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "拒绝授权失败", "warning");
                  }
                }}
                className="py-2.5 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[14px] active:opacity-85 transition-opacity duration-150"
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await completeBotApproveFlow(setupSession);
                    setBotSetupSessionId(null);
                    showToast("已完成授权绑定！", "success");
                  } catch (err) {
                    showToast(err instanceof Error ? err.message : "确认授权失败", "warning");
                  }
                }}
                className="py-2.5 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[14px] flex items-center justify-center gap-1.5 active:opacity-85 transition-opacity duration-150"
              >
                <Check size={16} /> 确认授权
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </>
  );
}
