import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { WorkspaceCard } from '../src/ui/cards';
import { MessageContent } from '../src/ui/MessageContent';
import { useWorkspace } from '../src/domain/store';
import { bootstrapSchema, parseMessage, topicSchema, type WorkspaceEvent } from '../src/domain/contracts';
import { cache, credentials } from '../src/platform/storage';
import { showMessageNotification } from '../src/platform/notifications';
import { ReplayTracker } from '../src/domain/replay';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-id' }));
jest.mock('../src/platform/config', () => ({ installed: { appVersion: '0.2.3', versionCode: 7 }, config: { apiOrigin: '' }, redirectUri: 'com.timestarry.duallane://oauth', validateOrigin: (value: string) => value }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn(), clearAccount: jest.fn() }, credentials: { read: jest.fn(), save: jest.fn(async () => undefined), clear: jest.fn(async () => undefined) } }));
jest.mock('../src/platform/notifications', () => ({ clearNotifications: jest.fn(async () => undefined), showMessageNotification: jest.fn(async () => undefined) }));
jest.mock('../src/data/transfers', () => ({ clearAccountFiles: jest.fn() }));

const fetchMock = jest.mocked(fetch);
const block = { type: 'card' as const, cardId: 'card-1', cardType: 'echo.request', schemaVersion: 1, fallbackText: 'Synthetic request' };
const context = { conversationId: 'c1' };
const account = 'https://workspace.example:u1';
const session = { accessToken: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token', accessTokenExpiresAt: '2099-01-01T00:00:00.000Z', refreshTokenExpiresAt: '2099-02-01T00:00:00.000Z' };
const policy = { schemaVersion: 1, platform: 'android', channel: 'internal', latest: { appVersion: '0.2.3', versionCode: 7, releaseId: 'r1', releaseNotes: [] }, minimum: { appVersion: '0.2.3', versionCode: 7 }, recommendation: 'none', apkUrl: null, protocol: { eventMajor: 1, contentFormats: ['duallane.message+json;v=1'] } };
const initialBootstrap = {
  auth: { currentUser: { id: 'u1', displayName: 'Self' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 4,
  policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, permissions: { canReadConversations: true }, members: [], files: [],
  conversations: [{ id: 'c1', type: 'direct', displayTitle: 'Echo', lastActivityAt: '2026-10-06T00:00:00Z', capabilities: { canSendMessage: true } }],
};
const message = { id: 'm1', conversationId: 'c1', authorId: 'usr_system_echo', authorName: 'Echo', kind: 'bot', createdAt: '2026-10-06T00:00:00Z', plainText: 'Synthetic request', content: { format: 'duallane.message+json;v=1', blocks: [block] }, attachments: [] };
function card(status = 'pending_review', revision = 1) {
  return { block, revision, status: 'active', actions: [status === 'pending_review' ? 'collect' : 'start'], payload: { title: 'Synthetic authorized title', detail: 'Synthetic private detail', scenario: 'Synthetic scenario', expectedResult: 'Synthetic result', status } };
}
function response(body: unknown) { return { ok: true, status: 200, json: async () => body } as Awaited<ReturnType<typeof fetch>>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function event(type: string, cardId = 'card-1', revision = 2): WorkspaceEvent {
  return { version: 1, id: `synthetic-${type}-${revision}`, spaceId: 's1', seq: 5, conversationId: 'c1', type, payload: { cardId, revision } };
}
async function applyEvent(runtime: Runtime, value: WorkspaceEvent) {
  await (runtime as unknown as { applyEvent: (value: WorkspaceEvent, replay: boolean) => Promise<void> }).applyEvent(value, false);
}
const originalAppState = AppState.currentState;
let runtime: Runtime;
let currentCard: ReturnType<typeof card>;
let currentBootstrap: typeof initialBootstrap;
let appStateChanged: (state: AppStateStatus) => void;
const cardCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/cards/card-1'));
beforeEach(async () => {
  AppState.currentState = 'active';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => { appStateChanged = listener; return { remove: jest.fn() }; });
  useWorkspace.getState().reset();
  jest.mocked(cache.get).mockReturnValue(null);
  jest.mocked(credentials.read).mockResolvedValue({ origin: 'https://workspace.example', refreshToken: 'synthetic-refresh-token', userId: 'u1' });
  currentCard = card(); currentBootstrap = initialBootstrap;
  fetchMock.mockImplementation(async url => {
    const path = String(url);
    return response(path.endsWith('/release-policy') ? policy : path.endsWith('/refresh') ? session : path.includes('/cards/') ? { card: currentCard } : path.includes('/messages?') ? { messages: [message] } : path.endsWith('/topics/mine') ? { topics: [] } : currentBootstrap);
  });
  runtime = new Runtime(); jest.spyOn(runtime, 'connect').mockImplementation(() => undefined); await runtime.start();
  useWorkspace.getState().setMessages('c1', [parseMessage(message)!]);
});
afterEach(() => { runtime.dispose(); jest.restoreAllMocks(); AppState.currentState = originalAppState; useWorkspace.getState().reset(); });

test('a card.updated reference reloads the same cardId and replaces pending state/actions without rebuilding messages', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('待处理')).toBeTruthy());
  const oldMessages = useWorkspace.getState().messages.c1;
  const bootstrapRequests = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/bootstrap')).length;
  currentCard = card('planned', 2);
  await act(async () => applyEvent(runtime, event('card.updated')));
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  expect(view.queryByText('待处理')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
  expect(view.getByRole('button', { name: '开始处理' })).toBeTruthy();
  expect(useWorkspace.getState().messages.c1).toBe(oldMessages);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/bootstrap'))).toHaveLength(bootstrapRequests);
  expect(cardCalls()).toHaveLength(2);
});

test('unrelated cards, connection/cursor changes and duplicate old revisions do not reload the card', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('待处理')).toBeTruthy());
  await act(async () => applyEvent(runtime, event('card.updated', 'other-card', 9)));
  act(() => useWorkspace.setState({ cursor: 100, connection: '已连接' }));
  expect(cardCalls()).toHaveLength(1);
  currentCard = card('planned', 2);
  await act(async () => applyEvent(runtime, event('card.updated')));
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  await act(async () => { await applyEvent(runtime, event('card.updated')); await applyEvent(runtime, event('card.created', 'card-1', 1)); });
  expect(cardCalls()).toHaveLength(2);
});

test('an unversioned Go card event with nullable conversation and targetId fallback refreshes without notifying', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('待处理')).toBeTruthy());
  currentCard = card('planned', 2);
  const tracker = new ReplayTracker(4);
  tracker.accept({ version: 1, type: 'ready', currentSeq: 4, replayCount: 0 });
  const accepted = tracker.accept({ version: 1, type: 'event', event: {
    id: 'go-card-reference', spaceId: 's1', seq: 5, type: 'card.updated', conversationId: null,
    actorId: null, targetId: 'card-1', payload: { revision: 2 },
  } });
  expect(accepted.sync).not.toBe(true);
  expect(accepted.event).toBeDefined();
  await act(async () => applyEvent(runtime, accepted.event!));
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  expect(showMessageNotification).not.toHaveBeenCalled();
});

test('card.invalidated reloads even without a higher revision and removes old body/actions', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('Synthetic private detail')).toBeTruthy());
  await act(async () => applyEvent(runtime, event('card.updated', 'card-1', 1)));
  fetchMock.mockResolvedValueOnce(response({ card: { ...card(), status: 'invalidated' } }));
  await act(async () => applyEvent(runtime, event('card.invalidated', 'card-1', 1)));
  await waitFor(() => expect(view.getByText('卡片已失效')).toBeTruthy());
  expect(view.queryByText('Synthetic private detail')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
  expect(useWorkspace.getState().cardRevisions['card-1']).toBe(2);
});

test('background to foreground resume refreshes mounted cards after authorization bootstrap, even at the same event high-water mark', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('待处理')).toBeTruthy());
  currentCard = card('planned', 2);
  act(() => { AppState.currentState = 'background'; appStateChanged('background'); AppState.currentState = 'active'; appStateChanged('active'); });
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  expect(cardCalls()).toHaveLength(2);
  expect(runtime.connect).toHaveBeenCalledTimes(2);
  expect(showMessageNotification).not.toHaveBeenCalled();
});

test('resume revalidation reserves measured card geometry without retaining its body or actions', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('Synthetic private detail')).toBeTruthy());
  const previousLayout = view.getByTestId('workspace-card').props.onLayout;
  fireEvent(view.getByTestId('workspace-card'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 2400 } } });
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  act(() => useWorkspace.getState().refreshCards());
  await waitFor(() => expect(cardCalls()).toHaveLength(2));
  expect(view.getByTestId('workspace-card').props.style.minHeight).toBe(2400);
  expect(view.queryByText('Synthetic private detail')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
  // A queued layout of the previous scope must not replace the reserved height.
  act(() => previousLayout({ nativeEvent: { layout: { width: 320, height: 60 } } }));
  expect(view.getByTestId('workspace-card').props.style.minHeight).toBe(2400);
  await act(async () => pending.resolve(response({ card: card('planned', 2) })));
  expect(view.getByText('已计划')).toBeTruthy();
  expect(view.getByTestId('workspace-card').props.style.minHeight).toBeUndefined();
  // The new measured height is authoritative once the reservation is removed.
  fireEvent(view.getByTestId('workspace-card'), 'layout', { nativeEvent: { layout: { width: 320, height: 900 } } });
  const next = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockReturnValueOnce(next.promise);
  act(() => useWorkspace.getState().refreshCards());
  expect(view.getByTestId('workspace-card').props.style.minHeight).toBe(900);
  await act(async () => next.resolve(response({ card: card('planned', 2) })));
});

test.each(['card.updated', 'card.invalidated'])('an explicit %s revision never reserves the old card geometry', async type => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('Synthetic private detail')).toBeTruthy());
  fireEvent(view.getByTestId('workspace-card'), 'layout', { nativeEvent: { layout: { width: 320, height: 2400 } } });
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  await act(async () => applyEvent(runtime, event(type)));
  expect(view.queryByText('Synthetic private detail')).toBeNull();
  expect(view.getByTestId('workspace-card').props.style.minHeight).toBeUndefined();
  await act(async () => pending.resolve(response({ card: { ...card(), status: 'invalidated' } })));
});

test.each([403, 404, 500])('failed revalidation (%s) releases the placeholder geometry without restoring old content', async status => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('Synthetic private detail')).toBeTruthy());
  fireEvent(view.getByTestId('workspace-card'), 'layout', { nativeEvent: { layout: { width: 320, height: 2400 } } });
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  act(() => useWorkspace.getState().refreshCards());
  expect(view.getByTestId('workspace-card').props.style.minHeight).toBe(2400);
  await act(async () => pending.resolve({ ok: false, status, json: async () => ({ error: { code: 'permission.denied' } }) } as Awaited<ReturnType<typeof fetch>>));
  await waitFor(() => expect(view.getByTestId('workspace-card').props.style.minHeight).toBeUndefined());
  expect(view.queryByText('Synthetic private detail')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
});

test('a changed authoritative snapshot refreshes mounted cards; repeated unchanged HTTP snapshots do not poll card resources', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('待处理')).toBeTruthy());
  currentCard = card('planned', 2); currentBootstrap = { ...initialBootstrap, eventCursor: 10 };
  await act(async () => runtime.bootstrap(true));
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  await act(async () => { await runtime.bootstrap(true); await runtime.bootstrap(true); });
  expect(cardCalls()).toHaveLength(2);
  expect(useWorkspace.getState().cardRevisions).toEqual({});
});

test('an older resolve response cannot overwrite a newer revision of the same card', async () => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>();
  fetchMock.mockReturnValueOnce(pending.promise);
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(cardCalls()).toHaveLength(1));
  currentCard = card('planned', 2);
  await act(async () => applyEvent(runtime, event('card.updated')));
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  await act(async () => pending.resolve(response({ card: card('pending_review', 1) })));
  expect(view.queryByText('待处理')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
});

test.each(['conversation', 'read', 'topic'] as const)('a late resource read cannot restore body after %s access is revoked', async revoke => {
  const topicContext = { ...context, topicId: 't1' };
  if (revoke === 'topic') useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 't1', conversationId: 'c1', title: 'Synthetic topic', joined: true }));
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>(); fetchMock.mockReturnValueOnce(pending.promise);
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={revoke === 'topic' ? topicContext : context} />);
  await waitFor(() => expect(cardCalls()).toHaveLength(1));
  act(() => {
    if (revoke === 'conversation') useWorkspace.setState({ conversations: {} });
    else if (revoke === 'topic') useWorkspace.setState({ topics: {} });
    else useWorkspace.setState({ bootstrap: { ...useWorkspace.getState().bootstrap!, permissions: { ...useWorkspace.getState().bootstrap!.permissions, canReadConversations: false } } });
  });
  await act(async () => pending.resolve(response({ card: card() })));
  expect(view.queryByText('Synthetic private detail')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
  expect(cardCalls()).toHaveLength(1);
});

test('account changes discard old resolved content immediately and late previous-account reads fail', async () => {
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByText('Synthetic private detail')).toBeTruthy());
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>(); fetchMock.mockReturnValueOnce(pending.promise);
  const reading = runtime.resolveCard('card-1', context).catch((error: unknown) => error);
  await act(async () => runtime.logout(false));
  await act(async () => pending.resolve(response({ card: card() })));
  expect(await reading).toMatchObject({ message: 'Stale session' });
  expect(view.queryByText('Synthetic private detail')).toBeNull();
  expect(useWorkspace.getState().cardRevisions).toEqual({});
});

test('runtime resource reads also reject same-session account replacement and foreign card IDs', async () => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>(); fetchMock.mockReturnValueOnce(pending.promise);
  const reading = runtime.resolveCard('card-1', context);
  useWorkspace.setState({ accountKey: 'https://workspace.example:other' });
  pending.resolve(response({ card: card() }));
  await expect(reading).rejects.toThrow('Stale session');
  useWorkspace.setState({ accountKey: account });
  fetchMock.mockResolvedValueOnce(response({ card: { ...card(), block: { ...block, cardId: 'foreign-card' } } }));
  await expect(runtime.resolveCard('card-1', context)).rejects.toMatchObject({ code: 'response.invalid' });
});

test('a delayed resource response is discarded when its API client is replaced within the same account', async () => {
  const pending = deferred<Awaited<ReturnType<typeof fetch>>>(); fetchMock.mockReturnValueOnce(pending.promise);
  const reading = runtime.resolveCard('card-1', context);
  runtime.api = null;
  pending.resolve(response({ card: card() }));
  await expect(reading).rejects.toThrow('Session unavailable');
});

test('a late action acknowledgement after conversation revocation cannot request or restore the card body', async () => {
  const pending = deferred<{ action: object }>();
  jest.spyOn(runtime, 'cardAction').mockReturnValueOnce(pending.promise);
  const view = render(<WorkspaceCard block={block} runtime={runtime} context={context} />);
  await waitFor(() => expect(view.getByRole('button', { name: '转为正式需求' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '转为正式需求' }));
  act(() => useWorkspace.setState({ conversations: {} }));
  await act(async () => pending.resolve({ action: {} }));
  expect(cardCalls()).toHaveLength(1);
  expect(view.queryByText('Synthetic private detail')).toBeNull();
});

test('MessageContent supplies the conversation/topic access boundary to card reads', async () => {
  const resolver = jest.fn().mockResolvedValue(card());
  useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 't1', conversationId: 'c1', title: 'Synthetic topic', joined: true }));
  const topicMessage = parseMessage({ ...message, topicId: 't1' })!;
  const view = render(<MessageContent message={topicMessage} download={jest.fn()} runtime={{ resolveCard: resolver } as unknown as Runtime} />);
  await waitFor(() => expect(view.getByText('待处理')).toBeTruthy());
  expect(resolver).toHaveBeenCalledWith('card-1', { conversationId: 'c1', topicId: 't1' });
});

test('invalid, foreign-space or unreadable card references cannot invalidate a projection', async () => {
  await applyEvent(runtime, { ...event('card.updated'), spaceId: 'foreign-space' });
  await applyEvent(runtime, { ...event('card.updated'), conversationId: 'removed' });
  await applyEvent(runtime, { ...event('card.updated'), payload: { cardId: 'card-1', revision: 'not-an-integer' } });
  expect(useWorkspace.getState().cardRevisions).toEqual({});
});

test('new-account bootstraps clear per-card revisions instead of inheriting another actor projection state', () => {
  useWorkspace.getState().invalidateCard('card-1', 9);
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({ ...initialBootstrap, auth: { currentUser: { id: 'other', displayName: 'Other' } } }), 'https://workspace.example:other');
  expect(useWorkspace.getState().cardRevisions).toEqual({});
});
