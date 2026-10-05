import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Keyboard, StyleSheet } from 'react-native';
import { ApiError } from '../src/data/client';
import type { Runtime } from '../src/data/runtime';
import { bootstrapSchema, topicSchema, type Message } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { syntheticConversations, syntheticMembers, syntheticMessages, syntheticSelf } from '../src/fixtures/synthetic';
import { MessageRow } from '../src/ui/message';
import { copyText } from '../src/platform/clipboard';
import { resolveTheme } from '../src/ui/tokens';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' } }));
jest.mock('../src/ui/RemoteImage', () => ({ RemoteImage: () => null }));
jest.mock('../src/platform/clipboard', () => ({ copyText: jest.fn().mockResolvedValue(undefined) }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };
const text = '用于动作失败测试的合成消息';
const original: Message = {
  ...syntheticMessages[0]!, authorId: syntheticSelf.id, authorName: syntheticSelf.displayName,
  plainText: text, blocks: [{ type: 'text', text }],
};

beforeEach(() => {
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: syntheticSelf }, space: { id: 'synthetic-space', name: '合成空间' },
    eventCursor: 0, permissions: { canReadConversations: true },
    policy: { dailyQuotaBytes: 1000, remainingQuotaBytes: 1000, messageRetentionCount: 100 },
    members: syntheticMembers, conversations: syntheticConversations, files: [],
  }), 'synthetic-account');
});

afterEach(() => useWorkspace.getState().reset());

function renderRow(runtime: Runtime, message = original, props: Partial<Pick<React.ComponentProps<typeof MessageRow>, 'onReply' | 'onToggleProjection' | 'isProjected' | 'projectionBusy'>> = {}) {
  useWorkspace.getState().setMessages(message.conversationId, [message]);
  const element = (item: Message) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <MessageRow message={item} runtime={runtime} retry={jest.fn()} download={jest.fn()} {...props} />
    </SafeAreaProvider>
  );
  const view = render(element(message));
  const openMore = () => {
    fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
    fireEvent.press(view.getByRole('button', { name: '更多' }));
  };
  return { view, openMore, rerender: (item: Message) => view.rerender(element(item)) };
}

test.each([
  { title: '仅自己隐藏', method: 'hide', patch: {}, args: [original.id, true] },
  { title: '恢复显示', method: 'hide', patch: { hiddenByCurrentUser: true }, args: [original.id, false] },
  { title: '常驻', method: 'pin', patch: {}, args: [original.conversationId, original.id, false] },
  { title: '取消常驻', method: 'pin', patch: { pin: { pinnedByUserId: syntheticSelf.id, pinnedAt: original.createdAt, canUnpin: true } }, args: [original.conversationId, original.id, true] },
  { title: '撤回', method: 'recall', patch: {}, args: [original.id] },
])('$title rejection shows a safe error without claiming a state change', async ({ title, method, patch, args }) => {
  const operation = jest.fn().mockRejectedValue(new ApiError('permission.denied', 403));
  const runtime = { [method]: operation } as unknown as Runtime;
  const message = { ...original, ...patch };
  const { view, openMore } = renderRow(runtime, message);
  openMore();
  fireEvent.press(view.getByRole('button', { name: title }));
  if (method === 'recall') {
    expect(operation).not.toHaveBeenCalled();
    expect(view.getByText('撤回这条消息？')).toBeTruthy();
    fireEvent.press(within(view.getByLabelText('撤回这条消息？')).getByRole('button', { name: '撤回' }));
  }
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  expect(operation).toHaveBeenCalledTimes(1);
  expect(operation).toHaveBeenCalledWith(...args);
  expect(view.getByText(text)).toBeTruthy();
  expect(useWorkspace.getState().messages[message.conversationId]?.[0]).toEqual(message);
  expect(view.queryByText(/撤回了一条消息/)).toBeNull();
});

test('450ms bubble long press opens the same cluster without executing an action', () => {
  const runtime = { hide: jest.fn(), pin: jest.fn(), recall: jest.fn(), react: jest.fn() } as unknown as Runtime;
  const { view } = renderRow(runtime, original, { onReply: jest.fn() });
  const bubble = view.root.findAll((item: { props: { delayLongPress?: number; onLongPress?: () => void } }) => item.props.delayLongPress === 450 && typeof item.props.onLongPress === 'function')[0];
  expect(bubble).toBeTruthy();
  fireEvent(bubble!, 'longPress');
  expect(view.getByRole('button', { name: '回复' })).toBeTruthy();
  expect(view.getByRole('button', { name: '复制' })).toBeTruthy();
  expect(view.getByRole('button', { name: '更多' })).toBeTruthy();
  expect(runtime.hide).not.toHaveBeenCalled();
  expect(runtime.pin).not.toHaveBeenCalled();
  expect(runtime.recall).not.toHaveBeenCalled();
  expect(runtime.react).not.toHaveBeenCalled();
});

test('opening message controls dismisses the keyboard while closing the cluster preserves its state and draft', async () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  const runtime = {
    react: jest.fn().mockResolvedValue(undefined),
    emoteLibrary: jest.fn().mockResolvedValue({ emotes: [], collections: [], entries: [] }),
  } as unknown as Runtime;
  const topic = topicSchema.parse({ id: 'topic-synthetic', conversationId: original.conversationId, title: '合成话题', status: 'open', joined: true });
  useWorkspace.getState().upsertTopic(topic);
  const draft = { text: '保留中的合成草稿', mentionIds: [], mentionSpans: [] };
  useWorkspace.getState().setDraft(`topic:${topic.id}`, draft);
  const onReply = jest.fn();
  const message = { ...original, topicId: topic.id };
  const { view } = renderRow(runtime, message, { onReply });
  const control = view.getByRole('button', { name: /^消息操作，/ });
  fireEvent.press(control);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '复制' })).toBeTruthy();
  expect(view.getByRole('button', { name: '回复' })).toBeTruthy();
  expect(view.getByRole('button', { name: '反应' })).toBeTruthy();
  expect(view.getByRole('button', { name: '更多' })).toBeTruthy();
  fireEvent.press(control);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(view.queryByRole('button', { name: '更多' })).toBeNull();
  const bubble = view.root.findAll((item: { props: { delayLongPress?: number; onLongPress?: () => void } }) => item.props.delayLongPress === 450 && typeof item.props.onLongPress === 'function')[0];
  fireEvent(bubble!, 'longPress');
  expect(dismiss).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByRole('button', { name: '更多' }));
  expect(dismiss).toHaveBeenCalledTimes(3);
  fireEvent.press(view.getByRole('button', { name: '复制' }));
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(message.plainText));
  fireEvent.press(control);
  fireEvent.press(view.getByRole('button', { name: '回复' }));
  expect(onReply).toHaveBeenCalledWith(message);
  fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'more' } });
  expect(dismiss).toHaveBeenCalledTimes(5);
  await act(async () => fireEvent.press(view.getByRole('button', { name: '添加表情回复' })));
  expect(dismiss).toHaveBeenCalledTimes(6);
  const catalog = within(view.getByLabelText('选择消息表情回复'));
  fireEvent.press(catalog.getAllByRole('button', { name: '笑脸' }).find(item => within(item).queryByText('😀'))!);
  expect(runtime.react).toHaveBeenCalledWith(message.id, 'emoji:grinning', false);
  expect(useWorkspace.getState().drafts[`topic:${topic.id}`]).toEqual(draft);
  dismiss.mockRestore();
});

test('TalkBack copy reply and more actions execute the same available handlers', async () => {
  const onReply = jest.fn();
  const { view } = renderRow({} as Runtime, original, { onReply });
  const control = view.getByRole('button', { name: /^消息操作，/ });
  expect(control.props.accessibilityActions).toEqual([
    { name: 'copy', label: '复制' }, { name: 'reply', label: '回复' }, { name: 'more', label: '更多消息操作' },
  ]);
  fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
  expect(onReply).toHaveBeenCalledWith(original);
  fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'copy' } });
  await waitFor(() => expect(copyText).toHaveBeenCalledWith(original.plainText));
  fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'more' } });
  expect(view.getByRole('button', { name: '仅自己隐藏' })).toBeTruthy();
});

test.each(['sending', 'failed'])('a %s message has copy and more but no reply or reactions', status => {
  const message = { ...original, status: status as 'sending' | 'failed' };
  const onReply = jest.fn();
  const { view, openMore } = renderRow({} as Runtime, message, { onReply });
  const control = view.getByRole('button', { name: /^消息操作，/ });
  expect(control.props.accessibilityActions.map((action: { name: string }) => action.name)).toEqual(['copy', 'more']);
  fireEvent(control, 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
  expect(onReply).not.toHaveBeenCalled();
  openMore();
  expect(view.queryByRole('button', { name: '添加表情回复' })).toBeNull();
  expect(view.queryByRole('button', { name: '撤回' })).toBeNull();
});

test('system and recalled rows expose no shared mutation or stale-body controls', () => {
  const runtime = {} as Runtime;
  const system = renderRow(runtime, { ...original, kind: 'system' });
  expect(system.view.queryByRole('button', { name: /^消息操作，/ })).toBeNull();
  system.view.unmount();
  const recalled = renderRow(runtime, { ...original, recalledAt: original.createdAt, plainText: '成员甲撤回了一条消息' });
  expect(recalled.view.queryByRole('button', { name: /^消息操作，/ })).toBeNull();
  expect(recalled.view.queryByText(text)).toBeNull();
});

test('complete reaction catalog sends canonical non-quick emoji and built-in image keys', async () => {
  const customId = '11111111-1111-4111-8111-111111111111';
  const emote = { id: customId, kind: 'image', label: '合成收藏', token: `[custom:${customId}]`, src: '/api/workspace/emotes/synthetic/content' };
  const runtime = {
    react: jest.fn().mockResolvedValue(undefined),
    emoteLibrary: jest.fn().mockResolvedValue({ emotes: [emote], collections: [], entries: [] }),
  } as unknown as Runtime;
  const { view, openMore } = renderRow(runtime);
  fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
  fireEvent.press(view.getByRole('button', { name: '反应' }));
  const quick = view.getByRole('button', { name: '反应 👍' });
  expect(StyleSheet.flatten(quick.props.style)).toMatchObject({ minWidth: resolveTheme('light').hit, minHeight: resolveTheme('light').hit });
  await act(async () => fireEvent.press(view.getByRole('button', { name: '更多表情' })));
  const catalog = within(view.getByLabelText('选择消息表情回复'));
  fireEvent.press(catalog.getAllByRole('button', { name: '笑脸' }).find(item => within(item).queryByText('😀'))!);
  expect(runtime.react).toHaveBeenCalledWith(original.id, 'emoji:grinning', false);
  openMore();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '添加表情回复' })));
  fireEvent.press(view.getByRole('tab', { name: 'B站' }));
  const builtInCatalog = within(view.getByLabelText('选择消息表情回复'));
  fireEvent.press(builtInCatalog.getByRole('button', { name: 'doge' }));
  expect(runtime.react).toHaveBeenCalledWith(original.id, 'bili:doge', false);
  expect(runtime.emoteLibrary).not.toHaveBeenCalled();
});

test('reaction picker excludes custom collections which the canonical server cannot accept', async () => {
  const emote = { id: '11111111-1111-4111-8111-111111111111', kind: 'custom', label: '合成001', token: '[custom:11111111-1111-4111-8111-111111111111]', src: '/api/workspace/emotes/synthetic/content' };
  const runtime = {
    react: jest.fn().mockResolvedValue(undefined),
    emoteLibrary: jest.fn().mockResolvedValue({ emotes: [emote], collections: [{ id: 'collection-synthetic', name: '合成小猫合集', items: [emote] }], entries: [] }),
  } as unknown as Runtime;
  const { view, openMore } = renderRow(runtime);
  openMore();
  await act(async () => fireEvent.press(view.getByRole('button', { name: '添加表情回复' })));
  expect(view.queryByRole('tab', { name: '收藏' })).toBeNull();
  expect(view.queryByRole('tab', { name: '合成小猫合集' })).toBeNull();
  expect(runtime.emoteLibrary).not.toHaveBeenCalled();
  expect(runtime.react).not.toHaveBeenCalled();
  expect(view.getByText('表情回复支持可用的内置表情；收藏和自定义合集可在输入框发送。')).toBeTruthy();
});

test('catalog toggles the same selected image reaction and shows safe command rejection', async () => {
  const runtime = {
    react: jest.fn().mockRejectedValue(new ApiError('permission.denied', 403)),
    emoteLibrary: jest.fn(),
  } as unknown as Runtime;
  const message = { ...original, reactions: [{ emoteKey: 'bili:doge', count: 1, reactedByCurrentUser: true }] };
  const { view, openMore } = renderRow(runtime, message);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '添加表情回复' }));
  fireEvent.press(view.getByRole('tab', { name: 'B站' }));
  const catalog = within(view.getByLabelText('选择消息表情回复'));
  fireEvent.press(catalog.getByRole('button', { name: 'doge' }));
  expect(runtime.react).toHaveBeenCalledWith(original.id, 'bili:doge', true);
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  expect(runtime.emoteLibrary).not.toHaveBeenCalled();
});

test('an account switch closes the reaction catalog without loading a private library', async () => {
  const runtime = { react: jest.fn(), emoteLibrary: jest.fn() } as unknown as Runtime;
  const { view, openMore } = renderRow(runtime);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '添加表情回复' }));
  await act(async () => useWorkspace.getState().reset());
  expect(view.queryByText('选择消息表情回复')).toBeNull();
  expect(runtime.react).not.toHaveBeenCalled();
  expect(runtime.emoteLibrary).not.toHaveBeenCalled();
});

test.each([
  ['emoji:thumbs-up', '👍'], ['emoji:heart', '❤️'], ['emoji:smile', '😄'],
])('quick reaction %s uses the same canonical key to add and remove', async (emoteKey, glyph) => {
  const runtime = { react: jest.fn().mockResolvedValue(undefined) } as unknown as Runtime;
  const { view, rerender } = renderRow(runtime);
  const chooseQuick = async () => {
    fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
    fireEvent.press(view.getByRole('button', { name: '反应' }));
    await act(async () => fireEvent.press(view.getByRole('button', { name: `反应 ${glyph}` })));
  };
  await chooseQuick();
  expect(runtime.react).toHaveBeenLastCalledWith(original.id, emoteKey, false);
  rerender({ ...original, reactions: [{ emoteKey, count: 1, reactedByCurrentUser: true }] });
  await chooseQuick();
  expect(runtime.react).toHaveBeenLastCalledWith(original.id, emoteKey, true);
});

test('a full-catalog image uses one canonical key for selection and the resulting selected pill', async () => {
  const runtime = { react: jest.fn().mockResolvedValue(undefined) } as unknown as Runtime;
  const { view, openMore, rerender } = renderRow(runtime);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '添加表情回复' }));
  fireEvent.press(view.getByRole('tab', { name: 'B站' }));
  const catalog = within(view.getByLabelText('选择消息表情回复'));
  await act(async () => fireEvent.press(catalog.getByRole('button', { name: 'doge' })));
  expect(runtime.react).toHaveBeenLastCalledWith(original.id, 'bili:doge', false);
  rerender({ ...original, reactions: [{ emoteKey: 'bili:doge', count: 1, reactedByCurrentUser: true }] });
  await act(async () => fireEvent.press(view.getByRole('button', { name: 'bili:doge 1，已选择' })));
  expect(runtime.react).toHaveBeenLastCalledWith(original.id, 'bili:doge', true);
});

test.each([
  { status: 'closed', joined: true, hide: true },
  { status: 'archived', joined: true, hide: true },
  { status: 'open', joined: false, hide: false },
])('$status topic joined=$joined removes write controls and preserves permitted personal hide', ({ status, joined, hide }) => {
  const topic = topicSchema.parse({ id: 'topic-synthetic', conversationId: original.conversationId, title: '合成话题', status, joined, allowSyncToGroup: true });
  useWorkspace.getState().upsertTopic(topic);
  const runtime = { react: jest.fn(), pin: jest.fn(), recall: jest.fn() } as unknown as Runtime;
  const onReply = jest.fn();
  const onToggleProjection = jest.fn();
  const { view, openMore } = renderRow(runtime, { ...original, topicId: topic.id }, { onReply, onToggleProjection });
  openMore();
  expect(view.queryByRole('button', { name: '回复' })).toBeNull();
  expect(view.queryByRole('button', { name: '常驻' })).toBeNull();
  expect(view.queryByRole('button', { name: '撤回' })).toBeNull();
  expect(view.queryByRole('button', { name: '添加表情回复' })).toBeNull();
  expect(view.queryByRole('button', { name: '同步到群聊' })).toBeNull();
  expect(!!view.queryByRole('button', { name: '仅自己隐藏' })).toBe(hide);
});

test('open joined topic pin uses its parent group and projection action follows canonical callback state', async () => {
  const topic = topicSchema.parse({ id: 'topic-synthetic', conversationId: original.conversationId, title: '合成话题', status: 'open', joined: true, allowSyncToGroup: true });
  useWorkspace.getState().upsertTopic(topic);
  const runtime = { pin: jest.fn().mockResolvedValue(undefined) } as unknown as Runtime;
  const onToggleProjection = jest.fn();
  const { view, openMore } = renderRow(runtime, { ...original, topicId: topic.id }, { onToggleProjection, isProjected: false });
  openMore();
  fireEvent.press(view.getByRole('button', { name: '常驻' }));
  expect(runtime.pin).toHaveBeenCalledWith(original.conversationId, original.id, false);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '同步到群聊' }));
  expect(onToggleProjection).toHaveBeenCalledTimes(1);
});

test('pending projection disables duplicate cancellation', () => {
  const topic = topicSchema.parse({ id: 'topic-synthetic', conversationId: original.conversationId, title: '合成话题', status: 'open', joined: true, allowSyncToGroup: true });
  useWorkspace.getState().upsertTopic(topic);
  const onToggleProjection = jest.fn();
  const { view, openMore } = renderRow({} as Runtime, { ...original, topicId: topic.id }, { onToggleProjection, isProjected: true, projectionBusy: true });
  openMore();
  const action = view.getByRole('button', { name: '取消同步到群聊' });
  expect(action).toBeDisabled();
  fireEvent.press(action);
  expect(onToggleProjection).not.toHaveBeenCalled();
});

test('closing a topic while recall confirmation is open cannot execute the stale command', async () => {
  const topic = topicSchema.parse({ id: 'topic-synthetic', conversationId: original.conversationId, title: '合成话题', status: 'open', joined: true });
  useWorkspace.getState().upsertTopic(topic);
  const runtime = { recall: jest.fn().mockResolvedValue(undefined) } as unknown as Runtime;
  const { view, openMore } = renderRow(runtime, { ...original, topicId: topic.id });
  openMore();
  fireEvent.press(view.getByRole('button', { name: '撤回' }));
  expect(runtime.recall).not.toHaveBeenCalled();
  await act(async () => useWorkspace.getState().upsertTopic({ ...topic, status: 'closed' }));
  view.queryAllByRole('button', { name: '撤回' }).forEach(button => fireEvent.press(button));
  expect(runtime.recall).not.toHaveBeenCalled();
});

test('unexpected operation errors never expose raw exception content', async () => {
  const runtime = { hide: jest.fn().mockRejectedValue(new Error('synthetic-private-sql-stack')) } as unknown as Runtime;
  const { view, openMore } = renderRow(runtime);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '仅自己隐藏' }));
  await waitFor(() => expect(view.getByText('无法连接到服务器，请检查网络后重试（net.unknown）')).toBeTruthy());
  expect(view.queryByText(/synthetic-private-sql-stack/)).toBeNull();
  expect(view.getByText(text)).toBeTruthy();
});

test('a previous failed invocation cannot overwrite feedback after a later action', async () => {
  let rejectHide: (reason: unknown) => void = () => undefined;
  const hide = new Promise<void>((_resolve, reject) => { rejectHide = reject; });
  const runtime = { hide: jest.fn().mockReturnValue(hide), pin: jest.fn().mockResolvedValue(undefined) } as unknown as Runtime;
  const { view, openMore } = renderRow(runtime);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '仅自己隐藏' }));
  openMore();
  fireEvent.press(view.getByRole('button', { name: '常驻' }));
  await act(async () => rejectHide(new ApiError('permission.denied', 403)));
  expect(view.queryByText('你当前不能执行此操作')).toBeNull();
});

test('a late rejection is ignored when the row changes message identity', async () => {
  let rejectHide: (reason: unknown) => void = () => undefined;
  const hide = new Promise<void>((_resolve, reject) => { rejectHide = reject; });
  const runtime = { hide: jest.fn().mockReturnValue(hide) } as unknown as Runtime;
  const { view, openMore, rerender } = renderRow(runtime);
  openMore();
  fireEvent.press(view.getByRole('button', { name: '仅自己隐藏' }));
  rerender({ ...original, id: 'another-synthetic-message' });
  await act(async () => rejectHide(new ApiError('permission.denied', 403)));
  expect(view.queryByText('你当前不能执行此操作')).toBeNull();
});
