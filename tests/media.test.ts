import { emoteSource, isPreviewableImage, resolveMediaUrl, splitCatalogEmotes } from '../src/data/media';
import { composerEmotePacks, catalogImage, catalogUnicodeGlyph, enabledCatalogPacks, splitImageEmotes } from '../src/domain/emote-catalog';
import { botAssetAvatar, isAllowedSameOriginMediaPath, sanitizeWorkspaceAvatarUrl } from '../src/domain/media-path';
import { recalledNotice } from '../src/domain/recall';

jest.mock('expo-file-system', () => ({ File: class {}, Directory: class { exists = false; create() {} delete() {} }, Paths: { cache: '' } }));
jest.mock('expo-crypto', () => ({ digestStringAsync: jest.fn(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));

test('relative emote and avatar paths resolve against the API origin', () => {
  expect(resolveMediaUrl('/api/workspace/emotes/e1/content', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/api/workspace/emotes/e1/content');
  expect(resolveMediaUrl('/emotes/bili/doge.png', 'https://duallane.tsio.top')).toBe('https://duallane.tsio.top/emotes/bili/doge.png');
  expect(resolveMediaUrl('https://avatars.githubusercontent.com/u/1', 'https://duallane.tsio.top')).toBe('https://avatars.githubusercontent.com/u/1');
});

test('custom emoji shortcodes map to the authorized content path', () => {
  expect(emoteSource('custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('/api/workspace/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content');
});

test('catalog emote tokens use the web catalog src instead of guessing filenames', () => {
  expect(splitCatalogEmotes('手机的[feishu:glance]表情')).toEqual([
    { text: '手机的' },
    { token: '[feishu:glance]', src: '/emotes/feishu/glance.png' },
    { text: '表情' },
  ]);
  expect(catalogImage('[bili:melon]')?.src).toBe('/emotes/bili/melon.png');
  expect(catalogImage('[wechat:微笑]')?.src).toBe('/emotes/wechat/u5fae-u7b11.png');
  expect(catalogImage('qq:smile')?.src).toBe('/emotes/qq/smile.gif');
  expect(splitImageEmotes(':[bili:melon]:')).toEqual([{ token: '[bili:melon]', src: '/emotes/bili/melon.png' }]);
  expect(splitImageEmotes('未知 [bili:nope]')).toEqual([{ text: '未知 [bili:nope]' }]);
  expect(catalogUnicodeGlyph('emoji:grinning')).toBe('😀');
});

test('same-origin bot and catalog assets are allowed media paths', () => {
  expect(isAllowedSameOriginMediaPath('/assets/beacon-avatar.png')).toBe(true);
  expect(isAllowedSameOriginMediaPath('/assets/echo-avatar.svg')).toBe(true);
  expect(isAllowedSameOriginMediaPath('/assets/../secret')).toBe(false);
  expect(sanitizeWorkspaceAvatarUrl('/assets/beacon-avatar.png')).toBe('/assets/beacon-avatar.png');
  expect(sanitizeWorkspaceAvatarUrl('https://duallane.tsio.top/api/workspace/avatars/other/2')).toBe('/api/workspace/avatars/other/2');
  expect(botAssetAvatar('信标')).toBe('/assets/beacon-avatar.png');
  expect(botAssetAvatar('回声')).toBe('/assets/echo-avatar.svg');
});

test('composer packs put custom collections beside enabled catalog packs', () => {
  const packs = composerEmotePacks({
    entries: [{ type: 'emote', emote: { id: 'e1', kind: 'image', label: '猫', token: '[custom:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee]', src: '/api/workspace/emotes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/content' } }],
    emotes: [],
    collections: [{ id: 'col1', name: '妙脆角', items: [{ id: 'e2', kind: 'image', label: '角', token: '[custom:bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee]', src: '/api/workspace/emotes/bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee/content' }] }],
  }, ['feishu']);
  expect(packs.map(pack => pack.id)).toEqual(['custom', 'collection:col1', 'feishu']);
  expect(packs[0]?.label).toBe('收藏');
  expect(enabledCatalogPacks(['bili']).every(pack => pack.id === 'bili')).toBe(true);
});

test('recalled notices keep the server sentence instead of a generic unavailable label', () => {
  expect(recalledNotice({ recalledAt: '2026-09-16T01:00:00Z', authorName: 'Member', recallReason: '内容有误', plainText: 'Member因内容有误撤回了一条消息' })).toBe('Member因内容有误撤回了一条消息');
  expect(recalledNotice({ recalledAt: '2026-09-16T01:00:00Z', authorName: 'Member', recallReason: '写错了', plainText: '消息已不可用' })).toBe('Member因写错了撤回了一条消息');
});

test('previewable image types match the web allow-list', () => {
  expect(isPreviewableImage({ mimeType: 'image/png' })).toBe(true);
  expect(isPreviewableImage({ mimeType: 'application/octet-stream', fileName: 'shot.webp' })).toBe(true);
  expect(isPreviewableImage({ mimeType: 'application/pdf', fileName: 'doc.pdf' })).toBe(false);
});
