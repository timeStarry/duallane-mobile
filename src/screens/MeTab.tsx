import { useEffect, useState } from "react";
import {
  Bot,
  Camera,
  Check,
  ChevronRight,
  Laptop,
  LogOut,
  Moon,
  Palette,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { Avatar } from "@/components/Avatar";
import { BottomSheet } from "@/components/BottomSheet";
import { nativeBridge } from "@/native/bridge";
import { mobileApi } from "@/shared/api";
import type { UserDeviceSummary } from "@/shared/card-kit";
import { formatBytes } from "@/shared/format";
import { useThemeStore } from "@/shared/theme-store";
import { ACCENT_IDS, DESIGN_TOKENS } from "@/shared/tokens";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

export function MeTab() {
  const currentUser = useWorkspaceStore((s) => s.currentUser);
  const quotaUsedBytes = useWorkspaceStore((s) => s.quotaUsedBytes);
  const quotaLimitBytes = useWorkspaceStore((s) => s.quotaLimitBytes);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);
  const logout = useWorkspaceStore((s) => s.logout);

  const preference = useThemeStore((s) => s.preference);
  const accent = useThemeStore((s) => s.accent);
  const transparency = useThemeStore((s) => s.transparency);
  const setPreference = useThemeStore((s) => s.setPreference);
  const setAccent = useThemeStore((s) => s.setAccent);
  const setTransparency = useThemeStore((s) => s.setTransparency);

  const setStickerStudioOpen = useNavStore((s) => s.setStickerStudioOpen);
  const setBotManageOpen = useNavStore((s) => s.setBotManageOpen);
  const showToast = useNavStore((s) => s.showToast);

  const [profileSheetOpen, setProfileSheetOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(currentUser?.displayName || "");
  const [devices, setDevices] = useState<UserDeviceSummary[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);

  const snap = nativeBridge.getSessionSnapshot();

  useEffect(() => {
    if (devicesOpen) {
      void mobileApi
        .listDevices()
        .then((res) => setDevices(res.devices || []))
        .catch(() => {});
    }
  }, [devicesOpen]);

  const handleSaveNickname = async () => {
    const trimmed = nicknameDraft.trim();
    if (!trimmed || savingProfile) return;
    setSavingProfile(true);
    try {
      await mobileApi.updateMyProfile({ nickname: trimmed });
      await bootstrapWorkspace();
      setProfileSheetOpen(false);
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

  return (
    <div className="h-full flex flex-col bg-[var(--dl-bg)]">
      <header className="pt-[var(--safe-top)] bg-[var(--dl-surface)] dl-glass border-b border-[var(--dl-border)] shrink-0">
        <div className="h-13 px-4 flex items-center">
          <h1 className="text-[17px] font-bold text-[var(--dl-text)]">我</h1>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Profile Card */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-4 flex items-center gap-3.5 shadow-2xs">
          <button
            type="button"
            onClick={() => void handleUploadAvatar()}
            className="relative shrink-0"
          >
            <Avatar
              name={currentUser?.displayName || "我"}
              src={currentUser?.avatarUrl}
              size={60}
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
              {currentUser?.handle ? `@${currentUser.handle}` : "已通过 GitHub 认证"}
            </div>
            <div className="mt-1 text-[11px] text-[var(--dl-text-muted)]">
              今日传输配额：{formatBytes(quotaUsedBytes)} / {formatBytes(quotaLimitBytes)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setNicknameDraft(currentUser?.displayName || "");
              setProfileSheetOpen(true);
            }}
            className="px-3 py-1.5 rounded-xl bg-[var(--dl-card)] text-[12px] font-semibold text-[var(--dl-text)]"
          >
            编辑
          </button>
        </div>

        {/* Appearance & Liquid Vibrancy */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-4 space-y-4 shadow-2xs">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--dl-text)]">
            <Palette size={16} className="text-[var(--dl-accent)]" />
            <span>外观与主题色（与 PC 端设计语言一致）</span>
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
                  className={`py-2.5 rounded-xl border text-[12px] font-medium flex items-center justify-center gap-1.5 transition ${
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

          {/* 5 Accent Colors */}
          <div className="flex items-center justify-between gap-2 pt-1">
            {ACCENT_IDS.map((id) => {
              const cfg = DESIGN_TOKENS.accents[id];
              const active = accent === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAccent(id)}
                  className={`flex-1 py-2 rounded-xl border flex flex-col items-center gap-1 transition ${
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

          {/* Glass vs Solid */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[13px] text-[var(--dl-text-muted)]">液态磨砂材质</span>
            <button
              type="button"
              onClick={() => setTransparency(transparency === "glass" ? "solid" : "glass")}
              className={`px-3 py-1 rounded-full text-[12px] font-medium ${
                transparency === "glass"
                  ? "bg-[var(--dl-accent)] text-white"
                  : "bg-[var(--dl-card)] text-[var(--dl-text-muted)]"
              }`}
            >
              {transparency === "glass" ? "已开启叠境毛玻璃" : "纯色低功耗"}
            </button>
          </div>
        </div>

        {/* Feature Entries */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] divide-y divide-[var(--dl-border)]/60 overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setStickerStudioOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
          >
            <Sparkles size={19} className="text-[var(--dl-accent)]" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              表情与贴纸工坊
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)]" />
          </button>

          <button
            type="button"
            onClick={() => setBotManageOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
          >
            <Bot size={19} className="text-[var(--dl-accent)]" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              我的机器人与解绑管理
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)]" />
          </button>

          <button
            type="button"
            onClick={() => setDevicesOpen(true)}
            className="w-full px-4 py-3.5 flex items-center gap-3 text-left active:bg-[var(--dl-card)]"
          >
            <Laptop size={19} className="text-[var(--dl-accent)]" />
            <span className="flex-1 text-[15px] font-medium text-[var(--dl-text)]">
              在线设备与会话管理
            </span>
            <ChevronRight size={17} className="text-[var(--dl-text-muted)]" />
          </button>
        </div>

        {/* Version & Logout */}
        <div className="rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-4 space-y-3 shadow-2xs">
          <div className="flex items-center justify-between text-[12px] text-[var(--dl-text-muted)]">
            <span>当前服务节点</span>
            <span className="font-mono text-[var(--dl-text)]">
              {snap.apiOrigin.replace(/^https?:\/\//, "")}
            </span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-[var(--dl-text-muted)]">
            <span>客户端版本</span>
            <span className="font-mono text-[var(--dl-text)]">
              v{snap.appVersion} ({snap.versionCode})
            </span>
          </div>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full mt-2 py-3 rounded-2xl bg-rose-500/12 text-rose-600 dark:text-rose-400 font-semibold text-[14px] flex items-center justify-center gap-2 active:opacity-80"
          >
            <LogOut size={17} />
            <span>退出当前账号</span>
          </button>
        </div>
      </div>

      {/* Edit Profile Sheet */}
      <BottomSheet
        open={profileSheetOpen}
        onClose={() => setProfileSheetOpen(false)}
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

      {/* Active Devices Sheet */}
      <BottomSheet
        open={devicesOpen}
        onClose={() => setDevicesOpen(false)}
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
                  <div className="text-[11px] text-[var(--dl-text-muted)] mt-0.5">
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
    </div>
  );
}
