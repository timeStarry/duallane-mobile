import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/ui/theme';
import { Composer } from '../src/ui/composer';
import { AccountNavigator, ChatPreferencesScreen, ProfileScreen } from '../src/features/account/screens';
import { Runtime } from '../src/data/runtime';
import { useWorkspace } from '../src/domain/store';
import type { ChatSettings } from '../src/domain/contracts';

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
const Stack = createNativeStackNavigator();
const settings: ChatSettings = {
  clickImageEmoteToSend: false,
  replyAutoMention: false,
  autoHideMessages: false,
  autoHideMessageTypes: ['image', 'emote', 'long'],
};

function wrap(children: React.ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider mode="light">{children}</ThemeProvider>
    </SafeAreaProvider>
  );
}

function seed() {
  useWorkspace.getState().applyBootstrap({
    auth: { currentUser: { id: 'u1', displayName: 'Test', kind: 'human', nickname: '旧名', searchDiscoverable: true, capabilities: { canStartDirectConversation: false } } },
    space: { id: 's1', name: 'Space' },
    eventCursor: 0,
    policy: { dailyQuotaBytes: 10, remainingQuotaBytes: 10, messageRetentionCount: 10 },
    permissions: { canReadConversations: true, canCreateDirect: false, canCreateGroup: false, canUpload: false, canDownload: false },
    members: [],
    conversations: [],
    files: [],
  }, 'origin:u1');
}

afterEach(() => {
  useWorkspace.getState().reset();
});

test('account home includes chat preferences and still omits device sessions', () => {
  const runtime = new Runtime();
  runtime.resume = jest.fn();
  runtime.logout = jest.fn();
  const view = render(wrap(
    <NavigationContainer>
      <AccountNavigator runtime={runtime} mode="light" setMode={jest.fn()} />
    </NavigationContainer>,
  ));
  expect(view.getByText('聊天偏好')).toBeTruthy();
  expect(view.getByText('账号')).toBeTruthy();
  expect(view.getByText('偏好')).toBeTruthy();
  expect(view.queryByText('设备会话')).toBeNull();
  fireEvent.press(view.getByText('外观与阅读'));
  expect(view.getByText('减少动态跟随系统可访问设置。本页没有单独开关，也不会同步到其他设备。')).toBeTruthy();
});

test('profile save sends nickname and keeps the input after a failure', async () => {
  seed();
  const runtime = new Runtime();
  runtime.updateProfile = jest.fn().mockRejectedValue(new Error('fail'));
  const view = render(wrap(
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Profile">{() => <ProfileScreen runtime={runtime} />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
  ));
  fireEvent.changeText(view.getByLabelText('显示名'), '新名字');
  fireEvent.press(view.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(runtime.updateProfile).toHaveBeenCalledWith({ nickname: '新名字', searchDiscoverable: true }));
  expect(view.getByLabelText('显示名').props.value).toBe('新名字');
});

test('chat preference autosave ignores a stale slower response', async () => {
  const runtime = new Runtime();
  let finishFirst: (value: ChatSettings) => void = () => undefined;
  runtime.chatSettings = jest.fn().mockResolvedValue({ settings });
  runtime.saveChatSettings = jest.fn()
    .mockImplementationOnce(() => new Promise<ChatSettings>(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce({ ...settings, clickImageEmoteToSend: true, replyAutoMention: true });
  const view = render(wrap(<ChatPreferencesScreen runtime={runtime} />));
  await waitFor(() => expect(view.getByLabelText('点击图片表情直接发送')).toBeTruthy());
  fireEvent(view.getByLabelText('点击图片表情直接发送'), 'valueChange', true);
  fireEvent(view.getByLabelText('回复时自动提及原作者'), 'valueChange', true);
  await waitFor(() => expect(runtime.saveChatSettings).toHaveBeenCalledTimes(2));
  finishFirst({ ...settings, clickImageEmoteToSend: true, replyAutoMention: false });
  await waitFor(() => expect(view.getByLabelText('回复时自动提及原作者').props.value).toBe(true));
});

test('composer keeps send reachable and does not send on IME confirm', () => {
  const onSend = jest.fn();
  const view = render(wrap(<Composer value="hello" onChangeText={jest.fn()} onSend={onSend} onAttach={jest.fn()} />));
  fireEvent(view.getByLabelText('消息'), 'submitEditing');
  expect(onSend).not.toHaveBeenCalled();
  expect(view.getByLabelText('发送')).toBeTruthy();
  expect(view.getByLabelText('添加文件')).toBeTruthy();
  fireEvent.press(view.getByLabelText('发送'));
  expect(onSend).toHaveBeenCalledTimes(1);
});
