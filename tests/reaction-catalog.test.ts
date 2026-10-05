import { catalogImage, catalogPacks, catalogReactionKey, catalogUnicodeGlyph, composerEmotePacks, reactionEmotePacks } from '../src/domain/emote-catalog';

test('reaction catalog keys match the Go built-in key grammar and omit hidden packs', () => {
  const packs = reactionEmotePacks();
  expect(packs.length).toBeGreaterThan(0);
  for (const pack of packs) {
    expect(['custom', 'douyin', 'qq']).not.toContain(pack.id);
    expect(pack.items.length).toBeGreaterThan(0);
    for (const item of pack.items) {
      const key = catalogReactionKey(pack.id, item.id);
      expect(key).toBe(`${pack.id}:${item.id}`);
      expect(key).toMatch(/^[a-z0-9_+\-]{1,64}:[a-z0-9_+\-]{1,128}$/);
      expect(item.kind === 'unicode' ? catalogUnicodeGlyph(key!) : catalogImage(key!)).toBeTruthy();
    }
  }
});

test('canonical image and Unicode identities do not come from composer tokens or private collections', () => {
  expect(catalogReactionKey('bili', 'doge')).toBe('bili:doge');
  expect(catalogReactionKey('emoji', 'thumbs-up')).toBe('emoji:thumbs-up');
  expect(catalogReactionKey('custom', '11111111-1111-4111-8111-111111111111')).toBeUndefined();
  expect(catalogReactionKey('collection:synthetic', 'doge')).toBeUndefined();
  expect(catalogReactionKey('bili', '[bili:doge]')).toBeUndefined();
  expect(catalogReactionKey('bili', 'future')).toBeUndefined();
  expect(catalogReactionKey('qq', 'smile')).toBeUndefined();
  expect(catalogReactionKey('douyin', 'smile')).toBeUndefined();
});

test('unsupported item IDs stay available to the message composer without entering the reaction picker', () => {
  expect(catalogPacks().find(pack => pack.id === 'wechat')?.items.some(item => item.id === '微笑')).toBe(true);
  expect(catalogReactionKey('wechat', '微笑')).toBeUndefined();
  expect(reactionEmotePacks().find(pack => pack.id === 'wechat')?.items.some(item => item.id === '微笑')).not.toBe(true);
  const custom = { id: '11111111-1111-4111-8111-111111111111', kind: 'custom', label: '合成小猫', token: '[custom:11111111-1111-4111-8111-111111111111]' };
  const composer = composerEmotePacks({ emotes: [custom], collections: [{ id: 'collection-synthetic', name: '合成合集', items: [custom] }] });
  expect(composer.find(pack => pack.id === 'custom')?.items[0]?.token).toBe(custom.token);
  expect(composer.find(pack => pack.id === 'collection:collection-synthetic')?.items[0]?.token).toBe(custom.token);
  expect(reactionEmotePacks().some(pack => pack.id === 'custom' || pack.id.startsWith('collection:'))).toBe(false);
});

test('reaction catalog respects enabled built-in packs and never exposes an empty unsupported pack', () => {
  expect(reactionEmotePacks(['emoji']).map(pack => pack.id)).toEqual(['emoji']);
  expect(reactionEmotePacks(['wechat'])[0]?.items.map(item => item.id)).toEqual(['666']);
  expect(reactionEmotePacks(['custom', 'douyin', 'qq'])).toEqual([]);
  expect(reactionEmotePacks(['bili', 'emoji']).map(pack => pack.id)).toEqual(['emoji', 'bili']);
});
