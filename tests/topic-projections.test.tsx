import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { Runtime } from '../src/data/runtime';
import { ApiError, errorText } from '../src/data/client';
import { bootstrapSchema, parseMessage, topicSchema, type ChatTarget, type Message } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { isTopicMessageProjected, topicProjectionLimit, topicProjectionResultSchema, topicProjectionsSchema, type TopicProjection } from '../src/domain/topic-projections';
import { useTopicProjections } from '../src/features/chat/useTopicProjections';
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/platform/config', () => ({ installed: { appVersion: '0.1.0', versionCode: 1 } }));

const target: ChatTarget = { kind: 'topic', id: 't1', conversationId: 'g1' };
const projection: TopicProjection = { id: 'p1', topicMessageId: 'm1', removedAt: null };
function message(extra: Partial<Message> = {}): Message {
  return { ...parseMessage({ id: 'm1', conversationId: 'g1', topicId: 't1', authorId: 'peer', authorName: 'Peer', kind: 'user', createdAt: '2026-10-06T00:00:00Z', plainText: 'Synthetic', content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'Synthetic' }] }, attachments: [] })!, ...extra };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function runtime() {
  return {
    api: {} as NonNullable<Runtime['api']>,
    topicProjections: jest.fn<Promise<TopicProjection[]>, [string]>().mockResolvedValue([]),
    setTopicProjection: jest.fn<Promise<TopicProjection | null>, [string, string, boolean]>().mockResolvedValue(projection),
  };
}
beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Self' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 4,
    permissions: { canReadConversations: true }, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, members: [], files: [],
    conversations: [{ id: 'g1', type: 'group', displayTitle: 'Group', lastActivityAt: '2026-10-06T00:00:00Z', capabilities: { canSendMessage: true } }],
  }), 'test:self');
  useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 't1', conversationId: 'g1', title: 'Topic', joined: true, status: 'open', allowSyncToGroup: true }));
  useWorkspace.getState().setMessages('topic:t1', [message()]);
});
afterEach(() => useWorkspace.getState().reset());

test('projection schemas reject malformed responses and removed records do not mean synced', () => {
  expect(topicProjectionsSchema.safeParse({ projections: [{ topicMessageId: 'm1' }] }).success).toBe(false);
  expect(topicProjectionResultSchema.safeParse({ projection: null }).success).toBe(true);
  expect(topicProjectionResultSchema.safeParse({ projection: {} }).success).toBe(false);
  expect(isTopicMessageProjected([{ ...projection, removedAt: '2026-10-06T00:00:00Z' }], 'm1')).toBe(false);
});

test('sync and cancel use the server projection result and keep the topic message', async () => {
  const api = runtime();
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenLastCalledWith('t1', 'm1', true);
  expect(hook.result.current.isProjected('m1')).toBe(true);
  expect(hook.result.current.feedback).toEqual({ text: '已同步到群聊', tone: 'success' });
  api.setTopicProjection.mockResolvedValueOnce(null);
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenLastCalledWith('t1', 'm1', false);
  expect(hook.result.current.isProjected('m1')).toBe(false);
  expect(hook.result.current.feedback).toEqual({ text: '已取消同步', tone: 'success' });
  expect(useWorkspace.getState().messages['topic:t1']?.[0]).toEqual(message());
});

test('an initially synced message cancels and a returned removed record becomes unsynced', async () => {
  const api = runtime();
  api.topicProjections.mockResolvedValue([projection]);
  api.setTopicProjection.mockResolvedValue({ ...projection, removedAt: '2026-10-06T00:00:00Z' });
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.isProjected('m1')).toBe(true));
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenCalledWith('t1', 'm1', false);
  expect(hook.result.current.isProjected('m1')).toBe(false);
  expect(hook.result.current.feedback.text).toBe('已取消同步');
});

test('a full projection window leaves absent historical message status unknown and blocks both stale callbacks and UI actions', async () => {
  const api = runtime();
  api.topicProjections.mockResolvedValue(Array.from({ length: topicProjectionLimit }, (_, index) => ({ id: `p${index}`, topicMessageId: `newer-${index}`, removedAt: index % 2 ? '2026-10-06T00:00:00Z' : null })));
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.feedback.text).toBe('部分较早消息的同步状态暂时不可用。'));
  expect(hook.result.current.canToggle(message())).toBe(false);
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).not.toHaveBeenCalled();
});

test('a known projection in a full window can cancel and its authoritative null result remains known for a subsequent sync', async () => {
  const api = runtime();
  api.topicProjections.mockResolvedValue([projection, ...Array.from({ length: topicProjectionLimit - 1 }, (_, index) => ({ id: `new-p${index}`, topicMessageId: `newer-${index}`, removedAt: null }))]);
  api.setTopicProjection.mockResolvedValueOnce(null);
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.isProjected('m1')).toBe(true));
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenLastCalledWith('t1', 'm1', false);
  expect(hook.result.current.canToggle(message())).toBe(true);
  expect(hook.result.current.isProjected('m1')).toBe(false);
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenLastCalledWith('t1', 'm1', true);
});

test('an absent message in a non-full projection window has a known unsynced state', async () => {
  const api = runtime();
  api.topicProjections.mockResolvedValue(Array.from({ length: topicProjectionLimit - 1 }, (_, index) => ({ id: `p${index}`, topicMessageId: `newer-${index}`, removedAt: null })));
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  expect(hook.result.current.feedback.text).toBe('');
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenLastCalledWith('t1', 'm1', true);
});

test.each(['sending', 'failed', 'recalled', 'deleted', 'hidden', 'closed', 'unjoined', 'sync-disabled', 'parent-readonly', 'foreign'])('projection action is unavailable for %s', async unavailable => {
  let source = message();
  if (unavailable === 'sending' || unavailable === 'failed') source = message({ status: unavailable });
  if (unavailable === 'recalled') source = message({ recalledAt: '2026-10-06T00:00:00Z' });
  if (unavailable === 'deleted') source = message({ deletedAt: '2026-10-06T00:00:00Z' });
  if (unavailable === 'hidden') source = message({ hiddenByCurrentUser: true });
  if (unavailable === 'foreign') source = message({ topicId: 'other-topic' });
  useWorkspace.getState().setMessages('topic:t1', [source]);
  if (unavailable === 'closed') useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, status: 'closed' } } }));
  if (unavailable === 'unjoined') useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, joined: false } } }));
  if (unavailable === 'sync-disabled') useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, allowSyncToGroup: false } } }));
  if (unavailable === 'parent-readonly') useWorkspace.setState(s => ({ conversations: { ...s.conversations, g1: { ...s.conversations.g1!, capabilities: { ...s.conversations.g1!.capabilities, canSendMessage: false } } } }));
  const api = runtime();
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await act(async () => undefined);
  expect(hook.result.current.canToggle(source)).toBe(false);
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).not.toHaveBeenCalled();
});

test('a snapshot must be loaded before selecting sync or cancel', async () => {
  const pending = deferred<TopicProjection[]>();
  const api = runtime();
  api.topicProjections.mockReturnValue(pending.promise);
  const hook = renderHook(() => useTopicProjections(api, target, true));
  expect(hook.result.current.canToggle(message())).toBe(false);
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).not.toHaveBeenCalled();
  await act(async () => { pending.resolve([projection]); });
  expect(hook.result.current.isProjected('m1')).toBe(true);
});

test('duplicate clicks share one command and failure preserves authoritative state with safe retry feedback', async () => {
  const api = runtime();
  api.topicProjections.mockResolvedValue([projection]);
  const command = deferred<TopicProjection | null>();
  api.setTopicProjection.mockReturnValueOnce(command.promise);
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.isProjected('m1')).toBe(true));
  const toggle = hook.result.current.toggle;
  let first!: Promise<void>;
  act(() => { first = toggle('m1'); void toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenCalledTimes(1);
  expect(hook.result.current.isBusy('m1')).toBe(true);
  await act(async () => { command.reject(new Error('sensitive server detail')); await first; });
  expect(hook.result.current.isBusy('m1')).toBe(false);
  expect(hook.result.current.isProjected('m1')).toBe(true);
  expect(hook.result.current.feedback).toEqual({ text: '同步操作失败，请稍后重试。', tone: 'danger' });
  api.setTopicProjection.mockResolvedValueOnce(null);
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(api.setTopicProjection).toHaveBeenCalledTimes(2);
  expect(hook.result.current.isProjected('m1')).toBe(false);
});

test.each(['permission.denied', 'quota.insufficient', 'request.network'])('a server %s rejection displays its safe stable reason', async code => {
  const api = runtime();
  const failure = new ApiError(code, code === 'permission.denied' ? 403 : 400);
  api.setTopicProjection.mockRejectedValue(failure);
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(hook.result.current.feedback).toEqual({ text: errorText(failure), tone: 'danger' });
  expect(hook.result.current.isProjected('m1')).toBe(false);
});

test('an unavailable projection list displays the safe permission reason and keeps actions unavailable', async () => {
  const api = runtime();
  api.topicProjections.mockRejectedValue(new ApiError('permission.denied', 403));
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.feedback.text).toBe('你当前不能执行此操作'));
  expect(hook.result.current.canToggle(message())).toBe(false);
});

test('focus and realtime synchronization refresh changes made by another client', async () => {
  const api = runtime();
  const hook = renderHook(({ focused }: { focused: boolean }) => useTopicProjections(api, target, focused), { initialProps: { focused: true } });
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  api.topicProjections.mockResolvedValue([projection]);
  act(() => useWorkspace.setState({ cursor: 5 }));
  await waitFor(() => expect(hook.result.current.isProjected('m1')).toBe(true));
  hook.rerender({ focused: false });
  expect(hook.result.current.canToggle(message())).toBe(false);
  api.topicProjections.mockResolvedValue([]);
  hook.rerender({ focused: true });
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  expect(hook.result.current.isProjected('m1')).toBe(false);
});

test('a read snapshot started before a successful command cannot restore the stale sync state', async () => {
  const api = runtime();
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  const stale = deferred<TopicProjection[]>();
  api.topicProjections.mockReturnValueOnce(stale.promise).mockResolvedValue([projection]);
  act(() => useWorkspace.setState({ cursor: 5 }));
  await waitFor(() => expect(api.topicProjections).toHaveBeenCalledTimes(2));
  await act(async () => { await hook.result.current.toggle('m1'); });
  expect(hook.result.current.isProjected('m1')).toBe(true);
  await act(async () => { stale.resolve([]); });
  await waitFor(() => expect(api.topicProjections).toHaveBeenCalledTimes(3));
  expect(hook.result.current.isProjected('m1')).toBe(true);
});

test('a queued synchronization snapshot does not erase the reason a command was rejected', async () => {
  const api = runtime();
  const hook = renderHook(() => useTopicProjections(api, target, true));
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  const stale = deferred<TopicProjection[]>();
  api.topicProjections.mockReturnValueOnce(stale.promise).mockResolvedValue([]);
  api.setTopicProjection.mockRejectedValue(new ApiError('permission.denied', 403));
  act(() => useWorkspace.setState({ cursor: 5 }));
  await waitFor(() => expect(api.topicProjections).toHaveBeenCalledTimes(2));
  await act(async () => { await hook.result.current.toggle('m1'); stale.resolve([]); });
  await waitFor(() => expect(api.topicProjections).toHaveBeenCalledTimes(3));
  expect(hook.result.current.feedback.text).toBe('你当前不能执行此操作');
});

test.each(['topic', 'account', 'api', 'permission', 'unmount'])('a late command result cannot affect a newer %s context', async change => {
  const api = runtime();
  const hook = renderHook(({ route }: { route: ChatTarget }) => useTopicProjections(api, route, true), { initialProps: { route: target } });
  await waitFor(() => expect(hook.result.current.canToggle(message())).toBe(true));
  const command = deferred<TopicProjection | null>();
  api.setTopicProjection.mockReturnValueOnce(command.promise);
  let operation!: Promise<void>;
  act(() => { operation = hook.result.current.toggle('m1'); });
  if (change === 'topic') {
    act(() => useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 't2', conversationId: 'g1', title: 'Other', joined: true, status: 'open', allowSyncToGroup: true })));
    hook.rerender({ route: { kind: 'topic', id: 't2', conversationId: 'g1' } });
  }
  if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'test:another' }));
  if (change === 'api') { api.api = {} as NonNullable<Runtime['api']>; hook.rerender({ route: target }); }
  if (change === 'permission') act(() => useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, joined: false } } })));
  if (change === 'unmount') hook.unmount();
  await act(async () => { command.resolve(projection); await operation; });
  if (change !== 'unmount') {
    expect(hook.result.current.isProjected('m1')).toBe(false);
    expect(hook.result.current.isBusy('m1')).toBe(false);
    expect(hook.result.current.feedback.text).toBe('');
  }
});

test('a late snapshot for another topic cannot set its projection or failure notice on the new route', async () => {
  const api = runtime();
  const stale = deferred<TopicProjection[]>();
  api.topicProjections.mockReturnValueOnce(stale.promise).mockResolvedValue([]);
  const hook = renderHook(({ route }: { route: ChatTarget }) => useTopicProjections(api, route, true), { initialProps: { route: target } });
  act(() => useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 't2', conversationId: 'g1', title: 'Other', joined: true, status: 'open', allowSyncToGroup: true })));
  hook.rerender({ route: { kind: 'topic', id: 't2', conversationId: 'g1' } });
  await act(async () => { stale.reject(new Error('sensitive stale detail')); });
  expect(hook.result.current.isProjected('m1')).toBe(false);
  expect(hook.result.current.feedback.text).toBe('');
});
