import { formatMessageDayLabel, getMessageGroupPositions, workspaceUnreadIndex } from '../src/domain/message-grouping';
import { groupHiddenWorkspaceMessages } from '../src/domain/hidden-messages';

const message = (index: number, patch: Record<string, unknown> = {}) => ({
  id: `m${index}`,
  authorId: 'u1',
  authorKind: 'human',
  kind: 'user',
  self: true,
  createdAt: new Date(2026, 8, 11, 12, index).toISOString(),
  ...patch,
});

test('continuous message surfaces keep isolated messages whole', () => {
  expect(getMessageGroupPositions([])).toEqual([]);
  expect(getMessageGroupPositions([message(0)])).toEqual(['single']);
  expect(getMessageGroupPositions([message(0), message(1), message(2), message(3, { authorId: 'u2' })]))
    .toEqual(['start', 'middle', 'end', 'single']);
});

test('grouping uses author identity and breaks on replies hidden recall and system', () => {
  expect(getMessageGroupPositions([message(0), message(1, { authorId: 'u2' })])).toEqual(['single', 'single']);
  expect(getMessageGroupPositions([message(0), message(1, { self: false })])).toEqual(['single', 'single']);
  expect(getMessageGroupPositions([message(0), message(1, { authorKind: 'bot' })])).toEqual(['single', 'single']);
  expect(getMessageGroupPositions([message(0), message(1), message(2, { replyToMessageId: 'x' }), message(3), message(4)]))
    .toEqual(['start', 'end', 'single', 'start', 'end']);
  expect(getMessageGroupPositions([message(0), message(1), message(2, { hiddenByCurrentUser: true }), message(3), message(4)]))
    .toEqual(['start', 'end', 'single', 'start', 'end']);
  expect(getMessageGroupPositions([message(0), message(1), message(2, { recalledAt: '2026-09-11T04:00:00Z' }), message(3), message(4)]))
    .toEqual(['start', 'end', 'single', 'start', 'end']);
  expect(getMessageGroupPositions([message(0), message(1), message(2, { kind: 'system', authorKind: 'system' }), message(3), message(4)]))
    .toEqual(['start', 'end', 'single', 'start', 'end']);
});

test('unread index splits groups and hidden-in-middle plus unread-at-end stay boundaries', () => {
  const messages = [message(0), message(1), message(2), message(3)];
  expect(getMessageGroupPositions(messages, 2)).toEqual(['start', 'end', 'start', 'end']);
  expect(workspaceUnreadIndex(messages, 'm0')).toBe(1);
  expect(workspaceUnreadIndex(messages, 'm3')).toBe(3);
  expect(getMessageGroupPositions(messages, workspaceUnreadIndex(messages, 'm3'))).toEqual(['start', 'middle', 'end', 'single']);
  const withHidden = [message(0), message(1, { hiddenByCurrentUser: true }), message(2)] as Array<ReturnType<typeof message> & { hiddenByCurrentUser?: boolean }>;
  expect(getMessageGroupPositions(withHidden)).toEqual(['single', 'single', 'single']);
  expect(groupHiddenWorkspaceMessages(withHidden)).toEqual([
    { kind: 'message', message: withHidden[0], sourceIndex: 0 },
    { kind: 'hidden', messages: [withHidden[1]], sourceIndex: 1 },
    { kind: 'message', message: withHidden[2], sourceIndex: 2 },
  ]);
});

test('five minute window splits dates and day labels use 今天/昨天', () => {
  expect(getMessageGroupPositions([message(0), message(5)])).toEqual(['start', 'end']);
  expect(getMessageGroupPositions([message(0), message(6)])).toEqual(['single', 'single']);
  const now = new Date(2026, 8, 18, 15);
  expect(formatMessageDayLabel(new Date(2026, 8, 18, 8).toISOString(), now)).toBe('今天');
  expect(formatMessageDayLabel(new Date(2026, 8, 17, 8).toISOString(), now)).toBe('昨天');
});
