import { z } from 'zod';
import { Runtime } from '../src/data/runtime';
import type { ApiClient } from '../src/data/client';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn(), clearAccount: jest.fn() }, credentials: { read: jest.fn(), save: jest.fn(), clear: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ clearNotifications: jest.fn(), showMessageNotification: jest.fn() }));

function runtimeWithResponse(response: unknown) {
  const json = jest.fn(async (_path: string, schema: z.ZodTypeAny, _body?: unknown) => schema.parse(response));
  const runtime = new Runtime();
  runtime.api = { json } as unknown as ApiClient;
  return { runtime, json };
}

test('share detail validates the authorized response and never trusts an incomplete body', async () => {
  const { runtime, json } = runtimeWithResponse({ share: {
    id: 'share-1', name: '旅行表情', itemCount: 1, revokedAt: null,
    sharedBy: { id: 'u2', displayName: '分享者' },
    originalCreator: { id: 'u3', displayName: '作者' },
    canSubscribeToSourceChanges: false,
    items: [{ id: 'e1', kind: 'custom', label: '你好', token: '[custom:e1]', src: '/api/workspace/emotes/e1/content' }],
  } });
  const share = await runtime.emoteShare('share-1');
  expect(share.items).toHaveLength(1);
  expect(json.mock.calls[0]?.[0]).toBe('/api/workspace/emote-collection-shares/share-1');

  const broken = runtimeWithResponse({ share: { id: 'share-1', name: 'incomplete' } });
  await expect(broken.runtime.emoteShare('share-1')).rejects.toBeInstanceOf(z.ZodError);
});

test('whole-collection import and message-image favorite send only authorized source identifiers', async () => {
  const imported = runtimeWithResponse({ collection: { id: 'c1', name: '旅行表情', items: [], itemCount: 0 }, items: [] });
  await imported.runtime.importEmoteShare('share/1', true);
  expect(imported.json.mock.calls[0]?.[0]).toBe('/api/workspace/emote-collection-shares/share%2F1/import');
  expect(imported.json.mock.calls[0]?.[2]).toEqual({ asCollection: true, subscribeToSourceChanges: true });

  const favorite = runtimeWithResponse({ emote: { id: 'e1', kind: 'custom', label: '图片', token: '[custom:e1]' } });
  await favorite.runtime.favoriteMessageEmote('m1', 'a1');
  expect(favorite.json.mock.calls[0]?.[0]).toBe('/api/workspace/me/emotes/favorite');
  expect(favorite.json.mock.calls[0]?.[2]).toEqual({ messageId: 'm1', attachmentId: 'a1' });
});
