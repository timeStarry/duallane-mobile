import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Modal, NativeModules, Platform, ScrollView, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConversationRow } from '../src/ui/chrome';
import { Button, ConnectionBanner, Dialog, Label, SettingGroup, SettingRow } from '../src/ui/primitives';
import { ThemeProvider } from '../src/ui/theme';
import { ConversationsScreen } from '../src/features/screens';
import { AccountNavigator } from '../src/features/account/screens';
import { WorkbenchScreen } from '../src/features/workbench/WorkbenchScreen';
import { syntheticConversations } from '../src/fixtures/synthetic';
import { Runtime } from '../src/data/runtime';
import { useWorkspace } from '../src/domain/store';

jest.mock('../src/data/runtime', () => ({ Runtime: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/data/transfers', () => ({ Transfers: jest.fn() }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' },
}));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications: jest.fn() }));
jest.mock('expo-updates', () => ({ isEnabled: false, checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };

function wrap(children: React.ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider mode="light">{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

afterEach(() => {
  useWorkspace.getState().reset();
});

test('conversation rows expose unread and muted state without pretending to search all history', () => {
  const muted = syntheticConversations[2]!;
  const view = render(wrap(<ConversationRow conversation={muted} selfId="user-a" onPress={() => undefined} />));
  expect(view.getByLabelText('打开公告群，12条未读，免打扰')).toBeTruthy();
});

test('the chat home opens a separate search route and keeps its topic empty state', () => {
  const runtime = new Runtime();
  runtime.listTopics = jest.fn().mockResolvedValue([]);
  const openSearch = jest.fn();
  const view = render(wrap(<ConversationsScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} openSearch={openSearch} />));
  fireEvent.press(view.getByLabelText('搜索'));
  expect(openSearch).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText('筛选已加载的会话')).toBeNull();
  fireEvent.press(view.getByRole('tab', { name: '话题' }));
  expect(view.getByText('还没有话题')).toBeTruthy();
  expect(view.queryByLabelText('筛选已加载的话题')).toBeNull();
});

test('account categories do not invent device-session or space-admin entries', () => {
  const runtime = new Runtime();
  runtime.resume = jest.fn();
  runtime.logout = jest.fn();
  const view = render(wrap(
    <NavigationContainer>
      <AccountNavigator runtime={runtime} mode="light" setMode={jest.fn()} />
    </NavigationContainer>,
  ));
  expect(view.getByText('个人资料')).toBeTruthy();
  expect(view.getByText('外观与阅读')).toBeTruthy();
  expect(view.getByText('通知')).toBeTruthy();
  expect(view.getByText('空间信息')).toBeTruthy();
  expect(view.getByText('关于与更新')).toBeTruthy();
  expect(view.queryByText('设备会话')).toBeNull();
  expect(view.queryByText('邀请管理')).toBeNull();
  expect(view.getByRole('button', { name: '退出登录' })).toBeTruthy();
});

test('connection banner keeps HTTP sync copy and has no reconnect action', () => {
  const view = render(wrap(<ConnectionBanner connection="实时未接通，已用 HTTP 同步" />));
  expect(view.getByText('实时未接通，已用 HTTP 同步')).toBeTruthy();
  expect(view.queryByText('重新连接')).toBeNull();
  expect(view.queryByRole('button', { name: '重新连接' })).toBeNull();
  const hidden = render(wrap(<ConnectionBanner connection="已连接" />));
  expect(hidden.queryByText('实时未接通，已用 HTTP 同步')).toBeNull();
  expect(hidden.queryByText('已连接')).toBeNull();
});

test('setting groups use inset surfaces without inventing a reconnect control', () => {
  const view = render(wrap(
    <SettingGroup title="空间">
      <SettingRow title="关于与更新" onPress={() => undefined} />
    </SettingGroup>,
  ));
  expect(view.getByText('空间')).toBeTruthy();
  expect(view.getByText('关于与更新')).toBeTruthy();
  expect(view.queryByText('重新连接')).toBeNull();
});

test('the workbench renders official primitives with synthetic content', () => {
  const view = render(wrap(<WorkbenchScreen />));
  expect(view.getByText('组件工作台')).toBeTruthy();
  expect(view.getByRole('button', { name: '主按钮' })).toBeTruthy();
  expect(view.getByRole('button', { name: '危险' })).toBeTruthy();
  expect(view.getByLabelText('打开成员乙，2条未读')).toBeTruthy();
  expect(view.getAllByText('验收记录-合成.txt').length).toBeGreaterThan(0);
  fireEvent.press(view.getByRole('button', { name: '打开消息动作' }));
  expect(view.getByText('仅自己隐藏')).toBeTruthy();
  expect(view.getByRole('button', { name: '撤回' })).toBeTruthy();
});

test('dialog backdrop is independent of ungrouped scrolling content and actions', () => {
  const close = jest.fn(), action = jest.fn();
  const view = render(wrap(
    <Dialog visible title="Synthetic dialog" onRequestClose={close} actions={[{ title: 'Confirm', onPress: action }]}>
      <ScrollView style={{ maxHeight: 100 }}><Label>Synthetic scrolling content</Label></ScrollView>
    </Dialog>,
  ));
  const backdrop = view.getByLabelText('关闭对话框', { includeHiddenElements: true });
  expect(within(backdrop).queryByText('Synthetic scrolling content')).toBeNull();
  const content = view.getByTestId('dialog-Synthetic dialog');
  expect(content.props.accessible).toBe(false);
  expect(content.props.onPress).toBeUndefined();
  expect(content.props.onStartShouldSetResponder).toBeUndefined();
  expect(view.queryByRole('summary', { name: 'Synthetic dialog' })).toBeNull();
  fireEvent.scroll(within(content).UNSAFE_getByType(ScrollView), { nativeEvent: { contentOffset: { y: 80 } } });
  fireEvent.press(view.getByText('Synthetic scrolling content'));
  fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(action).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  fireEvent.press(backdrop);
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent(view.UNSAFE_getByType(Modal), 'requestClose');
  expect(close).toHaveBeenCalledTimes(2);
});

describe('dialog return focus after native Activity window focus', () => {
  const frames = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, Set<(state: typeof AppState.currentState) => void>>();
  let frameId = 0;
  let focus: jest.Mock;
  let capture: jest.Mock;
  let cancel: jest.Mock;
  let previousModule: unknown;
  let handle: jest.SpyInstance;
  let originalState: typeof AppState.currentState;
  const trigger = React.createRef<View>();
  const allowed = jest.fn(() => true);
  function tree(visible: boolean, triggerKey = 'trigger') {
    return wrap(<>
      <Button key={triggerKey} ref={trigger} title="Open synthetic dialog" onPress={() => undefined} />
      <Dialog visible={visible} title="Synthetic focus" returnFocusRef={trigger} canReturnFocus={allowed}
        onRequestClose={() => undefined} actions={[]}><Label>Content</Label></Dialog>
    </>);
  }
  function emit(type: string, state = AppState.currentState) {
    act(() => { for (const callback of [...(listeners.get(type) ?? [])]) callback(state); });
  }
  function show(view: ReturnType<typeof render>) {
    fireEvent(view.UNSAFE_getByType(Modal), 'show');
    emit('blur');
  }
  async function completeFrames() {
    await act(async () => { await Promise.resolve(); });
    act(() => {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); }
    });
  }
  beforeEach(() => {
    frames.clear(); listeners.clear(); frameId = 0; allowed.mockReset().mockReturnValue(true);
    jest.replaceProperty(Platform, 'OS', 'android');
    originalState = AppState.currentState; AppState.currentState = 'active';
    jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
      const group = listeners.get(type) ?? new Set(); listeners.set(type, group); group.add(listener);
      return { remove: () => { group.delete(listener); } };
    });
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    previousModule = NativeModules.DualLaneAccessibilityFocus;
    focus = jest.fn().mockResolvedValue(true);
    capture = jest.fn().mockResolvedValue(true);
    cancel = jest.fn();
    NativeModules.DualLaneAccessibilityFocus = { captureTarget: capture, restoreFocus: focus, cancelTarget: cancel };
    handle = jest.spyOn(jest.requireActual<typeof import('react-native')>('react-native'), 'findNodeHandle').mockReturnValue(4242);
  });
  afterEach(() => {
    AppState.currentState = originalState;
    NativeModules.DualLaneAccessibilityFocus = previousModule;
    jest.restoreAllMocks();
  });
  test('hide plus arbitrary JS frames does not focus while the native modal still owns the window', async () => {
    const view = render(tree(true)); show(view);
    view.rerender(tree(false));
    await completeFrames(); await completeFrames();
    expect(focus).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
    emit('focus'); await completeFrames();
    expect(handle).toHaveBeenCalledWith(trigger.current);
    expect(focus).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledWith(capture.mock.calls[0]![1]);
    emit('focus'); view.rerender(tree(false)); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
  });
  test('window focus delivered before hide commit is retained and only consumed after hide', async () => {
    const view = render(tree(true)); show(view); emit('focus');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    view.rerender(tree(false)); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
  });
  test('onShow and blur may arrive in either order before native window return', async () => {
    const view = render(tree(true)); emit('blur'); fireEvent(view.UNSAFE_getByType(Modal), 'show');
    view.rerender(tree(false)); await completeFrames(); expect(focus).not.toHaveBeenCalled();
    emit('focus'); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
  });
  test('initial focus is unknown; focus without a shown modal and observed blur never returns', async () => {
    const view = render(tree(false)); emit('focus'); await completeFrames();
    view.rerender(tree(true)); fireEvent(view.UNSAFE_getByType(Modal), 'show'); emit('focus');
    view.rerender(tree(false)); await completeFrames(); expect(focus).not.toHaveBeenCalled();
  });
  test.each(['background', null] as const)('SAF visible commit while state=%s records onShow before active without a second blur/show', async initial => {
    AppState.currentState = initial as typeof AppState.currentState;
    const view = render(tree(true)); fireEvent(view.UNSAFE_getByType(Modal), 'show');
    AppState.currentState = 'active'; emit('change', 'active');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    view.rerender(tree(false)); await completeFrames(); expect(focus).not.toHaveBeenCalled();
    emit('focus'); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
  });
  test('a queued background event before onShow and active-before-show retain the current visible candidate', async () => {
    AppState.currentState = 'background';
    const view = render(tree(true)); emit('change', 'background');
    AppState.currentState = 'active'; emit('change', 'active');
    fireEvent(view.UNSAFE_getByType(Modal), 'show');
    view.rerender(tree(false)); emit('focus'); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
  });
  test('a new modal cannot consume an earlier SAF blur or resume focus before hide', async () => {
    const view = render(tree(false)); emit('blur');
    AppState.currentState = 'background'; emit('change', 'background');
    AppState.currentState = 'active'; emit('change', 'active');
    view.rerender(tree(true)); fireEvent(view.UNSAFE_getByType(Modal), 'show');
    emit('focus'); await completeFrames(); expect(focus).not.toHaveBeenCalled();
    view.rerender(tree(false)); await completeFrames();
    expect(focus).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
    emit('focus'); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
    emit('focus'); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
  });
  test('Picker resume focus before onShow cannot authorize a closing Modal without its real later hosting focus', async () => {
    const view = render(tree(false)); emit('blur'); view.rerender(tree(true)); emit('focus');
    fireEvent(view.UNSAFE_getByType(Modal), 'show'); view.rerender(tree(false));
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    emit('focus'); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
  });
  test('hosting focus after hide still needs the native onShow of this cycle', async () => {
    const view = render(tree(true)); view.rerender(tree(false)); emit('focus');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
  });
  test.each(['hide before active', 'revoked scope', 'reopen', 'unmount'] as const)('%s cannot revive an inactive SAF candidate', async reason => {
    AppState.currentState = 'background';
    const view = render(tree(true)); fireEvent(view.UNSAFE_getByType(Modal), 'show');
    if (reason === 'hide before active') view.rerender(tree(false));
    else if (reason === 'revoked scope') allowed.mockReturnValue(false);
    else if (reason === 'reopen') { view.rerender(tree(false)); view.rerender(tree(true)); }
    else view.unmount();
    AppState.currentState = 'active'; emit('change', 'active'); allowed.mockReturnValue(true);
    if (reason !== 'unmount') view.rerender(tree(false));
    emit('focus'); await completeFrames(); expect(focus).not.toHaveBeenCalled();
  });
  test('StrictMode show/hide keeps the valid current cycle and removes subscribers on unmount', async () => {
    AppState.currentState = 'background';
    const view = render(<React.StrictMode>{tree(true)}</React.StrictMode>);
    fireEvent(view.UNSAFE_getByType(Modal), 'show');
    AppState.currentState = 'active'; emit('change', 'active');
    view.rerender(<React.StrictMode>{tree(false)}</React.StrictMode>); emit('focus'); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
    view.unmount(); emit('focus'); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
    expect([...listeners.values()].every(group => group.size === 0)).toBe(true);
  });
  test('an already shown modal resumes without another onShow and returns to its valid trigger', async () => {
    const view = render(tree(true)); show(view); emit('focus');
    AppState.currentState = 'background'; emit('change', 'background'); emit('change', 'background');
    AppState.currentState = 'active'; emit('change', 'active');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    view.rerender(tree(false)); await completeFrames(); expect(focus).not.toHaveBeenCalled();
    emit('focus'); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(trigger.current);
  });
  test.each(['hidden', 'reopened', 'trigger replacement', 'route/session revoked', 'unmount'] as const)('%s cannot resume a backgrounded modal cycle', async reason => {
    const view = render(tree(true)); show(view);
    AppState.currentState = 'background'; emit('change', 'background');
    if (reason === 'hidden') view.rerender(tree(false));
    else if (reason === 'reopened') { view.rerender(tree(false)); view.rerender(tree(true)); }
    else if (reason === 'trigger replacement') view.rerender(tree(true, 'replacement'));
    else if (reason === 'route/session revoked') allowed.mockReturnValue(false);
    else view.unmount();
    AppState.currentState = 'active'; emit('change', 'active');
    allowed.mockReturnValue(true);
    if (reason !== 'unmount') view.rerender(tree(false));
    emit('focus'); await completeFrames(); expect(focus).not.toHaveBeenCalled();
  });
  test.each(['pending reader', 'queued frame'] as const)('a hidden %s is permanently canceled by backgrounding', async phase => {
    let resolve!: (enabled: boolean) => void;
    if (phase === 'pending reader') jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus');
    await act(async () => { await Promise.resolve(); });
    const lateFrame = [...frames.values()][0];
    AppState.currentState = 'background'; emit('change', 'background');
    AppState.currentState = 'active'; emit('change', 'active');
    if (phase === 'pending reader') await act(async () => { resolve(true); });
    emit('focus'); await completeFrames();
    if (lateFrame) act(() => lateFrame(0));
    expect(focus).not.toHaveBeenCalled();
  });
  test.each(['unmount', 'reopen', 'trigger replacement', 'route/session revoked', 'background', 'new window blur'] as const)('%s cancels or rejects a queued native return', async reason => {
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus');
    await act(async () => { await Promise.resolve(); });
    expect(frames.size).toBe(1);
    const lateFrame = [...frames.values()][0]!;
    if (reason === 'unmount') view.unmount();
    else if (reason === 'reopen') view.rerender(tree(true));
    else if (reason === 'trigger replacement') view.rerender(tree(false, 'replacement'));
    else if (reason === 'route/session revoked') allowed.mockReturnValue(false);
    else if (reason === 'background') { AppState.currentState = 'background'; emit('change', 'background'); }
    else emit('blur');
    await completeFrames(); act(() => lateFrame(0)); emit('focus'); await completeFrames();
    expect(focus).not.toHaveBeenCalled();
  });
  test('a late onShow from an old modal cannot authorize the reopened modal', async () => {
    const view = render(tree(true));
    const oldShow = view.UNSAFE_getByType(Modal).props.onShow;
    show(view); view.rerender(tree(false)); view.rerender(tree(true));
    const currentShow = view.UNSAFE_getByType(Modal).props.onShow;
    act(() => oldShow()); emit('blur'); view.rerender(tree(false)); emit('focus');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    act(() => currentShow()); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
  });
  test('screen-reader snapshot and window focus can resolve in either order', async () => {
    let resolve!: (enabled: boolean) => void;
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    await act(async () => { resolve(true); }); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
  });
  test('a reader enabled after onShow uses the captured native target, never RN event 8', async () => {
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(false);
    const view = render(tree(true)); show(view);
    await completeFrames();
    expect(capture).toHaveBeenCalledWith(4242, expect.any(Number));
    expect(AccessibilityInfo.isScreenReaderEnabled).not.toHaveBeenCalled();
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
    view.rerender(tree(false)); emit('focus'); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(capture.mock.calls[0]![1]);
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  });
  test('native capture may finish after hide and hosting focus without retargeting', async () => {
    let resolve!: (captured: boolean) => void;
    capture.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus');
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    await act(async () => { resolve(true); }); await completeFrames();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledTimes(1);
  });
  test.each(['unmount', 'reopen', 'background', 'scope revoked'] as const)('late capture cannot revive %s', async reason => {
    let resolve!: (captured: boolean) => void;
    capture.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); show(view);
    const ticket = capture.mock.calls[0]![1];
    view.rerender(tree(false)); emit('focus');
    if (reason === 'unmount') view.unmount();
    else if (reason === 'reopen') view.rerender(tree(true));
    else if (reason === 'background') { AppState.currentState = 'background'; emit('change', 'background'); }
    else allowed.mockReturnValue(false);
    await act(async () => { resolve(true); }); await completeFrames();
    expect(focus).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith(ticket);
  });
  test.each([false, 'true', new Error('Synthetic capture failure')] as const)('failed native capture is fail closed: %s', async result => {
    if (result instanceof Error) capture.mockRejectedValueOnce(result);
    else capture.mockResolvedValueOnce(result);
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus');
    await completeFrames();
    expect(focus).not.toHaveBeenCalled();
    expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  test.each(['unmount', 'reopen', 'trigger replacement', 'scope revoked', 'background', 'window blur'] as const)('a dispatched but pending native restore is canceled by %s', async reason => {
    let resolve!: (restored: boolean) => void;
    focus.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus');
    await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
    const ticket = capture.mock.calls[0]![1];
    expect(cancel).not.toHaveBeenCalledWith(ticket);
    if (reason === 'unmount') view.unmount();
    else if (reason === 'reopen') view.rerender(tree(true));
    else if (reason === 'trigger replacement') view.rerender(tree(false, 'replacement'));
    else if (reason === 'scope revoked') { allowed.mockReturnValue(false); view.rerender(tree(false)); }
    else if (reason === 'background') { AppState.currentState = 'background'; emit('change', 'background'); }
    else emit('blur');
    expect(cancel).toHaveBeenCalledWith(ticket);
    await act(async () => { resolve(true); });
    emit('focus'); await completeFrames();
    expect(focus).toHaveBeenCalledTimes(1);
  });
  test('a screen-reader snapshot resolving after unmount cannot queue native focus or leave listeners', async () => {
    let resolve!: (enabled: boolean) => void;
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); show(view); view.rerender(tree(false)); view.unmount(); emit('focus');
    await act(async () => { resolve(true); }); await completeFrames();
    expect(frames.size).toBe(0); expect(focus).not.toHaveBeenCalled();
    expect([...listeners.values()].every(group => group.size === 0)).toBe(true);
  });
  test.each(['disabled', 'rejected'] as const)('%s reader snapshot cannot return focus after the window event', async reason => {
    if (reason === 'disabled') jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValueOnce(false);
    else jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockRejectedValueOnce(new Error('Synthetic reader query failed'));
    const view = render(tree(true)); show(view); view.rerender(tree(false)); emit('focus'); await completeFrames();
    expect(focus).not.toHaveBeenCalled();
  });
});
