import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { AccessibilityInfo, AppState, Modal, ScrollView, View } from 'react-native';
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

test('the chat home uses a loaded-list filter and an honest topic placeholder', () => {
  const runtime = new Runtime();
  runtime.listTopics = jest.fn().mockResolvedValue([]);
  const view = render(wrap(<ConversationsScreen runtime={runtime} open={jest.fn()} openTopic={jest.fn()} />));
  fireEvent.press(view.getByLabelText('搜索'));
  expect(view.getByLabelText('筛选已加载的会话')).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: '话题' }));
  expect(view.getByText('还没有话题')).toBeTruthy();
  expect(view.getByLabelText('筛选已加载的话题')).toBeTruthy();
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

describe('dialog return focus after a committed close', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  let focus: jest.SpyInstance;
  let handle: jest.SpyInstance;
  let originalState: typeof AppState.currentState;
  const trigger = React.createRef<View>();
  const allowed = jest.fn(() => true);
  function tree(visible: boolean) {
    return wrap(<>
      <Button ref={trigger} title="Open synthetic dialog" onPress={() => undefined} />
      <Dialog visible={visible} title="Synthetic focus" returnFocusRef={trigger} canReturnFocus={allowed}
        onRequestClose={() => undefined} actions={[]}><Label>Content</Label></Dialog>
    </>);
  }
  async function completeFrames() {
    await act(async () => { await Promise.resolve(); });
    act(() => {
      for (const [id, callback] of [...frames]) { frames.delete(id); callback(0); }
    });
  }
  beforeEach(() => {
    frames.clear(); frameId = 0; allowed.mockReset().mockReturnValue(true);
    originalState = AppState.currentState; AppState.currentState = 'active';
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId; });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
    handle = jest.spyOn(jest.requireActual<typeof import('react-native')>('react-native'), 'findNodeHandle').mockReturnValue(4242);
  });
  afterEach(() => { AppState.currentState = originalState; jest.restoreAllMocks(); });
  test('only a visible-to-hidden transition returns focus once to the native trigger', async () => {
    const view = render(tree(false));
    await completeFrames(); expect(focus).not.toHaveBeenCalled();
    view.rerender(tree(true)); await completeFrames(); expect(focus).not.toHaveBeenCalled();
    view.rerender(tree(false)); expect(focus).not.toHaveBeenCalled();
    await completeFrames();
    expect(trigger.current).not.toBeNull();
    expect(handle).toHaveBeenCalledWith(trigger.current);
    expect(focus).toHaveBeenCalledTimes(1); expect(focus).toHaveBeenCalledWith(4242);
    view.rerender(tree(false)); await completeFrames(); expect(focus).toHaveBeenCalledTimes(1);
  });
  test.each(['unmount', 'reopen', 'route/session revoked', 'background'] as const)('%s cancels or rejects late focus', async reason => {
    const view = render(tree(true));
    view.rerender(tree(false));
    await act(async () => { await Promise.resolve(); });
    expect(frames.size).toBe(1);
    const lateFrame = [...frames.values()][0]!;
    if (reason === 'unmount') view.unmount();
    else if (reason === 'reopen') view.rerender(tree(true));
    else if (reason === 'route/session revoked') allowed.mockReturnValue(false);
    const previousState = AppState.currentState;
    if (reason === 'background') AppState.currentState = 'background';
    try {
      await completeFrames();
      act(() => lateFrame(0));
      expect(focus).not.toHaveBeenCalled();
      if (reason === 'unmount' || reason === 'reopen') expect(global.cancelAnimationFrame).toHaveBeenCalled();
    }
    finally { AppState.currentState = previousState; }
  });
  test('a screen-reader snapshot resolving after unmount cannot queue native focus', async () => {
    let resolve!: (enabled: boolean) => void;
    jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
    const view = render(tree(true)); view.rerender(tree(false)); view.unmount();
    await act(async () => { resolve(true); });
    await completeFrames();
    expect(frames.size).toBe(0); expect(focus).not.toHaveBeenCalled();
  });
});
