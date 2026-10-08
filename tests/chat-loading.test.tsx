import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatScreen } from '../src/features/chat/screens';
import type { Runtime } from '../src/data/runtime';
import type { Transfers } from '../src/data/transfers';
import { bootstrapSchema, parseMessage } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { ApiError, errorText } from '../src/data/client';
import { MessageRow } from '../src/ui/message';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
  useNavigation: () => ({ goBack: jest.fn() }),
}));
jest.mock('../src/ui/useChatIme', () => ({
  useChatIme: () => ({ panel: 'none', dock: { dockBottom: 0, panelHeight: 0 }, openPanel: jest.fn(), closePanel: jest.fn(), setPanel: jest.fn() }),
}));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.1', nativeBuildVersion: '3' } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };

beforeEach(() => {
  jest.useFakeTimers();
  useWorkspace.setState({ bootstrap: bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Self' } },
    space: { id: 'space-1', name: 'Test' },
    eventCursor: 0,
    policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 },
    members: [], conversations: [], files: [],
  }) });
});
afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  useWorkspace.getState().reset();
});

test('a new route object for the same conversation does not reload history or restore the spinner', async () => {
  const runtime = {
    open: jest.fn().mockResolvedValue(0),
    openTopic: jest.fn().mockResolvedValue(0),
    emotes: jest.fn().mockResolvedValue({ items: [] }),
    emoteLibrary: jest.fn().mockResolvedValue({ emotes: [], collections: [] }),
  } as unknown as Runtime;
  const screen = (id: string) => (
    <SafeAreaProvider initialMetrics={metrics}>
      <ChatScreen target={{ kind: 'conversation', id }} runtime={runtime} transfers={{} as Transfers} details={jest.fn()} />
    </SafeAreaProvider>
  );
  const view = render(screen('conversation-1'));
  await waitFor(() => expect(view.getByText('还没有消息')).toBeTruthy());
  expect(runtime.open).toHaveBeenCalledTimes(1);

  view.rerender(screen('conversation-1'));
  expect(runtime.open).toHaveBeenCalledTimes(1);
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();

  view.rerender(screen('conversation-2'));
  await waitFor(() => expect(runtime.open).toHaveBeenCalledTimes(2));
});

test('cached conversation content remains visible during a background refresh', () => {
  const cached = parseMessage({
    id: 'message-1', conversationId: 'conversation-1', authorId: 'other', authorName: 'Peer',
    kind: 'user', createdAt: '2026-09-26T00:00:00Z', plainText: 'cached message',
    content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'cached message' }] },
    attachments: [],
  })!;
  useWorkspace.getState().setMessages('conversation-1', [cached], false);
  const runtime = {
    open: jest.fn(() => new Promise<number>(() => undefined)),
    emotes: jest.fn(() => new Promise(() => undefined)),
    emoteLibrary: jest.fn(() => new Promise(() => undefined)),
  } as unknown as Runtime;
  const view = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ChatScreen target={{ kind: 'conversation', id: 'conversation-1' }} runtime={runtime} transfers={{} as Transfers} details={jest.fn()} />
    </SafeAreaProvider>,
  );
  expect(view.getByText('cached message')).toBeTruthy();
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  expect(runtime.open).toHaveBeenCalledTimes(1);
});

function seedReadFeedback(count = 1) {
  const b = useWorkspace.getState().bootstrap!;
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({ ...b, permissions: { canReadConversations: true },
    conversations: [{ id: 'c1', type: 'group', displayTitle: 'Test', lastActivityAt: '2026-01-01T00:00:00Z', capabilities: { canSendMessage: true } }],
  }), 'test:self');
  useWorkspace.getState().setMessages('c1', Array.from({ length: count }, (_, index) => parseMessage({
    id: `m${index}`, conversationId: 'c1', authorId: 'other', kind: 'user', createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), plainText: `synthetic ${index}`,
    content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: `synthetic ${index}` }] },
  })!));
  return {
    api: { json: jest.fn().mockResolvedValue({ messages: [] }) },
    open: jest.fn().mockResolvedValue(count), messages: jest.fn().mockResolvedValue(0),
    emotes: jest.fn().mockResolvedValue({ items: [] }), emoteLibrary: jest.fn().mockResolvedValue({ emotes: [], collections: [] }),
    markRead: jest.fn().mockResolvedValue(undefined), send: jest.fn().mockResolvedValue(undefined),
  };
}

function readScreen(runtime: ReturnType<typeof seedReadFeedback>) {
  return <SafeAreaProvider initialMetrics={metrics}><ChatScreen target={{ kind: 'conversation', id: 'c1' }} runtime={runtime as unknown as Runtime} transfers={{} as Transfers} details={jest.fn()} /></SafeAreaProvider>;
}

test('only a later accepted HTTP window clears an open error, without another open or losing draft', async () => {
  const runtime = seedReadFeedback();
  runtime.open.mockRejectedValue(new ApiError('request.network', 0, 'net.http2'));
  useWorkspace.getState().setDraft('c1', 'synthetic unsent');
  const view = render(readScreen(runtime));
  await waitFor(() => expect(view.getByText(/net.http2/)).toBeTruthy());
  act(() => {
    useWorkspace.setState({ connection: '已连接' });
    useWorkspace.getState().refreshCards();
    useWorkspace.getState().setMessages('c1', useWorkspace.getState().messages.c1!);
    useWorkspace.getState().upsertMessage({ ...useWorkspace.getState().messages.c1![0]!, id: 'ws' });
  });
  expect(view.getByText(/net.http2/)).toBeTruthy();
  act(() => useWorkspace.getState().acceptMessageRead('unrelated', [], runtime.api));
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], runtime.api, 'm0'));
  expect(view.getByText(/net.http2/)).toBeTruthy();
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], runtime.api));
  expect(view.queryByText(/net.http2/)).toBeNull();
  expect(view.getByDisplayValue('synthetic unsent')).toBeTruthy();
  expect(runtime.open).toHaveBeenCalledTimes(1);
});

test('an older-page error requires the same cursor, including a successful empty terminal page', async () => {
  const runtime = seedReadFeedback(50);
  runtime.messages.mockRejectedValue(new ApiError('request.network', 0, 'net.http2'));
  const view = render(readScreen(runtime));
  await waitFor(() => expect(view.getByText('加载更早消息')).toBeTruthy());
  fireEvent.press(view.getByText('加载更早消息'));
  await waitFor(() => expect(view.getByText(/net.http2/)).toBeTruthy());
  expect(runtime.messages).toHaveBeenCalledWith('c1', 'm0');
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], runtime.api, 'another-cursor'));
  act(() => useWorkspace.getState().acceptMessageRead('c1', useWorkspace.getState().messages.c1!, runtime.api));
  expect(view.getByText(/net.http2/)).toBeTruthy();
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], runtime.api, 'm0'));
  expect(view.queryByText(/net.http2/)).toBeNull();
});

test.each(['request.network', 'quota.insufficient'])('successful reads preserve a %s send error', async code => {
  const runtime = seedReadFeedback();
  runtime.send.mockRejectedValue(new ApiError(code, 0));
  useWorkspace.getState().setDraft('c1', 'synthetic send');
  const view = render(readScreen(runtime));
  await act(async () => undefined);
  fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(runtime.send).toHaveBeenCalledTimes(1));
  const label = errorText(new ApiError(code, 0));
  await waitFor(() => expect(view.getByText(label)).toBeTruthy());
  act(() => useWorkspace.getState().acceptMessageRead('c1', useWorkspace.getState().messages.c1!, runtime.api));
  expect(view.getByText(label)).toBeTruthy();
});

test('a read receipt does not clear a locate failure', async () => {
  const runtime = seedReadFeedback();
  const view = render(readScreen(runtime));
  await act(async () => undefined);
  act(() => view.UNSAFE_getByType(MessageRow).props.locate('missing'));
  await waitFor(() => expect(view.getByText('原消息不可用')).toBeTruthy());
  act(() => useWorkspace.getState().acceptMessageRead('c1', useWorkspace.getState().messages.c1!, runtime.api));
  expect(view.getByText('原消息不可用')).toBeTruthy();
});

function pendingRead() {
  let resolve!: (count: number) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<number>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

test.each(['account', 'api', 'permission', 'revoke-restore'] as const)('late open failure is isolated after %s changes', async change => {
  const runtime = seedReadFeedback();
  const pending = pendingRead();
  runtime.open.mockReturnValueOnce(pending.promise);
  const view = render(readScreen(runtime));
  act(() => {
    if (change === 'api') runtime.api = { json: jest.fn().mockResolvedValue({ messages: [] }) };
    else if (change === 'account') useWorkspace.getState().applyBootstrap(useWorkspace.getState().bootstrap!, 'next-account');
    else {
      const bootstrap = useWorkspace.getState().bootstrap!;
      useWorkspace.getState().applyBootstrap({ ...bootstrap, permissions: { ...bootstrap.permissions, canReadConversations: false } }, 'test:self');
      if (change === 'revoke-restore') useWorkspace.getState().applyBootstrap(bootstrap, 'test:self');
    }
  });
  await act(async () => pending.reject(new ApiError('request.network', 0, 'net.http2')));
  expect(view.queryByText(/net.http2/)).toBeNull();
});

test('a late old-API receipt cannot clear the current API read error', async () => {
  const runtime = seedReadFeedback();
  const oldApi = runtime.api;
  runtime.open.mockRejectedValue(new ApiError('request.network', 0, 'net.http2'));
  const view = render(readScreen(runtime));
  await waitFor(() => expect(view.getByText(/net.http2/)).toBeTruthy());
  const nextRuntime = { ...runtime, api: { json: jest.fn().mockResolvedValue({ messages: [] }) } };
  view.rerender(readScreen(nextRuntime));
  await waitFor(() => expect(runtime.open).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(view.getByText(/net.http2/)).toBeTruthy());
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], oldApi));
  expect(view.getByText(/net.http2/)).toBeTruthy();
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], nextRuntime.api));
  expect(view.queryByText(/net.http2/)).toBeNull();
});

test('matching receipts are consumed even when another cursor succeeds in the same render batch', async () => {
  const runtime = seedReadFeedback(50);
  runtime.messages.mockRejectedValue(new ApiError('request.network', 0, 'net.http2'));
  const view = render(readScreen(runtime));
  await act(async () => undefined);
  fireEvent.press(view.getByText('加载更早消息'));
  await waitFor(() => expect(view.getByText(/net.http2/)).toBeTruthy());
  act(() => {
    useWorkspace.getState().acceptMessageRead('c1', [], runtime.api, 'm0');
    useWorkspace.getState().acceptMessageRead('c1', [], runtime.api, 'other-cursor');
  });
  expect(view.queryByText(/net.http2/)).toBeNull();
});

test('a superseded older request cannot restore its error after a newer same-cursor success', async () => {
  const runtime = seedReadFeedback(50);
  const pending = pendingRead();
  runtime.messages.mockReturnValueOnce(pending.promise).mockImplementationOnce(async () => {
    useWorkspace.getState().acceptMessageRead('c1', [], runtime.api, 'm0');
    return 0;
  });
  const view = render(readScreen(runtime));
  await act(async () => undefined);
  fireEvent.press(view.getByText('加载更早消息'));
  fireEvent.press(view.getByText('加载更早消息'));
  await act(async () => undefined);
  await act(async () => pending.reject(new ApiError('request.network', 0, 'net.http2')));
  expect(view.queryByText(/net.http2/)).toBeNull();
  expect(runtime.messages).toHaveBeenCalledTimes(2);
});

test('read recovery cannot hide an action error while both errors exist', async () => {
  const runtime = seedReadFeedback();
  runtime.open.mockRejectedValue(new ApiError('request.network', 0, 'net.http2'));
  runtime.send.mockRejectedValue(new ApiError('quota.insufficient', 429));
  useWorkspace.getState().setDraft('c1', 'synthetic send');
  const view = render(readScreen(runtime));
  await waitFor(() => expect(view.getByText(/net.http2/)).toBeTruthy());
  fireEvent.press(view.getByLabelText('发送'));
  await waitFor(() => expect(view.getByText('今日传输额度不足')).toBeTruthy());
  act(() => useWorkspace.getState().acceptMessageRead('c1', [], runtime.api));
  expect(view.getByText('今日传输额度不足')).toBeTruthy();
});

test('a read failure followed by success before React renders uses the failure-time revision', async () => {
  const runtime = seedReadFeedback();
  const pending = pendingRead();
  runtime.open.mockReturnValueOnce(pending.promise);
  const view = render(readScreen(runtime));
  await act(async () => {
    pending.reject(new ApiError('request.network', 0, 'net.http2'));
    await Promise.resolve();
    useWorkspace.getState().acceptMessageRead('c1', [], runtime.api);
  });
  expect(view.queryByText(/net.http2/)).toBeNull();
});

test('an API identity change alone never adds a recovery HTTP request', async () => {
  const runtime = seedReadFeedback();
  const view = render(readScreen(runtime));
  await act(async () => undefined);
  runtime.api = { json: jest.fn().mockResolvedValue({ messages: [] }) };
  view.rerender(readScreen(runtime));
  await act(async () => undefined);
  expect(runtime.open).toHaveBeenCalledTimes(1);
  expect(runtime.messages).not.toHaveBeenCalled();
});
