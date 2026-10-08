import { messageActions } from '../src/domain/message-actions';
import type { Message } from '../src/domain/contracts';

const base = {
  id: 'm1',
  conversationId: 'c1',
  authorId: 'me',
  authorName: '我',
  kind: 'user',
  createdAt: '2026-09-18T00:00:00.000Z',
  plainText: 'hi',
  hiddenByCurrentUser: false,
  reactions: [],
  attachments: [],
  blocks: [],
  fallback: false,
} as Message;

test('message actions never use 删除 and keep hide recall pin distinct', () => {
  const actions = messageActions(base, { own: true, group: true, canSend: true });
  expect(actions.map(action => action.title).join(',')).not.toContain('删除');
  expect(actions.some(action => action.id === 'hide')).toBe(true);
  expect(actions.some(action => action.id === 'recall' && action.danger)).toBe(true);
  expect(actions.some(action => action.id === 'pin')).toBe(true);
  expect(messageActions({ ...base, kind: 'system' }, { own: false, group: false, canSend: true }).some(action => action.id === 'reply')).toBe(false);
});

test('joined open topic messages use the parent-group pin action', () => {
  const topicMessage = { ...base, topicId: 'topic-synthetic' };
  expect(messageActions(topicMessage, { own: true, group: true, canSend: true }).map(action => action.id)).toContain('pin');
  expect(messageActions(topicMessage, { own: false, group: true, canSend: true }).map(action => action.id)).not.toContain('pin');
  expect(messageActions({ ...topicMessage, pin: { pinnedByUserId: 'other', pinnedAt: base.createdAt, canUnpin: true } }, { own: false, group: true, canSend: true }).map(action => action.id)).toContain('pin');
  expect(messageActions({ ...topicMessage, pin: { pinnedByUserId: 'me', pinnedAt: base.createdAt, canUnpin: false } }, { own: true, group: true, canSend: true }).map(action => action.id)).not.toContain('pin');
});

test('topic write restrictions remove reply recall and pin while preserving personal hide', () => {
  const actions = messageActions({ ...base, topicId: 'topic-synthetic' }, { own: true, group: true, canSend: false });
  expect(actions.map(action => action.id)).toEqual(['copy', 'hide']);
});

test.each([
  { ...base, status: 'sending' as const },
  { ...base, status: 'failed' as const },
  { ...base, recalledAt: base.createdAt },
  { ...base, kind: 'system' },
  { ...base, authorKind: 'system' },
])('pending system and recalled messages do not offer shared write actions', message => {
  expect(messageActions(message, { own: true, group: true, canSend: true }).map(action => action.id)).toEqual(['copy']);
});
