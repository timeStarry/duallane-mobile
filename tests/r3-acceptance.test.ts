import { assertAllowedCardAction } from '../src/domain/actions';
import { composeBlocks, activeMentionQuery } from '../src/domain/compose';
import { parseMessage, targetKey } from '../src/domain/contracts';
import { hiddenTypes } from '../src/domain/hide';
import { prepareWorkspaceMarkdown } from '../src/domain/markdown';
import { shouldNotify } from '../src/domain/notifications';
import { mergeMessages, useWorkspace } from '../src/domain/store';
import { updateDecision, releaseSchema } from '../src/domain/updates';

const member = { id: 'u2', displayName: '成员乙', kind: 'human', capabilities: { canStartDirectConversation: true } };
const bot = { id: 'bot-1', displayName: 'Echo', kind: 'bot', capabilities: { canStartDirectConversation: true } };
const valid = {
  id: 'm1', conversationId: 'c1', authorId: 'u2', authorName: 'A', kind: 'user',
  createdAt: '2026-01-01T00:00:00.000Z', plainText: 'hi',
  content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'hi' }] }, attachments: [],
};
const conversation = {
  id: 'c1', displayTitle: 'x', type: 'direct' as const, lastMessagePlainText: '', lastActivityAt: '', unreadCount: 0,
  notificationLevel: 'all' as const, retentionText: '', members: [],
  capabilities: { canSendMessage: true, canUploadFile: false, canManageMembers: false },
};

afterEach(() => useWorkspace.getState().reset());

test('A06 unknown payload and HTML stay in the safe summary', () => {
  const unknown = parseMessage({ ...valid, plainText: '安全摘要', content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'future_card', payload: { script: 'bad' } }], plainText: '安全摘要' } });
  expect(unknown?.fallback).toBe(true);
  expect(unknown?.plainText).toBe('安全摘要');
  expect(JSON.stringify(unknown)).not.toContain('script');
  expect(prepareWorkspaceMarkdown('<script>x</script>\nhello').plain).toBe(true);
});

test('A08 multiple mentions and IME query do not treat confirm as send', () => {
  const blocks = composeBlocks('@成员乙 和 @Echo 都看', [member, bot], ['u2', 'bot-1']);
  expect(blocks.filter(block => block.type === 'mention')).toEqual([
    { type: 'mention', userId: 'u2', label: '成员乙' },
    { type: 'mention', userId: 'bot-1', label: 'Echo' },
  ]);
  expect(activeMentionQuery('hello @成')).toBe('成');
  expect(activeMentionQuery('hello @成 ')).toBeNull();
});

test('A12 late failed retry cannot replace a canonical message or a newer draft', () => {
  const canonical = parseMessage({ ...valid, authorId: 'u1', clientMessageId: 'local1', content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'hi' }], plainText: 'hi' } })!;
  const pending = { ...canonical, id: 'local1', plainText: 'local', status: 'sending' as const };
  useWorkspace.getState().upsertMessage(pending);
  useWorkspace.getState().setMessages('c1', [canonical]);
  useWorkspace.getState().upsertMessage({ ...pending, status: 'failed' });
  expect(useWorkspace.getState().messages.c1).toEqual([canonical]);
  useWorkspace.getState().setDraft('c1', { text: 'A', mentionIds: [] });
  useWorkspace.getState().setDraft('c1', { text: 'B', mentionIds: [] });
  expect(useWorkspace.getState().drafts.c1?.text).toBe('B');
});

test('A15 drafts are keyed by conversation and topic targets', () => {
  const conversationKey = targetKey({ kind: 'conversation', id: 'c1' });
  const topicKey = targetKey({ kind: 'topic', id: 't1', conversationId: 'c1' });
  useWorkspace.getState().setDraft(conversationKey, { text: '群草稿', replyToMessageId: 'm1', mentionIds: ['u2'] });
  useWorkspace.getState().setDraft(topicKey, { text: '话题草稿', mentionIds: [] });
  expect(useWorkspace.getState().drafts[conversationKey]?.text).toBe('群草稿');
  expect(useWorkspace.getState().drafts[topicKey]?.text).toBe('话题草稿');
  expect(useWorkspace.getState().drafts[topicKey]?.replyToMessageId).toBeUndefined();
});

test('A16 a pending attachment is draft state, not a sent message', () => {
  useWorkspace.getState().setDraft('c1', { text: '配图', mentionIds: [], pendingAttachment: { taskId: 'task-1', fileName: 'note.txt', mimeType: 'text/plain', byteSize: 3 } });
  expect(useWorkspace.getState().messages.c1).toBeUndefined();
  expect(useWorkspace.getState().drafts.c1?.pendingAttachment?.fileName).toBe('note.txt');
});

test('A23 unknown card actions are rejected before any write', () => {
  expect(() => assertAllowedCardAction('explode', ['open_topic', 'join_topic'])).toThrow('Unknown action');
});

test('A27 auto-hide is a local display preference and does not recall the message', () => {
  const message = parseMessage({
    ...valid,
    content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'emoji', shortcode: 'smile' }, { type: 'text', text: '😀' }] },
  })!;
  const types = hiddenTypes(
    { clickImageEmoteToSend: false, replyAutoMention: false, autoHideMessages: true, autoHideMessageTypes: ['emote'] },
    message.blocks, message.attachments, message.plainText,
  );
  expect(types).toContain('emote');
  expect(message.recalledAt).toBeFalsy();
  expect(message.hiddenByCurrentUser).toBe(false);
  const catalog = parseMessage({
    ...valid,
    content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: '手机的[bili:melon]表情' }] },
  })!;
  expect(hiddenTypes(
    { clickImageEmoteToSend: false, replyAutoMention: false, autoHideMessages: true, autoHideMessageTypes: ['emote'] },
    catalog.blocks, catalog.attachments, catalog.plainText,
  )).toContain('emote');
});

test('A28 local notifications honor self, replay, muted, mentions and topic targets', () => {
  const message = parseMessage(valid)!;
  const mention = parseMessage({ ...valid, content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'mention', userId: 'u1', label: 'me' }] } })!;
  const topic = { id: 't1', conversationId: 'c1', title: 'T', status: 'open', joined: true, canJoin: false, allowSyncToGroup: false, participantCount: 1, unreadCount: 0, notificationLevel: 'mentions' as const, revision: 1 };
  expect(shouldNotify({ background: true, replay: false, message, userId: 'u2', conversation })).toBe(false);
  expect(shouldNotify({ background: true, replay: true, message, userId: 'u1', conversation })).toBe(false);
  expect(shouldNotify({ background: true, replay: false, message, userId: 'u2', conversation: { ...conversation, notificationLevel: 'muted' } })).toBe(false);
  expect(shouldNotify({ background: true, replay: false, message, userId: 'u1', conversation: { ...conversation, notificationLevel: 'mentions' }, topic })).toBe(false);
  expect(shouldNotify({ background: true, replay: false, message: mention, userId: 'u1', conversation: { ...conversation, notificationLevel: 'mentions' }, topic })).toBe(true);
});

test('A02 policy network failure is not a forced update', () => {
  const policy = releaseSchema.parse({
    schemaVersion: 1, platform: 'android', channel: 'internal',
    latest: { appVersion: '0.2.0', versionCode: 2, releaseId: 'r', releaseNotes: [] },
    minimum: { appVersion: '0.1.0', versionCode: 1 }, recommendation: 'soft', apkUrl: null,
    protocol: { eventMajor: 1, contentFormats: ['duallane.message+json;v=1'] },
  });
  expect(updateDecision(policy, { appVersion: '0.1.0', versionCode: 1 })).toBe('soft');
  expect(updateDecision(policy, { appVersion: '0.0.1', versionCode: 1 })).toBe('forced');
});

test('V07 pagination keys stay unique across 1000 mixed messages', () => {
  const incoming = Array.from({ length: 1000 }, (_, index) => parseMessage({
    ...valid, id: `m${index}`, createdAt: `2026-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    plainText: `msg ${index}`, content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: `msg ${index}` }] },
  })!);
  const merged = mergeMessages(incoming.slice(500), incoming);
  const ids = merged.map(message => message.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(merged).toHaveLength(1000);
});
