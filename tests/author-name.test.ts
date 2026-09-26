import { visibleAuthorName } from '../src/domain/author-name';

test('bot messages use the member display name instead of an internal handle', () => {
  expect(visibleAuthorName(
    { authorId: 'bot-echo', authorName: '__duallane_echo__', authorKind: 'bot', kind: 'bot' },
    [{ id: 'bot-echo', displayName: '回声' }],
  )).toBe('回声');
});

test('internal handles do not leak when the member list has no match', () => {
  expect(visibleAuthorName(
    { authorId: 'bot-echo', authorName: '__duallane_echo__', authorKind: 'bot', kind: 'bot' },
    [],
  )).toBe('成员');
  expect(visibleAuthorName(
    { authorId: 'bot-echo', authorName: '__duallane_echo__', authorKind: 'bot', kind: 'bot' },
    [],
    '回声',
  )).toBe('回声');
});

test('human authors keep the server display name when no member overlay exists', () => {
  expect(visibleAuthorName(
    { authorId: 'u1', authorName: '李总', kind: 'user' },
    [],
  )).toBe('李总');
});
