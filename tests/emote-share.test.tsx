import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../src/data/client';
import type { Runtime } from '../src/data/runtime';
import { EmoteCollectionShare } from '../src/ui/EmoteCollectionShare';

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
