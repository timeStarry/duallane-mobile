import { emoteSource, isPreviewableImage, resolveMediaUrl, splitCatalogEmotes } from '../src/data/media';

jest.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: '' } }));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));

test('relative emote and avatar paths resolve against the API origin', () => {
  expect(resolveMediaUrl('/api/workspace/emotes/e1/content', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/api/workspace/emotes/e1/content');
  expect(resolveMediaUrl('/emotes/bili/doge.png', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/emotes/bili/doge.png');
  expect(resolveMediaUrl('https://avatars.githubusercontent.com/u/1', 'https://duallane.tsio.top')).toBe('https://avatars.githubusercontent.com/u/1');
});

test('custom emoji shortcodes map to the authorized content path', () => {
  expect(emoteSource('custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('/api/workspace/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content');
});

test('catalog emote tokens in text become image parts', () => {
  const parts = splitCatalogEmotes('手机的[feishu:glance]表情');
  expect(parts).toEqual([
    { text: '手机的' },
    { token: '[feishu:glance]', src: '/emotes/feishu/glance.png' },
    { text: '表情' },
  ]);
});

test('previewable image types match the web allow-list', () => {
  expect(isPreviewableImage({ mimeType: 'image/png' })).toBe(true);
  expect(isPreviewableImage({ mimeType: 'application/octet-stream', fileName: 'shot.webp' })).toBe(true);
  expect(isPreviewableImage({ mimeType: 'application/pdf', fileName: 'doc.pdf' })).toBe(false);
});
