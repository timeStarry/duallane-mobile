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
