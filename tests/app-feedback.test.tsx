import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Button as NativeButton, Text, TextInput, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context';
import App from '../App';
import { AppHeader } from '../src/ui/chrome';
import { useWorkspace } from '../src/domain/store';

const mockStart = jest.fn().mockResolvedValue(undefined);
const mockDispose = jest.fn();
const mockSend = jest.fn();
const mockChatMount = jest.fn();
const mockChatUnmount = jest.fn();

jest.mock('../src/data/runtime', () => ({
  Runtime: jest.fn().mockImplementation(() => ({ start: mockStart, dispose: mockDispose, isForced: () => false, send: mockSend })),
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
  addNotificationResponseReceivedListener: () => ({ remove: jest.fn() }),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn(),
}));
jest.mock('../src/features/account/screens', () => ({ AccountNavigator: () => null }));
jest.mock('../src/ui/MediaViewer', () => ({ MediaViewer: () => null }));
jest.mock('../src/data/media', () => ({ canPreviewAttachment: () => false }));
function MockConversationsScreen({ open }: { open: (id: string) => void }) {
  return <NativeButton title="Open synthetic chat" onPress={() => open('synthetic-chat')} />;
}
function MockChatScreen() {
  const insets = useSafeAreaInsets();
  const draft = useWorkspace(state => state.drafts['synthetic-chat']?.text ?? '');
  const [panelOpen, setPanelOpen] = React.useState(false);
  React.useEffect(() => { mockChatMount(); return () => { mockChatUnmount(); }; }, []);
  return <View>
    <AppHeader title="Synthetic chat" includeTopInset />
    <Text testID="chat-insets">{JSON.stringify(insets)}</Text>
    <TextInput accessibilityLabel="Synthetic draft" value={draft} onChangeText={text => useWorkspace.getState().setDraft('synthetic-chat', text)} />
    <NativeButton title="Open synthetic panel" onPress={() => setPanelOpen(true)} />
    <Text>{panelOpen ? 'Synthetic panel open' : 'Synthetic panel closed'}</Text>
  </View>;
}
function MockLoginScreen() { return <Text>Synthetic login</Text>; }
jest.mock('../src/features/screens', () => ({
  ConversationsScreen: MockConversationsScreen,
  ChatScreen: MockChatScreen,
  FilesScreen: () => null,
  MembersScreen: () => null,
  DetailsScreen: () => null,
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

beforeEach(() => { useWorkspace.getState().reset(); });
afterEach(() => { useWorkspace.getState().reset(); });

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
