import React from 'react';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react-native';
import { DeviceEventEmitter, FlatList, Keyboard, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView, KeyboardController } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SearchScreen } from '../src/features/chat/SearchScreen';
import type { Runtime } from '../src/data/runtime';
import { bootstrapSchema, conversationSchema, topicSchema } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { cache } from '../src/platform/storage';
import { searchHistoryKey } from '../src/data/search-history';
import { SEARCH_SCOPE_TEXT } from '../src/domain/search';
import { ThemeProvider } from '../src/ui/theme';
import { resolveTheme } from '../src/ui/tokens';
import { AppHeader, ConversationRow, TopicRow } from '../src/ui/chrome';

let mockFocused = true;
const mockSetEnabled = jest.fn();
const mockAssureFocusedInputVisible = jest.fn();
let mockKeyboardVisible = false;
let mockKeyboardHeight = 0;
let mockKeyboardWindow = { width: 390, height: 844 };
let mockFontScale = 1;
let mockRNKeyboardMetrics: ReturnType<typeof Keyboard.metrics>;
const mockMeasureSearchBar = jest.fn<void, Parameters<View['measure']>>();
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    const focused = mockFocused;
    React.useEffect(() => focused ? effect() : undefined, [effect, focused]);
  },
}));
jest.mock('react-native-keyboard-controller', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { ScrollView } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useKeyboardController: () => ({ setEnabled: mockSetEnabled }),
    KeyboardController: { setInputMode: jest.fn(), setDefaultMode: jest.fn() },
    AndroidSoftInputModes: { SOFT_INPUT_ADJUST_NOTHING: 48 },
    useKeyboardState: (selector: (state: { isVisible: boolean; height: number }) => unknown) => selector({ isVisible: mockKeyboardVisible, height: mockKeyboardHeight }),
    useWindowDimensions: () => mockKeyboardWindow,
    KeyboardAwareScrollView: React.forwardRef<{ assureFocusedInputVisible: () => void }, React.ComponentProps<typeof ScrollView>>((props, ref) => {
      React.useImperativeHandle(ref, () => ({ assureFocusedInputVisible: mockAssureFocusedInputVisible }));
      return <ScrollView {...props} />;
    }),
  };
});
jest.mock('../src/platform/font-scale', () => ({ useFontScale: () => mockFontScale }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } }));
jest.mock('../src/ui/RemoteImage', () => ({ RemoteImage: () => null }));

const origin = 'https://synthetic.test';
const account = `${origin}:u1`;
const group = conversationSchema.parse({ id: 'g1', displayTitle: 'Design Group', type: 'group', lastActivityAt: '2026-10-07T00:00:00.000Z' });
const direct = conversationSchema.parse({ id: 'd1', displayTitle: 'Other Person', type: 'direct', lastActivityAt: '2026-10-07T00:00:00.000Z' });
const topic = topicSchema.parse({ id: 't1', conversationId: 'g1', title: 'Design Topic', descriptionPreview: 'Synthetic summary' });
const bootstrap = bootstrapSchema.parse({ auth: { currentUser: { id: 'u1', displayName: 'Synthetic' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 0, permissions: { canReadConversations: true }, policy: { dailyQuotaBytes: 1, remainingQuotaBytes: 1, messageRetentionCount: 50 }, members: [], conversations: [group, direct], files: [] });
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
let values: Map<string, unknown>;

beforeEach(() => {
  jest.useFakeTimers();
  mockFocused = true; mockKeyboardVisible = false; mockKeyboardHeight = 0;
  mockKeyboardWindow = { width: 390, height: 844 }; mockFontScale = 1;
  mockRNKeyboardMetrics = undefined;
  mockMeasureSearchBar.mockReset();
  jest.spyOn(Keyboard, 'metrics').mockImplementation(() => mockRNKeyboardMetrics);
  jest.spyOn(View.prototype, 'measure').mockImplementation(mockMeasureSearchBar);
  values = new Map(); useWorkspace.getState().reset();
  useWorkspace.getState().applyBootstrap(bootstrap, account); useWorkspace.getState().setTopics([topic]);
  jest.mocked(cache.get).mockReset().mockImplementation(key => values.get(key));
  jest.mocked(cache.set).mockReset().mockImplementation((key, value) => { values.set(key, value); return { changes: 1, lastInsertRowId: 1 }; });
  jest.mocked(cache.remove).mockReset().mockImplementation(key => { values.delete(key); return { changes: 1, lastInsertRowId: 1 }; });
});
afterEach(() => { cleanup(); jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); useWorkspace.getState().reset(); });

function screen() {
  const listTopics = jest.fn().mockResolvedValue(undefined);
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const open = jest.fn(), openTopic = jest.fn(), onBack = jest.fn();
  const element = () => <SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={open} openTopic={openTopic} onBack={onBack} /></SafeAreaProvider>;
  const view = render(element());
  return { view, runtime, listTopics, open, openTopic, onBack, rerender: () => view.rerender(element()) };
}

function measureSearch(view: ReturnType<typeof render>, viewportHeight: number, rowHeight: number) {
  fireEvent(view.UNSAFE_getByType(FlatList), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 844, height: viewportHeight } } });
  fireEvent(view.getByTestId('search-bar'), 'layout', { nativeEvent: { layout: { x: 16, y: 8, width: 812, height: rowHeight } } });
}

function showRNKeyboard(screenY: number) {
  mockRNKeyboardMetrics = { screenX: 0, screenY, width: 844, height: 296 };
  act(() => DeviceEventEmitter.emit('keyboardDidShow', { duration: 0, easing: 'keyboard', endCoordinates: mockRNKeyboardMetrics }));
}

test.each([48, 69])('visible native row height %s is not dismissed even if viewport is already reduced or nav height differs', rowHeight => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  mockKeyboardWindow = { width: 844, height: 390 };
  const { view, rerender } = screen();
  fireEvent(view.getByLabelText('搜索会话和话题'), 'focus');
  mockMeasureSearchBar.mockImplementation(callback => callback(16, 8, 812, rowHeight, 16, 32));
  mockKeyboardVisible = true; mockKeyboardHeight = 310; rerender();
  showRNKeyboard(108);
  measureSearch(view, 80, rowHeight);
  expect(dismiss).not.toHaveBeenCalled();
  expect(view.queryByText('当前窗口空间不足，键盘已收起，请转为竖屏输入。')).toBeNull();
});

test('standalone search focuses input, states its loaded scope, and typing does not save history', () => {
  const { view, onBack } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  expect(input.props.autoFocus).toBe(true); expect(input.props.returnKeyType).toBe('search');
  expect(view.getByText(SEARCH_SCOPE_TEXT)).toBeTruthy();
  expect(view.getByText('还没有搜索历史')).toBeTruthy();
  expect(view.UNSAFE_getByType(FlatList).props.keyboardShouldPersistTaps).toBe('handled');
  fireEvent.changeText(input, ' design ');
  expect(view.getByText('会话')).toBeTruthy(); expect(view.getByText('话题')).toBeTruthy();
  expect(view.queryByText('Other Person')).toBeNull();
  expect(cache.set).not.toHaveBeenCalled();
  fireEvent(input, 'submitEditing');
  expect(values.get(searchHistoryKey({ accountKey: account, spaceId: 's1' })!)).toEqual(['design']);
  const back = view.getByRole('button', { name: '返回' });
  const style = StyleSheet.flatten(back.props.style);
  expect(style.minWidth).toBeGreaterThanOrEqual(48); expect(style.minHeight).toBeGreaterThanOrEqual(48);
  fireEvent.press(back); expect(onBack).toHaveBeenCalledTimes(1);
});

test('canonical conversation/topic rows open their current objects and record query only on opening', () => {
  const { view, open, openTopic } = screen();
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  fireEvent.press(view.getByRole('button', { name: /打开Design Group/ }));
  expect(open).toHaveBeenCalledWith('g1'); expect(cache.set).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: /打开话题Design Topic/ }));
  expect(openTopic).toHaveBeenCalledWith(topic);
  expect(values.get(searchHistoryKey({ accountKey: account, spaceId: 's1' })!)).toEqual(['Design']);
});

test('history can be reused, individually deleted and cleared without recording every edit', () => {
  values.set(searchHistoryKey({ accountKey: account, spaceId: 's1' })!, ['Design', 'Other']);
  const { view } = screen();
  fireEvent.press(view.getByRole('button', { name: '删除搜索历史：Other' }));
  expect(view.queryByRole('button', { name: '搜索历史：Other' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '搜索历史：Design' }));
  expect(view.getByLabelText('搜索会话和话题').props.value).toBe('Design');
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), '');
  fireEvent.press(view.getByRole('button', { name: '清空历史' }));
  expect(cache.remove).toHaveBeenCalledWith(searchHistoryKey({ accountKey: account, spaceId: 's1' }));
  expect(view.getByText('还没有搜索历史')).toBeTruthy();
});

test('empty results remain scoped and a returning search page preserves its keyword', () => {
  const { view, rerender } = screen();
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Missing');
  expect(view.getByText('没有匹配的已加载内容')).toBeTruthy();
  mockFocused = false; rerender(); mockFocused = true; rerender();
  expect(view.getByLabelText('搜索会话和话题').props.value).toBe('Missing');
  expect(cache.set).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '清空搜索关键词' }));
  expect(view.getByLabelText('搜索会话和话题').props.value).toBe('');
  expect(cache.set).not.toHaveBeenCalled();
});

test.each(['account', 'space', 'api', 'blur', 'unmount'] as const)('old callbacks cannot navigate or record after %s', reason => {
  const { view, runtime, open, rerender } = screen();
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  const oldOpen = view.UNSAFE_getByType(ConversationRow).props.onPress;
  const oldSubmit = view.getByLabelText('搜索会话和话题').props.onSubmitEditing;
  if (reason === 'account') act(() => useWorkspace.setState({ accountKey: `${origin}:u2`, bootstrap: { ...bootstrap, auth: { currentUser: { ...bootstrap.auth.currentUser, id: 'u2' } } } }));
  else if (reason === 'space') act(() => useWorkspace.setState({ bootstrap: { ...bootstrap, space: { id: 's2', name: 'Other synthetic space' } } }));
  else if (reason === 'api') { runtime.api = { origin: 'https://other.test' } as Runtime['api']; rerender(); }
  else if (reason === 'blur') { mockFocused = false; rerender(); }
  else view.unmount();
  act(() => { oldOpen(); oldSubmit(); });
  expect(open).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
  if (reason === 'account' || reason === 'space' || reason === 'api') expect(view.getByLabelText('搜索会话和话题').props.value).toBe('');
});

test('permission loss or removed parent blocks old result handlers without exposing cached topic', () => {
  const { view, open, openTopic } = screen();
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  const oldConversation = view.UNSAFE_getByType(ConversationRow).props.onPress;
  const oldTopic = view.UNSAFE_getByType(TopicRow).props.onPress;
  act(() => useWorkspace.setState({ conversations: {} }));
  act(() => { oldConversation(); oldTopic(); });
  expect(open).not.toHaveBeenCalled(); expect(openTopic).not.toHaveBeenCalled();
  expect(view.queryByText('Design Topic')).toBeNull(); expect(cache.set).not.toHaveBeenCalled();
  act(() => useWorkspace.setState({ conversations: { g1: group }, bootstrap: { ...bootstrap, permissions: { ...bootstrap.permissions, canReadConversations: false } } }));
  act(oldConversation); expect(open).not.toHaveBeenCalled();
});

test('no account neither reads history nor accepts typed or submitted values', () => {
  useWorkspace.getState().reset(); const { view } = screen();
  expect(view.getByText('登录后可搜索')).toBeTruthy();
  const input = view.getByLabelText('搜索会话和话题'); expect(input.props.editable).toBe(false);
  fireEvent.changeText(input, 'Do not persist'); fireEvent(input, 'submitEditing');
  expect(cache.get).not.toHaveBeenCalled(); expect(cache.set).not.toHaveBeenCalled();
});

test('history storage failure leaves local search and opening usable without claiming save', () => {
  jest.mocked(cache.get).mockImplementation(() => { throw new Error('Synthetic IO'); });
  const { view, open } = screen();
  expect(view.getByText('本机搜索历史暂时无法读取，仍可筛选已加载的内容。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  fireEvent.press(view.getByRole('button', { name: /打开Design Group/ }));
  expect(open).toHaveBeenCalledWith('g1');
  expect(view.getByText('本机搜索历史未保存，仍可打开搜索结果。')).toBeTruthy();
});

test('search page follows the existing dark theme without changing keyboard or cached history', async () => {
  const runtime = { api: { origin }, listTopics: jest.fn().mockResolvedValue(undefined) } as unknown as Runtime;
  const view = render(<SafeAreaProvider initialMetrics={metrics}><ThemeProvider mode="dark"><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></ThemeProvider></SafeAreaProvider>);
  await act(async () => { await Promise.resolve(); });
  expect(StyleSheet.flatten(view.getByTestId('search-page').props.style).backgroundColor).toBe(resolveTheme('dark').bg);
  expect(cache.set).not.toHaveBeenCalled();
  expect(Keyboard.dismiss).toBeDefined();
});

test('first focused readable entry refreshes authorized topics once without sending the keyword or blocking loaded results', async () => {
  const { view, listTopics, rerender } = screen();
  expect(listTopics).toHaveBeenCalledTimes(1); expect(listTopics).toHaveBeenCalledWith();
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  expect(view.getByText('Design Group')).toBeTruthy();
  mockFocused = false; rerender(); mockFocused = true; rerender();
  await act(async () => { await Promise.resolve(); });
  expect(listTopics).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('搜索会话和话题').props.value).toBe('Design');
});

test('a first visit can discover returned topics even if the home topic tab has never loaded them', async () => {
  useWorkspace.setState({ topics: {} });
  let finish: () => void = () => undefined;
  const listTopics = jest.fn(() => new Promise<void>(resolve => { finish = () => { useWorkspace.getState().setTopics([topic]); resolve(); }; }));
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const view = render(<SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>);
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  expect(view.getByText('Design Group')).toBeTruthy(); expect(view.queryByText('Design Topic')).toBeNull();
  await act(async () => { finish(); });
  expect(view.getByText('Design Topic')).toBeTruthy(); expect(listTopics).toHaveBeenCalledWith();
});

test('Strict Mode setup cleanup does not repeat the automatic topic request', async () => {
  const listTopics = jest.fn().mockResolvedValue(undefined);
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const view = render(<React.StrictMode><SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider></React.StrictMode>);
  await act(async () => { await Promise.resolve(); });
  expect(listTopics).toHaveBeenCalledTimes(1);
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  expect(view.getByText('Design Group')).toBeTruthy();
});

test('authorized offline loaded search and history remain usable without a topic network call', () => {
  const listTopics = jest.fn();
  const runtime = { api: undefined, listTopics } as unknown as Runtime;
  const view = render(<SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>);
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  fireEvent(view.getByLabelText('搜索会话和话题'), 'submitEditing');
  expect(view.getByText('Design Group')).toBeTruthy(); expect(listTopics).not.toHaveBeenCalled();
  expect(values.get(searchHistoryKey({ accountKey: account, spaceId: 's1' })!)).toEqual(['Design']);
});

test('topic refresh failure preserves loaded results and can retry within the same scope', async () => {
  let reject: (error: unknown) => void = () => undefined;
  const listTopics = jest.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const view = render(<SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>);
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  await act(async () => { reject(new Error('Synthetic network')); });
  expect(view.getByText('话题暂时无法更新，仍可搜索已加载的内容。')).toBeTruthy();
  expect(view.getByText('Design Group')).toBeTruthy(); expect(view.getByText('Design Topic')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '重试加载话题' }));
  await act(async () => { await Promise.resolve(); });
  expect(listTopics).toHaveBeenCalledTimes(2); expect(listTopics).toHaveBeenLastCalledWith();
  expect(view.queryByText('话题暂时无法更新，仍可搜索已加载的内容。')).toBeNull();
});

test('a failed first topic refresh while blurred is recoverable after returning without automatic retry loops', async () => {
  let reject: (error: unknown) => void = () => undefined;
  const listTopics = jest.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const element = () => <SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>;
  const view = render(element());
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  mockFocused = false; view.rerender(element());
  await act(async () => { reject(new Error('Synthetic first-load network failure')); });
  mockFocused = true; view.rerender(element());
  expect(view.getByLabelText('搜索会话和话题').props.value).toBe('Design');
  expect(view.getByText('Design Group')).toBeTruthy();
  expect(view.getByText('话题暂时无法更新，仍可搜索已加载的内容。')).toBeTruthy();
  expect(listTopics).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '重试加载话题' }));
  await act(async () => { await Promise.resolve(); });
  expect(listTopics).toHaveBeenCalledTimes(2); expect(listTopics).toHaveBeenLastCalledWith();
  expect(view.queryByRole('button', { name: '重试加载话题' })).toBeNull();
  mockFocused = false; view.rerender(element()); mockFocused = true; view.rerender(element());
  expect(listTopics).toHaveBeenCalledTimes(2);
});

test.each(['account', 'space', 'api', 'permission', 'unmount'] as const)('a pending topic failure cannot publish after %s invalidation', async reason => {
  let reject: (error: unknown) => void = () => undefined;
  const listTopics = jest.fn().mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; })).mockResolvedValue(undefined);
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const element = () => <SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>;
  const view = render(element());
  mockFocused = false; view.rerender(element());
  if (reason === 'account') act(() => useWorkspace.setState({ accountKey: `${origin}:u2`, bootstrap: { ...bootstrap, auth: { currentUser: { ...bootstrap.auth.currentUser, id: 'u2' } } } }));
  else if (reason === 'space') act(() => useWorkspace.setState({ bootstrap: { ...bootstrap, space: { id: 's2', name: 'Other synthetic space' } } }));
  else if (reason === 'api') { runtime.api = { origin: 'https://other.test' } as Runtime['api']; view.rerender(element()); }
  else if (reason === 'permission') act(() => useWorkspace.setState({ bootstrap: { ...bootstrap, permissions: { ...bootstrap.permissions, canReadConversations: false } } }));
  else view.unmount();
  await act(async () => { reject(new Error('Invalidated topic failure')); });
  if (reason !== 'unmount') {
    mockFocused = true; view.rerender(element());
    await act(async () => { await Promise.resolve(); });
    expect(view.queryByText('话题暂时无法更新，仍可搜索已加载的内容。')).toBeNull();
    expect(view.queryByRole('button', { name: '重试加载话题' })).toBeNull();
  }
});

test('late topic refresh failure cannot publish old scope feedback, and an unreadable account never refreshes', async () => {
  let reject: (error: unknown) => void = () => undefined;
  const listTopics = jest.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const runtime = { api: { origin }, listTopics } as unknown as Runtime;
  const view = render(<SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>);
  act(() => useWorkspace.setState({ accountKey: `${origin}:u2`, bootstrap: { ...bootstrap, auth: { currentUser: { ...bootstrap.auth.currentUser, id: 'u2' } }, permissions: { ...bootstrap.permissions, canReadConversations: false } } }));
  await act(async () => { reject(new Error('Old scope failure')); });
  expect(listTopics).toHaveBeenCalledTimes(1);
  expect(view.queryByText('话题暂时无法更新，仍可搜索已加载的内容。')).toBeNull();
});

test('short-window controls and history share the keyboard-aware scroll surface', () => {
  values.set(searchHistoryKey({ accountKey: account, spaceId: 's1' })!, ['Design']);
  const { view, rerender } = screen();
  const list = view.UNSAFE_getByType(FlatList);
  expect(view.UNSAFE_getAllByType(FlatList)).toHaveLength(1);
  const content = within(list);
  expect(content.getByRole('button', { name: '返回' })).toBeTruthy();
  expect(content.getByLabelText('搜索会话和话题')).toBeTruthy();
  expect(content.getByRole('button', { name: '搜索' })).toBeTruthy();
  expect(content.getByText(SEARCH_SCOPE_TEXT)).toBeTruthy();
  expect(content.getByRole('button', { name: '搜索历史：Design' })).toBeTruthy();
  const aware = view.UNSAFE_getByType(KeyboardAwareScrollView);
  expect(aware.props.enabled).toBe(true);
  expect(aware.props.bottomOffset).toBe(8);
  expect(list.props.removeClippedSubviews).toBe(false);
  expect(content.getByLabelText('搜索会话和话题').props.disableFullscreenUI).toBe(true);
  expect(StyleSheet.flatten(view.getByTestId('search-page').props.style).paddingBottom ?? 0).toBe(0);
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBe(40);
  mockKeyboardVisible = true; rerender();
  expect(StyleSheet.flatten(view.UNSAFE_getByType(FlatList).props.contentContainerStyle).paddingBottom).toBe(16);
});

test('top safe area stays outside the scroll viewport without a duplicate header inset', () => {
  const { view, rerender } = screen();
  const page = view.getByTestId('search-page');
  const input = view.getByLabelText('搜索会话和话题');
  const aware = view.UNSAFE_getByType(KeyboardAwareScrollView);
  expect(StyleSheet.flatten(page.props.style).paddingTop).toBe(metrics.insets.top);
  expect(within(aware).queryByTestId('search-page')).toBeNull();
  expect(view.UNSAFE_queryByType(AppHeader)).toBeNull();
  expect(StyleSheet.flatten(view.UNSAFE_getByType(FlatList).props.contentContainerStyle).paddingTop ?? 0).toBe(0);
  mockKeyboardVisible = true; mockKeyboardHeight = 296;
  mockKeyboardWindow = { width: 844, height: 390 }; mockFontScale = 2; rerender();
  expect(StyleSheet.flatten(page.props.style).paddingTop).toBe(metrics.insets.top);
  expect(StyleSheet.flatten(page.props.style).paddingBottom ?? 0).toBe(0);
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
  expect(view.UNSAFE_getByType(KeyboardAwareScrollView)).toBe(aware);
  const backStyle = StyleSheet.flatten(view.getByRole('button', { name: '返回' }).props.style);
  expect(backStyle.minWidth).toBeGreaterThanOrEqual(48);
  expect(backStyle.minHeight).toBeGreaterThanOrEqual(48);
});

test('the native search bar keeps Back and the same Input in one row across typing and rotation', () => {
  const { view, rerender, onBack } = screen();
  const bar = view.getByTestId('search-bar');
  const controls = within(bar);
  const input = controls.getByLabelText('搜索会话和话题');
  const back = controls.getByRole('button', { name: '返回' });
  const barStyle = StyleSheet.flatten(bar.props.style);
  expect(barStyle.flexDirection).toBe('row');
  expect(barStyle.gap).toBe(8);
  let form = bar.parent;
  while (form && StyleSheet.flatten(form.props.style)?.paddingHorizontal === undefined) form = form.parent;
  const formStyle = StyleSheet.flatten(form?.props.style);
  expect(formStyle?.paddingHorizontal).toBe(16);
  expect(formStyle?.paddingVertical).toBe(8);
  const backStyle = StyleSheet.flatten(back.props.style);
  expect(backStyle.minWidth).toBeGreaterThanOrEqual(48);
  expect(backStyle.minHeight).toBeGreaterThanOrEqual(48);
  expect(controls.queryByRole('button', { name: '搜索' })).toBeNull();
  fireEvent.changeText(input, 'Design');
  expect(controls.getByRole('button', { name: '清空搜索关键词' })).toBeTruthy();
  mockKeyboardVisible = true; mockKeyboardHeight = 296;
  mockKeyboardWindow = { width: 844, height: 390 }; mockFontScale = 2; rerender();
  expect(view.getByTestId('search-bar')).toBe(bar);
  expect(controls.getByLabelText('搜索会话和话题')).toBe(input);
  expect(input.props.value).toBe('Design');
  fireEvent.press(controls.getByRole('button', { name: '清空搜索关键词' }));
  expect(controls.getByLabelText('搜索会话和话题')).toBe(input);
  expect(input.props.value).toBe('');
  expect(input.props.autoFocus).toBe(true);
  expect(input.props.allowFontScaling).not.toBe(false);
  fireEvent.press(back);
  expect(onBack).toHaveBeenCalledTimes(1);
});

test('keyboard ownership restores pan on blur and unmount without intercepting system back', () => {
  const { view, rerender } = screen();
  expect(mockSetEnabled).toHaveBeenLastCalledWith(true);
  expect(KeyboardController.setInputMode).toHaveBeenLastCalledWith(48);
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design');
  const modeCalls = jest.mocked(KeyboardController.setInputMode).mock.calls.length;
  fireEvent.changeText(view.getByLabelText('搜索会话和话题'), 'Design Group');
  expect(KeyboardController.setInputMode).toHaveBeenCalledTimes(modeCalls);
  mockFocused = false; rerender();
  expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  expect(KeyboardController.setDefaultMode).toHaveBeenCalledTimes(1);
  expect(view.UNSAFE_getByType(KeyboardAwareScrollView).props.enabled).toBe(false);
  mockFocused = true; rerender();
  expect(mockSetEnabled).toHaveBeenLastCalledWith(true);
  expect(view.getByLabelText('搜索会话和话题').props.value).toBe('Design Group');
  view.unmount();
  expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  expect(KeyboardController.setDefaultMode).toHaveBeenCalledTimes(2);
});

test('keyword edits, history visibility and result changes preserve the same input host and scroll component', () => {
  const { view } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  const aware = view.UNSAFE_getByType(KeyboardAwareScrollView);
  fireEvent.changeText(input, 'Design');
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
  expect(view.UNSAFE_getByType(KeyboardAwareScrollView)).toBe(aware);
  fireEvent(input, 'submitEditing');
  fireEvent.press(view.getByRole('button', { name: '清空搜索关键词' }));
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
  expect(view.UNSAFE_getByType(KeyboardAwareScrollView)).toBe(aware);
  expect(input.props.allowFontScaling).not.toBe(false);
});

test('rotation, keyboard height and font changes refresh the focused input without replacing its host', () => {
  const { view, rerender } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  const aware = view.UNSAFE_getByType(KeyboardAwareScrollView);
  fireEvent(input, 'focus');
  mockKeyboardVisible = true; mockKeyboardHeight = 310; rerender();
  mockAssureFocusedInputVisible.mockClear();
  mockKeyboardWindow = { width: 844, height: 390 }; rerender();
  expect(mockAssureFocusedInputVisible).toHaveBeenCalled();
  mockAssureFocusedInputVisible.mockClear();
  mockKeyboardHeight = 296; rerender();
  expect(mockAssureFocusedInputVisible).toHaveBeenCalled();
  mockAssureFocusedInputVisible.mockClear();
  mockFontScale = 2; rerender();
  expect(mockAssureFocusedInputVisible).toHaveBeenCalled();
  mockAssureFocusedInputVisible.mockClear();
  fireEvent(input, 'layout', { nativeEvent: { layout: { x: 16, y: 88, width: 360, height: 72 } } });
  expect(mockAssureFocusedInputVisible).toHaveBeenCalled();
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
  expect(view.UNSAFE_getByType(KeyboardAwareScrollView)).toBe(aware);
  expect(StyleSheet.flatten(view.getByTestId('search-page').props.style).paddingBottom ?? 0).toBe(0);
});

test('first entry in landscape resynchronizes after focus and the real viewport layout', () => {
  mockKeyboardWindow = { width: 844, height: 390 };
  mockKeyboardVisible = true; mockKeyboardHeight = 296;
  const { view } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  expect(input.props.autoFocus).toBe(true);
  fireEvent(input, 'focus');
  expect(mockAssureFocusedInputVisible).toHaveBeenCalled();
  mockAssureFocusedInputVisible.mockClear();
  fireEvent(view.UNSAFE_getByType(FlatList), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 844, height: 390 } } });
  expect(mockAssureFocusedInputVisible).toHaveBeenCalled();
});

test('visibility refresh stops after input or route blur and rejects stale layout after unmount', () => {
  const { view, rerender } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  fireEvent(input, 'focus');
  const oldLayout = input.props.onLayout;
  fireEvent(input, 'blur');
  mockAssureFocusedInputVisible.mockClear();
  mockKeyboardVisible = true; mockKeyboardHeight = 310; rerender();
  fireEvent(input, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 48 } } });
  expect(mockAssureFocusedInputVisible).not.toHaveBeenCalled();
  fireEvent(input, 'focus'); mockFocused = false; rerender();
  mockAssureFocusedInputVisible.mockClear();
  act(() => oldLayout());
  mockKeyboardWindow = { width: 844, height: 390 }; rerender();
  expect(mockAssureFocusedInputVisible).not.toHaveBeenCalled();
  view.unmount();
  act(() => oldLayout());
  expect(mockAssureFocusedInputVisible).not.toHaveBeenCalled();
});

const insufficientSpaceText = '当前窗口空间不足，键盘已收起，请转为竖屏输入。';
type RowMeasurement = Parameters<View['measure']>[0];

function latestRowMeasurement(): RowMeasurement {
  const callback = mockMeasureSearchBar.mock.calls.at(-1)?.[0];
  if (!callback) throw new Error('No native row measurement was requested');
  return callback;
}

function measureRow(callback: RowMeasurement, pageY = 60, rowHeight = 69, rowWidth = 812) {
  act(() => callback(16, 8, rowWidth, rowHeight, 16, pageY));
}

test('an occluded absolute row dismisses once and preserves query and feedback after its own blur and keyboard hide', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  fireEvent.changeText(input, 'Design'); fireEvent(input, 'focus');
  mockMeasureSearchBar.mockImplementation(callback => callback(16, 8, 812, 69, 16, 60));
  mockKeyboardVisible = true; mockKeyboardHeight = 260; rerender();
  showRNKeyboard(108);
  measureSearch(view, 300, 69);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(view.getByText(insufficientSpaceText)).toBeTruthy();
  expect(input.props.value).toBe('Design');
  measureSearch(view, 300, 69);
  expect(dismiss).toHaveBeenCalledTimes(1);
  fireEvent(input, 'blur');
  mockKeyboardVisible = false; mockKeyboardHeight = 0; rerender();
  mockRNKeyboardMetrics = undefined;
  act(() => DeviceEventEmitter.emit('keyboardDidHide', {}));
  expect(view.getByText(insufficientSpaceText)).toBeTruthy();
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
  mockMeasureSearchBar.mockImplementation(callback => callback(16, 8, 812, 69, 16, 32));
  fireEvent(input, 'focus'); mockKeyboardVisible = true; rerender(); showRNKeyboard(108);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(view.queryByText(insufficientSpaceText)).toBeNull();
});

test.each([[Number.NaN, 69, 812], [-1, 69, 812], [60, 0, 812], [60, -1, 812], [60, 69, 0], [39, 69, 812]] as const)
('invalid native measurement or visible boundary %s/%s/%s does not dismiss', (pageY, rowHeight, rowWidth) => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  fireEvent(view.getByLabelText('搜索会话和话题'), 'focus');
  mockKeyboardVisible = true; rerender(); showRNKeyboard(108);
  measureRow(latestRowMeasurement(), pageY, rowHeight, rowWidth);
  expect(dismiss).not.toHaveBeenCalled();
  expect(view.queryByText(insufficientSpaceText)).toBeNull();
});

test('controller height or local layout alone cannot dismiss without a native keyboard frame and completed measure', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  fireEvent(view.getByLabelText('搜索会话和话题'), 'focus');
  mockKeyboardVisible = true; mockKeyboardHeight = 1000; rerender(); measureSearch(view, 80, 69);
  expect(mockMeasureSearchBar).not.toHaveBeenCalled();
  showRNKeyboard(108);
  expect(mockMeasureSearchBar).toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled(); // Native measure has not returned.
});

test.each([Number.NaN, -1])('invalid RN keyboard screenY %s cannot dismiss', screenY => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  fireEvent(view.getByLabelText('搜索会话和话题'), 'focus');
  mockMeasureSearchBar.mockImplementation(callback => callback(16, 8, 812, 69, 16, 60));
  mockKeyboardVisible = true; rerender(); showRNKeyboard(screenY); measureSearch(view, 80, 69);
  expect(mockMeasureSearchBar).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
});

test('insufficient-space feedback does not replace current history or topic failures and clears on route blur', async () => {
  jest.mocked(cache.get).mockImplementation(() => { throw new Error('Synthetic history failure'); });
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const runtime = { api: { origin }, listTopics: jest.fn().mockRejectedValue(new Error('Synthetic topic failure')) } as unknown as Runtime;
  const element = () => <SafeAreaProvider initialMetrics={metrics}><SearchScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} onBack={jest.fn()} /></SafeAreaProvider>;
  const view = render(element());
  await act(async () => { await Promise.resolve(); });
  fireEvent(view.getByLabelText('搜索会话和话题'), 'focus');
  mockMeasureSearchBar.mockImplementation(callback => callback(16, 8, 812, 69, 16, 60));
  mockKeyboardVisible = true; view.rerender(element()); showRNKeyboard(108);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(view.getByText(insufficientSpaceText)).toBeTruthy();
  expect(view.getByText('本机搜索历史暂时无法读取，仍可筛选已加载的内容。')).toBeTruthy();
  expect(view.getByText('话题暂时无法更新，仍可搜索已加载的内容。')).toBeTruthy();
  mockFocused = false; view.rerender(element());
  expect(view.queryByText(insufficientSpaceText)).toBeNull();
});

test.each(['input-blur', 'route-blur', 'invalid-account', 'api', 'space', 'unmount'] as const)
('an asynchronous native measurement cannot close another keyboard after %s', reason => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender, runtime } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  fireEvent(input, 'focus'); mockKeyboardVisible = true; rerender(); showRNKeyboard(108);
  const callback = latestRowMeasurement();
  if (reason === 'input-blur') fireEvent(input, 'blur');
  else if (reason === 'route-blur') { mockFocused = false; rerender(); }
  else if (reason === 'invalid-account') act(() => useWorkspace.setState({ accountKey: `${origin}:u2` }));
  else if (reason === 'api') { runtime.api = { origin: 'https://other.test' } as Runtime['api']; rerender(); }
  else if (reason === 'space') act(() => useWorkspace.setState({ bootstrap: { ...bootstrap, space: { id: 's2', name: 'Other synthetic space' } } }));
  else view.unmount();
  measureRow(callback);
  expect(dismiss).not.toHaveBeenCalled();
  if (reason !== 'unmount') expect(view.queryByText(insufficientSpaceText)).toBeNull();
  if (reason === 'route-blur') {
    mockFocused = true; rerender(); measureRow(callback);
    expect(dismiss).not.toHaveBeenCalled(); // Returning alone is not native input focus.
  }
});

test.each(['window', 'font', 'frame', 'hide'] as const)('old asynchronous row measure is rejected after %s changes', change => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  fireEvent(input, 'focus'); mockKeyboardVisible = true; rerender(); showRNKeyboard(108);
  const oldMeasure = latestRowMeasurement();
  if (change === 'window') { mockKeyboardWindow = { width: 844, height: 390 }; rerender(); }
  else if (change === 'font') { mockFontScale = 2; rerender(); }
  else if (change === 'frame') showRNKeyboard(200);
  else { mockRNKeyboardMetrics = undefined; act(() => DeviceEventEmitter.emit('keyboardDidHide', {})); }
  measureRow(oldMeasure);
  expect(dismiss).not.toHaveBeenCalled();
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
});

test('window rotation rejects cached RN metrics until a fresh native keyboard frame, then checks the measured row', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  fireEvent(view.getByLabelText('搜索会话和话题'), 'focus');
  mockKeyboardVisible = true; rerender(); showRNKeyboard(108);
  measureRow(latestRowMeasurement(), 32);
  mockMeasureSearchBar.mockClear();
  mockKeyboardWindow = { width: 844, height: 390 }; mockKeyboardHeight = 310; rerender();
  measureSearch(view, 80, 69);
  expect(mockMeasureSearchBar).not.toHaveBeenCalled();
  expect(dismiss).not.toHaveBeenCalled();
  showRNKeyboard(108);
  measureRow(latestRowMeasurement());
  expect(dismiss).toHaveBeenCalledTimes(1);
});

test('font-only change and same-window controller height request fresh absolute measurement without a second spacer or remount', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => {});
  const { view, rerender } = screen();
  const input = view.getByLabelText('搜索会话和话题');
  fireEvent(input, 'focus'); mockKeyboardVisible = true; rerender(); showRNKeyboard(108);
  measureRow(latestRowMeasurement(), 32, 48);
  mockFontScale = 2; rerender();
  measureRow(latestRowMeasurement(), 32, 69);
  expect(dismiss).not.toHaveBeenCalled();
  mockKeyboardHeight = 320; rerender();
  measureRow(latestRowMeasurement(), 60, 69);
  expect(dismiss).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('搜索会话和话题')).toBe(input);
  expect(StyleSheet.flatten(view.getByTestId('search-page').props.style).paddingBottom ?? 0).toBe(0);
});
