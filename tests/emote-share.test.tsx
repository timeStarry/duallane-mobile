import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Modal, StyleSheet } from 'react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';
import { ApiError, type ApiClient } from '../src/data/client';
import type { Runtime } from '../src/data/runtime';
import { EmoteCollectionShare } from '../src/ui/EmoteCollectionShare';
import { useWorkspace } from '../src/domain/store';
import { WindowMetricsProvider } from '../src/ui/WindowSafeArea';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' } }));
jest.mock('../src/ui/RemoteImage', () => ({ RemoteImage: () => null }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
const share = {
  id: 'share-1', name: '旅行表情', itemCount: 1, revokedAt: null,
  sharedBy: { id: 'u2', displayName: '分享者' },
  originalCreator: { id: 'u3', displayName: '作者' },
  canSubscribeToSourceChanges: true,
  items: [{ id: 'e1', kind: 'custom', label: '你好', token: '[custom:e1]', src: '/api/workspace/emotes/e1/content' }],
};
const renderShare = (runtime: Runtime, revokedAt: string | null = null) => render(
  <SafeAreaProvider initialMetrics={metrics}>
    <EmoteCollectionShare shareId="share-1" summary={{ name: '旅行表情', itemCount: 1, revokedAt }} runtime={runtime} />
  </SafeAreaProvider>,
);

afterEach(() => useWorkspace.getState().reset());

test('opens an authorized share, offers subscription, and blocks duplicate imports', async () => {
  let finish!: (value: { collection: null; items: [] }) => void;
  const pending = new Promise<{ collection: null; items: [] }>(resolve => { finish = resolve; });
  const runtime = {
    emoteShare: jest.fn().mockResolvedValue(share),
    importEmoteShare: jest.fn().mockReturnValue(pending),
  } as unknown as Runtime;
  const view = renderShare(runtime);
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 旅行表情' }));
  await waitFor(() => expect(view.getByText('1 张 · 作者 创建 · 分享者 分享')).toBeTruthy());
  fireEvent(view.getByLabelText('订阅原作者更新'), 'valueChange', true);
  fireEvent.press(view.getByRole('button', { name: '添加整套' }));
  expect(view.getByRole('button', { name: '正在添加…' })).toBeDisabled();
  expect(runtime.importEmoteShare).toHaveBeenCalledTimes(1);
  expect(runtime.importEmoteShare).toHaveBeenCalledWith('share-1', true);
  finish({ collection: null, items: [] });
  await waitFor(() => expect(view.getByText('已添加到我的表情')).toBeTruthy());
  expect(view.getByRole('button', { name: '已添加' })).toBeDisabled();
});

test('revoked summary cannot request or import a share', () => {
  const runtime = { emoteShare: jest.fn(), importEmoteShare: jest.fn() } as unknown as Runtime;
  const view = renderShare(runtime, '2026-01-01T00:00:00Z');
  expect(view.getByRole('button', { name: '表情合集已停止分享' })).toBeDisabled();
  expect(runtime.emoteShare).not.toHaveBeenCalled();
});

test('permission rejection shows a safe message and never exposes an import action', async () => {
  const runtime = {
    emoteShare: jest.fn().mockRejectedValue(new ApiError('permission.denied', 403)),
    importEmoteShare: jest.fn(),
  } as unknown as Runtime;
  const view = renderShare(runtime);
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 旅行表情' }));
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  expect(view.queryByRole('button', { name: '添加整套' })).toBeNull();
});

test.each(['account', 'share', 'runtime', 'api'] as const)('a late import after changing %s cannot mark or unlock the next collection', async change => {
  useWorkspace.setState({ accountKey: 'synthetic-account-a' });
  let completeOld!: () => void;
  let completeNew!: () => void;
  const oldPending = new Promise<void>(resolve => { completeOld = resolve; });
  const newPending = new Promise<void>(resolve => { completeNew = resolve; });
  const importEmoteShare = jest.fn().mockReturnValueOnce(oldPending).mockReturnValue(newPending);
  const emoteShare = jest.fn().mockImplementation((id: string) => Promise.resolve({ ...share, id }));
  const runtime = { api: {} as ApiClient, emoteShare, importEmoteShare } as unknown as Runtime;
  const element = (currentRuntime: Runtime, id: string) => <SafeAreaProvider initialMetrics={metrics}><EmoteCollectionShare shareId={id} summary={{ name: '合成合集', itemCount: 1 }} runtime={currentRuntime} /></SafeAreaProvider>;
  const view = render(element(runtime, share.id));
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 合成合集' }));
  await waitFor(() => expect(view.getByRole('button', { name: '添加整套' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '添加整套' }));
  expect(importEmoteShare).toHaveBeenCalledTimes(1);
  let nextRuntime = runtime;
  let nextShareId = share.id;
  if (change === 'account') await act(async () => useWorkspace.setState({ accountKey: 'synthetic-account-b' }));
  if (change === 'share') nextShareId = 'share-2';
  if (change === 'runtime') nextRuntime = { api: {} as ApiClient, emoteShare, importEmoteShare } as unknown as Runtime;
  if (change === 'api') runtime.api = {} as ApiClient;
  view.rerender(element(nextRuntime, nextShareId));
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 合成合集' }));
  await waitFor(() => expect(view.getByRole('button', { name: '添加整套' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '添加整套' }));
  expect(importEmoteShare).toHaveBeenCalledTimes(2);
  expect(importEmoteShare).toHaveBeenLastCalledWith(nextShareId, false);
  await act(async () => completeOld());
  expect(view.queryByText('已添加到我的表情')).toBeNull();
  expect(view.getByRole('button', { name: '正在添加…' })).toBeDisabled();
  fireEvent.press(view.getByRole('button', { name: '正在添加…' }));
  expect(importEmoteShare).toHaveBeenCalledTimes(2);
  await act(async () => completeNew());
  expect(view.getByText('已添加到我的表情')).toBeTruthy();
  expect(view.getByRole('button', { name: '已添加' })).toBeDisabled();
});

test('a stale import rejection does not appear in a newly opened collection', async () => {
  let rejectOld!: (error: unknown) => void;
  const pending = new Promise<void>((_resolve, reject) => { rejectOld = reject; });
  const runtime = {
    emoteShare: jest.fn().mockImplementation((id: string) => Promise.resolve({ ...share, id })),
    importEmoteShare: jest.fn().mockReturnValue(pending),
  } as unknown as Runtime;
  const element = (id: string) => <SafeAreaProvider initialMetrics={metrics}><EmoteCollectionShare shareId={id} summary={{ name: '合成合集', itemCount: 1 }} runtime={runtime} /></SafeAreaProvider>;
  const view = render(element(share.id));
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 合成合集' }));
  await waitFor(() => expect(view.getByRole('button', { name: '添加整套' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '添加整套' }));
  view.rerender(element('share-2'));
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 合成合集' }));
  await waitFor(() => expect(view.getByRole('button', { name: '添加整套' })).toBeTruthy());
  await act(async () => rejectOld(new ApiError('permission.denied', 403)));
  expect(view.queryByText('你当前不能执行此操作')).toBeNull();
  expect(view.getByRole('button', { name: '添加整套' })).toBeEnabled();
});

test('an API replacement also invalidates an authorized read before any rerender', async () => {
  let completeRead!: (value: typeof share) => void;
  const pending = new Promise<typeof share>(resolve => { completeRead = resolve; });
  const runtime = { api: {} as ApiClient, emoteShare: jest.fn().mockReturnValue(pending), importEmoteShare: jest.fn() } as unknown as Runtime;
  const view = renderShare(runtime);
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 旅行表情' }));
  runtime.api = {} as ApiClient;
  await act(async () => completeRead(share));
  expect(view.queryByRole('button', { name: '添加整套' })).toBeNull();
  expect(view.queryByText('1 张 · 作者 创建 · 分享者 分享')).toBeNull();
});

test.each([
  { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 32, left: 0, right: 0, bottom: 24 } },
  { frame: { x: 0, y: 0, width: 844, height: 390 }, insets: { top: 0, left: 32, right: 24, bottom: 16 } },
] satisfies Metrics[])('full-screen collection controls use one window safe area when navigation has a shortened frame: $frame.width×$frame.height', async fullWindow => {
  const shiftedNavigation: Metrics = { frame: { ...fullWindow.frame, y: 80, height: fullWindow.frame.height - 80 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
  const runtime = { emoteShare: jest.fn().mockResolvedValue(share), importEmoteShare: jest.fn() } as unknown as Runtime;
  const view = render(
    <SafeAreaProvider initialMetrics={fullWindow}>
      <WindowMetricsProvider>
        <SafeAreaProvider initialMetrics={shiftedNavigation}>
          <EmoteCollectionShare shareId={share.id} summary={{ name: share.name, itemCount: share.itemCount }} runtime={runtime} />
        </SafeAreaProvider>
      </WindowMetricsProvider>
    </SafeAreaProvider>,
  );
  fireEvent.press(view.getByRole('button', { name: '打开表情合集 旅行表情' }));
  await waitFor(() => expect(view.getByRole('button', { name: '添加整套' })).toBeTruthy());
  const modal = view.UNSAFE_getByType(Modal);
  expect(modal.props.statusBarTranslucent).toBe(true);
  expect(modal.props.navigationBarTranslucent).toBe(true);
  expect(StyleSheet.flatten(view.getByTestId('emote-share-window').props.style)).toMatchObject({
    paddingTop: fullWindow.insets.top, paddingBottom: fullWindow.insets.bottom,
    paddingLeft: fullWindow.insets.left, paddingRight: fullWindow.insets.right,
  });
  const close = view.getByRole('button', { name: '关闭表情合集预览' });
  const closeStyle = StyleSheet.flatten(close.props.style);
  expect(closeStyle.minWidth).toBeGreaterThanOrEqual(48);
  expect(closeStyle.minHeight).toBeGreaterThanOrEqual(48);
  fireEvent.press(close);
  expect(view.queryByRole('button', { name: '关闭表情合集预览' })).toBeNull();
  expect(runtime.importEmoteShare).not.toHaveBeenCalled();
});
