import { useCallback, useEffect, useRef, useState } from "react";
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
import { BotGroupRequests } from "@/components/BotGroupRequests";
import { nativeBridge } from "@/native/bridge";
import {
  mobileApi,
  type BotConnectionInfo,
  type BotSetupSession,
  type BotTokenRecord,
  type EmoteCollectionShareDetailDTO,
  type MobileBotConversationItem,
  type MobileBotSummary,
} from "@/shared/api";
import { resolveAssetUrl, resolveLibraryStickerSrc } from "@/shared/emotes";
import {
  buildBotPairingPrompt as buildPairingPrompt,
  parseBotAccessPolicy, privateAssistantGroupPolicy, validateBotAccessPolicy, withBotAccessPolicy,
  type BotAccessPolicy, type BotPolicyAudience, type BotGroupAudience,
} from "@/shared/bot-policy";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

type MobileBotSubView = "root" | "permissions" | "conversations" | "persona" | "credentials";
type MobileGroupPreset = "disabled" | "owner_only" | "approval_required" | "open";

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

  const favoriteEmotes = useEmoteStore((s) => s.favoriteEmotes);
  const collections = useEmoteStore((s) => s.collections);
  const refreshLibrary = useEmoteStore((s) => s.refreshLibrary);
  const uploadStickers = useEmoteStore((s) => s.uploadStickers);
  const createPackWithFiles = useEmoteStore((s) => s.createPackWithFiles);
  const deleteSticker = useEmoteStore((s) => s.deleteSticker);
  const deleteCollection = useEmoteStore((s) => s.deleteCollection);

  const members = useWorkspaceStore((s) => s.members);
  const conversations = useWorkspaceStore((s) => s.conversations);
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
  const [latestSdkVer, setLatestSdkVer] = useState("");
  const [accessPolicy, setAccessPolicy] = useState<BotAccessPolicy | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const detailEpoch = useRef(0);

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
    const requestEpoch = ++detailEpoch.current;
    const [tokRes, connRes, setRes, ovRes] = await Promise.all([
      mobileApi.listBotTokens(botId).catch(() => ({ tokens: [] })),
      mobileApi.getBotConnection(botId).catch(() => ({ connection: null })),
      mobileApi.getBotSettings(botId).catch(() => null),
      mobileApi.getBotOverview(botId).catch(() => null),
    ]);
    if (requestEpoch !== detailEpoch.current) return;
    setSettingsLoaded(Boolean(setRes?.settings));
    setPolicyError(setRes?.settings ? "" : "暂时无法读取权限，请刷新后再修改");
    setBotTokens((tokRes.tokens || []).filter((t) => !t.revokedAt));
    setBotConnection(connRes.connection || null);
    if (setRes?.settings) {
      const s = setRes.settings;
      try { setAccessPolicy(parseBotAccessPolicy(s.accessPolicy)); }
      catch (error) {
        setAccessPolicy(null);
        setPolicyError(error instanceof Error ? error.message : "权限响应无效");
      }
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
    detailEpoch.current += 1;
    setSettingsLoaded(false);
    setPolicyError("");
    setAccessPolicy(null);
    setBotTokens([]);
    setBotConnection(null);
    setBotConversations([]);
    setLatestSdkVer("");
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
    const validScopes = session.requestedScopes || [];
    if (validScopes.length === 0) throw new Error("未收到明确的权限申请，请让 Agent 重新发起配对请求");
    const res = await mobileApi.approveBotSetupSession(session.id, validScopes);
    const targetBotId = session.bot?.id || selectedBot?.id;
    const targetBotUserId =
      session.bot?.botUserId ||
      bots.find((b) => b.id === targetBotId)?.botUserId ||
      selectedBot?.botUserId;
    if (targetBotId && targetBotUserId) {
      // Pairing approves the shown token scopes, not a new history/trigger grant.
      await mobileApi.createDirectConversation(targetBotUserId).catch(() => null);
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
      const dmRes = await mobileApi.createDirectConversation(selectedBot.botUserId);
      const convObj = (dmRes?.conversation || dmRes) as Record<string, unknown>;
      const dmConvId = String(convObj?.id || "");
      if (dmConvId) {
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
  const groupPreset = accessPolicy
    ? allowGroup ? "owner_only" : "disabled"
    : resolveGroupPreset(allowGroup, groupInviterPolicy, requireOwnerApproval);
  const savePermissionSettings = async (patch: Record<string, unknown>) => {
    if (!selectedBot || !settingsLoaded || policyError) throw new Error("请先重新加载机器人权限");
    await mobileApi.updateBotSettings(selectedBot.id, withBotAccessPolicy(patch, accessPolicy));
  };

  const visibilitySummaryLabel =
    accessPolicy
      ? accessPolicy.direct.audience === "owner_only" ? "仅创建者私聊"
        : accessPolicy.direct.audience === "specified_members" ? "指定成员可私聊" : "空间成员可私聊"
      : visPolicy === "space_members"
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
                      src={resolveLibraryStickerSrc(item)}
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
                单枚收藏贴纸 ({favoriteEmotes.length})
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
              {favoriteEmotes.map((em) => (
                <div
                  key={em.id}
                  className="relative aspect-square rounded-2xl bg-[var(--dl-card)] p-2 flex items-center justify-center"
                >
                  <img
                    src={resolveLibraryStickerSrc(em)}
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

              {!settingsLoaded || policyError ? (
                <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2">
                  <p role={policyError ? "alert" : "status"} className="text-[12px] text-[var(--dl-text-muted)]">
                    {policyError || "正在读取机器人权限…"}
                  </p>
                  <button type="button" className="text-[13px] text-[var(--dl-accent)]"
                    onClick={() => void refreshSelectedBotDetail(selectedBot.id)}>重新加载权限</button>
                </div>
              ) : (
                <BotAccessPolicyEditor key={selectedBot.id} policy={accessPolicy}
                  members={Object.values(members).filter((member) => member.role !== "bot")}
                  botSources={bots.filter((bot) => bot.id !== selectedBot.id)}
                  onSave={async (next) => {
                    const requestEpoch = detailEpoch.current;
                    await mobileApi.updateBotSettings(selectedBot.id, { accessPolicy: next });
                    if (requestEpoch !== detailEpoch.current) return;
                    setAccessPolicy(next);
                    await refreshSelectedBotDetail(selectedBot.id);
                    if (requestEpoch + 1 === detailEpoch.current) showToast("独立权限已保存", "success");
                  }} />
              )}

              {settingsLoaded && !policyError && !accessPolicy && (
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
                          await savePermissionSettings({
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
                              try {
                                await savePermissionSettings({ allowedMemberIds: next });
                              } catch {
                                await refreshSelectedBotDetail(selectedBot.id);
                                showToast("保存失败，已重新读取权限", "warning");
                              }
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
              )}

              <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2">
                <div className="text-[12.5px] font-semibold text-[var(--dl-text)]">
                  群聊准入与唤醒规则
                </div>
                {(
                  accessPolicy ? [
                    { id: "owner_only", label: "允许创建者申请入群 · 群管理员批准" },
                    { id: "disabled", label: "禁止加入群聊" },
                  ] as const : [
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
                      disabled={!settingsLoaded || Boolean(policyError)}
                      onClick={async () => {
                        const patch = buildGroupPresetPatch(opt.id);
                        setAllowGroup(Boolean(patch.allowGroup));
                        setGroupInviterPolicy(String(patch.groupInviterPolicy));
                        setRequireOwnerApproval(Boolean(patch.requireOwnerApproval));
                        try {
                          await savePermissionSettings(patch);
                          void refreshSelectedBotDetail(selectedBot.id);
                          showToast("群聊准入策略已更新", "success");
                        } catch {
                          await refreshSelectedBotDetail(selectedBot.id);
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
                    disabled={!settingsLoaded || Boolean(policyError)}
                    onClick={async () => {
                      const nextPrivacy = triggerPolicy === "all-messages";
                      const nextMode = nextPrivacy ? "mention-or-command" : "all-messages";
                      setTriggerPolicy(nextMode);
                      try {
                        await savePermissionSettings({ triggerPolicy: nextMode });
                        showToast(nextPrivacy ? "已设为仅 @提及/回复唤醒" : "已设为群聊全量消息响应", "success");
                      } catch {
                        await refreshSelectedBotDetail(selectedBot.id);
                        showToast("保存失败，已重新读取权限", "warning");
                      }
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

              <BotGroupRequests key={selectedBot.id} botId={selectedBot.id}
                conversations={Object.values(conversations).filter((group) => group.kind === "group")} />

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
                      disabled={conv.type === "group"}
                      onClick={async () => {
                        try {
                          const nextCtx = !conv.allowContext;
                          // A group grant is a two-party request. Its generic
                          // policy PATCH defaults to active, so it must never
                          // be used as a history-only toggle.
                          if (conv.type === "group") return;
                          await mobileApi.updateBotContextGrant(selectedBot.id, conv.id, {
                            allowContext: nextCtx,
                            ...(nextCtx && conv.maxMessages <= 0 ? { maxMessages: 20 } : {}),
                          });
                          await refreshSelectedBotDetail(selectedBot.id);
                          showToast("历史读取授权已更新，唤醒状态保持不变", "success");
                        } catch {
                          showToast("更新失败", "warning");
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-[var(--dl-surface)] text-[12px] font-semibold text-[var(--dl-accent)] shrink-0 disabled:opacity-60"
                    >
                      {conv.type === "group"
                        ? "历史范围请在上方重新申请"
                        : conv.allowContext
                        ? "关闭上下文"
                        : "开启上下文（最多" + (conv.maxMessages > 0 ? conv.maxMessages : 20) + "条）"}
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

/**
 * Intent: let a Bot owner express who can discover, DM and invoke it in a group.
 * Each audience leads its own compact card; existing DL surfaces, accent and
 * body sizes keep this a settings editor rather than a new visual system.
 */
export function BotAccessPolicyEditor({ policy, members, botSources, onSave }: {
  policy: BotAccessPolicy | null;
  members: Array<{ id: string; displayName: string }>;
  botSources: Array<{ id: string; name: string }>;
  onSave: (policy: BotAccessPolicy) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => parseBotAccessPolicy(policy) || privateAssistantGroupPolicy());
  const [editing, setEditing] = useState(policy !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(parseBotAccessPolicy(policy) || privateAssistantGroupPolicy());
    setEditing(policy !== null);
    setError("");
  }, [policy]);
  const changeAudience = (key: "discovery" | "direct" | "groups", audience: BotPolicyAudience | BotGroupAudience) => {
    setSaved(false);
    setDraft((current) => key === "groups" ? {
      ...current, groups: {
        ...current.groups, audience: audience as BotGroupAudience,
        memberIds: audience === "specified_members" ? current.groups.memberIds : [],
      },
    } : {
      ...current, [key]: {
        audience: audience as BotPolicyAudience,
        memberIds: audience === "specified_members" ? current[key].memberIds : [],
      },
    });
  };
  const toggleMember = (key: "discovery" | "direct" | "groups", memberId: string) => {
    setSaved(false);
    setDraft((current) => ({
      ...current, [key]: {
        ...current[key],
        memberIds: current[key].memberIds.includes(memberId)
          ? current[key].memberIds.filter((id) => id !== memberId)
          : [...current[key].memberIds, memberId],
      },
    }));
  };
  const axisOptions = [
    { key: "discovery", title: "目录发现", owner: "仅创建者可发现", all: "空间成员可发现" },
    { key: "direct", title: "发起私聊", owner: "仅创建者可私聊", all: "空间成员可私聊" },
    { key: "groups", title: "已批准群内的使用者", owner: "仅创建者可在群内使用", all: "该群当前成员可使用" },
  ] as const;
  return (
    <section aria-label="独立机器人权限" className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-3">
      <h4 className="text-[13px] font-semibold text-[var(--dl-text)]">独立权限</h4>
      <p className="text-[12px] leading-5 text-[var(--dl-text-muted)]">
        目录发现、发起私聊和群内使用分别控制。允许群友使用，不会开放他们的私聊权限。
      </p>
      {!policy && <p className="text-[12px] leading-5 text-[var(--dl-text-muted)]">
        当前仍沿用旧规则。查看本页不会转换权限；启用前请核对下面的范围。
      </p>}
      {!editing ? <button type="button"
        className="w-full p-3 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[13px] font-semibold"
        onClick={() => setEditing(true)}>设置“仅自己私聊，指定群共享”</button> : <>
        {axisOptions.map((axis) => (
          <div key={axis.key} className="space-y-2">
            <label className="block text-[12px] font-medium text-[var(--dl-text)]">{axis.title}
              <select aria-label={axis.title} disabled={busy} value={draft[axis.key].audience}
                onChange={(event) => changeAudience(axis.key, event.target.value as BotPolicyAudience | BotGroupAudience)}
                className="mt-1 w-full p-2.5 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13px]">
                <option value="owner_only">{axis.owner}</option>
                <option value="specified_members">创建者与指定成员</option>
                <option value={axis.key === "groups" ? "current_members" : "space_members"}>{axis.all}</option>
              </select>
            </label>
            {draft[axis.key].audience === "specified_members" && (
              <div className="max-h-36 overflow-y-auto space-y-2 rounded-xl bg-[var(--dl-surface)] p-3">
                {members.length === 0 ? <p className="text-[12px] text-[var(--dl-text-muted)]">当前没有可选择的人类成员</p>
                  : members.map((member) => (
                    <label key={member.id} className="flex items-center gap-2 text-[12px] text-[var(--dl-text)]">
                      <input type="checkbox" disabled={busy} aria-label={axis.title + "成员：" + member.displayName}
                        checked={draft[axis.key].memberIds.includes(member.id)}
                        onChange={() => toggleMember(axis.key, member.id)} />
                      <span>{member.displayName}</span>
                    </label>
                  ))}
              </div>
            )}
          </div>
        ))}
        <div className="space-y-2 rounded-xl bg-[var(--dl-surface)] p-3">
          <label className="flex items-center gap-2 text-[12px] font-medium text-[var(--dl-text)]">
            <input type="checkbox" disabled={busy} checked={draft.groups.allowBotTriggers}
              onChange={(event) => {
                const checked = event.target.checked;
                setSaved(false);
                setDraft((current) => ({ ...current, groups: {
                  ...current.groups, allowBotTriggers: checked,
                  allowedBotIds: checked ? current.groups.allowedBotIds : [],
                } }));
              }} />允许指定机器人触发
          </label>
          <p className="text-[11px] leading-5 text-[var(--dl-text-muted)]">
            默认关闭。开启后仍需逐个指定来源，并遵守服务端轮数、因果链和停止控制。
          </p>
          {draft.groups.allowBotTriggers && <>
            {botSources.map((source) => (
              <label key={source.id} className="flex items-center gap-2 text-[12px] text-[var(--dl-text)]">
                <input type="checkbox" disabled={busy} aria-label={source.name + "可触发此机器人"}
                  checked={draft.groups.allowedBotIds.includes(source.id)}
                  onChange={() => {
                    setSaved(false);
                    setDraft((current) => ({ ...current, groups: { ...current.groups,
                      allowedBotIds: current.groups.allowedBotIds.includes(source.id)
                        ? current.groups.allowedBotIds.filter((id) => id !== source.id)
                        : [...current.groups.allowedBotIds, source.id],
                    } }));
                  }} />{source.name}
              </label>
            ))}
            {botSources.length === 0 && <p className="text-[12px] text-[var(--dl-text-muted)]">没有可选择的其他机器人，不会自动允许未来新增的机器人。</p>}
            {draft.groups.allowedBotIds.some((id) => !botSources.some((source) => source.id === id)) &&
              <p className="text-[11px] text-[var(--dl-text-muted)]">另有已保存的来源当前不可查看，其授权会保留；关闭机器人触发可清空全部来源。</p>}
          </>}
        </div>
        {error && <p role="alert" className="text-[12px] text-[var(--dl-danger,#dc2626)]">{error}</p>}
        {saved && <p role="status" className="text-[12px] text-[var(--dl-text)]">独立权限已保存</p>}
        <button type="button" disabled={busy}
          className="w-full p-3 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold disabled:opacity-50"
          onClick={async () => {
            if (busy) return;
            setError(""); setSaved(false);
            try {
              validateBotAccessPolicy(draft);
              setBusy(true);
              await onSave(draft);
              setSaved(true);
            } catch (cause) { setError(cause instanceof Error ? cause.message : "权限保存失败"); }
            finally { setBusy(false); }
          }}>{busy ? "正在保存…" : policy ? "保存独立权限" : "启用并保存独立权限"}</button>
      </>}
    </section>
  );
}
