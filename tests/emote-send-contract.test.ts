import { AppState } from 'react-native';
import { fetch } from 'expo/fetch';
import { Runtime } from '../src/data/runtime';
import { editDraftText, insertDraftEmote, insertDraftMention } from '../src/domain/compose';
import { type Block, memberSchema } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { cache, credentials } from '../src/platform/storage';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-message-id', digestStringAsync: async () => 'synthetic-digest', CryptoDigestAlgorithm: { SHA256: 'SHA256' }, CryptoEncoding: { BASE64: 'base64' } }));
jest.mock('../src/platform/config', () => ({ installed: { appVersion: '0.1.0', versionCode: 1 }, config: { apiOrigin: '' }, redirectUri: 'com.timestarry.duallane://oauth', validateOrigin: (origin: string) => origin }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn(), clearAccount: jest.fn() }, credentials: { read: jest.fn(), save: jest.fn(async () => undefined), clear: jest.fn(async () => undefined) } }));
jest.mock('../src/platform/notifications', () => ({ clearNotifications: jest.fn(async () => undefined), showMessageNotification: jest.fn(async () => undefined) }));
jest.mock('../src/data/transfers', () => ({ clearAccountFiles: jest.fn() }));

const fetchMock = jest.mocked(fetch);
const customId = '11111111-1111-4111-8111-111111111111';
const token = `[custom:${customId}]`;
const item = { id: customId, kind: 'custom' };
// Matches Web's workspaceComposerDocumentToContentBlocks and the Go custom-emote validator.
const customBlock: Block = { type: 'emoji', shortcode: `custom:${customId}` };
const member = memberSchema.parse({ id: 'peer', displayName: '同行' });
const conversation = { id: 'conversation', displayTitle: '合成会话', type: 'group', lastActivityAt: '2026-01-01T00:00:00Z', members: [member], notificationLevel: 'all', capabilities: { canSendMessage: true, canUploadFile: true } };
const bootstrap = { auth: { currentUser: { id: 'owner', displayName: '发送者' } }, space: { id: 'space', name: '合成空间' }, eventCursor: 0, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, permissions: { canReadConversations: true }, members: [member], conversations: [conversation], files: [] };
const session = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', accessTokenExpiresAt: '2099-01-01T00:00:00.000Z', refreshTokenExpiresAt: '2099-02-01T00:00:00.000Z' };
const policy = { schemaVersion: 1, platform: 'android', channel: 'internal', latest: { appVersion: '0.1.0', versionCode: 1, releaseId: 'r1', releaseNotes: [] }, minimum: { appVersion: '0.1.0', versionCode: 1 }, recommendation: 'none', apkUrl: null, protocol: { eventMajor: 1, contentFormats: ['duallane.message+json;v=1'] } };

type CreateBody = { clientMessageId: string; content: { format: string; blocks: Block[] }; replyToMessageId: string | null; conversationId?: string; syncToGroup?: boolean };
function response(body: unknown) { return { ok: true, status: 200, json: async () => body } as Awaited<ReturnType<typeof fetch>>; }
function postedBodies() {
  return fetchMock.mock.calls.filter(([url]) => /\/messages$/.test(String(url))).map(([url, options]) => ({
    path: new URL(String(url)).pathname,
    body: JSON.parse(String(options?.body)) as CreateBody,
  }));
}
function serveSend() {
  fetchMock.mockImplementation(async (url, options) => {
    const body = JSON.parse(String(options?.body)) as CreateBody;
    return response({ message: {
      id: 'canonical-message', clientMessageId: body.clientMessageId, conversationId: conversation.id,
      ...(String(url).includes('/topics/') ? { topicId: 'topic' } : {}),
      authorId: 'owner', authorName: '发送者', kind: 'user', createdAt: '2026-01-01T00:00:00Z',
      plainText: '[表情]', replyToMessageId: body.replyToMessageId, content: body.content,
    } });
  });
}

let runtime: Runtime;
beforeEach(async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  useWorkspace.getState().reset();
  jest.mocked(cache.get).mockReturnValue(null);
  jest.mocked(credentials.read).mockResolvedValue({ origin: 'https://workspace.example', refreshToken: 'synthetic-refresh', userId: 'owner' });
  fetchMock.mockImplementation(async url => response(String(url).endsWith('/release-policy') ? policy : String(url).endsWith('/refresh') ? session : bootstrap));
  runtime = new Runtime();
  jest.spyOn(runtime, 'connect').mockImplementation(() => undefined);
  jest.spyOn(runtime, 'listTopics').mockResolvedValue([]);
  await runtime.start();
  useWorkspace.getState().upsertTopic({ id: 'topic', conversationId: conversation.id, title: '合成话题', status: 'open', joined: true, canJoin: false, allowSyncToGroup: true, participantCount: 2, unreadCount: 0, notificationLevel: 'all', revision: 1 });
  fetchMock.mockClear();
  serveSend();
});
afterEach(() => { runtime.dispose(); jest.restoreAllMocks(); });

test.each([false, true])('draft sends emit the canonical custom block and retain quote/mention identity (topic=%s)', async topic => {
  const bucket = topic ? 'topic:topic' : conversation.id;
  const selected = insertDraftEmote({ text: '前', mentionIds: [] }, item, token);
  const draft = { ...insertDraftMention(editDraftText(selected, `${selected.text}后 @同`), member), replyToMessageId: 'quoted-message' };
  runtime.patchDraft(bucket, draft);
  await runtime.send(conversation.id, draft.text, undefined, undefined, { topicId: topic ? 'topic' : undefined, syncToGroup: topic, replyToMessageId: draft.replyToMessageId, mentionIds: draft.mentionIds, mentionSpans: draft.mentionSpans, emoteSpans: draft.emoteSpans });
  expect(postedBodies()).toEqual([{ path: topic ? '/api/workspace/topics/topic/messages' : '/api/workspace/messages', body: {
    clientMessageId: 'synthetic-message-id', replyToMessageId: 'quoted-message',
    ...(topic ? { syncToGroup: true } : { conversationId: conversation.id }),
    content: { format: 'duallane.message+json;v=1', blocks: [
      { type: 'text', text: '前' }, customBlock, { type: 'text', text: '后 ' },
      { type: 'mention', userId: member.id, label: member.displayName }, { type: 'text', text: ' ' },
    ] },
  } }]);
  expect(useWorkspace.getState().messages[bucket]?.[0]?.blocks).toContainEqual(customBlock);
  expect(useWorkspace.getState().drafts[bucket]?.text).toBe('');
  expect(useWorkspace.getState().drafts[bucket]?.emoteSpans).toEqual([]);
});

test.each([false, true])('direct sends use the same custom reference and preserve the complete draft (topic=%s)', async topic => {
  const bucket = topic ? 'topic:topic' : conversation.id;
  const draft = { ...insertDraftEmote(insertDraftMention({ text: '未发送 @同', mentionIds: [] }, member), item, token), replyToMessageId: 'draft-quote', pendingAttachment: { taskId: 'draft-file', fileName: 'synthetic.txt', mimeType: 'text/plain', byteSize: 2 } };
  runtime.patchDraft(bucket, draft);
  const selected = insertDraftEmote({ text: '', mentionIds: [] }, item, token);
  await runtime.send(conversation.id, selected.text, undefined, undefined, { topicId: topic ? 'topic' : undefined, preserveDraft: true, emoteSpans: selected.emoteSpans });
  expect(postedBodies()[0]?.body).toEqual({
    clientMessageId: 'synthetic-message-id', replyToMessageId: null,
    ...(topic ? { syncToGroup: false } : { conversationId: conversation.id }),
    content: { format: 'duallane.message+json;v=1', blocks: [customBlock] },
  });
  expect(useWorkspace.getState().drafts[bucket]).toEqual(draft);
});

test('failed custom sends retry with the same client ID, canonical reference and reply', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'));
  const selected = insertDraftEmote({ text: '', mentionIds: [] }, item, token);
  await expect(runtime.send(conversation.id, selected.text, undefined, undefined, { replyToMessageId: 'quoted-message', emoteSpans: selected.emoteSpans })).rejects.toThrow('request.network');
  const failed = useWorkspace.getState().messages[conversation.id]?.[0];
  expect(failed).toMatchObject({ status: 'failed', blocks: [customBlock] });
  await runtime.send(conversation.id, 'changed composer text', failed);
  expect(postedBodies().map(({ body }) => body)).toEqual([
    { clientMessageId: 'synthetic-message-id', replyToMessageId: 'quoted-message', conversationId: conversation.id, content: { format: 'duallane.message+json;v=1', blocks: [customBlock] } },
    { clientMessageId: 'synthetic-message-id', replyToMessageId: 'quoted-message', conversationId: conversation.id, content: { format: 'duallane.message+json;v=1', blocks: [customBlock] } },
  ]);
  expect(useWorkspace.getState().messages[conversation.id]).toHaveLength(1);
});

test('regular sends retain selected resources through attachment upload', async () => {
  const selected = insertDraftEmote({ text: '', mentionIds: [] }, item, token);
  const file = { id: 'uploaded-file', fileName: 'synthetic.png', mimeType: 'image/png', byteSize: 2, status: 'available', capabilities: { canDownload: true } };
  await runtime.send(conversation.id, selected.text, undefined, undefined, { emoteSpans: selected.emoteSpans, upload: async () => file, uploadTaskId: 'task' });
  expect(postedBodies()[0]?.body.content.blocks).toEqual([customBlock, { type: 'attachment', attachmentId: file.id }]);
});

test('photo direct-send preserves selected emotes and every other field in the existing draft', async () => {
  const draft = { ...insertDraftEmote(insertDraftMention({ text: '未发送 @同', mentionIds: [] }, member), item, token), replyToMessageId: 'draft-quote', pendingAttachment: { taskId: 'draft-file', fileName: 'synthetic.txt', mimeType: 'text/plain', byteSize: 2 } };
  runtime.patchDraft(conversation.id, draft);
  const file = { id: 'photo-file', fileName: 'synthetic.png', mimeType: 'image/png', byteSize: 2, status: 'available', capabilities: { canDownload: true } };
  await runtime.send(conversation.id, '', undefined, undefined, { preserveDraft: true, upload: async () => file, uploadTaskId: 'photo-task' });
  expect(postedBodies()[0]?.body.content.blocks).toEqual([{ type: 'attachment', attachmentId: file.id }]);
  expect(useWorkspace.getState().drafts[conversation.id]).toEqual(draft);
});

test('selected-emote draft spans persist and restore through the actual account cache path', async () => {
  const selected = { ...insertDraftEmote({ text: '未发送', mentionIds: [] }, item, token), replyToMessageId: 'draft-quote' };
  runtime.patchDraft(conversation.id, selected);
  const saved = jest.mocked(cache.set).mock.calls.filter(([key]) => key.endsWith(':drafts')).at(-1)?.[1];
  expect(saved).toEqual({ [conversation.id]: selected });
  runtime.dispose();
  useWorkspace.getState().reset();
  jest.mocked(cache.get).mockImplementation(key => key.endsWith(':drafts') ? saved : null);
  fetchMock.mockImplementation(async url => response(String(url).endsWith('/release-policy') ? policy : String(url).endsWith('/refresh') ? session : bootstrap));
  runtime = new Runtime();
  jest.spyOn(runtime, 'connect').mockImplementation(() => undefined);
  jest.spyOn(runtime, 'listTopics').mockResolvedValue([]);
  await runtime.start();
  expect(useWorkspace.getState().drafts[conversation.id]).toEqual(selected);
  fetchMock.mockClear();
  serveSend();
  const restored = useWorkspace.getState().drafts[conversation.id]!;
  await runtime.send(conversation.id, restored.text, undefined, undefined, { emoteSpans: restored.emoteSpans, replyToMessageId: restored.replyToMessageId });
  expect(postedBodies()[0]?.body.content.blocks).toEqual([{ type: 'text', text: '未发送' }, customBlock]);
});
