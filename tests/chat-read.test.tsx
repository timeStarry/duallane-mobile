import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, FlatList } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatScreen } from '../src/features/chat/screens';
import type { Runtime } from '../src/data/runtime';
import type { Transfers } from '../src/data/transfers';
import { bootstrapSchema, conversationSchema, memberSchema, parseMessage, targetKey, topicSchema, type ChatTarget, type Draft, type Message } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { CatalogEmoteGrid } from '../src/ui/CatalogEmoteGrid';

let mockFocused = true;
let mockPanel = 'none';
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockFocused,
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('../src/ui/useChatIme', () => ({
  useChatIme: () => ({ panel: mockPanel, dock: { dockBottom: 0, panelHeight: 0 }, openPanel: jest.fn(), closePanel: jest.fn(), setPanel: jest.fn() }),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.1', nativeBuildVersion: '3' } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
const conversationTarget: ChatTarget = { kind: 'conversation', id: 'g1' };
const topicTarget: ChatTarget = { kind: 'topic', id: 't1', conversationId: 'g1' };
const originalAppState = AppState.currentState;

function dto(id: string, second: number, target: ChatTarget = conversationTarget, extra: Record<string, unknown> = {}) {
  return {
    id, conversationId: target.kind === 'topic' ? target.conversationId : target.id,
    ...(target.kind === 'topic' ? { topicId: target.id } : {}),
    authorId: 'other', authorName: 'Peer', kind: 'user',
    createdAt: new Date(Date.UTC(2026, 9, 5, 0, 0, second)).toISOString(), plainText: id,
    content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: id }] }, attachments: [], ...extra,
  };
}

function message(id: string, second: number, target: ChatTarget = conversationTarget, extra: Record<string, unknown> = {}): Message {
  return parseMessage(dto(id, second, target, extra))!;
}

function seed(target: ChatTarget = conversationTarget, messages?: Message[]) {
  const conversationId = target.kind === 'topic' ? target.conversationId : target.id;
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Self' } }, space: { id: 'space-1', name: 'Test' }, eventCursor: 0,
    permissions: { canReadConversations: true },
    policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, members: [], files: [],
    conversations: [{ id: conversationId, displayTitle: conversationId, type: 'group', lastActivityAt: '2026-10-05T00:00:00Z', unreadCount: 2, capabilities: { canSendMessage: true } }],
  }), 'test:self');
  if (target.kind === 'topic') useWorkspace.getState().upsertTopic(topicSchema.parse({ id: target.id, conversationId, title: 'Topic', joined: true, unreadCount: 2 }));
  if (messages) useWorkspace.getState().setMessages(targetKey(target), messages);
  useWorkspace.setState({ connection: '已连接' });
}

function createRuntime() {
  return {
    api: { json: jest.fn().mockResolvedValue({ messages: [] }) },
    open: jest.fn().mockResolvedValue(2), openTopic: jest.fn().mockResolvedValue(2),
    markRead: jest.fn().mockResolvedValue(undefined),
    patchDraft: jest.fn((key: string, patch: Partial<Draft>) => useWorkspace.getState().setDraft(key, patch)),
    send: jest.fn().mockResolvedValue(undefined),
    topicProjections: jest.fn().mockResolvedValue([]),
    setTopicProjection: jest.fn().mockResolvedValue(null),
    emotes: jest.fn().mockResolvedValue({ items: [] }),
    emoteLibrary: jest.fn().mockResolvedValue({ emotes: [], collections: [] }),
  };
}

function screen(runtime: ReturnType<typeof createRuntime>, target: ChatTarget = conversationTarget, focusMessageId?: string) {
  return <SafeAreaProvider initialMetrics={metrics}><ChatScreen target={target} focusMessageId={focusMessageId} runtime={runtime as unknown as Runtime} transfers={{} as Transfers} details={jest.fn()} /></SafeAreaProvider>;
}

function offset(y: number) {
  return { nativeEvent: { contentOffset: { y }, contentSize: { height: 1500 }, layoutMeasurement: { height: 500 } } };
}

beforeEach(() => {
  jest.useFakeTimers();
  useWorkspace.getState().reset();
  mockFocused = true;
  mockPanel = 'none';
  AppState.currentState = 'active';
  jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  jest.spyOn(FlatList.prototype, 'scrollToEnd').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  useWorkspace.getState().reset();
  AppState.currentState = originalAppState;
  jest.restoreAllMocks();
});

test.each([conversationTarget, topicTarget])('opening a $kind at a historical anchor does not read its initial latest window', async target => {
  seed(target);
  const runtime = createRuntime();
  const open = async () => {
    useWorkspace.getState().setMessages(targetKey(target), [message('latest-1', 1, target), message('latest-2', 2, target)]);
    return 2;
  };
  runtime.open.mockImplementation(open);
  runtime.openTopic.mockImplementation(open);
  runtime.api.json.mockResolvedValue({ messages: [dto('original', 0, target)] });
  const view = render(screen(runtime, target, 'original'));

  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalledWith({ index: 0, animated: false, viewPosition: 0.5 }));
  expect(runtime.markRead).not.toHaveBeenCalled();
  act(() => useWorkspace.getState().upsertMessage(message('latest-3', 3, target)));
  expect(runtime.markRead).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith(target.id, 'latest-3', target.kind === 'topic'));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
});

test('returning to the bottom by scrolling reads a message received while browsing history once', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  runtime.open.mockResolvedValue(50);
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.inverted).toBe(true));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, offset(300));
  fireEvent(list, 'scrollEndDrag', offset(300));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);

  fireEvent(list, 'momentumScrollEnd', offset(0));
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
  fireEvent(list, 'momentumScrollEnd', offset(0));
  act(() => useWorkspace.setState(s => ({ conversations: { ...s.conversations, g1: { ...s.conversations.g1!, unreadCount: 0, lastReadMessageId: 'latest-2' } } })));
  expect(runtime.markRead).toHaveBeenCalledTimes(2);
});

test('read requests are serialized and a local pending message waits for server confirmation', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  let finishRead!: () => void;
  runtime.markRead.mockImplementationOnce(() => new Promise<void>(resolve => { finishRead = resolve; }));
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  act(() => useWorkspace.getState().upsertMessage({ ...message('latest-3', 3), status: 'sending' }));
  await act(async () => { finishRead(); });
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  act(() => useWorkspace.getState().upsertMessage(message('latest-3', 3)));
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-3', false));
  fireEvent(view.UNSAFE_getByType(FlatList), 'momentumScrollEnd', offset(1000));
  expect(runtime.markRead).toHaveBeenCalledTimes(2);
});

test('a failed marker does not retry in a render loop and retries after connectivity recovers', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  runtime.markRead.mockRejectedValue(new Error('synthetic failure'));
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  await act(async () => undefined);
  view.rerender(screen(runtime));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  act(() => useWorkspace.setState({ connection: '离线缓存，恢复连接后同步' }));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  act(() => useWorkspace.setState({ connection: '实时未接通，已用 HTTP 同步' }));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(2));
});

test.each(['background', 'unfocused', 'offline', 'unjoined'])('automatic read is suppressed while %s', async state => {
  seed(topicTarget, [message('latest-1', 1, topicTarget)]);
  if (state === 'background') AppState.currentState = 'background';
  if (state === 'unfocused') mockFocused = false;
  if (state === 'offline') useWorkspace.setState({ connection: '离线缓存，恢复连接后同步' });
  if (state === 'unjoined') useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, joined: false } } }));
  const runtime = createRuntime();
  render(screen(runtime, topicTarget));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
});

test('resuming the app reads a newer server message only when the current view remains at the bottom', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  AppState.currentState = 'background';
  const listen = jest.spyOn(AppState, 'addEventListener');
  const runtime = createRuntime();
  render(screen(runtime));
  await act(async () => undefined);
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  expect(runtime.markRead).not.toHaveBeenCalled();
  const onChange = listen.mock.calls.find(([event]) => event === 'change')?.[1];
  act(() => {
    AppState.currentState = 'active';
    onChange?.('active');
  });
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-2', false));
});

test('changing the historical anchor on the same route suppresses read before locating it', async () => {
  seed(conversationTarget, [message('original', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  view.rerender(screen(runtime, conversationTarget, 'original'));
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalled());
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
});

test.each([conversationTarget, topicTarget])('reply location fetches an authorized $kind around window without reading new messages or changing the draft', async target => {
  seed(target, [message('reply', 2, target, { replyToMessageId: 'original' })]);
  useWorkspace.getState().setDraft(targetKey(target), { text: 'draft stays', mentionIds: ['other'], replyToMessageId: 'reply' });
  const runtime = createRuntime();
  runtime.api.json.mockResolvedValue({ messages: [dto('original', 0, target), dto('foreign', 1, { kind: 'conversation', id: 'foreign-group' })] });
  const view = render(screen(runtime, target));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalledWith({ index: 0, animated: false, viewPosition: 0.5 }));
  expect(runtime.api.json).toHaveBeenCalledWith(`/api/workspace/${target.kind === 'topic' ? 'topics' : 'conversations'}/${target.id}/messages?around=original&limit=50`, expect.anything());
  expect(useWorkspace.getState().messages[targetKey(target)]?.map(item => item.id)).toEqual(['original', 'reply']);
  expect(useWorkspace.getState().drafts[targetKey(target)]).toEqual({ text: 'draft stays', mentionIds: ['other'], replyToMessageId: 'reply' });
  act(() => useWorkspace.getState().upsertMessage(message('latest-3', 3, target)));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith(target.id, 'latest-3', target.kind === 'topic'));
});

test('a cached original is located without loading or snapping back to the latest message', async () => {
  seed(conversationTarget, [message('original', 0), message('reply', 2, conversationTarget, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  jest.mocked(FlatList.prototype.scrollToEnd).mockClear();
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalled());
  fireEvent(view.UNSAFE_getByType(FlatList), 'contentSizeChange', 390, 1500);
  expect(FlatList.prototype.scrollToEnd).not.toHaveBeenCalled();
  expect(runtime.api.json).not.toHaveBeenCalled();
});

test.each([conversationTarget, topicTarget])('a late $kind around page cannot restore a neighbor recalled during the request', async target => {
  seed(target, [message('neighbor', 1, target), message('reply', 2, target, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  let finishAround!: (response: { messages: ReturnType<typeof dto>[] }) => void;
  runtime.api.json.mockImplementationOnce(() => new Promise(resolve => { finishAround = resolve; }));
  runtime.api.json.mockResolvedValue({ messages: [dto('original', 0, target), dto('neighbor', 1, target, { recalledAt: '2026-10-06T01:00:00Z', plainText: 'Recalled', content: null })] });
  const view = render(screen(runtime, target));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(runtime.api.json).toHaveBeenCalledTimes(1));
  act(() => useWorkspace.getState().upsertMessage(message('neighbor', 1, target, { recalledAt: '2026-10-06T01:00:00Z', plainText: 'Recalled', content: null })));
  await act(async () => { finishAround({ messages: [dto('original', 0, target), dto('neighbor', 1, target)] }); });
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalled());
  expect(runtime.api.json).toHaveBeenCalledTimes(2);
  expect(useWorkspace.getState().messages[targetKey(target)]?.find(item => item.id === 'neighbor')?.recalledAt).toBe('2026-10-06T01:00:00Z');
  expect(useWorkspace.getState().messages[targetKey(target)]?.find(item => item.id === 'neighbor')?.plainText).toBe('Recalled');
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
});

test('a personally hidden original is kept hidden with a safe recovery hint', async () => {
  seed(conversationTarget, [message('original', 0, conversationTarget, { hiddenByCurrentUser: true }), message('reply', 2, conversationTarget, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(view.getByText('原消息已隐藏，请先恢复后再定位。')).toBeTruthy());
  expect(useWorkspace.getState().messages.g1?.[0]?.hiddenByCurrentUser).toBe(true);
  expect(FlatList.prototype.scrollToIndex).not.toHaveBeenCalled();
  expect(runtime.api.json).not.toHaveBeenCalled();
});

test.each(['missing', 'foreign', 'forbidden'])('an unavailable reply (%s) gives safe feedback and keeps the existing window', async result => {
  seed(conversationTarget, [message('reply', 2, conversationTarget, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  if (result === 'forbidden') runtime.api.json.mockRejectedValue(new Error('sensitive server detail'));
  else runtime.api.json.mockResolvedValue({ messages: result === 'foreign' ? [dto('original', 0, { kind: 'conversation', id: 'foreign-group' })] : [] });
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(view.getAllByText('原消息不可用')).toHaveLength(2));
  expect(view.queryByText('sensitive server detail')).toBeNull();
  expect(useWorkspace.getState().messages.g1?.map(item => item.id)).toEqual(['reply']);
  expect(FlatList.prototype.scrollToIndex).not.toHaveBeenCalled();
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
});

test.each(['latest', 'scroll', 'target', 'account'])('a late around response cannot undo a newer %s decision', async change => {
  seed(conversationTarget, [message('reply', 2, conversationTarget, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  let finishAround!: (response: { messages: ReturnType<typeof dto>[] }) => void;
  runtime.api.json.mockImplementation(() => new Promise(resolve => { finishAround = resolve; }));
  const view = render(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(runtime.api.json).toHaveBeenCalledTimes(1));
  if (change === 'latest') fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  if (change === 'scroll') {
    const list = view.UNSAFE_getByType(FlatList);
    fireEvent(list, 'scrollBeginDrag');
    fireEvent(list, 'scrollEndDrag', offset(1000));
  }
  if (change === 'target') {
    const next = { kind: 'conversation', id: 'g2' } as const;
    act(() => {
      useWorkspace.setState(s => ({ conversations: { ...s.conversations, g2: conversationSchema.parse({ id: 'g2', type: 'group', displayTitle: 'g2', lastActivityAt: '2026-10-05T00:00:00Z' }) } }));
      useWorkspace.getState().setMessages('g2', [message('g2-latest', 3, next)]);
    });
    view.rerender(screen(runtime, next));
  }
  if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'test:another' }));
  await act(async () => { finishAround({ messages: [dto('original', 0)] }); });
  expect(useWorkspace.getState().messages.g1?.map(item => item.id)).toEqual(['reply']);
  expect(FlatList.prototype.scrollToIndex).not.toHaveBeenCalled();
});

test('the selected mention identity survives ordinary edits and is passed to send with its exact span', async () => {
  seed(conversationTarget, []);
  useWorkspace.setState(s => ({ conversations: { ...s.conversations, g1: { ...s.conversations.g1!, members: [memberSchema.parse({ id: 'first', displayName: 'Shared' }), memberSchema.parse({ id: 'second', displayName: 'Shared' })] } } }));
  useWorkspace.getState().setDraft('g1', { text: 'hello @', mentionIds: [] });
  mockPanel = 'mention';
  const runtime = createRuntime();
  const view = render(screen(runtime));
  fireEvent.press(view.getAllByRole('button', { name: '提及Shared' })[1]!);
  expect(useWorkspace.getState().drafts.g1?.mentionSpans).toEqual([{ userId: 'second', label: 'Shared', start: 6, end: 13 }]);
  fireEvent.changeText(view.getByLabelText('消息'), 'prefix hello @Shared ');
  expect(useWorkspace.getState().drafts.g1?.mentionSpans).toEqual([{ userId: 'second', label: 'Shared', start: 13, end: 20 }]);
  fireEvent.press(view.getByRole('button', { name: '发送' }));
  expect(runtime.send).toHaveBeenCalledWith('g1', 'prefix hello @Shared ', undefined, undefined, expect.objectContaining({ mentionIds: ['second'], mentionSpans: [{ userId: 'second', label: 'Shared', start: 13, end: 20 }] }));
  fireEvent.changeText(view.getByLabelText('消息'), 'prefix hello @Changed ');
  expect(useWorkspace.getState().drafts.g1?.mentionSpans).toEqual([]);
  expect(useWorkspace.getState().drafts.g1?.mentionIds).toEqual([]);
  await act(async () => undefined);
});

test('reply auto mention adds a selected span beside literal same-name text and deduplicates by identity', async () => {
  seed(conversationTarget, [message('original', 1)]);
  useWorkspace.getState().setChatSettings({ replyAutoMention: true, clickImageEmoteToSend: false, autoHideMessages: false, autoHideMessageTypes: [] });
  useWorkspace.getState().setDraft('g1', { text: '@Peer', mentionIds: [] });
  const runtime = createRuntime();
  const view = render(screen(runtime));
  fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
  fireEvent.press(view.getByRole('button', { name: '回复' }));
  expect(useWorkspace.getState().drafts.g1).toEqual({ text: '@Peer @Peer ', mentionIds: ['other'], replyToMessageId: 'original', mentionSpans: [{ userId: 'other', label: 'Peer', start: 6, end: 11 }] });
  fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
  fireEvent.press(view.getByRole('button', { name: '回复' }));
  expect(useWorkspace.getState().drafts.g1?.text).toBe('@Peer @Peer ');
  await act(async () => undefined);
});

test('emote insertion preserves selected spans and direct image replacement clears unrelated mentions', async () => {
  seed(conversationTarget, []);
  useWorkspace.getState().setDraft('g1', { text: '@Peer ', mentionIds: ['other'], mentionSpans: [{ userId: 'other', label: 'Peer', start: 0, end: 5 }] });
  mockPanel = 'emoji';
  const runtime = createRuntime();
  const view = render(screen(runtime));
  act(() => view.UNSAFE_getByType(CatalogEmoteGrid).props.onPick({ kind: 'unicode', id: 'smile', label: 'smile', value: '😀' }, 'emoji'));
  expect(useWorkspace.getState().drafts.g1).toEqual({ text: '@Peer 😀', mentionIds: ['other'], mentionSpans: [{ userId: 'other', label: 'Peer', start: 0, end: 5 }] });
  act(() => useWorkspace.getState().setChatSettings({ replyAutoMention: false, clickImageEmoteToSend: true, autoHideMessages: false, autoHideMessageTypes: [] }));
  act(() => view.UNSAFE_getByType(CatalogEmoteGrid).props.onPick({ kind: 'image', id: '00000000-0000-0000-0000-000000000001', label: 'custom', token: '[custom:00000000-0000-0000-0000-000000000001]' }, 'custom'));
  expect(runtime.send).toHaveBeenCalledWith('g1', '[custom:00000000-0000-0000-0000-000000000001]', undefined, undefined, expect.objectContaining({ mentionIds: [], mentionSpans: [] }));
  await act(async () => undefined);
});

test('posted topic messages expose sync and cancel through the shared action menu', async () => {
  seed(topicTarget, [message('posted', 1, topicTarget)]);
  useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, allowSyncToGroup: true } } }));
  const runtime = createRuntime();
  runtime.setTopicProjection.mockResolvedValueOnce({ id: 'p1', topicMessageId: 'posted', removedAt: null });
  const view = render(screen(runtime, topicTarget));
  await waitFor(() => expect(runtime.topicProjections).toHaveBeenCalledWith('t1'));
  fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
  fireEvent.press(view.getByRole('button', { name: '更多' }));
  await waitFor(() => expect(view.getByRole('button', { name: '同步到群聊' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '同步到群聊' }));
  await waitFor(() => expect(view.getByText('已同步到群聊')).toBeTruthy());
  expect(runtime.setTopicProjection).toHaveBeenLastCalledWith('t1', 'posted', true);
  fireEvent.press(view.getByRole('button', { name: /^消息操作，/ }));
  fireEvent.press(view.getByRole('button', { name: '更多' }));
  fireEvent.press(view.getByRole('button', { name: '取消同步到群聊' }));
  await waitFor(() => expect(view.getByText('已取消同步')).toBeTruthy());
  expect(runtime.setTopicProjection).toHaveBeenLastCalledWith('t1', 'posted', false);
});

test('legacy selected-mention drafts explain that members must be selected again after editing', async () => {
  seed(conversationTarget, []);
  useWorkspace.getState().setDraft('g1', { text: '@Peer old', mentionIds: ['other'] });
  const runtime = createRuntime();
  const view = render(screen(runtime));
  expect(view.getByText('旧草稿中的提及请重新选择成员')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('消息'), '@Peer edited');
  expect(view.queryByText('旧草稿中的提及请重新选择成员')).toBeNull();
  expect(useWorkspace.getState().drafts.g1?.mentionIds).toEqual([]);
  await act(async () => undefined);
});
