import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatScreen } from '../src/features/chat/screens';
import type { Runtime } from '../src/data/runtime';
import type { Transfers } from '../src/data/transfers';
import { bootstrapSchema, parseMessage } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';

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
  useWorkspace.setState({ bootstrap: bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Self' } },
    space: { id: 'space-1', name: 'Test' },
    eventCursor: 0,
    policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 },
    members: [], conversations: [], files: [],
  }) });
});
afterEach(() => useWorkspace.getState().reset());

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
