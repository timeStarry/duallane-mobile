import { ApiError, type ApiClient } from '../src/data/client';
import { attachmentPreviewUri, canPreviewAttachment, setMediaAccount, setMediaClient } from '../src/data/media';
import { bootstrapSchema, parseMessage, type Attachment } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';

const mockFiles = new Map<string, Uint8Array>();
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system', () => {
  const uri = (base: string | { uri: string }, parts: string[]) => [typeof base === 'string' ? base : base.uri, ...parts].join('/');
  return {
    Paths: { cache: 'file:///cache' },
    Directory: class {
      uri: string;
      constructor(base: string | { uri: string }, ...parts: string[]) { this.uri = uri(base, parts); }
      get exists() { return [...mockFiles.keys()].some(key => key.startsWith(`${this.uri}/`)); }
      create() {}
      delete() { for (const key of mockFiles.keys()) if (key.startsWith(`${this.uri}/`)) mockFiles.delete(key); }
    },
    File: class {
      uri: string;
      constructor(base: string | { uri: string }, ...parts: string[]) { this.uri = uri(base, parts); }
      get exists() { return mockFiles.has(this.uri); }
      get size() { return mockFiles.get(this.uri)?.length ?? 0; }
      create() { mockFiles.set(this.uri, new Uint8Array()); }
      delete() { mockFiles.delete(this.uri); }
      open() { return { writeBytes: (bytes: Uint8Array) => mockFiles.set(this.uri, bytes), close: () => undefined }; }
    },
  };
});
jest.mock('expo-crypto', () => ({ digestStringAsync: async (_algorithm: string, value: string) => value.replace(/\W/g, ''), CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
jest.mock('../src/platform/config', () => ({ installed: { appVersion: '0.1.0', versionCode: 1 } }));
const file: Attachment = { id: 'a1', fileName: 'synthetic.png', mimeType: 'image/png', byteSize: 3, status: 'available', capabilities: { canDownload: true } };
const bootstrap = bootstrapSchema.parse({ auth: { currentUser: { id: 'u1', displayName: 'Member' } }, space: { id: 's1', name: 'Workspace' }, eventCursor: 1, permissions: { canReadConversations: true, canDownload: true }, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, members: [], conversations: [{ id: 'c1', type: 'group', displayTitle: 'Group', lastActivityAt: '2026-01-01T00:00:00Z', notificationLevel: 'all' }], files: [] });
const topic = { id: 't1', conversationId: 'c1', title: 'Topic', status: 'open', joined: true, canJoin: false, allowSyncToGroup: false, participantCount: 2, unreadCount: 0, notificationLevel: 'all' as const, revision: 1 };
const context = { accountKey: 'account-a', conversationId: 'c1', topicId: 't1' };
const message = parseMessage({ id: 'm1', conversationId: 'c1', topicId: 't1', authorId: 'u2', kind: 'user', createdAt: '2026-01-01T00:00:00Z', plainText: 'image', attachments: [file], content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'attachment', attachmentId: 'a1' }] } })!;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function mediaResponse() { return { arrayBuffer: jest.fn(async () => new Uint8Array([1, 2, 3]).buffer), body: { cancel: jest.fn(async () => undefined) } } as unknown as Response; }
let raw: jest.Mock, json: jest.Mock;
beforeEach(() => {
  setMediaClient(null); mockFiles.clear(); useWorkspace.getState().reset();
  useWorkspace.getState().applyBootstrap(bootstrap, 'account-a'); useWorkspace.getState().upsertTopic(topic); useWorkspace.getState().upsertMessage(message);
  raw = jest.fn(async () => mediaResponse()); json = jest.fn();
  setMediaClient({ origin: 'https://workspace.example', raw, json } as unknown as ApiClient); setMediaAccount('account-a');
});
afterEach(() => { setMediaClient(null); useWorkspace.getState().reset(); mockFiles.clear(); });

test('every cached image preview reauthorizes the resource without returning a token URL', async () => {
  const first = await attachmentPreviewUri(file, context);
  const authorization = mediaResponse(); raw.mockResolvedValueOnce(authorization);
  expect(await attachmentPreviewUri(file, context)).toBe(first);
  expect(raw).toHaveBeenCalledTimes(2); expect(raw).toHaveBeenLastCalledWith('/api/workspace/files/a1/preview', { signal:expect.any(AbortSignal) }, true);
  expect(authorization.arrayBuffer).not.toHaveBeenCalled(); expect(authorization.body?.cancel).toHaveBeenCalled();
  expect(first).toMatch(/^file:\/\/\//); expect(first).not.toContain('?');
});

test('network failure refuses cached display but retains the cache and authorized conversation for retry', async () => {
  const first = await attachmentPreviewUri(file, context); raw.mockRejectedValueOnce(new Error('offline'));
  await expect(attachmentPreviewUri(file, context)).rejects.toThrow('offline');
  expect(mockFiles.has(first)).toBe(true); expect(useWorkspace.getState().topics.t1?.joined).toBe(true); expect(json).not.toHaveBeenCalled();
  expect(await attachmentPreviewUri(file, context)).toBe(first);
});

test.each([403,404])('a current server access denial removes cached preview bytes (status %s)', async status => {
  await attachmentPreviewUri(file, context); raw.mockRejectedValueOnce(new ApiError(status === 403 ? 'permission.denied' : 'file.not_found', status));
  await expect(attachmentPreviewUri(file, context)).rejects.toBeInstanceOf(ApiError);
  expect(mockFiles.size).toBe(0); expect(json).not.toHaveBeenCalled();
});

test('leaving the topic clears cached bytes and refuses a static file route before issuing another request', async () => {
  await attachmentPreviewUri(file, context); useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  expect(mockFiles.size).toBe(0); expect(canPreviewAttachment(file, context)).toBe(false);
  await expect(attachmentPreviewUri(file, context)).rejects.toThrow('permission.denied'); expect(raw).toHaveBeenCalledTimes(1);
});

test('parent group membership loss clears its topic previews and refuses stale route metadata', async () => {
  await attachmentPreviewUri(file, context); useWorkspace.getState().applyBootstrap({ ...bootstrap, conversations: [] }, 'account-a');
  expect(mockFiles.size).toBe(0); expect(canPreviewAttachment(file, context)).toBe(false);
  await expect(attachmentPreviewUri(file, context)).rejects.toThrow('permission.denied');
});

test('revoked download permission clears previews without granting access from a stale attachment capability', async () => {
  await attachmentPreviewUri(file, context); useWorkspace.getState().applyBootstrap({ ...bootstrap, permissions: { ...bootstrap.permissions, canDownload: false } }, 'account-a');
  expect(mockFiles.size).toBe(0); expect(canPreviewAttachment(file, context)).toBe(false);
});

test.each(['hidden','recalled','deleted','restricted'])('a static preview source cannot survive a %s message or attachment', async loss => {
  const source = { ...context, messageId: message.id };
  expect(canPreviewAttachment(file, source)).toBe(true);
  useWorkspace.getState().patchMessage('topic:t1', message.id, loss === 'hidden' ? { hiddenByCurrentUser: true } : loss === 'recalled' ? { recalledAt: '2026-01-02T00:00:00Z' } : loss === 'deleted' ? { deletedAt: '2026-01-02T00:00:00Z' } : { attachments: [{ ...file, capabilities: { canDownload: false } }] });
  expect(canPreviewAttachment(file, source)).toBe(false);
});

test('evicting an authorized history source from the latest page keeps preview usable with server authorization', async () => {
  const source = { ...context, messageId: message.id };
  const first = await attachmentPreviewUri(file, source);
  useWorkspace.getState().setMessages('topic:t1', []);
  expect(canPreviewAttachment(file, source)).toBe(true);
  expect(await attachmentPreviewUri(file, source)).toBe(first);
  expect(raw).toHaveBeenCalledTimes(2);
  raw.mockRejectedValueOnce(new ApiError('file.not_found', 404));
  await expect(attachmentPreviewUri(file, source)).rejects.toBeInstanceOf(ApiError);
  expect(mockFiles.size).toBe(0);
});

test('current file library restrictions override stale route download capability', () => {
  useWorkspace.setState({ files: [{ ...file, capabilities: { canDownload: false } }] });
  expect(canPreviewAttachment(file, context)).toBe(false);
});

test('a different account cannot preview a previous account route even if both can read the group', async () => {
  await attachmentPreviewUri(file, context); useWorkspace.getState().applyBootstrap(bootstrap, 'account-b'); setMediaAccount('account-b'); useWorkspace.getState().upsertTopic(topic);
  expect(mockFiles.size).toBe(0); expect(canPreviewAttachment(file, context)).toBe(false);
  await expect(attachmentPreviewUri(file, context)).rejects.toThrow('permission.denied');
});

test.each(['logout','account','topic','group'])('late image bytes cannot recreate a cache after %s access invalidation', async loss => {
  const bytes = deferred<ArrayBuffer>(), started = deferred<void>();
  raw.mockResolvedValueOnce({ arrayBuffer: () => { started.resolve(); return bytes.promise; } });
  const loading = attachmentPreviewUri(file, context); await started.promise;
  if (loss === 'logout') { useWorkspace.getState().reset(); setMediaAccount(''); setMediaClient(null); }
  else if (loss === 'account') { useWorkspace.getState().applyBootstrap(bootstrap, 'account-b'); setMediaAccount('account-b'); }
  else if (loss === 'topic') useWorkspace.getState().upsertTopic({ ...topic, joined: false });
  else useWorkspace.getState().applyBootstrap({ ...bootstrap, conversations: [] }, 'account-a');
  bytes.resolve(new Uint8Array([1,2,3]).buffer);
  await expect(loading).rejects.toThrow('Stale media session'); expect(mockFiles.size).toBe(0);
});

test('download compatibility fallback still clears cached bytes when reservation authorization is revoked', async () => {
  await attachmentPreviewUri(file, context); raw.mockRejectedValueOnce(new ApiError('request.failed',405)); json.mockRejectedValueOnce(new ApiError('permission.denied',403));
  await expect(attachmentPreviewUri(file, context)).rejects.toThrow('permission.denied'); expect(mockFiles.size).toBe(0);
});
