import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, mobileApi } from "@/shared/api";
import type { DualLaneCardKitDocument } from "@/shared/card-kit";
import { projectWorkspaceCard, type WorkspaceCardReference } from "@/shared/workspace-cards";
import { useWorkspaceStore } from "@/store/workspace-store";
import { CardKitView } from "./CardKitView";

type Attempt = { actionId: string; revision: number; clientActionId: string };

export function WorkspaceCardView({ reference }: { reference: WorkspaceCardReference }) {
  const userId = useWorkspaceStore((s) => s.currentUser?.id);
  const authStatus = useWorkspaceStore((s) => s.authStatus);
  const revision = useWorkspaceStore((s) => s.cardRevisions[reference.cardId] || 0);
  const [reload, setReload] = useState(0);
  const [card, setCard] = useState<DualLaneCardKitDocument | null>(null);
  const [loadedKey, setLoadedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [unknown, setUnknown] = useState(false);
  const [acknowledgedRevision, setAcknowledgedRevision] = useState(0);
  const [sending, setSending] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const identity = useRef({ active: true });
  const { cardId, cardType, schemaVersion, fallbackText } = reference;
  const queryKey = [userId, cardId, cardType, schemaVersion, fallbackText, revision, reload].join("\u0000");

  useEffect(() => {
    const lifetime = { active: true };
    identity.current = lifetime;
    return () => { lifetime.active = false; };
  }, [cardId, userId]);

  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    setCard(null);
    setLoading(true);
    if (!userId || authStatus !== "authenticated") { setLoading(false); return; }
    void mobileApi.resolveCard(cardId).then((response) => {
      if (cancelled || generation.current !== current) return;
      const next = projectWorkspaceCard({ cardId, cardType, schemaVersion, fallbackText }, response.card);
      setCard(next && next.revision >= revision ? next : null);
      setLoadedKey(queryKey);
      setLoading(false);
    }).catch(() => {
      if (!cancelled && generation.current === current) { setCard(null); setLoadedKey(queryKey); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [userId, authStatus, cardId, cardType, schemaVersion, fallbackText, revision, reload, queryKey]);

  useEffect(() => {
    attempt.current = null;
    busy.current = false;
    setUnknown(false);
    setNotice("");
    setAcknowledgedRevision(0);
  }, [cardId, userId]);

  const submit = useCallback(async (actionId: string) => {
    if (busy.current || !card || loadedKey !== queryKey || card.status !== "active") return;
    // A manual retry keeps the original request and revision. Never convert a
    // lost response into a fresh operation or replay it automatically.
    const request = attempt.current ?? { actionId, revision: card.revision, clientActionId: `act_${crypto.randomUUID()}` };
    if (request.actionId !== actionId) return;
    attempt.current = request;
    const current = identity.current;
    busy.current = true;
    setSending(true);
    setNotice("");
    try {
      const response = await mobileApi.invokeCardAction(cardId, request.actionId, {}, request.revision, request.clientActionId);
      if (!current.active || current !== identity.current) return;
      const outcome = response.action;
      if (!outcome || typeof outcome !== "object" || !("ok" in outcome) || outcome.ok !== true) throw new Error("invalid receipt");
      setNotice("操作已提交，等待助手更新");
      setAcknowledgedRevision(request.revision);
      setUnknown(false);
      attempt.current = null;
      setReload((value) => value + 1);
    } catch (error) {
      if (!current.active || current !== identity.current) return;
      const uncertain = !(error instanceof ApiClientError) || error.status === 0 || error.status >= 500;
      setUnknown(uncertain);
      if (uncertain) setNotice("操作结果尚未确认。重试会沿用原操作编号，请勿重复发起新操作。");
      else {
        attempt.current = null;
        setNotice(error instanceof ApiClientError && [401, 403, 404].includes(error.status)
          ? "当前无法使用此卡片，请确认会话权限" : "卡片状态已变化，请刷新后核对");
        setReload((value) => value + 1);
      }
    } finally {
      if (current.active && current === identity.current) { busy.current = false; setSending(false); }
    }
  }, [card, cardId, loadedKey, queryKey]);

  if (!userId || authStatus !== "authenticated") return <section aria-label="助手交互卡片">{fallbackText}</section>;
  const visibleCard = loadedKey === queryKey ? card : null;

  return <section aria-label="助手交互卡片" data-card-id={cardId} className="min-w-0 max-w-full">
    {visibleCard ? <CardKitView card={visibleCard} onAction={submit}
      locked={unknown || sending || visibleCard.revision <= acknowledgedRevision} />
      : <div className="mt-1.5 rounded-2xl border border-[var(--dl-border)] bg-[var(--dl-surface)] px-3.5 py-3 text-[13px] whitespace-pre-wrap break-words">
        <div>{fallbackText || "卡片暂不可用"}</div>
        <div role="status" className="mt-1 text-[11px] text-[var(--dl-text-muted)]">{loading || loadedKey !== queryKey ? "正在读取卡片…" : "无法显示此卡片，内容或权限可能已变化"}</div>
        {!loading && <button type="button" className="mt-2 text-[12px] text-[var(--dl-accent)]"
          onClick={() => setReload((value) => value + 1)}>重新读取卡片</button>}
      </div>}
    {notice && <div role="status" className="mt-1 px-1 text-[12px] text-[var(--dl-text-muted)]">{notice}</div>}
    {unknown && attempt.current && <button type="button" disabled={sending || !card || card.status !== "active"}
      className="mt-2 rounded-xl border border-[var(--dl-border)] px-3 py-2 text-[12px] disabled:opacity-50"
      onClick={() => { if (attempt.current) void submit(attempt.current.actionId); }}>重试同一操作</button>}
  </section>;
}
