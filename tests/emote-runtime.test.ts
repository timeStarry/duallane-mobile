import { z } from 'zod';
import { Runtime } from '../src/data/runtime';
import type { ApiClient } from '../src/data/client';
import { useWorkspace } from '../src/domain/store';
import { rememberEmotes } from '../src/data/media';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.1.0', nativeBuildVersion: '1' } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn(), clearAccount: jest.fn() }, credentials: { read: jest.fn(), save: jest.fn(), clear: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ clearNotifications: jest.fn(), showMessageNotification: jest.fn() }));
jest.mock('../src/data/media', () => ({ rememberEmotes: jest.fn(), setMediaAccount: jest.fn(), setMediaClient: jest.fn(), clearAccountPreviewCache: jest.fn() }));

const runtimes: Runtime[] = [];
beforeEach(() => { useWorkspace.getState().reset(); });
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); useWorkspace.getState().reset(); });

async function runtimeWithResponse(response: unknown) {
  const json = jest.fn(async (_path: string, schema: z.ZodTypeAny, _body?: unknown) => schema.parse(await response));
  const runtime = new Runtime();
  runtimes.push(runtime);
  await runtime.start();
  runtime.api = { json } as unknown as ApiClient;
  return { runtime, json };
}

test('share detail validates the authorized response and never trusts an incomplete body', async () => {
  const { runtime, json } = await runtimeWithResponse({ share: {
    id: 'share-1', name: '旅行表情', itemCount: 1, revokedAt: null,
    sharedBy: { id: 'u2', displayName: '分享者' },
    originalCreator: { id: 'u3', displayName: '作者' },
    canSubscribeToSourceChanges: false,
    items: [{ id: 'e1', kind: 'custom', label: '你好', token: '[custom:e1]', src: '/api/workspace/emotes/e1/content' }],
  } });
  const share = await runtime.emoteShare('share-1');
  expect(share.items).toHaveLength(1);
  expect(json.mock.calls[0]?.[0]).toBe('/api/workspace/emote-collection-shares/share-1');

  const broken = await runtimeWithResponse({ share: { id: 'share-1', name: 'incomplete' } });
  await expect(broken.runtime.emoteShare('share-1')).rejects.toBeInstanceOf(z.ZodError);
});

test('whole-collection import and message-image favorite send only authorized source identifiers', async () => {
  const imported = await runtimeWithResponse({ collection: { id: 'c1', name: '旅行表情', items: [], itemCount: 0 }, items: [] });
  await imported.runtime.importEmoteShare('share/1', true);
  expect(imported.json.mock.calls[0]?.[0]).toBe('/api/workspace/emote-collection-shares/share%2F1/import');
  expect(imported.json.mock.calls[0]?.[2]).toEqual({ asCollection: true, subscribeToSourceChanges: true });

  const favorite = await runtimeWithResponse({ emote: { id: 'e1', kind: 'custom', label: '图片', token: '[custom:e1]' } });
  await favorite.runtime.favoriteMessageEmote('m1', 'a1');
  expect(favorite.json.mock.calls[0]?.[0]).toBe('/api/workspace/me/emotes/favorite');
  expect(favorite.json.mock.calls[0]?.[2]).toEqual({ messageId: 'm1', attachmentId: 'a1' });
});

const emote = { id: '11111111-1111-4111-8111-111111111111', kind: 'custom', label: '合成表情', token: '[custom:11111111-1111-4111-8111-111111111111]', src: '/api/workspace/emotes/11111111-1111-4111-8111-111111111111/content' };
const share = { id: 'share', name: '合成合集', itemCount: 1, sharedBy: { id: 'owner', displayName: '作者' }, originalCreator: { id: 'owner', displayName: '作者' }, items: [emote] };
const cases = [
  { name: 'list', response: { items: [emote] }, invoke: (runtime: Runtime) => runtime.emotes() },
  { name: 'library', response: { emotes: [emote], collections: [], entries: [] }, invoke: (runtime: Runtime) => runtime.emoteLibrary() },
  { name: 'share detail', response: { share }, invoke: (runtime: Runtime) => runtime.emoteShare('share') },
  { name: 'import', response: { collection: { id: 'collection', name: '合成合集', items: [emote] }, items: [emote] }, invoke: (runtime: Runtime) => runtime.importEmoteShare('share') },
  { name: 'favorite', response: { emote }, invoke: (runtime: Runtime) => runtime.favoriteMessageEmote('message', 'attachment') },
];

test.each(cases)('late $name response cannot enter another account or media registry', async ({ response, invoke }) => {
  let finish!: (result: unknown) => void;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  const { runtime } = await runtimeWithResponse(pending);
  useWorkspace.setState({ accountKey: 'previous-account' });
  const request = invoke(runtime);
  useWorkspace.setState({ accountKey: 'replacement-account' });
  finish(response);
  await expect(request).rejects.toThrow('Stale session');
  expect(rememberEmotes).not.toHaveBeenCalled();
});

test.each(cases)('late $name response from a replaced API is ignored even on the same account', async ({ response, invoke }) => {
  let finish!: (result: unknown) => void;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  const { runtime } = await runtimeWithResponse(pending);
  const request = invoke(runtime);
  runtime.api = { json: jest.fn() } as unknown as ApiClient;
  finish(response);
  await expect(request).rejects.toThrow('Stale session');
  expect(rememberEmotes).not.toHaveBeenCalled();
});

test.each(cases)('late $name response cannot commit after runtime disposal', async ({ response, invoke }) => {
  let finish!: (result: unknown) => void;
  const pending = new Promise<unknown>(resolve => { finish = resolve; });
  const { runtime } = await runtimeWithResponse(pending);
  const request = invoke(runtime);
  runtime.dispose();
  finish(response);
  await expect(request).rejects.toThrow('Stale session');
  expect(rememberEmotes).not.toHaveBeenCalled();
});

test('successful same-account emote mutations remember canonical resources', async () => {
  const favorite = await runtimeWithResponse({ emote });
  await favorite.runtime.favoriteMessageEmote('message', 'attachment');
  expect(rememberEmotes).toHaveBeenLastCalledWith([emote]);
  const imported = await runtimeWithResponse(cases[3]!.response);
  await imported.runtime.importEmoteShare('share');
  expect(rememberEmotes).toHaveBeenLastCalledWith([emote]);
});
