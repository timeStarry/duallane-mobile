import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  botPolicyApi, type BotGroupPolicy, type BotGroupRequest,
} from "@/shared/bot-policy";
import { useWorkspaceStore } from "@/store/workspace-store";

type GroupChoice = { id: string; title: string };
type Props =
  | { botId: string; conversations: GroupChoice[]; conversationId?: never }
  | { conversationId: string; botId?: never; conversations?: never };
type Loaded = {
  scope: string; ready: boolean; error: string; canManage: boolean;
  policies: BotGroupPolicy[]; requests: BotGroupRequest[]; hasMore: boolean;
};
const statusLabels = { pending: "等待群管理员批准", active: "已批准入群", rejected: "已拒绝", removed: "已撤销" };
const buttonClass = "px-3 py-2 rounded-xl bg-[var(--dl-accent-soft)] text-[var(--dl-accent)] text-[12px] font-semibold disabled:opacity-50";

/**
 * Intent: an owner requests one group, its manager decides that request.
 * Keep the decision and its context boundary together in the existing quiet
 * card surface; group approval never appears as a private-chat permission.
 */
export function BotGroupRequests(props: Props) {
  const scope = props.botId ? "bot:" + props.botId : "group:" + props.conversationId;
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState<Loaded>({
    scope: "", ready: false, error: "", canManage: false, policies: [], requests: [], hasMore: false,
  });
  const [selection, setSelection] = useState("");
  const [allowContext, setAllowContext] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ scope: "", message: "", error: false });
  const epoch = useRef(0);
  const bootstrapWorkspace = useWorkspaceStore((state) => state.bootstrapWorkspace);
  const botId = props.botId, conversationId = props.conversationId;
  useEffect(() => {
    const requestEpoch = ++epoch.current;
    let cancelled = false;
    const run = async () => {
      try {
        const result = botId
          ? { policies: await botPolicyApi.listGroups(botId), requests: [], canManage: true, hasMore: false }
          : { policies: [], ...await botPolicyApi.listRequests(conversationId || "") };
        if (!cancelled && epoch.current === requestEpoch) {
          setLoaded({ scope, ready: true, error: "", ...result });
        }
      } catch (error) {
        if (!cancelled && epoch.current === requestEpoch) {
          setLoaded({
            scope, ready: true, error: error instanceof Error ? error.message : "无法加载入群请求",
            policies: [], requests: [], canManage: false, hasMore: false,
          });
        }
      }
    };
    setLoaded((previous) => ({ ...previous, scope, ready: false }));
    setBusy("");
    void run();
    return () => { cancelled = true; };
  }, [botId, conversationId, revision, scope]);

  const decide = async (targetBotId: string, targetGroupId: string, status: "active" | "rejected" | "removed", ownerRequest = false) => {
    if (busy) return;
    const requestEpoch = epoch.current;
    setBusy(targetBotId + ":" + targetGroupId);
    setNotice({ scope, message: "", error: false });
    try {
      const result = await botPolicyApi.updateGroup(targetBotId, targetGroupId, {
        status,
        ...(ownerRequest ? { allowTrigger: true, allowContext, ...(allowContext ? { maxMessages: 20 } : {}) } : {}),
      });
      if (epoch.current !== requestEpoch) return;
      setNotice({ scope, message: statusLabels[result.status], error: false });
      await bootstrapWorkspace().catch(() => undefined);
      if (epoch.current === requestEpoch) setRevision((value) => value + 1);
    } catch (error) {
      if (epoch.current === requestEpoch) {
        setNotice({ scope, message: error instanceof Error ? error.message : "操作失败，请刷新重试", error: true });
      }
    } finally {
      if (epoch.current === requestEpoch) setBusy("");
    }
  };
  const current = loaded.scope === scope;
  if (current && loaded.ready && !loaded.error && !loaded.canManage) return null;
  return (
    <section aria-label={botId ? "机器人入群授权" : "机器人入群请求"} className="p-3.5 rounded-2xl bg-[var(--dl-card)] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-[13px] font-semibold text-[var(--dl-text)]">{botId ? "请求加入指定群聊" : "机器人入群请求"}</h4>
        <button type="button" aria-label="刷新机器人入群请求" className={buttonClass} disabled={Boolean(busy)}
          onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} /></button>
      </div>
      <p className="text-[12px] leading-5 text-[var(--dl-text-muted)]">
        由创建者发起，群管理员批准后生效。批准只影响当前群，不开放其他人的私聊权限。
      </p>
      {!current || !loaded.ready ? <p role="status" className="text-[12px] text-[var(--dl-text-muted)]">正在加载入群授权…</p>
        : loaded.error ? <p role="alert" className="text-[12px] text-[var(--dl-danger,#dc2626)]">{loaded.error}</p>
        : <>
          {botId && props.conversations && (
            <div className="space-y-2">
              <label className="block text-[12px] text-[var(--dl-text)]">目标群聊
                <select aria-label="目标群聊" value={selection} disabled={Boolean(busy)}
                  onChange={(event) => setSelection(event.target.value)}
                  className="mt-1 w-full p-2.5 rounded-xl bg-[var(--dl-surface)] border border-[var(--dl-border)] text-[13px]">
                  <option value="">请选择自己已加入的群聊</option>
                  {props.conversations.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
                </select>
              </label>
              <label className="flex items-start gap-2 text-[12px] leading-5 text-[var(--dl-text)]">
                <input type="checkbox" checked={allowContext} disabled={Boolean(busy)}
                  onChange={(event) => setAllowContext(event.target.checked)} />
                允许按需读取本群最近 20 条历史（默认只接收触发消息）
              </label>
              <button type="button" className={buttonClass} disabled={!selection || Boolean(busy)}
                onClick={() => void decide(botId, selection, "active", true)}>发起入群请求</button>
              {loaded.policies.length === 0 && <p className="text-[12px] text-[var(--dl-text-muted)]">尚未请求加入群聊</p>}
              {loaded.policies.map((policy) => (
                <div key={policy.conversationId} className="rounded-xl bg-[var(--dl-surface)] p-3 space-y-2">
                  <div className="text-[13px] font-medium text-[var(--dl-text)]">
                    {props.conversations?.find((group) => group.id === policy.conversationId)?.title || "原群聊（当前不可见）"}
                  </div>
                  <p className="text-[12px] text-[var(--dl-text-muted)]">{statusLabels[policy.status]}
                    {policy.allowContext ? " · 已请求历史读取" : " · 仅读触发消息"}</p>
                  {(policy.status === "pending" || policy.status === "active") && <button type="button"
                    className={buttonClass} disabled={Boolean(busy)}
                    onClick={() => void decide(botId, policy.conversationId, "removed")}>撤销群内授权</button>}
                </div>
              ))}
            </div>
          )}
          {!botId && loaded.requests.length === 0 && <p className="text-[12px] text-[var(--dl-text-muted)]">暂无待处理请求</p>}
          {!botId && loaded.requests.map((item) => (
            <div key={item.botId} className="rounded-xl bg-[var(--dl-surface)] p-3 space-y-2">
              <div className="text-[13px] font-semibold text-[var(--dl-text)]">{item.name}</div>
              <p className="text-[12px] text-[var(--dl-text-muted)]">{item.allowContext
                ? "请求按需读取本群历史" + (item.maxMessages === null ? "" : "，最多 " + item.maxMessages + " 条")
                : "仅读取触发消息"}</p>
              <div className="flex justify-end gap-2">
                <button type="button" disabled={Boolean(busy)} className={buttonClass}
                  onClick={() => void decide(item.botId, conversationId || "", "rejected")}>拒绝</button>
                <button type="button" disabled={Boolean(busy)} className={buttonClass}
                  onClick={() => void decide(item.botId, conversationId || "", "active")}>批准</button>
              </div>
            </div>
          ))}
          {loaded.hasMore && <p className="text-[12px] text-[var(--dl-text-muted)]">还有更多请求，处理后刷新继续查看。</p>}
        </>}
      {notice.scope === scope && notice.message && <p role={notice.error ? "alert" : "status"}
        className="text-[12px] text-[var(--dl-text)]">{notice.message}</p>}
    </section>
  );
}
