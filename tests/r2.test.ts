import { composeBlocks, activeMentionQuery } from '../src/domain/compose';
import { parseMessage } from '../src/domain/contracts';
import { assertAllowedCardAction } from '../src/domain/actions';

const member = { id: 'u2', displayName: '成员乙', kind: 'human', capabilities: { canStartDirectConversation: true } };
const valid = { id: 'm1', conversationId: 'c1', authorId: 'u2', authorName: 'A', kind: 'user', createdAt: '2026-01-01T00:00:00.000Z', plainText: 'hi', content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'hi' }] }, attachments: [] };

test('composeBlocks emits structured mentions instead of raw @ text', () => {
  expect(composeBlocks('请看 @成员乙 的回复', [member], ['u2'])).toEqual([
    { type: 'text', text: '请看 ' },
    { type: 'mention', userId: 'u2', label: '成员乙' },
    { type: 'text', text: ' 的回复' },
  ]);
  expect(activeMentionQuery('hello @成')).toBe('成');
  expect(activeMentionQuery('hello 成')).toBeNull();
});

test('parseMessage keeps reply metadata and known cards, and still falls back unknown blocks', () => {
  const reply = parseMessage({ ...valid, replyToMessageId: 'm0', reactions: [{ emoteKey: 'builtin:smile', count: 1, reactedByCurrentUser: true }] });
  expect(reply?.replyToMessageId).toBe('m0');
  expect(reply?.reactions[0]?.emoteKey).toBe('builtin:smile');
  const card = parseMessage({ ...valid, content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'card', cardId: 'card1', cardType: 'workspace.topic-created', schemaVersion: 1, fallbackText: '新话题' }] } });
  expect(card?.fallback).toBe(false);
  expect(card?.blocks[0]).toMatchObject({ type: 'card', cardId: 'card1' });
  const unknown = parseMessage({ ...valid, content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'future_card', payload: { script: 'bad' } }] } });
  expect(unknown?.fallback).toBe(true);
  expect(JSON.stringify(unknown)).not.toContain('script');
});

test('card actions refuse ids that the projection did not allow', () => {
  expect(() => assertAllowedCardAction('explode', ['open_topic'])).toThrow('Unknown action');
  expect(() => assertAllowedCardAction('open_topic', ['open_topic'])).not.toThrow();
});
