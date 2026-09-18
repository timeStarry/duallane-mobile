import { resolveMediaUrl } from '../src/data/media';

jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: '' } }));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));

test('relative emote and avatar paths resolve against the API origin', () => {
  expect(resolveMediaUrl('/api/workspace/emotes/e1/content', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/api/workspace/emotes/e1/content');
  expect(resolveMediaUrl('/emotes/bili/doge.png', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/emotes/bili/doge.png');
  expect(resolveMediaUrl('https://avatars.githubusercontent.com/u/1', 'https://duallane.tsio.top')).toBe('https://avatars.githubusercontent.com/u/1');
});
