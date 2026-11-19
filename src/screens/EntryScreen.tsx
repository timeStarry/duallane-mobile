import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Github,
  KeyRound,
  Lock,
  Mail,
  Server,
  ShieldCheck,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { BottomSheet } from "@/components/BottomSheet";
import { nativeBridge } from "@/native/bridge";
import { mobileApi } from "@/shared/api";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";
import { DirectTab } from "./DirectTab";

export function EntryScreen() {
  const entryLane = useNavStore((s) => s.entryLane);
  const setEntryLane = useNavStore((s) => s.setEntryLane);
  const serverConfigOpen = useNavStore((s) => s.serverConfigOpen);
  const setServerConfigOpen = useNavStore((s) => s.setServerConfigOpen);
  const showToast = useNavStore((s) => s.showToast);

  const pendingInviteCode = useWorkspaceStore((s) => s.pendingInviteCode);
  const setPendingInviteCode = useWorkspaceStore((s) => s.setPendingInviteCode);
  const statusError = useWorkspaceStore((s) => s.statusError);
  const bootstrapWorkspace = useWorkspaceStore((s) => s.bootstrapWorkspace);

  const [loginMode, setLoginMode] = useState<"github" | "email">("github");
  const [inviteOpen, setInviteOpen] = useState(Boolean(pendingInviteCode));
  const [oauthBusy, setOauthBusy] = useState(false);

  const [emailInput, setEmailInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);

  const [originDraft, setOriginDraft] = useState(
    () => nativeBridge.getSessionSnapshot().apiOrigin
  );

  useEffect(() => {
    const off = nativeBridge.onOAuthResult((res) => {
      setOauthBusy(false);
      if (res.ok) {
        showToast("登录成功，正在同步空间…", "success");
        void bootstrapWorkspace();
      } else if (res.error) {
        showToast(res.error, "danger");
      }
    });
    return off;
  }, [bootstrapWorkspace, showToast]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => (c > 1 ? c - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  if (entryLane === "direct_guest") {
    return (
      <div className="h-full flex flex-col bg-[var(--dl-bg)] pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        <DirectTab guestMode onExitGuest={() => setEntryLane("welcome")} />
      </div>
    );
  }

  const snap = nativeBridge.getSessionSnapshot();
  const currentOrigin = snap.apiOrigin;

  const handleStartLogin = () => {
    setOauthBusy(true);
    nativeBridge.haptic("medium");
    nativeBridge.startGitHubOAuth(pendingInviteCode);
    setTimeout(() => setOauthBusy(false), 12000);
  };

  const handleSendEmailCode = async () => {
    const cleanEmail = emailInput.trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      showToast("请输入有效的邮箱地址", "warning");
      return;
    }
    setSendingCode(true);
    try {
      const res = await mobileApi.sendLoginEmailCode(cleanEmail);
      setChallengeId(res.challengeId);
      setCooldown(Math.max(30, Number(res.cooldownSec || 60)));
      nativeBridge.haptic("light");
      showToast("若该邮箱可用于登录，请查收验证码");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "发送验证码失败", "danger");
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyEmailLogin = async () => {
    const cleanEmail = emailInput.trim();
    const cleanCode = codeInput.trim();
    if (!cleanEmail || !challengeId || cleanCode.length !== 6) return;
    setVerifyingCode(true);
    try {
      await mobileApi.verifyLoginEmail(cleanEmail, challengeId, cleanCode);
      nativeBridge.haptic("medium");
      showToast("登录成功，正在同步空间…", "success");
      await bootstrapWorkspace();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "验证码校验失败", "danger");
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSaveOrigin = () => {
    const res = nativeBridge.setApiOrigin(originDraft);
    if (!res.ok) {
      showToast(res.error || "服务地址无效", "warning");
      return;
    }
    setServerConfigOpen(false);
    showToast("已切换服务节点", "success");
  };

  return (
    <div className="h-full flex flex-col justify-between bg-[var(--dl-bg)] px-6 pt-[calc(var(--safe-top)+16px)] pb-[calc(var(--safe-bottom)+20px)] overflow-y-auto">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] text-[var(--dl-text-muted)]">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="truncate max-w-[200px]">
            {currentOrigin.replace(/^https?:\/\//, "")}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setOriginDraft(currentOrigin);
            setServerConfigOpen(true);
          }}
          aria-label="配置服务节点"
          className="px-3 py-1.5 rounded-full text-[12px] font-medium bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[var(--dl-text-muted)] flex items-center gap-1.5 active:scale-95"
        >
          <Server size={13} />
          <span>节点设置</span>
        </button>
      </div>

      {/* Brand Hero + Workspace Auth Card */}
      <div className="my-auto py-6 flex flex-col items-center">
        <BrandLogo size={68} withTile label="DualLane 叠境双晶图标" />
        <h1 className="mt-4 text-[26px] font-bold tracking-tight text-[var(--dl-text)]">
          DualLane
        </h1>
        <p className="mt-1 text-[13px] text-[var(--dl-text-muted)] text-center max-w-[270px]">
          叠境双轨协作终端 · 共享空间与端到端私密直连
        </p>

        {statusError && (
          <div className="mt-4 w-full max-w-[360px] px-3.5 py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-600 dark:text-rose-300 text-[12px]">
            {statusError}
          </div>
        )}

        {/* Primary Shared Workspace Card */}
        <div className="mt-6 w-full max-w-[360px] rounded-[24px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3.5">
            <div>
              <div className="text-[15px] font-semibold text-[var(--dl-text)]">共享空间</div>
              <div className="text-[12px] text-[var(--dl-text-muted)]">
                团队会话、话题、AI 机器人与云端表情同步
              </div>
            </div>
            <ShieldCheck size={20} className="text-[var(--dl-accent)] shrink-0" />
          </div>

          {/* Auth Mode Switcher */}
          <div className="grid grid-cols-2 p-1 mb-3.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)]/70">
            <button
              type="button"
              onClick={() => setLoginMode("github")}
              className={`py-1.5 rounded-lg text-[12.5px] font-semibold flex items-center justify-center gap-1.5 transition ${
                loginMode === "github"
                  ? "bg-[var(--dl-surface)] text-[var(--dl-text)] shadow-2xs"
                  : "text-[var(--dl-text-muted)]"
              }`}
            >
              <Github size={13.5} />
              <span>GitHub 登录</span>
            </button>
            <button
              type="button"
              onClick={() => setLoginMode("email")}
              className={`py-1.5 rounded-lg text-[12.5px] font-semibold flex items-center justify-center gap-1.5 transition ${
                loginMode === "email"
                  ? "bg-[var(--dl-surface)] text-[var(--dl-text)] shadow-2xs"
                  : "text-[var(--dl-text-muted)]"
              }`}
            >
              <Mail size={13.5} />
              <span>邮箱验证码</span>
            </button>
          </div>

          {loginMode === "github" ? (
            <>
              {inviteOpen && (
                <div className="mb-3">
                  <label className="block text-[11px] font-medium text-[var(--dl-text-muted)] mb-1">
                    空间邀请码（首次加入空间时填写）
                  </label>
                  <div className="relative">
                    <KeyRound
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dl-text-muted)]"
                    />
                    <input
                      type="text"
                      value={pendingInviteCode}
                      onChange={(e) => setPendingInviteCode(e.target.value)}
                      placeholder="输入邀请码（选填）"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
                    />
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={oauthBusy}
                aria-label="使用 GitHub 登录"
                onClick={handleStartLogin}
                className="w-full py-3 px-4 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition disabled:opacity-60"
              >
                <Github size={18} />
                <span>{oauthBusy ? "正在唤起安全授权…" : "使用 GitHub 登录"}</span>
              </button>

              <div className="mt-3 flex items-center justify-between text-[12px]">
                <span className="text-[var(--dl-text-muted)]">还没有账号？</span>
                <button
                  type="button"
                  onClick={() => setInviteOpen((v) => !v)}
                  className="text-[var(--dl-accent)] font-medium"
                >
                  {inviteOpen ? "收起邀请码" : "使用邀请码加入空间"}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-2.5">
              <div className="relative">
                <Mail
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--dl-text-muted)]"
                />
                <input
                  type="email"
                  aria-label="登录邮箱"
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setChallengeId("");
                  }}
                  placeholder="输入登录邮箱"
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
                />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  aria-label="邮箱验证码"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6 位数字验证码"
                  className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] font-mono tracking-widest text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
                />
                <button
                  type="button"
                  disabled={sendingCode || cooldown > 0 || !emailInput.trim()}
                  onClick={() => void handleSendEmailCode()}
                  className="px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[12.5px] font-semibold text-[var(--dl-accent)] shrink-0 disabled:opacity-50"
                >
                  {sendingCode ? "发送中…" : cooldown > 0 ? `${cooldown}s` : "获取验证码"}
                </button>
              </div>

              <button
                type="button"
                disabled={
                  verifyingCode || !emailInput.trim() || !challengeId || codeInput.trim().length !== 6
                }
                onClick={() => void handleVerifyEmailLogin()}
                className="w-full py-3 px-4 rounded-2xl bg-[var(--dl-accent)] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition disabled:opacity-50"
              >
                <span>{verifyingCode ? "正在校验…" : "验证并进入空间"}</span>
              </button>

              <div className="pt-0.5 text-center text-[11.5px] text-[var(--dl-text-muted)]">
                使用已绑定的邮箱，未绑定时使用 GitHub 已验证的主邮箱。邮箱尚未同步时，可先用 GitHub 登录。
              </div>
            </div>
          )}
        </div>

        {/* Secondary Zero-Login Private Direct P2P Card */}
        <button
          type="button"
          onClick={() => {
            nativeBridge.haptic("light");
            setEntryLane("direct_guest");
          }}
          className="mt-3.5 w-full max-w-[360px] rounded-[22px] bg-[var(--dl-surface)] border border-[var(--dl-border)] p-4 text-left flex items-center gap-3.5 active:scale-[0.99] transition"
        >
          <div className="w-10 h-10 rounded-2xl bg-amber-500/15 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
            <Lock size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-[var(--dl-text)]">一对一直连</div>
            <div className="text-[12px] text-[var(--dl-text-muted)] truncate">
              免登录 · 纯内存 AES-256-GCM 端到端加密阅后即焚
            </div>
          </div>
          <ArrowRight size={17} className="text-[var(--dl-text-muted)] shrink-0" />
        </button>
      </div>

      {/* Footer */}
      <div className="text-center text-[11px] text-[var(--dl-text-muted)]">
        DualLane Android v{snap.appVersion} · PKCE Keystore 安全会话
      </div>

      {/* Server Node Sheet */}
      <BottomSheet
        open={serverConfigOpen}
        onClose={() => setServerConfigOpen(false)}
        title="切换服务节点"
        subtitle="支持官方云端或私有化部署的 HTTPS 实例"
      >
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[12px] font-medium text-[var(--dl-text-muted)] mb-1.5">
              服务端根域名
            </label>
            <input
              type="url"
              value={originDraft}
              onChange={(e) => setOriginDraft(e.target.value)}
              placeholder="https://duallane.tsio.top"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--dl-card)] border border-[var(--dl-border)] text-[14px] text-[var(--dl-text)] outline-none focus:border-[var(--dl-accent)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOriginDraft("https://duallane.tsio.top")}
              className="px-3 py-2 rounded-xl bg-[var(--dl-card)] text-[12px] text-[var(--dl-text-muted)]"
            >
              恢复默认节点
            </button>
            <button
              type="button"
              onClick={handleSaveOrigin}
              className="ml-auto px-4 py-2 rounded-xl bg-[var(--dl-accent)] text-white text-[13px] font-semibold flex items-center gap-1.5"
            >
              <Check size={15} />
              <span>保存生效</span>
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
