import { conversationSchema } from '../src/domain/contracts';
import { conversationIdentity } from '../src/ui/chrome';

jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: '' } }));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

test('group conversations use the workspace emoji avatar instead of a title letter', () => {
  const conversation = conversationSchema.parse({
    id: 'g1',
    displayTitle: '【研发】需求讨论大群',
    type: 'group',
    avatarEmoji: '🧪',
    lastActivityAt: '2026-09-18T00:00:00Z',
    members: [],
  });
  expect(conversationIdentity(conversation)).toMatchObject({ shape: 'group', emoji: '🧪', uri: undefined });
});

test('direct conversations use the other member avatar URL', () => {
  const conversation = conversationSchema.parse({
    id: 'd1',
    displayTitle: '格总',
    type: 'direct',
    lastActivityAt: '2026-09-18T00:00:00Z',
    members: [
      { id: 'self', displayName: '我', kind: 'human', avatarUrl: 'https://avatars.githubusercontent.com/u/1' },
      { id: 'other', displayName: '格总', kind: 'human', avatarUrl: 'https://duallane.tsio.top/api/workspace/avatars/other/2' },
    ],
  });
  expect(conversationIdentity(conversation, 'self')).toMatchObject({
    shape: 'person',
    name: '格总',
    uri: 'https://duallane.tsio.top/api/workspace/avatars/other/2',
  });
});
