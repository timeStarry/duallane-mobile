import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConversationRow } from '../src/ui/chrome';
import { ConnectionBanner, SettingGroup, SettingRow } from '../src/ui/primitives';
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
  expect(view.getByLabelText('筛选已加载的会话')).toBeTruthy();
  fireEvent.press(view.getByRole('tab', { name: '话题' }));
  expect(view.getByText('还没有话题')).toBeTruthy();
  expect(view.queryByLabelText('筛选已加载的会话')).toBeNull();
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
