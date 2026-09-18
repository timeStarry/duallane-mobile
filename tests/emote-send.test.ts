import { catalogPacks } from '../src/domain/emote-catalog';
import { shouldDirectSendWorkspaceEmote } from '../src/domain/emote-send';

test('catalogPacks exposes DualLane packs and omits the empty custom pack', () => {
  const packs = catalogPacks();
  expect(packs.some(pack => pack.id === 'bili')).toBe(true);
  expect(packs.some(pack => pack.id === 'wechat')).toBe(true);
  expect(packs.some(pack => pack.id === 'emoji')).toBe(true);
  expect(packs.some(pack => pack.id === 'custom')).toBe(false);
  const melon = packs.find(pack => pack.id === 'bili')?.items.find(item => item.id === 'melon');
  expect(melon?.src).toBe('/emotes/bili/melon.png');
});

test('shouldDirectSendWorkspaceEmote only fires for custom image emotes', () => {
  const image = { kind: 'image' };
  const unicode = { kind: 'unicode' };
  expect(shouldDirectSendWorkspaceEmote(image, 'custom', true)).toBe(true);
  expect(shouldDirectSendWorkspaceEmote(image, 'bili', true)).toBe(false);
  expect(shouldDirectSendWorkspaceEmote(image, 'custom', false)).toBe(false);
  expect(shouldDirectSendWorkspaceEmote(unicode, 'custom', true)).toBe(false);
});
