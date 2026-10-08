import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Runtime } from '../../data/runtime';
import { ApiError, errorText } from '../../data/client';
import type { ChatTarget, Message } from '../../domain/contracts';
import { useWorkspace } from '../../domain/store';
import { canToggleTopicProjection, isTopicMessageProjected, topicProjectionLimit, type TopicProjection } from '../../domain/topic-projections';

type ProjectionRuntime = Pick<Runtime, 'api' | 'topicProjections' | 'setTopicProjection'>;
type Feedback = { text: string; tone: 'danger' | 'success' | 'info' };
const emptyFeedback: Feedback = { text: '', tone: 'info' };

export function useTopicProjections(runtime: ProjectionRuntime, target: ChatTarget, focused: boolean) {
  const accountKey = useWorkspace(state => state.accountKey);
  const cursor = useWorkspace(state => state.cursor);
  const connection = useWorkspace(state => state.connection);
  const topicId = target.kind === 'topic' ? target.id : undefined;
  const conversationId = target.kind === 'topic' ? target.conversationId : target.id;
  const topic = useWorkspace(state => topicId ? state.topics[topicId] : undefined);
  const conversation = useWorkspace(state => state.conversations[conversationId]);
  const readable = useWorkspace(state => !!state.bootstrap?.permissions.canReadConversations);
  const canRead = readable && !!topic?.joined && topic.conversationId === conversationId && !!conversation;
  const activity = useMemo(() => ({
    accountKey, topicId, conversationId, api: runtime.api, focused, canRead,
    live: false, readInvocation: 0, refreshRunning: false, refreshQueued: false, commands: new Set<string>(),
  }), [accountKey, canRead, conversationId, focused, runtime.api, topicId]);
  const active = useRef(activity);
  active.current = activity;
  const [snapshot, setSnapshot] = useState<{ activity: typeof activity; projections: TopicProjection[]; complete: boolean; confirmedIds: string[] }>();
  const [pending, setPending] = useState<{ activity: typeof activity; ids: string[] }>();
  const [notice, setNotice] = useState<{ activity: typeof activity; feedback: Feedback; source: 'read' | 'command' }>();
  const current = useCallback(() => {
    const state = useWorkspace.getState();
    return active.current === activity && activity.live && activity.focused && activity.canRead && !!activity.topicId
      && state.accountKey === activity.accountKey && runtime.api === activity.api
      && state.bootstrap?.permissions.canReadConversations && state.topics[activity.topicId]?.joined
      && state.topics[activity.topicId]?.conversationId === activity.conversationId && !!state.conversations[activity.conversationId];
  }, [activity, runtime]);
  useEffect(() => {
    activity.live = true;
    setSnapshot(undefined);
    setPending(undefined);
    setNotice(undefined);
    return () => { activity.live = false; activity.readInvocation += 1; };
  }, [activity]);

  const refresh = useCallback(async function refreshProjections() {
    if (!current() || !activity.topicId) return;
    if (activity.refreshRunning || activity.commands.size) { activity.refreshQueued = true; return; }
    activity.refreshRunning = true;
    const invocation = ++activity.readInvocation;
    try {
      const projections = await runtime.topicProjections(activity.topicId);
      if (current() && invocation === activity.readInvocation && !activity.refreshQueued && !activity.commands.size) {
        setSnapshot({ activity, projections, complete: projections.length < topicProjectionLimit, confirmedIds: [] });
        setNotice(previous => previous?.activity === activity && previous.source === 'command' ? previous : undefined);
      }
    } catch (error) {
      if (current() && invocation === activity.readInvocation) setNotice(previous => previous?.activity === activity && previous.source === 'command' ? previous : { activity, source: 'read', feedback: { text: error instanceof ApiError ? errorText(error) : '同步状态暂时不可用，请稍后重试。', tone: 'danger' } });
    } finally {
      activity.refreshRunning = false;
      if (current() && activity.refreshQueued && !activity.commands.size) {
        activity.refreshQueued = false;
        void refreshProjections();
      }
    }
  }, [activity, current, runtime]);
  useEffect(() => { void refresh(); }, [connection, cursor, refresh]);

  const ready = snapshot?.activity === activity;
  const projections = ready ? snapshot.projections : [];
  const statusKnown = (messageId: string) => ready && (snapshot.complete || snapshot.confirmedIds.includes(messageId) || projections.some(item => item.topicMessageId === messageId));
  const toggle = useCallback(async (messageId: string) => {
    if (!current() || !activity.topicId || snapshot?.activity !== activity || activity.commands.has(messageId)) return;
    if (!snapshot.complete && !snapshot.confirmedIds.includes(messageId) && !snapshot.projections.some(item => item.topicMessageId === messageId)) return;
    const state = useWorkspace.getState();
    const source = state.messages[`topic:${activity.topicId}`]?.find(message => message.id === messageId);
    if (!source || !canToggleTopicProjection(source, state.topics[activity.topicId], state.conversations[activity.conversationId])) return;
    const enabled = !isTopicMessageProjected(snapshot.projections, messageId);
    // Invalidate a pre-command snapshot and coalesce synchronization until commands finish.
    activity.readInvocation += 1;
    activity.refreshQueued ||= activity.refreshRunning;
    activity.commands.add(messageId);
    setPending({ activity, ids: [...activity.commands] });
    setNotice(undefined);
    try {
      const projection = await runtime.setTopicProjection(activity.topicId, messageId, enabled);
      const nextState = useWorkspace.getState();
      const message = nextState.messages[`topic:${activity.topicId}`]?.find(item => item.id === messageId);
      if (!current() || !message || !canToggleTopicProjection(message, nextState.topics[activity.topicId], nextState.conversations[activity.conversationId])) return;
      setSnapshot(previous => {
        if (previous?.activity !== activity) return previous;
        const remaining = previous.projections.filter(item => item.topicMessageId !== messageId);
        return { ...previous, projections: projection ? [...remaining, projection] : remaining, confirmedIds: [...previous.confirmedIds.filter(id => id !== messageId), messageId] };
      });
      setNotice({ activity, source: 'command', feedback: { text: projection && !projection.removedAt ? '已同步到群聊' : '已取消同步', tone: 'success' } });
    } catch (error) {
      if (current()) setNotice({ activity, source: 'command', feedback: { text: error instanceof ApiError ? errorText(error) : '同步操作失败，请稍后重试。', tone: 'danger' } });
    } finally {
      activity.commands.delete(messageId);
      if (current()) {
        setPending({ activity, ids: [...activity.commands] });
        if (activity.refreshQueued && !activity.commands.size) { activity.refreshQueued = false; void refresh(); }
      }
    }
  }, [activity, current, refresh, runtime, snapshot]);

  return {
    canToggle: (message: Message) => statusKnown(message.id) && focused && canToggleTopicProjection(message, topic, conversation),
    isProjected: (messageId: string) => isTopicMessageProjected(projections, messageId),
    isBusy: (messageId: string) => pending?.activity === activity && pending.ids.includes(messageId),
    feedback: notice?.activity === activity ? notice.feedback : ready && !snapshot.complete ? { text: '部分较早消息的同步状态暂时不可用。', tone: 'info' as const } : emptyFeedback,
    toggle,
  };
}
