import { useCallback, useEffect, useState } from "react";
import {
  BatteryCharging,
  Bell,
  Bot,
  Camera,
  Check,
  ChevronRight,
  Download,
  EyeOff,
  ExternalLink,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Moon,
  Palette,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { MarkdownContent } from "@/components/MarkdownContent";
import { nativeBridge, type BackgroundPushStatus } from "@/native/bridge";
import { mobileApi } from "@/shared/api";
import type { UserDeviceSummary } from "@/shared/card-kit";
import { formatBytes } from "@/shared/format";
import { useThemeStore } from "@/shared/theme-store";
import { ACCENT_IDS, DESIGN_TOKENS } from "@/shared/tokens";
import { useUpdateStore } from "@/shared/updater";
import { useEmoteStore } from "@/store/emote-store";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

function ToggleSwitch({
  checked,
  disabled,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors duration-150 shrink-0 disabled:opacity-45 ${
        checked ? "bg-[var(--dl-accent)]" : "bg-[var(--dl-card)] border border-[var(--dl-border)]"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-xs transition-transform duration-150 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function MeTab() {
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const boundEmail = useWorkspaceStore((s) => s.boundEmail);
  const setBoundEmailLocal = useWorkspaceStore((s) => s.setBoundEmailLocal);
  const p2pRoom = useWorkspaceStore((s) => s.p2pRoom);
  const quotaUsedBytes = useWorkspaceStore((s) => s.quotaUsedBytes);
  const quotaLimitBytes = useWorkspaceStore((s) => s.quotaLimitBytes);
  const collapsePrefs = useWorkspaceStore((s) => s.collapsePrefs);
  const updateCollapsePreferences = useWorkspaceStore((s) => s.updateCollapsePreferences);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);
  const logout = useWorkspaceStore((s) => s.logout);

  const replyAutoMention = useEmoteStore((s) => s.settings?.replyAutoMention !== false);
  const setReplyAutoMention = useEmoteStore((s) => s.setReplyAutoMention);

  const preference = useThemeStore((s) => s.preference);
  const accent = useThemeStore((s) => s.accent);
  const transparency = useThemeStore((s) => s.transparency);
  const setPreference = useThemeStore((s) => s.setPreference);
  const setAccent = useThemeStore((s) => s.setAccent);
  const setTransparency = useThemeStore((s) => s.setTransparency);

  const setStickerStudioOpen = useNavStore((s) => s.setStickerStudioOpen);
  const setBotManageOpen = useNavStore((s) => s.setBotManageOpen);
  const setDirectOverlayOpen = useNavStore((s) => s.setDirectOverlayOpen);
  const updateSheetOpen = useNavStore((s) => s.updateSheetOpen);
  const setUpdateSheetOpen = useNavStore((s) => s.setUpdateSheetOpen);
  const meSubSheet = useNavStore((s) => s.meSubSheet);
  const setMeSubSheet = useNavStore((s) => s.setMeSubSheet);
  const showToast = useNavStore((s) => s.showToast);

  const checkingUpdate = useUpdateStore((s) => s.checking);
  const hasUpdate = useUpdateStore((s) => s.hasUpdate);
  const recommendedMode = useUpdateStore((s) => s.recommendedMode);
  const latestRelease = useUpdateStore((s) => s.latestRelease);
  const updateError = useUpdateStore((s) => s.error);
  const installingUpdate = useUpdateStore((s) => s.installing);
  const installKind = useUpdateStore((s) => s.installKind);
  const updateProgress = useUpdateStore((s) => s.progress);
  const otaStagedBundleId = useUpdateStore((s) => s.otaStagedBundleId);
  const apkPermissionPending = useUpdateStore((s) => s.apkPermissionPending);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const performOtaUpdate = useUpdateStore((s) => s.performOtaUpdate);
  const performApkUpdate = useUpdateStore((s) => s.performApkUpdate);
  const resumePendingApkInstall = useUpdateStore((s) => s.resumePendingApkInstall);

  const [nicknameDraft, setNicknameDraft] = useState(currentUser?.displayName || "");
  const [devices, setDevices] = useState<UserDeviceSummary[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);

  const [changingEmail, setChangingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailCodeDraft, setEmailCodeDraft] = useState("");
  const [emailChallengeId, setEmailChallengeId] = useState("");
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [emailBusy, setEmailBusy] = useState(false);

  const [bgPushStatus, setBgPushStatus] = useState<BackgroundPushStatus>(() =>
    nativeBridge.getBackgroundPushStatus()
  );
  const [offlineEmailEnabled, setOfflineEmailEnabled] = useState(false);
  const [offlineEmailFieldKey, setOfflineEmailFieldKey] = useState("offlineEmailEnabled");
  const [offlineEmailBusy, setOfflineEmailBusy] = useState(false);

  const snap = nativeBridge.getSessionSnapshot();
  const isNative = nativeBridge.isNativeAndroid();

  const refreshPushStatus = useCallback(() => {
    setBgPushStatus(nativeBridge.getBackgroundPushStatus());
  }, []);

  useEffect(() => {
    refreshPushStatus();
    const offResume = nativeBridge.onAppResumed(refreshPushStatus);
    const onVis = () => {
      if (document.visibilityState === "visible") refreshPushStatus();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      offResume();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshPushStatus]);

  useEffect(() => {
    let cancelled = false;
    void mobileApi
      .getMyNotificationSettings()
      .then((res) => {
        if (!cancelled) {
          setOfflineEmailEnabled(res.offlineEmailEnabled);
          setOfflineEmailFieldKey(res.fieldKey);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (emailCooldown <= 0) return;
    const timer = setInterval(() => {
      setEmailCooldown((c) => (c > 1 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [emailCooldown]);

  useEffect(() => {
    if (meSubSheet === "devices") {
      void mobileApi
        .listDevices()
        .then((res) => setDevices(res.devices || []))
        .catch(() => {});
    }
  }, [meSubSheet]);

  const handleToggleKeepAlive = (next: boolean) => {
    const updated = nativeBridge.setKeepAliveEnabled(next);
    setBgPushStatus(updated);
    showToast(next ? "已开启后台常驻实时连接" : "已关闭后台常驻守护", "info");
  };

  const handleToggleOfflineEmail = async (next: boolean) => {
    if (offlineEmailBusy) return;
    if (next && !boundEmail) {
      showToast("请先绑定登录邮箱以接收离线通知", "warning");
      openEmailSheet();
      return;
    }
    const prev = offlineEmailEnabled;
    setOfflineEmailEnabled(next);
    setOfflineEmailBusy(true);
    try {
      const saved = await mobileApi.updateMyNotificationSettings(next, offlineEmailFieldKey);
      setOfflineEmailEnabled(saved.offlineEmailEnabled);
      showToast(next ? "离线邮件提醒已开启" : "离线邮件提醒已关闭", "success");
    } catch {
      setOfflineEmailEnabled(prev);
      showToast("更新离线邮件提醒失败", "danger");
    } finally {
      setOfflineEmailBusy(false);
    }
  };

  const handleToggleReplyMention = async (next: boolean) => {
    try {
      await setReplyAutoMention(next);
    } catch {
      showToast("保存回复设置失败", "danger");
    }
  };

  const handleSaveNickname = async () => {
    const trimmed = nicknameDraft.trim();
    if (!trimmed || savingProfile) return;
    setSavingProfile(true);
    try {
      await mobileApi.updateMyProfile({ nickname: trimmed });
      await bootstrapWorkspace();
      setMeSubSheet(null);
      showToast("个人昵称已更新", "success");
    } catch {
      showToast("保存昵称失败", "danger");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUploadAvatar = async () => {
    const picked = await nativeBridge.pickMedia("image", false);
    if (picked.length === 0) return;
    try {
      await mobileApi.uploadMyAvatar(picked[0].id);
      await bootstrapWorkspace();
      showToast("个人头像已更新", "success");
    } catch {
      showToast("上传头像失败", "danger");
    }
  };

  const handleResetAvatar = async () => {
    try {
      await mobileApi.deleteMyAvatar();
      await bootstrapWorkspace();
      showToast("已恢复默认 GitHub 头像", "success");
    } catch {
      showToast("恢复头像失败", "warning");
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    try {
      await mobileApi.revokeDevice(deviceId);
      setDevices((prev) => prev.filter((d) => d.id !== deviceId));
      showToast("已移除该登录设备", "success");
    } catch {
      showToast("移除设备失败", "warning");
    }
  };

  const openEmailSheet = () => {
    setChangingEmail(!boundEmail);
    setEmailDraft("");
    setEmailCodeDraft("");
    setEmailChallengeId("");
    setMeSubSheet("email");
  };

  const handleSendBindCode = async () => {
    const clean = emailDraft.trim();
    if (!clean || !clean.includes("@")) {
      showToast("请输入有效的邮箱地址", "warning");
      return;
    }
    setEmailBusy(true);
    try {
      const res = await mobileApi.sendBindEmailCode(clean);
      setEmailChallengeId(res.challengeId);
      setEmailCooldown(Math.max(30, Number(res.cooldownSec || 60)));
      showToast(`验证码已发送至 ${res.maskedEmail || clean}`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "发送验证码失败", "danger");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleConfirmBindEmail = async () => {
    const clean = emailDraft.trim();
    const code = emailCodeDraft.trim();
    if (!clean || !emailChallengeId || code.length !== 6) return;
    setEmailBusy(true);
    try {
      const res = await mobileApi.verifyBindEmail(emailChallengeId, code);
      setBoundEmailLocal(res.email || clean);
      setChangingEmail(false);
      setMeSubSheet(null);
      showToast("登录邮箱已绑定", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "验证码校验失败", "danger");
    } finally {
      setEmailBusy(false);
    }
  };

  const handleUnbindEmail = async () => {
    setEmailBusy(true);
    try {
      await mobileApi.unbindAccountEmail();
      setBoundEmailLocal("");
      setOfflineEmailEnabled(false);
      setChangingEmail(true);
      showToast("已解绑登录邮箱", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "解绑失败", "danger");
    } finally {
      setEmailBusy(false);
    }
  };

  const activeCollapsedCount = [
    collapsePrefs.collapseImages,
    collapsePrefs.collapseStickers,
    collapsePrefs.collapseLongMessages,
  ].filter(Boolean).length;

  const notificationSummary = !bgPushStatus.keepAliveEnabled
    ? "已关闭守护"
    : !bgPushStatus.notificationsGranted
    ? "通知待开启"
    : "常驻守护中";

  const readingSummary =
    activeCollapsedCount > 0 ? `已折叠 ${activeCollapsedCount} 类` : "默认直接展开";

  const themeModeLabel =
    preference === "light" ? "浅色" : preference === "dark" ? "深色" : "跟随系统";

  return (
    <div className="h-full flex flex-col bg-[var(--dl-bg)]">
      <header className="pt-[var(--safe-top)] bg-[var(--dl-surface)] border-b border-[var(--dl-border)] shrink-0">
        <div className="h-13 px-4 flex items-center">
          <h1 className="text-[17px] font-bold text-[var(--dl-text)]">我</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {/* 1. Identity Card */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-4 flex items-center gap-3.5 shadow-2xs">
          <button
            type="button"
            onClick={() => void handleUploadAvatar()}
            aria-label="更换头像"
            className="relative shrink-0 active:opacity-85 transition-opacity duration-150"
          >
            <Avatar
              name={currentUser?.displayName || "我"}
              src={currentUser?.avatarUrl}
              size={58}
            />
            <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[var(--dl-accent)] text-white flex items-center justify-center shadow-xs">
              <Camera size={12} />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-bold text-[var(--dl-text)] truncate">
              {currentUser?.displayName || "协作成员"}
            </div>
            <div className="text-[12px] text-[var(--dl-text-muted)] truncate">
              {currentUser?.handle ? `@${currentUser.handle}` : "已通过身份认证"}
            </div>
            <div className="mt-1 text-[11px] text-[var(--dl-text-muted)] tabular-nums">
              今日配额：{formatBytes(quotaUsedBytes)} / {formatBytes(quotaLimitBytes)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setNicknameDraft(currentUser?.displayName || "");
              setMeSubSheet("profile");
            }}
            className="px-3 py-1.5 rounded-xl bg-[var(--dl-card)] text-[12px] font-semibold text-[var(--dl-text)] active:opacity-80 transition-opacity duration-150"
          >
            编辑
          </button>
        </div>

        {/* 2. Primary Capabilities Group */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setDirectOverlayOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Lock size={19} className="text-[var(--dl-accent)] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[15px] font-medium text-[var(--dl-text)]">
                一对一加密直连
              </div>
              <div className="text-[11px] text-[var(--dl-text-muted)] truncate">
                免加好友临时房间 · 端到端加密传输
              </div>
            </div>
            {p2pRoom && (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[11px] font-semibold shrink-0">
                进行中
              </span>
            )}
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setStickerStudioOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Sparkles size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              表情与贴纸工坊
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setBotManageOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Bot size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              我的机器人与解绑管理
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>
        </div>

        {/* 3. Collapsed Secondary Settings Group (Zero Exposed Low-Frequency Toggles) */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setMeSubSheet("notifications")}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Bell size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              消息通知与后台常驻
            </span>
            <span className="text-[12px] text-[var(--dl-text-muted)] shrink-0">
              {notificationSummary}
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setMeSubSheet("reading")}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <EyeOff size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              聊天阅读与自动折叠
            </span>
            <span className="text-[12px] text-[var(--dl-text-muted)] tabular-nums shrink-0">
              {readingSummary}
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setMeSubSheet("appearance")}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Palette size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              外观与主题
            </span>
            <span className="text-[12px] text-[var(--dl-text-muted)] shrink-0">
              {themeModeLabel} · {DESIGN_TOKENS.accents[accent].label}
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={openEmailSheet}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Mail size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              登录邮箱
            </span>
            <span className="text-[12px] text-[var(--dl-text-muted)] truncate max-w-[150px]">
              {boundEmail || "未自定义"}
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => setMeSubSheet("devices")}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <Laptop size={19} className="text-[var(--dl-accent)] shrink-0" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              在线设备与会话管理
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => {
              setUpdateSheetOpen(true);
              void checkForUpdates(false);
            }}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)] transition-colors duration-150"
          >
            <RefreshCw
              size={19}
              className={`text-[var(--dl-accent)] shrink-0 ${checkingUpdate ? "animate-spin" : ""}`}
            />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              检查更新
            </span>
            {hasUpdate && latestRelease ? (
              <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[11px] font-semibold tabular-nums shrink-0">
                新版本 v{latestRelease.version}
              </span>
            ) : (
              <span className="text-[12px] text-[var(--dl-text-muted)] font-mono tabular-nums shrink-0">
                v{snap.appVersion}
              </span>
            )}
            <ChevronRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
          </button>
        </div>

        {/* 4. Sign Out Action */}
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full py-3.5 rounded-[20px] bg-[var(--dl-surface)] border border-[var(--dl-border)] text-rose-600 dark:text-rose-400 font-semibold text-[14.5px] flex items-center justify-center gap-2 shadow-2xs active:opacity-80 transition-opacity duration-150"
        >
          <LogOut size={17} />
          <span>退出当前账号</span>
        </button>
      </div>

      {/* Secondary Sheet: Notifications & Background Keep-Alive */}
      <BottomSheet
        open={meSubSheet === "notifications"}
        onClose={() => setMeSubSheet(null)}
        title="消息通知与后台常驻"
        subtitle="管理后台实时推送守护与离线邮件兜底"
      >
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-[var(--dl-text)]">
                后台常驻实时连接
              </div>
              <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                静音守护连接，锁屏或切换网络时即时送达消息
              </div>
            </div>
            <ToggleSwitch
              checked={bgPushStatus.keepAliveEnabled}
              onChange={handleToggleKeepAlive}
              ariaLabel="后台常驻实时连接"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--dl-border)]/60">
            <div className="min-w-0 flex items-center gap-2.5">
              <ShieldCheck size={17} className="text-[var(--dl-accent)] shrink-0" />
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-[var(--dl-text)]">系统通知权限</div>
                <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                  在后台收到新消息或 @提及 时弹出系统通知
                </div>
              </div>
            </div>
            {bgPushStatus.notificationsGranted ? (
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[11px] font-semibold shrink-0">
                已开启
              </span>
            ) : (
              <button
                type="button"
                onClick={() => nativeBridge.requestNotificationPermission()}
                className="px-3 py-1.5 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[12px] font-semibold shrink-0 active:opacity-80 transition-opacity duration-150"
              >
                去开启
              </button>
            )}
          </div>

          {isNative && (
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--dl-border)]/60">
              <div className="min-w-0 flex items-center gap-2.5">
                <BatteryCharging size={17} className="text-[var(--dl-accent)] shrink-0" />
                <div className="min-w-0">
                  <div className="text-[14px] font-medium text-[var(--dl-text)]">
                    加入省电白名单（防杀后台）
                  </div>
                  <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                    避免系统休眠冻结后台实时推送通道
                  </div>
                </div>
              </div>
              {bgPushStatus.ignoringBatteryOptimizations ? (
                <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[11px] font-semibold shrink-0">
                  已豁免
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => nativeBridge.requestIgnoreBatteryOptimizations()}
                  className="px-3 py-1.5 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[12px] font-semibold shrink-0 active:opacity-80 transition-opacity duration-150"
                >
                  一键加入
                </button>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--dl-border)]/60">
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-[var(--dl-text)]">
                离线邮件提醒
              </div>
              <div className="text-[11.5px] text-[var(--dl-text-muted)] truncate mt-0.5">
                {boundEmail
                  ? `全端离线时发送提醒至 ${boundEmail}`
                  : "绑定登录邮箱后可开启离线邮件兜底提醒"}
              </div>
            </div>
            <ToggleSwitch
              checked={offlineEmailEnabled}
              disabled={offlineEmailBusy}
              onChange={(next) => void handleToggleOfflineEmail(next)}
              ariaLabel="离线邮件提醒"
            />
          </div>
        </div>
      </BottomSheet>

      {/* Secondary Sheet: Chat Reading & Auto-Collapse */}
      <BottomSheet
        open={meSubSheet === "reading"}
        onClose={() => setMeSubSheet(null)}
        title="聊天阅读与自动折叠"
        subtitle="公共场合防窥折叠与群聊引用习惯"
      >
        <div className="p-4 space-y-3.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-[var(--dl-text)]">
                群聊回复自动 @对方
              </div>
              <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                左滑或长按引用群消息时自动带入 @提及
              </div>
            </div>
            <ToggleSwitch
              checked={replyAutoMention}
              onChange={(next) => void handleToggleReplyMention(next)}
              ariaLabel="群聊回复自动 @对方"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--dl-border)]/60">
            <span className="text-[14px] font-medium text-[var(--dl-text)]">默认折叠图片</span>
            <ToggleSwitch
              checked={collapsePrefs.collapseImages}
              onChange={(next) => void updateCollapsePreferences({ collapseImages: next })}
              ariaLabel="折叠图片"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-medium text-[var(--dl-text)]">默认折叠贴纸</span>
            <ToggleSwitch
              checked={collapsePrefs.collapseStickers}
              onChange={(next) => void updateCollapsePreferences({ collapseStickers: next })}
              ariaLabel="折叠贴纸"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-medium text-[var(--dl-text)]">
              默认折叠超长消息 (&gt;12行)
            </span>
            <ToggleSwitch
              checked={collapsePrefs.collapseLongMessages}
              onChange={(next) => void updateCollapsePreferences({ collapseLongMessages: next })}
              ariaLabel="折叠超长消息 (>12行)"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--dl-border)]/60">
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-[var(--dl-text)]">仅本机生效</div>
              <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                开启后折叠开关仅作用于当前手机，不同步到桌面端
              </div>
            </div>
            <ToggleSwitch
              checked={collapsePrefs.localOnly}
              onChange={(next) => void updateCollapsePreferences({ localOnly: next })}
              ariaLabel="仅本机生效"
            />
          </div>
        </div>
      </BottomSheet>

      {/* Secondary Sheet: Appearance & Theme */}
      <BottomSheet
        open={meSubSheet === "appearance"}
        onClose={() => setMeSubSheet(null)}
        title="外观与主题"
        subtitle="深浅外观、主题强调色与面板材质"
      >
        <div className="p-4 space-y-4">
          <div>
            <div className="text-[12px] font-medium text-[var(--dl-text-muted)] mb-2">
              深浅外观
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: "system", label: "跟随系统", icon: Smartphone },
                  { id: "light", label: "浅色", icon: Sun },
                  { id: "dark", label: "深色", icon: Moon },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = preference === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreference(item.id)}
                    className={`py-2.5 rounded-xl border text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-colors duration-150 ${
                      active
                        ? "border-[var(--dl-accent)] bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] font-semibold"
                        : "border-[var(--dl-border)] bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
                    }`}
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[12px] font-medium text-[var(--dl-text-muted)] mb-2">
              主题强调色
            </div>
            <div className="flex items-center justify-between gap-2">
              {ACCENT_IDS.map((id) => {
                const cfg = DESIGN_TOKENS.accents[id];
                const active = accent === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setAccent(id)}
                    className={`flex-1 py-2.5 rounded-xl border flex flex-col items-center gap-1.5 transition-colors duration-150 ${
                      active
                        ? "border-[var(--dl-accent)] bg-[var(--dl-accent-soft)]"
                        : "border-[var(--dl-border)] bg-[var(--dl-card)]/60"
                    }`}
                  >
                    <span
                      style={{ backgroundColor: cfg.swatch }}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-white"
                    >
                      {active && <Check size={12} />}
                    </span>
                    <span className="text-[11px] text-[var(--dl-text)]">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--dl-border)]/60">
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-[var(--dl-text)]">浮层磨砂材质</div>
              <div className="text-[11.5px] text-[var(--dl-text-muted)] mt-0.5">
                低功耗模式下关闭浮动栏毛玻璃模糊
              </div>
            </div>
            <ToggleSwitch
              checked={transparency === "glass"}
              onChange={(next) => setTransparency(next ? "glass" : "solid")}
              ariaLabel="液态磨砂材质"
            />
          </div>
        </div>
      </BottomSheet>

      {/* Edit Profile Sheet */}
      <BottomSheet
        open={meSubSheet === "profile"}
        onClose={() => setMeSubSheet(null)}
        title="编辑个人资料"
      >
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--dl-text-muted)] mb-1.5">
              空间公开昵称
            </label>
            <input
              type="text"
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void handleResetAvatar()}
              className="px-3 py-2 rounded-xl bg-[var(--dl-card)] text-[12px] text-[var(--dl-text-muted)]"
            >
              恢复 GitHub 头像
            </button>
            <button
              type="button"
              disabled={savingProfile}
              onClick={() => void handleSaveNickname()}
              className="px-4 py-2 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold"
            >
              {savingProfile ? "保存中…" : "保存昵称"}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Bound Login Email Sheet */}
      <BottomSheet
        open={meSubSheet === "email"}
        onClose={() => setMeSubSheet(null)}
        title="登录邮箱"
        subtitle="未绑定时使用 GitHub 已验证的主邮箱"
      >
        <div className="p-4 space-y-4">
          {boundEmail && !changingEmail ? (
            <div className="space-y-3">
              <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] text-[var(--dl-text-muted)]">当前绑定邮箱</div>
                  <div className="text-[14.5px] font-semibold text-[var(--dl-text)] truncate mt-0.5">
                    {boundEmail}
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[11px] font-semibold shrink-0">
                  已绑定
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={emailBusy}
                  onClick={() => {
                    setChangingEmail(true);
                    setEmailDraft("");
                    setEmailCodeDraft("");
                    setEmailChallengeId("");
                  }}
                  className="py-2.5 rounded-xl bg-[var(--dl-card)] text-[var(--dl-text)] text-[13px] font-semibold"
                >
                  更换邮箱
                </button>
                <button
                  type="button"
                  disabled={emailBusy}
                  onClick={() => void handleUnbindEmail()}
                  className="py-2.5 rounded-xl bg-rose-500/12 text-rose-600 dark:text-rose-400 text-[13px] font-semibold"
                >
                  {emailBusy ? "处理中…" : "解绑邮箱"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-[12px] font-medium text-[var(--dl-text-muted)] mb-1.5">
                  邮箱地址
                </label>
                <input
                  type="email"
                  value={emailDraft}
                  onChange={(e) => {
                    setEmailDraft(e.target.value);
                    setEmailChallengeId("");
                  }}
                  placeholder="name@example.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
                />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={emailCodeDraft}
                  onChange={(e) =>
                    setEmailCodeDraft(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="6 位数字验证码"
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] font-mono tabular-nums tracking-widest text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
                />
                <button
                  type="button"
                  disabled={emailBusy || emailCooldown > 0 || !emailDraft.trim()}
                  onClick={() => void handleSendBindCode()}
                  className="px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[12.5px] font-semibold text-[var(--dl-accent)] tabular-nums shrink-0 disabled:opacity-50"
                >
                  {emailCooldown > 0 ? `${emailCooldown}s` : "获取验证码"}
                </button>
              </div>

              <div className="flex items-center gap-2 pt-1">
                {boundEmail && (
                  <button
                    type="button"
                    onClick={() => setChangingEmail(false)}
                    className="px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] text-[13px] font-medium text-[var(--dl-text-muted)]"
                  >
                    取消
                  </button>
                )}
                <button
                  type="button"
                  disabled={
                    emailBusy ||
                    !emailDraft.trim() ||
                    !emailChallengeId ||
                    emailCodeDraft.trim().length !== 6
                  }
                  onClick={() => void handleConfirmBindEmail()}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--dl-accent)] text-white text-[13.5px] font-semibold disabled:opacity-50"
                >
                  {emailBusy ? "校验中…" : "确认绑定"}
                </button>
              </div>
            </div>
          )}
        </div>
      </BottomSheet>

      {/* Active Devices Sheet */}
      <BottomSheet
        open={meSubSheet === "devices"}
        onClose={() => setMeSubSheet(null)}
        title="已登录设备管理"
        subtitle="可随时吊销其他终端的访问会话"
      >
        <div className="p-4 space-y-2.5">
          {devices.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-[var(--dl-text-muted)]">
              当前仅本机在线
            </div>
          ) : (
            devices.map((d) => (
              <div
                key={d.id}
                className="p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[var(--dl-text)] truncate">
                    {d.deviceName || d.platform}
                    {d.current && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
                        本机
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--dl-text-muted)] mt-0.5 tabular-nums">
                    最近活跃：{new Date(d.lastActiveAt).toLocaleString("zh-CN")}
                  </div>
                </div>
                {!d.current && (
                  <button
                    type="button"
                    onClick={() => void handleRevokeDevice(d.id)}
                    className="p-2 rounded-xl text-rose-500 active:bg-rose-500/10"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </BottomSheet>

      {/* Check for Updates Sheet */}
      <BottomSheet
        open={updateSheetOpen}
        onClose={() => setUpdateSheetOpen(false)}
        title="检查版本更新"
        subtitle={`界面 v${snap.appVersion} · Android v${snap.nativeVersion || snap.appVersion} (${snap.versionCode}) · ${snap.apiOrigin.replace(
          /^https?:\/\//,
          ""
        )}${snap.otaActive ? " · 热更生效中" : ""}`}
      >
        <div className="p-4 space-y-4">
          {checkingUpdate ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2.5 text-[var(--dl-text-muted)]">
              <RefreshCw size={22} className="animate-spin text-[var(--dl-accent)]" />
              <span className="text-[13px]">正在查询最新版本…</span>
            </div>
          ) : (
            <>
              {updateError && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-300 text-[13px] space-y-1">
                  <div className="font-semibold">更新操作未完成</div>
                  <div className="text-[12px] opacity-90">{updateError}</div>
                </div>
              )}

              {latestRelease && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-bold text-[var(--dl-text)]">
                          {latestRelease.title || `v${latestRelease.version}`}
                        </span>
                        {hasUpdate ? (
                          recommendedMode === "ota" ? (
                            <span className="px-2 py-0.5 rounded-full bg-[var(--dl-accent)] text-white text-[10px] font-semibold">
                              支持秒级热更
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-semibold">
                              有可用更新
                            </span>
                          )
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[10px] font-semibold">
                            已是最新
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--dl-text-muted)] mt-1 tabular-nums">
                        最新版本 v{latestRelease.version}
                        {recommendedMode === "ota" && latestRelease.ota?.byteSize
                          ? ` · 热更包 ${formatBytes(latestRelease.ota.byteSize)}`
                          : latestRelease.apkSizeBytes > 0
                          ? ` · 安装包 ${formatBytes(latestRelease.apkSizeBytes)}`
                          : ""}
                      </div>
                    </div>
                  </div>

                  {latestRelease.notes && (
                    <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] max-h-52 overflow-y-auto">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold text-[var(--dl-text-muted)]">
                          版本说明
                        </span>
                        {latestRelease.source === "server" && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[10px] font-semibold">
                            当前节点直发
                          </span>
                        )}
                      </div>
                      <MarkdownContent content={latestRelease.notes} />
                    </div>
                  )}

                  {installingUpdate && updateProgress && (
                    <div className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-2">
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-medium text-[var(--dl-text)]">
                          {updateProgress.phase === "verifying"
                            ? "正在校验完整性摘要…"
                            : installKind === "ota"
                            ? "正在应用内拉取秒级热更包…"
                            : "正在应用内下载更新安装包…"}
                        </span>
                        <span className="font-mono text-[11px] text-[var(--dl-accent)] font-semibold tabular-nums">
                          {Math.max(0, Math.min(100, updateProgress.percent))}%
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[var(--dl-surface)] overflow-hidden">
                        <div
                          className="h-full w-full rounded-full bg-[var(--dl-accent)] origin-left transition-transform duration-150"
                          style={{
                            transform: `scaleX(${Math.max(
                              0.04,
                              Math.min(1, updateProgress.percent / 100)
                            )})`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {hasUpdate && recommendedMode === "ota" && latestRelease.ota && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        disabled={installingUpdate}
                        onClick={async () => {
                          const res = await performOtaUpdate(true);
                          if (!res.ok && res.error) {
                            showToast(res.error, "danger");
                          }
                        }}
                        className="w-full py-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-55 active:opacity-90 transition-opacity duration-150"
                      >
                        <Sparkles size={16} />
                        <span>
                          {otaStagedBundleId === latestRelease.ota.bundleId
                            ? "热更已就绪 · 立即秒级生效（免安装）"
                            : `立即秒级热更（免安装${
                                latestRelease.ota.byteSize > 0
                                  ? ` · ${formatBytes(latestRelease.ota.byteSize)}`
                                  : ""
                              }）`}
                        </span>
                      </button>

                      {latestRelease.apkSizeBytes > 0 &&
                        (latestRelease.versionCode || 0) > (snap.versionCode || 0) && (
                          <button
                            type="button"
                            disabled={installingUpdate}
                            onClick={async () => {
                              const res = await performApkUpdate();
                              if (res.status === "permission_requested") {
                                showToast("请允许安装未知来源应用，授权后将自动调起安装", "info");
                              }
                            }}
                            className="w-full py-2.5 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-medium text-[12.5px] flex items-center justify-center gap-1.5 disabled:opacity-50"
                          >
                            <Download size={14} />
                            <span>
                              应用内下载完整安装包 ({formatBytes(latestRelease.apkSizeBytes)})
                            </span>
                          </button>
                        )}
                    </div>
                  )}

                  {hasUpdate && recommendedMode === "apk" && (
                    <div className="space-y-2">
                      {apkPermissionPending ? (
                        <button
                          type="button"
                          onClick={() => void resumePendingApkInstall()}
                          className="w-full py-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[14px] flex items-center justify-center gap-2 active:opacity-90 transition-opacity duration-150"
                        >
                          <Download size={16} />
                          <span>安装包已就绪 · 调起系统安装器</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={installingUpdate}
                          onClick={async () => {
                            const res = await performApkUpdate();
                            if (res.status === "permission_requested") {
                              showToast("请开启允许安装此来源应用，返回后自动安装", "info");
                            }
                          }}
                          className="w-full py-3 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[14px] flex items-center justify-center gap-2 disabled:opacity-55 active:opacity-90 transition-opacity duration-150"
                        >
                          <Download size={16} />
                          <span>
                            应用内下载并安装
                            {latestRelease.apkSizeBytes > 0
                              ? ` (${formatBytes(latestRelease.apkSizeBytes)})`
                              : ""}
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={checkingUpdate || installingUpdate}
              onClick={async () => {
                const res = await checkForUpdates(false);
                if (!res.error && !res.hasUpdate) {
                  showToast("当前已是最新版本", "success");
                }
              }}
              className="py-2.5 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text)] font-semibold text-[13px] flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={14} className={checkingUpdate ? "animate-spin" : ""} />
              <span>重新检查</span>
            </button>
            <button
              type="button"
              onClick={() =>
                nativeBridge.openExternalUrl(
                  latestRelease?.apkUrl ||
                    `${snap.apiOrigin.replace(/\/+$/, "")}/api/v1/mobile/android/latest.apk`
                )
              }
              className="py-2.5 rounded-2xl bg-[var(--dl-card)] text-[var(--dl-text-muted)] font-semibold text-[13px] flex items-center justify-center gap-1.5"
            >
              <ExternalLink size={14} />
              <span>浏览器备用下载</span>
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
