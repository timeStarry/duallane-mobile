import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, FlatList, Keyboard, View, type MeasureInWindowOnSuccessCallback } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatScreen } from '../src/features/chat/screens';
import type { Runtime } from '../src/data/runtime';
import type { Transfers } from '../src/data/transfers';
import { bootstrapSchema, conversationSchema, memberSchema, parseMessage, targetKey, topicSchema, type ChatTarget, type Draft, type Message } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { CatalogEmoteGrid } from '../src/ui/CatalogEmoteGrid';
import { MessageRow } from '../src/ui/message';
import type { WorkspaceMessageDisplayItem } from '../src/domain/hidden-messages';

let mockFocused = true;
let mockPanel = 'none';
let mockCompact = false;
let mockInsufficientSpace = false;
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => mockFocused,
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('../src/ui/useChatIme', () => ({
  useChatIme: () => ({ panel: mockPanel, compact: mockCompact, insufficientSpace: mockInsufficientSpace, availableContentHeight: 84, minimumComposerHeight: 48, dock: { dockBottom: 0, panelHeight: 0 }, openPanel: jest.fn(), closePanel: jest.fn(), setPanel: jest.fn() }),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.1', nativeBuildVersion: '3' } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
const conversationTarget: ChatTarget = { kind: 'conversation', id: 'g1' };
const topicTarget: ChatTarget = { kind: 'topic', id: 't1', conversationId: 'g1' };
const originalAppState = AppState.currentState;
const mockNativeScrollToEnd = jest.fn();
const mockMeasureViewport = jest.fn<void, [MeasureInWindowOnSuccessCallback]>();
const mockMeasureTail = jest.fn<void, [MeasureInWindowOnSuccessCallback]>();

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
    messages: jest.fn().mockResolvedValue(0), topicMessages: jest.fn().mockResolvedValue(0),
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

function visibleLatest(view: ReturnType<typeof render>, messageId: string) {
  const list = view.UNSAFE_getByType(FlatList);
  const items = list.props.data as WorkspaceMessageDisplayItem<Message>[];
  const index = items.findIndex(item => item.kind === 'message'
    ? item.message.id === messageId
    : item.messages.some(message => message.id === messageId));
  fireEvent(list, 'viewableItemsChanged', {
    viewableItems: [{ item: items[index], index, key: messageId, isViewable: true }], changed: [],
  });
}

async function observeLatest(view: ReturnType<typeof render>, messageId?: string) {
  await act(async () => undefined);
  const list = view.UNSAFE_getByType(FlatList);
  const items = list.props.data as WorkspaceMessageDisplayItem<Message>[];
  const tail = list.props.inverted ? items[0] : items.at(-1);
  const tailId = messageId ?? (tail?.kind === 'message' ? tail.message.id : tail?.messages.at(-1)?.id);
  if (!tailId) throw new Error('The test must provide a populated transcript');
  fireEvent.scroll(list, offset(list.props.inverted ? 0 : 1000));
  visibleLatest(view, tailId);
}

beforeEach(() => {
  jest.useFakeTimers();
  useWorkspace.getState().reset();
  mockFocused = true;
  mockPanel = 'none';
  mockCompact = false;
  mockInsufficientSpace = false;
  AppState.currentState = 'active';
  jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => undefined);
  jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => undefined);
  jest.spyOn(FlatList.prototype, 'scrollToEnd').mockImplementation(() => undefined);
  mockNativeScrollToEnd.mockClear();
  mockMeasureViewport.mockReset();
  mockMeasureTail.mockReset();
  jest.spyOn(FlatList.prototype, 'getNativeScrollRef').mockImplementation(() => (
    { measureInWindow: mockMeasureViewport } as unknown as ReturnType<FlatList['getNativeScrollRef']>
  ));
  jest.spyOn(View.prototype, 'measureInWindow').mockImplementation(mockMeasureTail);
  jest.spyOn(FlatList.prototype, 'getScrollResponder').mockImplementation(() => (
    { scrollToEnd: mockNativeScrollToEnd } as unknown as ReturnType<FlatList['getScrollResponder']>
  ));
});

test('a compact keyboard keeps the topic identity, navigation and explicit group-sync choice reachable', async () => {
  seed(topicTarget, []);
  useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, allowSyncToGroup: true } } }));
  useWorkspace.getState().setDraft(targetKey(topicTarget), { text: 'synthetic compact topic', mentionIds: [] });
  mockCompact = true;
  const runtime = createRuntime();
  const view = render(screen(runtime, topicTarget));
  expect(view.getByRole('button', { name: '返回' })).toBeTruthy();
  expect(view.getByRole('button', { name: '会话详情' })).toBeTruthy();
  expect(view.getByLabelText('消息').props.value).toBe('synthetic compact topic');
  fireEvent.press(view.getByRole('button', { name: 'Topic，只发到话题，点按切换' }));
  expect(view.getByRole('button', { name: 'Topic，将同步到群聊，点按切换' })).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '发送' }));
  expect(runtime.send).toHaveBeenCalledWith('g1', 'synthetic compact topic', undefined, undefined, expect.objectContaining({ topicId: 't1', syncToGroup: true }));
  await act(async () => undefined);
});

test('an opaque keyboard leaving less than a full input row is dismissed without changing the draft or sending', async () => {
  seed(conversationTarget, []);
  useWorkspace.getState().setDraft('g1', { text: 'synthetic preserved draft', mentionIds: [] });
  mockCompact = true;
  mockInsufficientSpace = true;
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await waitFor(() => expect(dismiss).toHaveBeenCalled());
  expect(view.getByText('当前可用高度不足，请转为竖屏后继续输入。')).toBeTruthy();
  expect(useWorkspace.getState().drafts.g1?.text).toBe('synthetic preserved draft');
  expect(runtime.send).not.toHaveBeenCalled();
});

test('closing a topic with its compact keyboard open retains the title and both navigation controls', async () => {
  seed(topicTarget, []);
  useWorkspace.getState().setDraft(targetKey(topicTarget), { text: 'synthetic retained topic draft', mentionIds: [] });
  mockCompact = true;
  const runtime = createRuntime();
  const view = render(screen(runtime, topicTarget));
  act(() => useWorkspace.setState(s => ({ topics: { ...s.topics, t1: { ...s.topics.t1!, status: 'closed' } } })));
  expect(view.getByText('Topic')).toBeTruthy();
  expect(view.getByRole('button', { name: '返回' })).toBeTruthy();
  expect(view.getByRole('button', { name: '会话详情' })).toBeTruthy();
  expect(view.queryByLabelText('消息')).toBeNull();
  expect(useWorkspace.getState().drafts[targetKey(topicTarget)]?.text).toBe('synthetic retained topic draft');
  expect(runtime.send).not.toHaveBeenCalled();
  await act(async () => undefined);
});

test('a send error that would cover a compact composer dismisses the keyboard and clears on deliberate refocus', async () => {
  seed(conversationTarget, []);
  useWorkspace.getState().setDraft('g1', { text: 'synthetic failed compact send', mentionIds: [] });
  mockCompact = true;
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  const runtime = createRuntime();
  runtime.send.mockRejectedValue(new Error('synthetic transport error'));
  const view = render(screen(runtime));
  fireEvent.press(view.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1));
  expect(useWorkspace.getState().drafts.g1?.text).toBe('synthetic failed compact send');
  fireEvent(view.getByLabelText('消息'), 'focus');
  expect(runtime.send).toHaveBeenCalledTimes(1);
  expect(dismiss).toHaveBeenCalledTimes(1);
});

test('an initially long async card does not read or hide latest until the real bottom and tail are visible', async () => {
  seed(conversationTarget, [message('long-card', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 500, width: 390, x: 0, y: 0 } } });
  fireEvent(list, 'contentSizeChange', 390, 1500);
  fireEvent.scroll(list, offset(200));
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
  expect(mockNativeScrollToEnd).toHaveBeenCalledWith({ animated: false });
  expect(FlatList.prototype.scrollToEnd).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
  fireEvent.scroll(list, offset(1000));
  expect(runtime.markRead).not.toHaveBeenCalled();
  visibleLatest(view, 'latest-1');
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-1', false));
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();

  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  fireEvent(list, 'contentSizeChange', 390, 2500);
  expect(mockNativeScrollToEnd).toHaveBeenLastCalledWith({ animated: false });
  visibleLatest(view, 'latest-2');
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 2000 }, contentSize: { height: 2500 }, layoutMeasurement: { height: 500 } } });
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
});

test.each(['content-size', 'viewability', 'offset'])('a late active %s observation cannot leave latest visible when the native tail is already fully visible', async source => {
  seed(conversationTarget, [message('long-card', 0), message('latest-1', 1)]);
  useWorkspace.setState({ connection: '离线缓存，恢复连接后同步' });
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await act(async () => undefined);
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent.scroll(list, offset(200));
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  mockMeasureTail.mockImplementation(callback => callback(0, 230, 390, 370));
  const latest = view.UNSAFE_getAllByType(MessageRow).find(row => row.props.message.id === 'latest-1');
  if (!latest) throw new Error('The fixture must mount the latest native row');
  fireEvent(latest, 'layout', { nativeEvent: { layout: { x: 0, y: 1000, width: 390, height: 370 } } });
  await act(async () => undefined);
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();
  expect(runtime.markRead).not.toHaveBeenCalled();
  mockMeasureViewport.mockClear();
  // Native is physically at the tail. A late list observation revokes the proof;
  // the following scrollToEnd cannot emit another event at an unchanged position.
  if (source === 'content-size') fireEvent(list, 'contentSizeChange', 390, 4500);
  if (source === 'viewability') visibleLatest(view, 'long-card');
  if (source === 'offset') {
    fireEvent.scroll(list, offset(300));
    fireEvent.scroll(list, offset(400));
  }
  await act(async () => undefined);
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();
  expect(mockMeasureViewport).toHaveBeenCalledTimes(source === 'offset' ? 2 : 1);
  act(() => useWorkspace.setState({ connection: '已连接' }));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  if (source === 'offset') {
    mockMeasureViewport.mockClear();
    mockMeasureTail.mockImplementation(callback => callback(0, 500, 390, 300));
    for (const y of [500, 600, 700]) fireEvent.scroll(list, offset(y));
    expect(mockMeasureViewport).toHaveBeenCalledTimes(1);
    expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
    expect(runtime.markRead).toHaveBeenCalledTimes(1);
  }
});

test('a short complete transcript can confirm its visible hidden tail without a scroll event', async () => {
  seed(conversationTarget, [message('latest-1', 1, conversationTarget, { hiddenByCurrentUser: true })]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 500, width: 390, x: 0, y: 0 } } });
  fireEvent(list, 'contentSizeChange', 390, 200);
  expect(runtime.markRead).not.toHaveBeenCalled();
  visibleLatest(view, 'latest-1');
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-1', false));
});

test.each(['navigation', 'foreground'])('an untouched transcript repins after %s and a late native offset without reading early', async transition => {
  seed(conversationTarget, [message('long-card', 0), message('latest-1', 1)]);
  const listen = jest.spyOn(AppState, 'addEventListener');
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const onAppState = listen.mock.calls.find(([event]) => event === 'change')?.[1];
  if (transition === 'navigation') {
    mockFocused = false;
    view.rerender(screen(runtime));
  } else act(() => { AppState.currentState = 'background'; onAppState?.('background'); });

  mockNativeScrollToEnd.mockClear();
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  const list = view.UNSAFE_getByType(FlatList);
  // A refreshed card changes height while the mounted native screen is inactive.
  fireEvent(list, 'contentSizeChange', 390, 4500);
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 200 }, contentSize: { height: 4500 }, layoutMeasurement: { height: 500 } } });
  visibleLatest(view, 'latest-2');
  expect(mockNativeScrollToEnd).not.toHaveBeenCalled();
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  const inactiveCallbacks = list.props;

  if (transition === 'navigation') {
    mockFocused = true;
    view.rerender(screen(runtime));
  } else act(() => { AppState.currentState = 'active'; onAppState?.('active'); });
  await act(async () => undefined);
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(1);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  act(() => inactiveCallbacks.onScroll({ nativeEvent: { contentOffset: { y: 4000 }, contentSize: { height: 4500 }, layoutMeasurement: { height: 500 } } }));
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  // Native restores/clamps its old offset after the first scroll command.
  const oldPosition = { nativeEvent: { contentOffset: { y: 200 }, contentSize: { height: 4500 }, layoutMeasurement: { height: 500 } } };
  fireEvent.scroll(list, oldPosition);
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(2);
  for (let frame = 0; frame < 5; frame += 1) fireEvent.scroll(list, oldPosition);
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(2);
  expect(view.getByTestId('transcript-latest-overlay')).toHaveStyle({ position: 'absolute' });
  expect(runtime.markRead).toHaveBeenCalledTimes(1);

  fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 4000 }, contentSize: { height: 4500 }, layoutMeasurement: { height: 500 } } });
  visibleLatest(view, 'latest-2');
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();
});

test('async card relayout gets one offset correction per measured size without a user drag or an early read', async () => {
  seed(conversationTarget, [message('long-card', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const list = view.UNSAFE_getByType(FlatList);
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  mockNativeScrollToEnd.mockClear();
  fireEvent(list, 'contentSizeChange', 390, 4500);
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(1);
  // Even inside the read threshold, a preserved pin should reveal the whole tail.
  const staleOffset = { nativeEvent: { contentOffset: { y: 3950 }, contentSize: { height: 4500 }, layoutMeasurement: { height: 500 } } };
  fireEvent.scroll(list, staleOffset);
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(2);
  fireEvent.scroll(list, staleOffset);
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(2);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);

  // A later async expansion is a new measured change, not a timer retry loop.
  fireEvent(list, 'contentSizeChange', 390, 5500);
  fireEvent.scroll(list, { nativeEvent: { ...staleOffset.nativeEvent, contentSize: { height: 5500 } } });
  expect(mockNativeScrollToEnd).toHaveBeenCalledTimes(4);
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 5000 }, contentSize: { height: 5500 }, layoutMeasurement: { height: 500 } } });
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  visibleLatest(view, 'latest-2');
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
});

test('a background message update cannot reuse the previously visible tail to read when resuming', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const listen = jest.spyOn(AppState, 'addEventListener');
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const onAppState = listen.mock.calls.find(([event]) => event === 'change')?.[1];
  act(() => { AppState.currentState = 'background'; onAppState?.('background'); });
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  act(() => { AppState.currentState = 'active'; onAppState?.('active'); });
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  await observeLatest(view, 'latest-2');
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
});

test.each(['navigation', 'foreground'])('a new tail measured while inactive cannot read before fresh foreground evidence after %s', async transition => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const listen = jest.spyOn(AppState, 'addEventListener');
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const onAppState = listen.mock.calls.find(([event]) => event === 'change')?.[1];
  if (transition === 'navigation') { mockFocused = false; view.rerender(screen(runtime)); }
  else act(() => { AppState.currentState = 'background'; onAppState?.('background'); });
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await observeLatest(view, 'latest-2');
  if (transition === 'navigation') { mockFocused = true; view.rerender(screen(runtime)); }
  else act(() => { AppState.currentState = 'active'; onAppState?.('active'); });
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent.scroll(list, offset(200));
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  await observeLatest(view, 'latest-2');
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
});

test('an unchanged short tail keeps its active evidence across focus loss without new native callbacks', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  useWorkspace.setState({ connection: '离线缓存，恢复连接后同步' });
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await act(async () => undefined);
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 500, width: 390, x: 0, y: 0 } } });
  fireEvent(list, 'contentSizeChange', 390, 200);
  visibleLatest(view, 'latest-1');
  mockFocused = false;
  view.rerender(screen(runtime));
  act(() => useWorkspace.setState({ connection: '已连接' }));
  expect(runtime.markRead).not.toHaveBeenCalled();
  mockFocused = true;
  view.rerender(screen(runtime));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-1', false));
});

test('inactive geometry changes revoke the same tail evidence until a real foreground measurement', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  useWorkspace.setState({ connection: '离线缓存，恢复连接后同步' });
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  mockFocused = false;
  view.rerender(screen(runtime));
  fireEvent(view.UNSAFE_getByType(FlatList), 'contentSizeChange', 390, 4500);
  mockFocused = true;
  act(() => useWorkspace.setState({ connection: '已连接' }));
  view.rerender(screen(runtime));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  mockMeasureTail.mockImplementation(callback => callback(0, 500, 390, 100));
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-1', false));
});

test('dirty resume retries native proof once on reaching the tail, not on every scroll frame', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  mockFocused = false;
  view.rerender(screen(runtime));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await observeLatest(view, 'latest-2');
  mockMeasureViewport.mockClear();
  mockMeasureTail.mockClear();
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  mockMeasureTail.mockImplementation(callback => callback(0, 500, 390, 300));
  mockFocused = true;
  view.rerender(screen(runtime));
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  expect(mockMeasureViewport).toHaveBeenCalledTimes(1);
  const list = view.UNSAFE_getByType(FlatList);
  for (const y of [200, 300, 600, 800]) fireEvent.scroll(list, offset(y));
  // One correction measurement, not another measurement for each offset frame.
  expect(mockMeasureViewport).toHaveBeenCalledTimes(2);
  mockMeasureTail.mockImplementation(callback => callback(0, 500, 390, 100));
  fireEvent.scroll(list, offset(1000));
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
  for (let frame = 0; frame < 5; frame += 1) fireEvent.scroll(list, offset(1000));
  expect(mockMeasureViewport).toHaveBeenCalledTimes(3);
});

test('an inverted transcript confirms a new visible tail when its native offset stays at zero', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  runtime.open.mockResolvedValue(50);
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'contentSizeChange', 390, 2500);
  visibleLatest(view, 'latest-2');
  // scrollToOffset(0) cannot emit a changed offset when native is already at zero.
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
});

test.each(['navigation', 'foreground'])('returning from %s preserves the user history anchor through new content and late offsets', async transition => {
  seed(conversationTarget, [message('old', 0), message('latest-1', 1)]);
  const listen = jest.spyOn(AppState, 'addEventListener');
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, offset(300));
  fireEvent(list, 'scrollEndDrag', offset(300));
  fireEvent(list, 'momentumScrollEnd', offset(300));
  const onAppState = listen.mock.calls.find(([event]) => event === 'change')?.[1];
  if (transition === 'navigation') { mockFocused = false; view.rerender(screen(runtime)); }
  else act(() => { AppState.currentState = 'background'; onAppState?.('background'); });
  mockNativeScrollToEnd.mockClear();
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  fireEvent(list, 'contentSizeChange', 390, 4500);
  if (transition === 'navigation') { mockFocused = true; view.rerender(screen(runtime)); }
  else act(() => { AppState.currentState = 'active'; onAppState?.('active'); });
  fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: 300 }, contentSize: { height: 4500 }, layoutMeasurement: { height: 500 } } });
  await act(async () => undefined);
  expect(mockNativeScrollToEnd).not.toHaveBeenCalled();
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
});

test('the final older page retains the mounted history direction and native stable-row anchor', async () => {
  seed(conversationTarget, Array.from({ length: 50 }, (_, index) => message(`message-${index}`, index)));
  const runtime = createRuntime();
  runtime.open.mockResolvedValue(50);
  let finishPage!: (count: number) => void;
  runtime.messages.mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
  const view = render(screen(runtime));
  await observeLatest(view, 'message-49');
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, offset(300));
  fireEvent(list, 'scrollEndDrag', offset(300));
  fireEvent(list, 'endReached');
  expect(runtime.messages).toHaveBeenCalledWith('g1', 'message-0');
  mockFocused = false;
  view.rerender(screen(runtime));
  mockNativeScrollToEnd.mockClear();
  jest.mocked(FlatList.prototype.scrollToOffset).mockClear();
  act(() => useWorkspace.getState().upsertMessage(message('new-status', 51)));
  await act(async () => { finishPage(3); });
  expect(view.UNSAFE_getByType(FlatList)).toBe(list);
  expect(list.props.inverted).toBe(true);
  expect(list.props.maintainVisibleContentPosition).toEqual({ minIndexForVisible: 0 });
  expect(view.queryByRole('button', { name: '加载更早消息' })).toBeNull();
  mockFocused = true;
  view.rerender(screen(runtime));
  fireEvent(list, 'contentSizeChange', 390, 4500);
  await act(async () => undefined);
  expect(mockNativeScrollToEnd).not.toHaveBeenCalled();
  expect(FlatList.prototype.scrollToOffset).not.toHaveBeenCalled();
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
});

test.each(['target', 'account'])('a late older page from another %s cannot change the current window direction or paging', async change => {
  const rows = Array.from({ length: 50 }, (_, index) => message(`message-${index}`, index));
  seed(conversationTarget, rows);
  const runtime = createRuntime();
  runtime.open.mockResolvedValue(50);
  let finishPage!: (count: number) => void;
  runtime.messages.mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
  const view = render(screen(runtime));
  await act(async () => undefined);
  fireEvent.press(view.getByRole('button', { name: '加载更早消息' }));
  if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'test:another' }));
  else {
    const nextTarget: ChatTarget = { kind: 'conversation', id: 'g2' };
    act(() => {
      useWorkspace.setState(s => ({ conversations: { ...s.conversations, g2: conversationSchema.parse({ id: 'g2', type: 'group', displayTitle: 'g2', lastActivityAt: '2026-10-05T00:00:00Z' }) } }));
      useWorkspace.getState().setMessages('g2', rows.map(row => ({ ...row, conversationId: 'g2' })));
    });
    view.rerender(screen(runtime, nextTarget));
  }
  await act(async () => undefined);
  const currentList = view.UNSAFE_getByType(FlatList);
  await act(async () => { finishPage(0); });
  expect(view.UNSAFE_getByType(FlatList)).toBe(currentList);
  expect(currentList.props.inverted).toBe(true);
  expect(view.getByRole('button', { name: '加载更早消息' })).toBeTruthy();
});

test('a late initial count cannot flip a cached transcript after the user starts reading history', async () => {
  seed(conversationTarget, Array.from({ length: 50 }, (_, index) => message(`message-${index}`, index)));
  const runtime = createRuntime();
  let finishOpen!: (count: number) => void;
  runtime.open.mockImplementationOnce(() => new Promise(resolve => { finishOpen = resolve; }));
  const view = render(screen(runtime));
  await act(async () => undefined);
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, offset(300));
  fireEvent(list, 'scrollEndDrag', offset(300));
  await act(async () => { finishOpen(3); });
  expect(view.UNSAFE_getByType(FlatList)).toBe(list);
  expect(list.props.inverted).toBe(true);
  expect(view.queryByRole('button', { name: '加载更早消息' })).toBeNull();
  expect(runtime.markRead).not.toHaveBeenCalled();
});

test('an initial page from a previous account cannot change the current window', async () => {
  seed(conversationTarget, Array.from({ length: 50 }, (_, index) => message(`message-${index}`, index)));
  const runtime = createRuntime();
  let finishOpen!: (count: number) => void;
  runtime.open.mockImplementationOnce(() => new Promise(resolve => { finishOpen = resolve; }));
  runtime.open.mockResolvedValue(50);
  const view = render(screen(runtime));
  await act(async () => undefined);
  act(() => useWorkspace.setState({ accountKey: 'test:another' }));
  await waitFor(() => expect(runtime.open).toHaveBeenCalledTimes(2));
  const currentList = view.UNSAFE_getByType(FlatList);
  await act(async () => { finishOpen(0); });
  expect(view.UNSAFE_getByType(FlatList)).toBe(currentList);
  expect(currentList.props.inverted).toBe(true);
  expect(view.getByRole('button', { name: '加载更早消息' })).toBeTruthy();
  expect(runtime.markRead).not.toHaveBeenCalled();
});

test('a short mounted list retains observed visibility across focus changes without another native callback', async () => {
  seed(conversationTarget, [message('original', 0), message('latest-1', 1)]);
  useWorkspace.setState({ connection: '离线缓存，恢复连接后同步' });
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await act(async () => undefined);
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'layout', { nativeEvent: { layout: { height: 500, width: 390, x: 0, y: 0 } } });
  fireEvent(list, 'contentSizeChange', 390, 200);
  visibleLatest(view, 'latest-1');
  expect(runtime.markRead).not.toHaveBeenCalled();

  view.rerender(screen(runtime, conversationTarget, 'original'));
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalled());
  expect(view.UNSAFE_getByType(FlatList)).toBe(list);
  act(() => useWorkspace.setState({ connection: '已连接' }));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  // Content already fits; native offsets and visible indices remain unchanged.
  // No synthetic scroll, layout, content-size or viewability callback follows the command.
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-1', false));
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
});

test.each(['target', 'account', 'mode'])('late list observations from a previous %s cannot confirm or scroll the new transcript', async change => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  let finishOpen!: (count: number) => void;
  if (change === 'mode') runtime.open.mockImplementationOnce(() => new Promise(resolve => { finishOpen = resolve; }));
  const view = render(screen(runtime));
  await act(async () => undefined);
  const old = view.UNSAFE_getByType(FlatList).props;
  const oldTail = { viewableItems: [{ item: old.data[0], index: 0, key: 'latest-1', isViewable: true }], changed: [] };
  let activeTarget = conversationTarget;
  if (change === 'target') {
    activeTarget = { kind: 'conversation', id: 'g2' };
    act(() => {
      useWorkspace.setState(s => ({ conversations: { ...s.conversations, g2: conversationSchema.parse({ id: 'g2', type: 'group', displayTitle: 'g2', lastActivityAt: '2026-10-05T00:00:00Z' }) } }));
      useWorkspace.getState().setMessages('g2', [message('latest-1', 1, activeTarget)]);
    });
    view.rerender(screen(runtime, activeTarget));
  } else if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'test:another' }));
  else await act(async () => { finishOpen(50); });
  await act(async () => undefined);
  mockNativeScrollToEnd.mockClear();
  jest.mocked(FlatList.prototype.scrollToOffset).mockClear();
  act(() => {
    old.onScrollBeginDrag();
    old.onLayout({ nativeEvent: { layout: { height: 500, width: 390, x: 0, y: 0 } } });
    old.onContentSizeChange(390, 1500);
    old.onScroll(offset(1000));
    old.onViewableItemsChanged(oldTail);
    old.onMomentumScrollEnd(offset(1000));
  });
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  expect(mockNativeScrollToEnd).not.toHaveBeenCalled();
  expect(FlatList.prototype.scrollToOffset).not.toHaveBeenCalled();
  await observeLatest(view, 'latest-1');
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith(activeTarget.id, 'latest-1', false));
});

test.each(['content', 'viewport'])('a %s size change revokes a queued read until real geometry reaches the latest again', async changed => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  let finishRead!: () => void;
  runtime.markRead.mockImplementationOnce(() => new Promise<void>(resolve => { finishRead = resolve; }));
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await observeLatest(view, 'latest-2');
  const list = view.UNSAFE_getByType(FlatList);
  if (changed === 'content') fireEvent(list, 'contentSizeChange', 390, 2500);
  else fireEvent(list, 'layout', { nativeEvent: { layout: { height: 200, width: 390, x: 0, y: 0 } } });
  await act(async () => { finishRead(); });
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
  // The visible item set did not change, so no second viewability callback is required.
  fireEvent.scroll(list, { nativeEvent: {
    contentOffset: { y: changed === 'content' ? 2000 : 1300 },
    contentSize: { height: changed === 'content' ? 2500 : 1500 },
    layoutMeasurement: { height: changed === 'content' ? 500 : 200 },
  } });
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith('g1', 'latest-2', false));
});

test('browsing away stops automatic pinning while later programmatic observations cannot change that intent', async () => {
  seed(conversationTarget, [message('old', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, offset(300));
  fireEvent(list, 'scrollEndDrag', offset(300));
  fireEvent(list, 'momentumScrollEnd', offset(300));
  mockNativeScrollToEnd.mockClear();
  fireEvent.scroll(list, offset(1000));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  fireEvent(list, 'contentSizeChange', 390, 2500);
  expect(mockNativeScrollToEnd).not.toHaveBeenCalled();
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  expect(mockNativeScrollToEnd).toHaveBeenCalledWith({ animated: true });
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
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
  await observeLatest(view, 'latest-3');
  expect(runtime.markRead).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  expect(runtime.markRead).not.toHaveBeenCalled();
  await observeLatest(view, 'latest-3');
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith(target.id, 'latest-3', target.kind === 'topic'));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
});

test('returning to the bottom by scrolling reads a message received while browsing history once', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  const runtime = createRuntime();
  runtime.open.mockResolvedValue(50);
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.inverted).toBe(true));
  const list = view.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.scroll(list, offset(300));
  fireEvent(list, 'scrollEndDrag', offset(300));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);

  fireEvent(list, 'momentumScrollEnd', offset(0));
  visibleLatest(view, 'latest-2');
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
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await observeLatest(view, 'latest-2');
  await act(async () => undefined);
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  act(() => useWorkspace.getState().upsertMessage({ ...message('latest-3', 3), status: 'sending' }));
  await observeLatest(view, 'latest-3');
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
  await observeLatest(view);
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
  const view = render(screen(runtime, topicTarget));
  if (state !== 'unjoined') await observeLatest(view);
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
});

test('resuming a dirty transcript can confirm native tail rectangles without another scroll or viewability callback', async () => {
  seed(conversationTarget, [message('latest-1', 1)]);
  AppState.currentState = 'background';
  const listen = jest.spyOn(AppState, 'addEventListener');
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await act(async () => undefined);
  act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  await observeLatest(view, 'latest-2');
  expect(runtime.markRead).not.toHaveBeenCalled();
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  mockMeasureTail.mockImplementation(callback => callback(0, 500, 390, 100));
  const onChange = listen.mock.calls.find(([event]) => event === 'change')?.[1];
  act(() => {
    AppState.currentState = 'active';
    onChange?.('active');
  });
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-2', false));
  expect(mockMeasureViewport).toHaveBeenCalledTimes(1);
  expect(mockMeasureTail).toHaveBeenCalledTimes(1);
});

test.each([false, true])('explicit latest measures the actual tail, including a hidden tail (%s), without native scroll callbacks', async hidden => {
  seed(conversationTarget, [message('original', 0), message('latest-1', 1, conversationTarget, { hiddenByCurrentUser: hidden })]);
  const runtime = createRuntime();
  const view = render(screen(runtime, conversationTarget, 'original'));
  await act(async () => undefined);
  fireEvent.scroll(view.UNSAFE_getByType(FlatList), offset(200));
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  mockMeasureTail.mockImplementation(callback => callback(0, 500, 390, 100));
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledWith('g1', 'latest-1', false));
  expect(view.queryByRole('button', { name: '回到最新' })).toBeNull();
  expect(mockMeasureTail).toHaveBeenCalledTimes(1);
});

test.each(['clipped', 'empty', 'throws', 'missing'])('an unavailable or invalid native tail measurement (%s) never confirms a read', async failure => {
  seed(conversationTarget, [message('original', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime, conversationTarget, 'original'));
  await act(async () => undefined);
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  if (failure === 'clipped') mockMeasureTail.mockImplementation(callback => callback(0, 550, 390, 100));
  if (failure === 'empty') mockMeasureTail.mockImplementation(callback => callback(0, 0, 0, 0));
  if (failure === 'throws') mockMeasureTail.mockImplementation(() => { throw new Error('unmounted native fixture'); });
  if (failure === 'missing') jest.mocked(FlatList.prototype.getNativeScrollRef).mockReturnValue(null);
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  await act(async () => undefined);
  expect(runtime.markRead).not.toHaveBeenCalled();
  expect(view.getByRole('button', { name: '回到最新' })).toBeTruthy();
});

test.each(['activity', 'account', 'tail', 'layout', 'offset', 'drag'])('late native measurement is discarded after %s changes', async change => {
  seed(conversationTarget, [message('original', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime, conversationTarget, 'original'));
  await act(async () => undefined);
  let finishTail: MeasureInWindowOnSuccessCallback | undefined;
  mockMeasureViewport.mockImplementation(callback => callback(0, 100, 390, 500));
  mockMeasureTail.mockImplementation(callback => { finishTail = callback; });
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  expect(finishTail).toBeDefined();
  const finishStaleTail = finishTail;
  if (change === 'activity') { mockFocused = false; view.rerender(screen(runtime, conversationTarget, 'original')); }
  if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'other:account' }));
  if (change === 'tail') act(() => useWorkspace.getState().upsertMessage(message('latest-2', 2)));
  if (change === 'layout') fireEvent(view.UNSAFE_getByType(FlatList), 'contentSizeChange', 390, 2500);
  if (change === 'offset') fireEvent.scroll(view.UNSAFE_getByType(FlatList), offset(200));
  if (change === 'drag') fireEvent(view.UNSAFE_getByType(FlatList), 'scrollBeginDrag');
  await act(async () => { finishStaleTail?.(0, 500, 390, 100); });
  expect(runtime.markRead).not.toHaveBeenCalled();
});

test('changing the historical anchor on the same route suppresses read before locating it', async () => {
  seed(conversationTarget, [message('original', 0), message('latest-1', 1)]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
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
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalledWith({ index: 0, animated: false, viewPosition: 0.5 }));
  expect(runtime.api.json).toHaveBeenCalledWith(`/api/workspace/${target.kind === 'topic' ? 'topics' : 'conversations'}/${target.id}/messages?around=original&limit=50`, expect.anything());
  expect(useWorkspace.getState().messages[targetKey(target)]?.map(item => item.id)).toEqual(['original', 'reply']);
  expect(useWorkspace.getState().drafts[targetKey(target)]).toEqual({ text: 'draft stays', mentionIds: ['other'], replyToMessageId: 'reply' });
  act(() => useWorkspace.getState().upsertMessage(message('latest-3', 3, target)));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '回到最新' }));
  expect(runtime.markRead).toHaveBeenCalledTimes(1);
  await observeLatest(view, 'latest-3');
  await waitFor(() => expect(runtime.markRead).toHaveBeenLastCalledWith(target.id, 'latest-3', target.kind === 'topic'));
});

test('a cached original is located without loading or snapping back to the latest message', async () => {
  seed(conversationTarget, [message('original', 0), message('reply', 2, conversationTarget, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  const view = render(screen(runtime));
  await observeLatest(view);
  await waitFor(() => expect(runtime.markRead).toHaveBeenCalledTimes(1));
  mockNativeScrollToEnd.mockClear();
  fireEvent.press(view.getByRole('button', { name: '定位原消息' }));
  await waitFor(() => expect(FlatList.prototype.scrollToIndex).toHaveBeenCalled());
  fireEvent(view.UNSAFE_getByType(FlatList), 'contentSizeChange', 390, 1500);
  expect(mockNativeScrollToEnd).not.toHaveBeenCalled();
  expect(runtime.api.json).not.toHaveBeenCalled();
});

test.each([conversationTarget, topicTarget])('a late $kind around page cannot restore a neighbor recalled during the request', async target => {
  seed(target, [message('neighbor', 1, target), message('reply', 2, target, { replyToMessageId: 'original' })]);
  const runtime = createRuntime();
  let finishAround!: (response: { messages: ReturnType<typeof dto>[] }) => void;
  runtime.api.json.mockImplementationOnce(() => new Promise(resolve => { finishAround = resolve; }));
  runtime.api.json.mockResolvedValue({ messages: [dto('original', 0, target), dto('neighbor', 1, target, { recalledAt: '2026-10-06T01:00:00Z', plainText: 'Recalled', content: null })] });
  const view = render(screen(runtime, target));
  await observeLatest(view);
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
  await observeLatest(view);
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
  await observeLatest(view);
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
  await observeLatest(view);
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
