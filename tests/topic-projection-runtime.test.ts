import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { useWorkspace } from '../src/domain/store';
import { parseMessage, topicSchema } from '../src/domain/contracts';
import { cache, credentials } from '../src/platform/storage';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
jest.mock('../src/platform/config', () => ({ installed: { appVersion: '0.1.0', versionCode: 1 }, config: { apiOrigin: '' }, redirectUri: 'com.timestarry.duallane://oauth', validateOrigin: (value: string) => value }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(() => null), set: jest.fn(), remove: jest.fn(), clearAccount: jest.fn() }, credentials: { read: jest.fn(), save: jest.fn(async () => undefined), clear: jest.fn(async () => undefined) } }));
jest.mock('../src/platform/notifications', () => ({ clearNotifications: jest.fn(async () => undefined), showMessageNotification: jest.fn(async () => undefined) }));
jest.mock('../src/data/transfers', () => ({ clearAccountFiles: jest.fn() }));

const fetchMock = jest.mocked(fetch);
const originalAppState = AppState.currentState;
const session = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00.000Z', refreshTokenExpiresAt: '2099-02-01T00:00:00.000Z' };
const topic = topicSchema.parse({ id: 'topic / one', conversationId: 'g1', title: 'Synthetic', joined: true, status: 'open', allowSyncToGroup: true });
const projection = { id: 'p1', topicMessageId: 'message / one', removedAt: null };
const bootstrap = { auth: { currentUser: { id: 'self', displayName: 'Self' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 4, permissions: { canReadConversations: true }, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, members: [], files: [], conversations: [{ id: 'g1', type: 'group', displayTitle: 'Group', lastActivityAt: '2026-10-06T00:00:00Z', capabilities: { canSendMessage: true } }] };
const policy = { schemaVersion: 1, platform: 'android', channel: 'internal', latest: { appVersion: '0.1.0', versionCode: 1, releaseId: 'r1', releaseNotes: [] }, minimum: { appVersion: '0.1.0', versionCode: 1 }, recommendation: 'none', apkUrl: null, protocol: { eventMajor: 1, contentFormats: ['duallane.message+json;v=1'] } };
function response(body: unknown) { return { ok: true, status: 200, json: async () => body } as Awaited<ReturnType<typeof fetch>>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function topicMessage(extra: Record<string, unknown> = {}) {
  return { id: projection.topicMessageId, topicId: topic.id, conversationId: 'g1', authorId: 'self', authorName: 'Self', kind: 'user', createdAt: '2026-10-06T00:00:00Z', plainText: 'Synthetic', attachments: [], content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'Synthetic' }] }, ...extra };
}
function fallback(url: string) {
  return response(url.endsWith('/release-policy') ? policy : url.endsWith('/refresh') ? session : url.endsWith('/topics/mine') ? { topics: [topic] } : bootstrap);
}
let runtime: Runtime;
beforeEach(async () => {
  AppState.currentState = 'active';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  useWorkspace.getState().reset();
  jest.mocked(credentials.read).mockResolvedValue({ origin: 'https://workspace.example', refreshToken: 'synthetic-refresh', userId: 'self' });
  fetchMock.mockImplementation(async url => fallback(String(url)));
  runtime = new Runtime();
  jest.spyOn(runtime, 'connect').mockImplementation(() => undefined);
  await runtime.start();
  useWorkspace.getState().upsertTopic(topic);
});
afterEach(() => { runtime.dispose(); AppState.currentState = originalAppState; jest.restoreAllMocks(); });

test('projection endpoints encode resource IDs and sync/cancel use explicit POST/DELETE semantics', async () => {
  fetchMock.mockImplementation(async url => response(String(url).includes('/projections?') ? { projections: [projection] } : { projection: String(url).endsWith('/sync') ? projection : null }));
  await expect(runtime.topicProjections(topic.id)).resolves.toEqual([projection]);
  const base = 'https://workspace.example/api/workspace/topics/topic%20%2F%20one';
  expect(fetchMock.mock.calls.some(([url, options]) => String(url) === `${base}/projections?limit=200` && options?.method === 'GET')).toBe(true);
  await expect(runtime.setTopicProjection(topic.id, projection.topicMessageId, true)).resolves.toEqual(projection);
  const posted = fetchMock.mock.calls.find(([url, options]) => String(url) === `${base}/messages/message%20%2F%20one/sync` && options?.method === 'POST');
  expect(posted?.[1]?.body).toBe('{}');
  fetchMock.mockImplementation(async () => response({ projection: null }));
  await expect(runtime.setTopicProjection(topic.id, projection.topicMessageId, false)).resolves.toBeNull();
  const removed = fetchMock.mock.calls.find(([url, options]) => String(url) === `${base}/messages/message%20%2F%20one/sync` && options?.method === 'DELETE');
  expect(removed?.[1]?.body).toBeUndefined();
});

test.each([false, true])('projection responses must match their canonical shape (mutation=%s)', async mutation => {
  fetchMock.mockImplementation(async () => response(mutation ? { projection: { topicMessageId: projection.topicMessageId } } : { projections: [{ id: 'p1' }] }));
  const request = mutation ? runtime.setTopicProjection(topic.id, projection.topicMessageId, true) : runtime.topicProjections(topic.id);
  await expect(request).rejects.toThrow();
});

test('a projection result for a different message is rejected', async () => {
  fetchMock.mockImplementation(async () => response({ projection: { ...projection, topicMessageId: 'foreign' } }));
  await expect(runtime.setTopicProjection(topic.id, projection.topicMessageId, true)).rejects.toThrow('Invalid topic projection');
});

test.each(['logout', 'account', 'permission', 'api'])('a projection mutation cannot return success after %s changes', async change => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const request = runtime.setTopicProjection(topic.id, projection.topicMessageId, true);
  if (change === 'logout') await runtime.logout(false);
  if (change === 'account') useWorkspace.setState({ accountKey: 'test:another' });
  if (change === 'permission') useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  if (change === 'api') runtime.api = null;
  pending.resolve(response({ projection }));
  await expect(request).rejects.toThrow(change === 'api' ? 'Session unavailable' : 'Stale session');
});

test('a projection list response is rejected after topic access is lost', async () => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const request = runtime.topicProjections(topic.id);
  useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  pending.resolve(response({ projections: [projection] }));
  await expect(request).rejects.toThrow('Stale session');
});

test.each([false, true])('topic pin/unpin refreshes its canonical row and preserves older loaded history (remove=%s)', async remove => {
  const pin = { pinnedByUserId: 'self', pinnedAt: '2026-10-06T01:00:00Z', canUnpin: true };
  const source = topicMessage({ pin: remove ? pin : null });
  const older = topicMessage({ id: 'older', createdAt: '2026-10-05T00:00:00Z' });
  useWorkspace.getState().setMessages(`topic:${topic.id}`, [parseMessage(older)!, parseMessage(source)!]);
  const canonical = topicMessage({ pin: remove ? null : pin });
  fetchMock.mockImplementation(async url => response(String(url).includes('/messages?around=') ? { messages: [canonical] } : {}));
  await runtime.pin('g1', projection.topicMessageId, remove);
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]?.map(item => item.id)).toEqual(['older', projection.topicMessageId]);
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]?.at(-1)?.pin).toEqual(remove ? null : pin);
  expect(useWorkspace.getState().messages.g1).toBeUndefined();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/topics/topic%20%2F%20one/messages?around=message%20%2F%20one&limit=1'))).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/conversations/g1'))).toBe(false);
  expect(cache.set).toHaveBeenCalledWith(expect.stringContaining(`:messages:topic:${topic.id}`), expect.any(Array));
});

test('ordinary group pin keeps its conversation refresh path', async () => {
  useWorkspace.getState().setMessages('g1', [parseMessage({ ...topicMessage(), topicId: undefined })!]);
  const pin = { pinnedByUserId: 'self', pinnedAt: '2026-10-06T01:00:00Z', canUnpin: true };
  const canonical = { ...topicMessage({ pin }), topicId: undefined };
  fetchMock.mockImplementation(async url => response(String(url).endsWith('/conversations/g1') ? { conversation: bootstrap.conversations[0] } : String(url).includes('/conversations/g1/messages?') ? { messages: [canonical] } : {}));
  await runtime.pin('g1', projection.topicMessageId);
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/conversations/g1'))).toBe(true);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/conversations/g1/messages?limit=50'))).toBe(true);
  expect(useWorkspace.getState().messages.g1?.[0]?.pin).toEqual(pin);
});

test('parent access revoked during an ordinary pin refresh cannot be resurrected by its old snapshot', async () => {
  useWorkspace.getState().setMessages('g1', [parseMessage({ ...topicMessage(), topicId: undefined })!]);
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  const started = deferred<void>();
  fetchMock.mockImplementation(async url => {
    if (!String(url).endsWith('/conversations/g1')) return response({});
    started.resolve(); return pending.promise;
  });
  const operation = runtime.pin('g1', projection.topicMessageId);
  await started.promise;
  useWorkspace.getState().applyBootstrap({ ...useWorkspace.getState().bootstrap!, conversations: [] }, useWorkspace.getState().accountKey);
  pending.resolve(response({ conversation: bootstrap.conversations[0] }));
  await operation;
  expect(useWorkspace.getState().conversations).toEqual({});
  expect(useWorkspace.getState().messages).toEqual({});
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/conversations/g1/messages?'))).toBe(false);
});

test.each(['recall', 'react', 'pin'])('%s captures the original topic bucket and ignores a late response after leaving', async command => {
  useWorkspace.getState().setMessages(`topic:${topic.id}`, [parseMessage(topicMessage())!]);
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const operation = command === 'recall' ? runtime.recall(projection.topicMessageId) : command === 'react' ? runtime.react(projection.topicMessageId, 'emoji:grinning') : runtime.pin('g1', projection.topicMessageId);
  useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  pending.resolve(response(command === 'recall' ? { message: topicMessage({ recalledAt: '2026-10-06T01:00:00Z' }) } : command === 'react' ? { messageId: projection.topicMessageId, reactions: [{ emoteKey: 'emoji:grinning', count: 1, reactedByCurrentUser: true }] } : {}));
  await operation;
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]).toBeUndefined();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/messages?around='))).toBe(false);
});

test.each(['recall', 'react', 'pin'])('%s ignores a late response after parent group access is revoked', async command => {
  useWorkspace.getState().setMessages(`topic:${topic.id}`, [parseMessage(topicMessage())!]);
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const operation = command === 'recall' ? runtime.recall(projection.topicMessageId) : command === 'react' ? runtime.react(projection.topicMessageId, 'emoji:grinning') : runtime.pin('g1', projection.topicMessageId);
  useWorkspace.getState().applyBootstrap({ ...useWorkspace.getState().bootstrap!, conversations: [] }, useWorkspace.getState().accountKey);
  pending.resolve(response(command === 'recall' ? { message: topicMessage({ recalledAt: '2026-10-06T01:00:00Z' }) } : command === 'react' ? { messageId: projection.topicMessageId, reactions: [] } : {}));
  await operation;
  expect(useWorkspace.getState().messages).toEqual({});
  expect(useWorkspace.getState().topics).toEqual({});
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/messages?around='))).toBe(false);
});

test('leaving during a topic pin canonical refresh prevents that row from being restored', async () => {
  useWorkspace.getState().setMessages(`topic:${topic.id}`, [parseMessage(topicMessage())!]);
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  const started = deferred<void>();
  fetchMock.mockImplementation(async url => {
    if (!String(url).includes('/messages?around=')) return response({});
    started.resolve(); return pending.promise;
  });
  const operation = runtime.pin('g1', projection.topicMessageId);
  await started.promise;
  useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  pending.resolve(response({ messages: [topicMessage({ pin: { pinnedByUserId: 'self', pinnedAt: '2026-10-06T01:00:00Z', canUnpin: true } })] }));
  await operation;
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]).toBeUndefined();
});

test('valid recall and reaction responses update only their captured canonical topic message', async () => {
  useWorkspace.getState().setMessages(`topic:${topic.id}`, [parseMessage(topicMessage())!]);
  const reactions = [{ emoteKey: 'emoji:grinning', count: 1, reactedByCurrentUser: true }];
  fetchMock.mockImplementation(async url => response(String(url).endsWith('/recall') ? { message: topicMessage({ recalledAt: '2026-10-06T01:00:00Z', plainText: 'Recalled', reactions }) } : { messageId: projection.topicMessageId, reactions }));
  await runtime.react(projection.topicMessageId, 'emoji:grinning');
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]?.[0]?.reactions).toEqual(reactions);
  await runtime.recall(projection.topicMessageId);
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]?.[0]?.recalledAt).toBe('2026-10-06T01:00:00Z');
  expect(useWorkspace.getState().messages.g1).toBeUndefined();
});

test.each(['recall', 'react'])('%s rejects a canonical result for a different message', async command => {
  useWorkspace.getState().setMessages(`topic:${topic.id}`, [parseMessage(topicMessage())!]);
  fetchMock.mockImplementation(async () => response(command === 'recall' ? { message: topicMessage({ id: 'foreign', recalledAt: '2026-10-06T01:00:00Z' }) } : { messageId: 'foreign', reactions: [] }));
  const request = command === 'recall' ? runtime.recall(projection.topicMessageId) : runtime.react(projection.topicMessageId, 'emoji:grinning');
  await expect(request).rejects.toThrow('response.invalid');
  expect(useWorkspace.getState().messages[`topic:${topic.id}`]?.[0]?.id).toBe(projection.topicMessageId);
});

test.each([false, true])('a late read response cannot restore revoked parent access (topic=%s)', async isTopic => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const operation = runtime.markRead(isTopic ? topic.id : 'g1', projection.topicMessageId, isTopic);
  expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('/read');
  useWorkspace.getState().applyBootstrap({ ...useWorkspace.getState().bootstrap!, conversations: [] }, useWorkspace.getState().accountKey);
  pending.resolve(response(isTopic ? { read: { topicId: topic.id, lastReadMessageId: projection.topicMessageId, unreadCount: 0 } } : { conversation: { ...bootstrap.conversations[0], lastReadMessageId: projection.topicMessageId, unreadCount: 0 } }));
  await operation;
  expect(useWorkspace.getState().conversations).toEqual({});
  expect(useWorkspace.getState().topics).toEqual({});
});

test.each([false, true])('a read response from the previous account cannot update the new account (topic=%s)', async isTopic => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const operation = runtime.markRead(isTopic ? topic.id : 'g1', projection.topicMessageId, isTopic);
  useWorkspace.setState({ accountKey: 'synthetic:another' });
  pending.resolve(response(isTopic ? { read: { topicId: topic.id, lastReadMessageId: projection.topicMessageId, unreadCount: 0 } } : { conversation: { ...bootstrap.conversations[0], lastReadMessageId: projection.topicMessageId, unreadCount: 0 } }));
  await operation;
  expect(useWorkspace.getState().topics[topic.id]?.lastReadMessageId).toBeUndefined();
  expect(useWorkspace.getState().conversations.g1?.lastReadMessageId).toBeUndefined();
});

test('a read response cannot mark an exited topic', async () => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockImplementation(() => pending.promise);
  const operation = runtime.markRead(topic.id, projection.topicMessageId, true);
  useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  pending.resolve(response({ read: { topicId: topic.id, lastReadMessageId: projection.topicMessageId, unreadCount: 0 } }));
  await operation;
  expect(useWorkspace.getState().topics[topic.id]?.joined).toBe(false);
  expect(useWorkspace.getState().topics[topic.id]?.lastReadMessageId).toBeUndefined();
});

test.each([false, true])('a current read result updates its canonical cursor (topic=%s)', async isTopic => {
  fetchMock.mockImplementation(async () => response(isTopic ? { read: { topicId: topic.id, lastReadMessageId: projection.topicMessageId, unreadCount: 0 } } : { conversation: { ...bootstrap.conversations[0], lastReadMessageId: projection.topicMessageId, unreadCount: 0 } }));
  await runtime.markRead(isTopic ? topic.id : 'g1', projection.topicMessageId, isTopic);
  expect((isTopic ? useWorkspace.getState().topics[topic.id] : useWorkspace.getState().conversations.g1)?.lastReadMessageId).toBe(projection.topicMessageId);
});

test.each([false, true])('a read result for a different resource is rejected (topic=%s)', async isTopic => {
  fetchMock.mockImplementation(async () => response(isTopic ? { read: { topicId: 'foreign', lastReadMessageId: projection.topicMessageId, unreadCount: 0 } } : { conversation: { ...bootstrap.conversations[0], id: 'foreign' } }));
  await expect(runtime.markRead(isTopic ? topic.id : 'g1', projection.topicMessageId, isTopic)).rejects.toThrow('response.invalid');
});
