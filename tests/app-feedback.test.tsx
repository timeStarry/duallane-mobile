import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button as NativeButton, Text, TextInput, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { NavigationContainer, useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import App from '../App';
import { AppHeader } from '../src/ui/chrome';
import { useWorkspace } from '../src/domain/store';
import { bootstrapSchema, topicSchema } from '../src/domain/contracts';
import { Runtime } from '../src/data/runtime';
import { ApiError } from '../src/data/client';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockDispose = jest.fn();
const mockSend = jest.fn();
const mockChatMount = jest.fn();
const mockChatUnmount = jest.fn();
const mockApi = { origin: 'https://workspace.example' };
const mockOpen = jest.fn().mockResolvedValue(50);
const mockOpenTopic = jest.fn().mockResolvedValue(50);
let mockNotificationListener: ((response: Notifications.NotificationResponse) => void) | undefined;

jest.mock('../src/data/runtime', () => ({
  Runtime: jest.fn().mockImplementation(() => ({ start: mockStart, dispose: mockDispose, isForced: () => false, send: mockSend, api: mockApi, open: mockOpen, openTopic: mockOpenTopic })),
}));
jest.mock('../src/data/transfers', () => ({ Transfers: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.2', nativeBuildVersion: '18' },
}));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn() } }));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: (listener: typeof mockNotificationListener) => { mockNotificationListener = listener; return { remove: jest.fn() }; },
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn(),
}));
jest.mock('../src/features/account/screens', () => ({ AccountNavigator: () => null }));
jest.mock('../src/ui/MediaViewer', () => ({ MediaViewer: () => null }));
jest.mock('../src/data/media', () => ({ canPreviewAttachment: () => false }));
function MockConversationsScreen({ open, openTopic, openSearch }: { open: (id: string) => void; openTopic: (topic: { id: string; conversationId: string }) => void; openSearch: () => void }) {
  return <View>
    <NativeButton title="Open synthetic search" onPress={openSearch} />
    <NativeButton title="Open synthetic chat" onPress={() => open('synthetic-chat')} />
    <NativeButton title="Open synthetic topic" onPress={() => openTopic({ id: 'synthetic-topic', conversationId: 'synthetic-chat' })} />
  </View>;
}
function MockSearchScreen({ open, openTopic, onBack }: { open: (id: string) => void; openTopic: (topic: { id: string; conversationId: string }) => void; onBack: () => void }) {
  const [query, setQuery] = React.useState('');
  return <View>
    <TextInput accessibilityLabel="Synthetic search query" value={query} onChangeText={setQuery} />
    <NativeButton title="Synthetic search chat result" onPress={() => open('synthetic-chat')} />
    <NativeButton title="Synthetic search topic result" onPress={() => openTopic({ id: 'synthetic-topic', conversationId: 'synthetic-chat' })} />
    <NativeButton title="Back from synthetic search" onPress={onBack} />
  </View>;
}
jest.mock('../src/features/chat/SearchScreen', () => ({ SearchScreen: MockSearchScreen }));
function MockChatScreen({ target, focusMessageId, details }: { target: { id: string; conversationId?: string }; focusMessageId?: string; details: () => void }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NavigationProp<{ Chat: { id: string; focusMessageId?: string }; Topic: { id: string; conversationId: string } }>>();
  const route = useRoute();
  const draft = useWorkspace(state => state.drafts['synthetic-chat']?.text ?? '');
  const [panelOpen, setPanelOpen] = React.useState(false);
  React.useEffect(() => { mockChatMount(); return () => { mockChatUnmount(); }; }, []);
  return <View>
    <AppHeader title="Synthetic chat" includeTopInset />
    <Text testID="synthetic-target">{target.id}</Text>
    <Text testID="synthetic-parent">{target.conversationId ?? ''}</Text>
    <Text testID="synthetic-route-key">{route.key}</Text>
    <Text testID="synthetic-focus">{focusMessageId ?? ''}</Text>
    <Text testID="chat-insets">{JSON.stringify(insets)}</Text>
    <TextInput accessibilityLabel="Synthetic draft" value={draft} onChangeText={text => useWorkspace.getState().setDraft('synthetic-chat', text)} />
    <NativeButton title="Open synthetic panel" onPress={() => setPanelOpen(true)} />
    <NativeButton title="Open synthetic details" onPress={details} />
    <NativeButton title="Back from synthetic chat" onPress={() => navigation.goBack()} />
    <NativeButton title="Replace synthetic chat target" onPress={() => navigation.navigate('Chat', { id: 'replacement-synthetic-chat' })} />
    <NativeButton title="Replace synthetic topic target" onPress={() => navigation.navigate('Topic', { id: 'replacement-synthetic-topic', conversationId: 'synthetic-chat' })} />
    <NativeButton title="Replace synthetic topic parent" onPress={() => navigation.navigate('Topic', { id: target.id, conversationId: 'replacement-synthetic-parent' })} />
    <NativeButton title="Locate another synthetic history" onPress={() => navigation.navigate('Chat', { id: target.id, focusMessageId: 'replacement-synthetic-history' })} />
    <Text>{panelOpen ? 'Synthetic panel open' : 'Synthetic panel closed'}</Text>
  </View>;
}
function MockLoginScreen() { return <Text>Synthetic login</Text>; }
function MockDetailsScreen({ onOpenPinnedMessage }: { onOpenPinnedMessage: (id: string) => void }) {
  return <NativeButton title="Open synthetic pinned message" onPress={() => onOpenPinnedMessage('synthetic-history')} />;
}
jest.mock('../src/features/screens', () => ({
  ConversationsScreen: MockConversationsScreen,
  ChatScreen: MockChatScreen,
  FilesScreen: () => null,
  MembersScreen: () => null,
  DetailsScreen: MockDetailsScreen,
  LoginScreen: MockLoginScreen,
  UpdatePrompt: () => null,
}));

const rootMetrics: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 32, left: 8, right: 8, bottom: 24 },
};
const shiftedMetrics: Metrics = {
  frame: { x: 0, y: 96, width: 390, height: 748 },
  insets: { top: 0, left: 8, right: 8, bottom: 24 },
};
const error = 'Synthetic global connection error';

function nativeInsets(view: ReturnType<typeof render>, provider: number, metrics: Metrics) {
  const native = view.UNSAFE_getAllByType(SafeAreaProvider)[provider]!
    .findAll((node: { props: { onInsetsChange?: unknown } }) => typeof node.props.onInsetsChange === 'function')[0]!;
  act(() => native.props.onInsetsChange({ nativeEvent: metrics }));
}

function start(ready: boolean, globalError = '') {
  useWorkspace.setState({ ready, error: globalError });
  const view = render(<App />);
  nativeInsets(view, 0, rootMetrics);
  return view;
}

function noticeOwner(view: ReturnType<typeof render>, text: string) {
  const notice = view.getByText(text);
  return view.UNSAFE_queryAllByType(SafeAreaView).find(area => area.findAll((node: unknown) => node === notice).length > 0);
}

beforeEach(() => { useWorkspace.getState().reset(); mockNotificationListener = undefined; mockOpen.mockResolvedValue(50); mockOpenTopic.mockResolvedValue(50); });
afterEach(() => { useWorkspace.getState().reset(); });

test('home search uses a separate stack route and returns from chat or topic to its retained query', async () => {
  const view = start(true);
  const state = () => view.UNSAFE_getByType(NavigationContainer).props.ref.current.getRootState();
  fireEvent.press(view.getByText('Open synthetic search'));
  await waitFor(() => expect(view.getByLabelText('Synthetic search query')).toBeTruthy());
  expect(state().routes.at(-1).name).toBe('Search');
  fireEvent.changeText(view.getByLabelText('Synthetic search query'), 'Synthetic query');
  for (const result of ['Synthetic search chat result', 'Synthetic search topic result']) {
    fireEvent.press(view.getByText(result));
    await waitFor(() => expect(view.getByText('Back from synthetic chat')).toBeTruthy());
    expect(['Chat', 'Topic']).toContain(state().routes.at(-1).name);
    fireEvent.press(view.getByText('Back from synthetic chat'));
    await waitFor(() => expect(view.getByLabelText('Synthetic search query').props.value).toBe('Synthetic query'));
    expect(state().routes.at(-1).name).toBe('Search');
  }
  fireEvent.press(view.getByText('Back from synthetic search'));
  await waitFor(() => expect(view.getByText('Open synthetic search')).toBeTruthy());
  expect(state().routes.at(-1).name).toBe('Workspace');
  expect(mockSend).not.toHaveBeenCalled();
});

test('authenticated global feedback has its own top and horizontal safe area', () => {
  const view = start(true, error);
  expect(noticeOwner(view, error)?.props.edges).toEqual(['top', 'left', 'right']);
  // These are JS contracts; the actual Android inset event and pixels require a package retest.
  expect(view.UNSAFE_getAllByType(SafeAreaProvider)).toHaveLength(2);
});

test('showing, updating and clearing a global error preserves the real navigation route, draft and local panel', async () => {
  const view = start(true);
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(() => expect(view.getByLabelText('Synthetic draft')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Synthetic draft'), 'synthetic unsent draft');
  fireEvent.press(view.getByText('Open synthetic panel'));
  const navigator = view.UNSAFE_getByType(NavigationContainer);
  const navigationArea = view.UNSAFE_getAllByType(SafeAreaProvider)[1];
  const input = view.getByLabelText('Synthetic draft');
  const mounts = mockChatMount.mock.calls.length;
  const unmounts = mockChatUnmount.mock.calls.length;
  for (const message of [error, 'Synthetic policy error', '']) {
    act(() => useWorkspace.setState({ error: message }));
    expect(view.UNSAFE_getByType(NavigationContainer)).toBe(navigator);
    expect(view.UNSAFE_getAllByType(SafeAreaProvider)[1]).toBe(navigationArea);
    expect(view.getByLabelText('Synthetic draft')).toBe(input);
    expect(view.getByLabelText('Synthetic draft').props.value).toBe('synthetic unsent draft');
    expect(view.getByText('Synthetic panel open')).toBeTruthy();
    expect(mockChatMount).toHaveBeenCalledTimes(mounts);
    expect(mockChatUnmount).toHaveBeenCalledTimes(unmounts);
    if (message) expect(noticeOwner(view, message)?.props.edges).toEqual(['top', 'left', 'right']);
  }
  expect(mockSend).not.toHaveBeenCalled();
  expect(mockStart).toHaveBeenCalledTimes(1);
});

test('the stable navigation provider accepts its actual frame insets without double top padding', async () => {
  const view = start(true);
  expect(view.UNSAFE_getAllByType(SafeAreaProvider)).toHaveLength(2);
  nativeInsets(view, 1, rootMetrics);
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(() => expect(view.getByTestId('chat-insets')).toBeTruthy());
  expect(JSON.parse(view.getByTestId('chat-insets').props.children)).toEqual(rootMetrics.insets);
  const headerTop = () => {
    const rows: { props: { style?: StyleProp<ViewStyle> } }[] = view.UNSAFE_getByType(AppHeader).findAllByType(View);
    return rows.map(row => StyleSheet.flatten(row.props.style)).find(style => style?.paddingTop !== undefined)?.paddingTop;
  };
  const headerSpacing = Number(headerTop()) - rootMetrics.insets.top;
  act(() => useWorkspace.setState({ error }));
  nativeInsets(view, 1, shiftedMetrics);
  expect(JSON.parse(view.getByTestId('chat-insets').props.children)).toEqual(shiftedMetrics.insets);
  expect(headerTop()).toBe(headerSpacing);
  const landscape: Metrics = {
    frame: { x: 0, y: 96, width: 844, height: 294 },
    insets: { top: 0, left: 32, right: 16, bottom: 24 },
  };
  nativeInsets(view, 1, landscape);
  expect(JSON.parse(view.getByTestId('chat-insets').props.children)).toEqual(landscape.insets);
  expect(headerTop()).toBe(headerSpacing);
  act(() => useWorkspace.setState({ error: '' }));
  nativeInsets(view, 1, rootMetrics);
  expect(headerTop()).toBe(rootMetrics.insets.top + headerSpacing);
  expect(view.UNSAFE_queryAllByType(SafeAreaView)).toHaveLength(0);
});

test('login keeps its existing single safe-area owner and shows global errors', () => {
  const view = start(false, error);
  expect(view.getByText('Synthetic login')).toBeTruthy();
  expect(noticeOwner(view, error)?.props.edges).toEqual(['top', 'left', 'right']);
  expect(view.UNSAFE_getAllByType(SafeAreaView)).toHaveLength(1);
  expect(view.UNSAFE_getAllByType(SafeAreaProvider)).toHaveLength(1);
});

function authorizeNotifications() {
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: { id: 'synthetic-self', displayName: 'Synthetic' } }, space: { id: 'synthetic-space', name: 'Synthetic' },
    eventCursor: 1, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 100 },
    permissions: { canReadConversations: true }, members: [], conversations: [{
      id: 'synthetic-chat', displayTitle: 'Synthetic', type: 'group', lastActivityAt: '2026-01-01T00:00:00Z', notificationLevel: 'all',
      capabilities: { canSendMessage: true, canUploadFile: true },
    }], files: [],
  }), 'synthetic-account');
  useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 'synthetic-topic', conversationId: 'synthetic-chat', title: 'Synthetic',
    status: 'open', joined: true, canJoin: false, allowSyncToGroup: true, participantCount: 1, unreadCount: 0, notificationLevel: 'all', revision: 1 }));
}

function notification(overrides: Partial<{ userId: string; origin: string; conversationId: string; messageId: string; topicId: string }> = {}): Notifications.NotificationResponse {
  return { actionIdentifier: 'synthetic-default-action', notification: { date: 1, request: { identifier: 'synthetic-notification', trigger: null, content: {
    title: 'DualLane', subtitle: null, body: '有新消息', categoryIdentifier: null, sound: 'default', data: {
    userId: 'synthetic-self', origin: mockApi.origin, conversationId: 'synthetic-chat', messageId: 'synthetic-next', ...overrides,
  } } } } };
}

test.each([false, true])('notification click on the displayed target requests a preserved authorized window without remounting it (topic=%s)', async topic => {
  authorizeNotifications();
  const view = start(true);
  fireEvent.press(view.getByText(topic ? 'Open synthetic topic' : 'Open synthetic chat'));
  await waitFor(() => expect(view.getByLabelText('Synthetic draft')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Synthetic draft'), 'synthetic unsent draft');
  fireEvent.press(view.getByText('Open synthetic panel'));
  const input = view.getByLabelText('Synthetic draft'), mounts = mockChatMount.mock.calls.length;
  await act(async () => mockNotificationListener?.(notification(topic ? { topicId: 'synthetic-topic' } : {})));
  expect(topic ? mockOpenTopic : mockOpen).toHaveBeenCalledWith(topic ? 'synthetic-topic' : 'synthetic-chat', { preserveLoadedWindow: true });
  expect(view.getByLabelText('Synthetic draft')).toBe(input);
  expect(input.props.value).toBe('synthetic unsent draft');
  expect(view.getByText('Synthetic panel open')).toBeTruthy();
  expect(mockChatMount).toHaveBeenCalledTimes(mounts);
  expect(mockSend).not.toHaveBeenCalled();
});

test.each([{}, { topicId: 'synthetic-topic' }])('a notification for a different active target uses the ordinary authorized open (%s)', async target => {
  authorizeNotifications();
  start(true);
  await act(async () => mockNotificationListener?.(notification(target)));
  expect('topicId' in target ? mockOpenTopic : mockOpen).toHaveBeenCalledWith('topicId' in target ? 'synthetic-topic' : 'synthetic-chat');
});

test.each([{ userId: 'other-self' }, { origin: 'https://other.example' }])('a notification with a different account or origin cannot open a target (%s)', async target => {
  authorizeNotifications();
  start(true);
  await act(async () => mockNotificationListener?.(notification(target)));
  expect(mockOpen).not.toHaveBeenCalled();
  expect(mockOpenTopic).not.toHaveBeenCalled();
});

test('a same-target notification does not reset an explicitly located history message', async () => {
  authorizeNotifications();
  const view = start(true);
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(() => expect(view.getByLabelText('Synthetic draft')).toBeTruthy());
  fireEvent.press(view.getByText('Open synthetic details'));
  await waitFor(() => expect(view.getByText('Open synthetic pinned message')).toBeTruthy());
  fireEvent.press(view.getByText('Open synthetic pinned message'));
  await waitFor(() => expect(view.getByTestId('synthetic-focus').props.children).toBe('synthetic-history'));
  const input = view.getByLabelText('Synthetic draft');
  await act(async () => mockNotificationListener?.(notification()));
  expect(view.getByTestId('synthetic-focus').props.children).toBe('synthetic-history');
  expect(view.getByLabelText('Synthetic draft')).toBe(input);
});

function pendingNotification() {
  let resolve!: (value: number) => void;
  const promise = new Promise<number>(done => { resolve = done; });
  return { promise, resolve };
}

test.each(['account', 'api', 'route'] as const)('a late notification open cannot navigate after its %s changes', async changed => {
  authorizeNotifications();
  const view = start(true), pending = pendingNotification();
  const instance: Runtime = jest.mocked(Runtime).mock.results.at(-1)!.value;
  mockOpen.mockReturnValueOnce(pending.promise);
  await act(async () => mockNotificationListener?.(notification({ conversationId: 'other-synthetic-chat' })));
  expect(mockOpen).toHaveBeenCalledWith('other-synthetic-chat');
  if (changed === 'account') act(() => useWorkspace.setState({ accountKey: 'other-synthetic-account' }));
  else if (changed === 'api') instance.api = null;
  else {
    fireEvent.press(view.getByText('Open synthetic chat'));
    await waitFor(() => expect(view.getByTestId('synthetic-target').props.children).toBe('synthetic-chat'));
  }
  await act(async () => pending.resolve(50));
  if (changed === 'route') expect(view.getByTestId('synthetic-target').props.children).toBe('synthetic-chat');
  else expect(view.queryByLabelText('Synthetic draft')).toBeNull();
});

test('a newer notification supersedes pending navigation without consuming a different route', async () => {
  authorizeNotifications();
  const view = start(true), first = pendingNotification(), second = pendingNotification();
  mockOpen.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await act(async () => mockNotificationListener?.(notification({ conversationId: 'older-synthetic-target' })));
  await act(async () => mockNotificationListener?.(notification({ conversationId: 'newer-synthetic-target' })));
  await act(async () => first.resolve(50));
  expect(view.queryByLabelText('Synthetic draft')).toBeNull();
  await act(async () => second.resolve(50));
  expect(view.getByTestId('synthetic-target').props.children).toBe('newer-synthetic-target');
});

test('same-target network refresh failure keeps the current reader route and unsent draft', async () => {
  authorizeNotifications();
  const view = start(true);
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(() => expect(view.getByLabelText('Synthetic draft')).toBeTruthy());
  fireEvent.changeText(view.getByLabelText('Synthetic draft'), 'synthetic unsent draft');
  const input = view.getByLabelText('Synthetic draft');
  mockOpen.mockRejectedValueOnce(new Error('synthetic offline'));
  await act(async () => mockNotificationListener?.(notification()));
  expect(useWorkspace.getState().error).not.toBe('');
  expect(view.getByLabelText('Synthetic draft')).toBe(input);
  expect(input.props.value).toBe('synthetic unsent draft');
});

test('same-target permission rejection leaves the cleared reader route', async () => {
  authorizeNotifications();
  const view = start(true);
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(() => expect(view.getByLabelText('Synthetic draft')).toBeTruthy());
  mockOpen.mockImplementationOnce(async () => {
    const state = useWorkspace.getState();
    state.applyBootstrap({ ...state.bootstrap!, conversations: [] }, state.accountKey);
    throw new ApiError('permission.denied', 403);
  });
  await act(async () => mockNotificationListener?.(notification()));
  expect(view.queryByLabelText('Synthetic draft')).toBeNull();
  expect(useWorkspace.getState().error).not.toBe('');
});

test.each([[false,403],[false,404],[true,403],[true,404]] as const)('a different rejected notification target exits to Workspace without mounting its reader (topic=%s,status=%s)', async (topic,status) => {
  authorizeNotifications();
  const view = start(true);
  fireEvent.press(view.getByText('Open synthetic chat'));
  await waitFor(() => expect(view.getByLabelText('Synthetic draft')).toBeTruthy());
  const mounts=mockChatMount.mock.calls.length;
  (topic?mockOpenTopic:mockOpen).mockRejectedValueOnce(new ApiError(status===403?'permission.denied':'resource.not_found',status));
  await act(async () => mockNotificationListener?.(notification(topic
    ? { topicId:'synthetic-topic' }
    : { conversationId:'different-denied-synthetic-chat' })));
  expect(topic?mockOpenTopic:mockOpen).toHaveBeenCalledWith(topic?'synthetic-topic':'different-denied-synthetic-chat');
  expect(view.queryByLabelText('Synthetic draft')).toBeNull();
  expect(view.getByText('Open synthetic chat')).toBeTruthy();
  expect(mockChatMount).toHaveBeenCalledTimes(mounts);
  expect(useWorkspace.getState().error).not.toBe('');
  expect(mockSend).not.toHaveBeenCalled();
});

test('authorized unjoined topic metadata still opens a different notification target', async () => {
  authorizeNotifications();
  const view = start(true);
  mockOpenTopic.mockImplementationOnce(async () => {
    const state = useWorkspace.getState();
    state.upsertTopic({ ...state.topics['synthetic-topic']!, joined: false, canJoin: true });
    return 0;
  });
  await act(async () => mockNotificationListener?.(notification({ topicId: 'synthetic-topic' })));
  expect(mockOpenTopic).toHaveBeenCalledWith('synthetic-topic');
  expect(view.getByTestId('synthetic-target').props.children).toBe('synthetic-topic');
  expect(useWorkspace.getState().topics['synthetic-topic']).toMatchObject({ joined: false, canJoin: true });
});

test('stale topic metadata does not navigate even when the original route remains active', async () => {
  authorizeNotifications();
  const view = start(true);
  mockOpenTopic.mockResolvedValueOnce(undefined);
  await act(async () => mockNotificationListener?.(notification({ topicId: 'synthetic-topic' })));
  expect(view.queryByLabelText('Synthetic draft')).toBeNull();
});

test('same-target topic departure stays on its route with its message bucket cleared', async () => {
  authorizeNotifications();
  const view = start(true);
  fireEvent.press(view.getByText('Open synthetic topic'));
  await waitFor(() => expect(view.getByTestId('synthetic-target').props.children).toBe('synthetic-topic'));
  mockOpenTopic.mockImplementationOnce(async () => {
    const state = useWorkspace.getState();
    state.upsertTopic({ ...state.topics['synthetic-topic']!, joined: false, canJoin: true });
    return 0;
  });
  await act(async () => mockNotificationListener?.(notification({ topicId: 'synthetic-topic' })));
  expect(view.getByTestId('synthetic-target').props.children).toBe('synthetic-topic');
  expect(useWorkspace.getState().topics['synthetic-topic']).toMatchObject({ joined: false, canJoin: true });
  expect(useWorkspace.getState().messages['topic:synthetic-topic']).toBeUndefined();
});

test.each(['chat', 'topic', 'parent', 'focus'] as const)('a late notification cannot replace a newer same-key route context (%s)', async changed => {
  authorizeNotifications();
  const view = start(true), topic = changed === 'topic' || changed === 'parent', pending = pendingNotification();
  fireEvent.press(view.getByText(topic ? 'Open synthetic topic' : 'Open synthetic chat'));
  await waitFor(() => expect(view.getByTestId('synthetic-route-key')).toBeTruthy());
  const key = view.getByTestId('synthetic-route-key').props.children;
  if (topic) mockOpenTopic.mockReturnValueOnce(pending.promise);
  else mockOpen.mockReturnValueOnce(pending.promise);
  await act(async () => mockNotificationListener?.(notification(topic
    ? { topicId: 'older-synthetic-notification-topic' }
    : { conversationId: 'older-synthetic-notification-chat' })));
  const button = changed === 'chat' ? 'Replace synthetic chat target' : changed === 'topic' ? 'Replace synthetic topic target'
    : changed === 'parent' ? 'Replace synthetic topic parent' : 'Locate another synthetic history';
  fireEvent.press(view.getByText(button));
  await waitFor(() => expect(view.getByTestId(changed === 'parent' ? 'synthetic-parent' : changed === 'focus' ? 'synthetic-focus' : 'synthetic-target').props.children)
    .toBe(changed === 'parent' ? 'replacement-synthetic-parent' : changed === 'focus' ? 'replacement-synthetic-history'
      : changed === 'topic' ? 'replacement-synthetic-topic' : 'replacement-synthetic-chat'));
  expect(view.getByTestId('synthetic-route-key').props.children).toBe(key);
  const target = view.getByTestId('synthetic-target').props.children, parent = view.getByTestId('synthetic-parent').props.children;
  const focus = view.getByTestId('synthetic-focus').props.children;
  await act(async () => pending.resolve(50));
  expect(view.getByTestId('synthetic-route-key').props.children).toBe(key);
  expect(view.getByTestId('synthetic-target').props.children).toBe(target);
  expect(view.getByTestId('synthetic-parent').props.children).toBe(parent);
  expect(view.getByTestId('synthetic-focus').props.children).toBe(focus);
});
