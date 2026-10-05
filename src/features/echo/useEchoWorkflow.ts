import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import type { Runtime } from '../../data/runtime';
import { ApiError, errorText } from '../../data/client';
import { useWorkspace } from '../../domain/store';
import {
  echoCommandResponseSchema, echoDraftSchema, echoErrorText, echoSlotSchema, echoStepInput, echoStoredDraftSchema,
  echoUserId, echoWorkflowResponseSchema, isOfficialEchoConversation, recognizeEchoCommand,
  restoredEchoDraft, type EchoDraft, type EchoWorkflow,
} from '../../domain/echo-workflows';
import { cache } from '../../platform/storage';

type Slot = ReturnType<typeof echoSlotSchema.parse>;
type Feedback = { text: string; tone: 'info' | 'danger' | 'success' };
const emptyFeedback: Feedback = { text: '', tone: 'info' };
const slotKey = (account: string, conversation: string) => `${account}:echo:slot:${encodeURIComponent(conversation)}`;
const draftKey = (account: string, conversation: string, workflow: string) => `${account}:echo:draft:${encodeURIComponent(JSON.stringify([conversation, workflow]))}`;

function readSlot(key: string): Slot {
  try { const result = echoSlotSchema.safeParse(cache.get(key)); return result.success ? result.data : {}; } catch { return {}; }
}
function readDraft(key: string, revision: number): EchoDraft {
  try { const result = echoStoredDraftSchema.safeParse(cache.get(key)); return result.success && result.data.revision === revision ? result.data.fields : {}; } catch { return {}; }
}

export function useEchoWorkflow(runtime: Pick<Runtime, 'api'>, conversationId: string | undefined, focused: boolean) {
  const accountKey = useWorkspace(state => state.accountKey);
  const conversation = useWorkspace(state => conversationId ? state.conversations[conversationId] : undefined);
  const readable = useWorkspace(state => !!state.bootstrap?.permissions.canReadConversations);
  const available = !!conversationId && readable && isOfficialEchoConversation(conversation) && !!conversation?.capabilities.canSendMessage;
  const activity = useMemo(() => ({
    accountKey, conversationId, api: runtime.api, available, focused, live: false, invocation: 0,
    busy: false, visible: false, slot: {} as Slot, draft: {} as EchoDraft,
    workflow: undefined as EchoWorkflow | undefined, publicId: undefined as string | undefined, feedback: emptyFeedback,
  }), [accountKey, available, conversationId, focused, runtime.api]);
  const active = useRef(activity);
  active.current = activity;
  const [snapshot, setSnapshot] = useState<{ activity: typeof activity; visible: boolean; busy: boolean; slot: Slot; draft: EchoDraft; workflow?: EchoWorkflow; publicId?: string; feedback: Feedback }>();
  const current = useCallback(() => {
    const state = useWorkspace.getState();
    const latest = activity.conversationId ? state.conversations[activity.conversationId] : undefined;
    return active.current === activity && activity.live && activity.focused && activity.available
      && state.accountKey === activity.accountKey && runtime.api === activity.api && !!activity.api
      && state.bootstrap?.permissions.canReadConversations && isOfficialEchoConversation(latest) && !!latest?.capabilities.canSendMessage;
  }, [activity, runtime]);
  const publish = useCallback(() => {
    if (current()) setSnapshot({ activity, visible: activity.visible, busy: activity.busy, slot: activity.slot, draft: activity.draft, workflow: activity.workflow, publicId: activity.publicId, feedback: activity.feedback });
  }, [activity, current]);
  const persistSlot = useCallback(() => {
    if (!current() || !activity.conversationId) return;
    try { cache.set(slotKey(activity.accountKey, activity.conversationId), activity.slot); }
    catch { activity.feedback = { text: '本机暂时无法保存流程进度，请稍后重试。', tone: 'danger' }; }
  }, [activity, current]);
  useEffect(() => {
    activity.live = true;
    if (current() && activity.conversationId) activity.slot = readSlot(slotKey(activity.accountKey, activity.conversationId));
    publish();
    return () => { activity.live = false; activity.invocation += 1; };
  }, [activity, current, publish]);

  const accept = useCallback((workflow: EchoWorkflow, expectedId?: string, publicId?: string, ownContinuation = false) => {
    if (!current() || !activity.conversationId) return;
    if (workflow.conversationId !== activity.conversationId || workflow.botUserId !== echoUserId || (expectedId && workflow.id !== expectedId)) throw new Error('Unexpected workflow');
    const key = draftKey(activity.accountKey, activity.conversationId, workflow.id);
    // Originals are tied to a known server revision; a different client's update invalidates them.
    const local = ownContinuation && activity.workflow?.id === workflow.id && workflow.revision === activity.workflow.revision + 1
      ? activity.draft : readDraft(key, workflow.revision);
    activity.workflow = workflow;
    activity.publicId = publicId;
    activity.draft = restoredEchoDraft(workflow, local);
    activity.slot = workflow.status === 'active' ? { workflowId: workflow.id } : {};
    persistSlot();
    if (workflow.status !== 'active') {
      try { cache.remove(key); } catch { /* Server status remains authoritative if local cleanup fails. */ }
      activity.draft = restoredEchoDraft(workflow, {});
    } else {
      try { cache.set(key, { revision: workflow.revision, fields: activity.draft }); }
      catch { activity.feedback = { text: '本机暂时无法保存表单，请稍后重试。', tone: 'danger' }; }
    }
  }, [activity, current, persistSlot]);
  const load = useCallback(async (id: string, invocation: number) => {
    const response = await activity.api!.json(`/api/workspace/workflows/${encodeURIComponent(id)}`, echoWorkflowResponseSchema);
    if (!current() || invocation !== activity.invocation) return false;
    accept(response.workflow, id, response.result?.publicId);
    return true;
  }, [accept, activity, current]);
  const perform = useCallback(async (operation: (invocation: number) => Promise<boolean>) => {
    if (!current() || activity.busy) return false;
    activity.busy = true;
    activity.visible = true;
    activity.feedback = emptyFeedback;
    const invocation = ++activity.invocation;
    publish();
    try { return await operation(invocation); }
    catch (error) {
      if (!current() || invocation !== activity.invocation) return false;
      const code = error instanceof ApiError ? error.code : '';
      activity.feedback = { text: echoErrorText(code) ?? (error instanceof ApiError ? errorText(error) : 'Echo 流程操作失败，请稍后重试。'), tone: 'danger' };
      const recoveryId = code === 'workflow.active_conflict' && error instanceof ApiError ? error.details?.activeWorkflowId : activity.workflow?.id;
      if (recoveryId && ['workflow.active_conflict', 'workflow.stale_revision', 'workflow.race_conflict', 'workflow.not_active', 'workflow.expired'].includes(code)) {
        try {
          if (await load(recoveryId, invocation)) {
            activity.feedback = { text: code === 'workflow.active_conflict' ? '已恢复未完成的流程，请继续或取消。' : '已重新载入流程，请检查当前步骤后操作。', tone: 'info' };
            return code === 'workflow.active_conflict';
          }
        } catch { /* Keep the stable original error; never retry a confirmation automatically. */ }
      }
      return false;
    } finally {
      activity.busy = false;
      if (current() && invocation === activity.invocation) publish();
    }
  }, [activity, current, load, publish]);
  const start = useCallback(async (source: string) => {
    if (!current() || !activity.conversationId || source.length > 10000 || !recognizeEchoCommand(useWorkspace.getState().conversations[activity.conversationId], source)) return false;
    return perform(async invocation => {
      const request = activity.slot.request?.source === source ? activity.slot.request : { source, clientInvocationId: Crypto.randomUUID() };
      activity.slot = { request };
      activity.workflow = undefined;
      activity.draft = {};
      activity.publicId = undefined;
      persistSlot();
      const response = await activity.api!.json('/api/workspace/interactions/commands', echoCommandResponseSchema, { conversationId: activity.conversationId, botUserId: echoUserId, ...request }, 'POST');
      if (!current() || invocation !== activity.invocation) return false;
      const command = response.command.result;
      const created = await activity.api!.json('/api/workspace/workflows', echoWorkflowResponseSchema, {
        conversationId: activity.conversationId, botUserId: echoUserId, type: command.workflowType, version: command.version, input: command.input, clientInvocationId: `${request.clientInvocationId}:workflow`,
      }, 'POST');
      if (!current() || invocation !== activity.invocation) return false;
      accept(created.workflow, undefined, created.result?.publicId);
      return true;
    });
  }, [accept, activity, current, perform, persistSlot]);
  const resume = useCallback(async () => {
    if (activity.slot.workflowId) return perform(invocation => load(activity.slot.workflowId!, invocation));
    if (activity.slot.request) return start(activity.slot.request.source);
    return false;
  }, [activity, load, perform, start]);
  const edit = useCallback((field: keyof EchoDraft, value: string) => {
    if (!current() || activity.busy || activity.workflow?.status !== 'active' || !activity.conversationId) return;
    const parsed = echoDraftSchema.safeParse({ ...activity.draft, [field]: value });
    if (!parsed.success) return;
    activity.draft = parsed.data;
    try { cache.set(draftKey(activity.accountKey, activity.conversationId, activity.workflow.id), { revision: activity.workflow.revision, fields: activity.draft }); }
    catch { activity.feedback = { text: '本机暂时无法保存表单，请稍后重试。', tone: 'danger' }; }
    publish();
  }, [activity, current, publish]);
  const advance = useCallback(async (confirm = false) => {
    if (!current() || activity.busy || !activity.workflow) return false;
    const workflow = activity.workflow;
    let input: Record<string, string | boolean>;
    try { input = echoStepInput(workflow, activity.draft, confirm); }
    catch (error) { activity.feedback = { text: (error as Error).message, tone: 'danger' }; publish(); return false; }
    return perform(async invocation => {
      const response = await activity.api!.json(`/api/workspace/workflows/${encodeURIComponent(workflow.id)}/continue`, echoWorkflowResponseSchema, { expectedRevision: workflow.revision, input }, 'POST');
      if (!current() || invocation !== activity.invocation) return false;
      accept(response.workflow, workflow.id, response.result?.publicId, true);
      return true;
    });
  }, [accept, activity, current, perform, publish]);
  const cancel = useCallback(async () => {
    if (!current() || activity.workflow?.status !== 'active') return false;
    const id = activity.workflow.id;
    return perform(async invocation => {
      const response = await activity.api!.json(`/api/workspace/workflows/${encodeURIComponent(id)}/cancel`, echoWorkflowResponseSchema, undefined, 'POST');
      if (!current() || invocation !== activity.invocation) return false;
      accept(response.workflow, id);
      return true;
    });
  }, [accept, activity, current, perform]);
  const close = useCallback(() => { if (current()) { activity.visible = false; publish(); } }, [activity, current, publish]);
  const view = snapshot?.activity === activity ? snapshot : undefined;
  return {
    available: available && focused && !!runtime.api, visible: !!view?.visible && available && focused,
    busy: view?.busy ?? false, workflow: view?.workflow, draft: view?.draft ?? {}, publicId: view?.publicId,
    canResume: !!view?.slot.workflowId || !!view?.slot.request, feedback: view?.feedback ?? emptyFeedback,
    start, resume, edit, advance, cancel, close,
  };
}

export type EchoWorkflowController = ReturnType<typeof useEchoWorkflow>;
