import { catalogPacks } from '../src/domain/emote-catalog';
import { composeBlocks, editDraftText, insertDraftEmote, insertDraftMention } from '../src/domain/compose';
import { draftSchema, memberSchema, type Draft, type Member } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
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

test.each(['custom', 'builtin', 'image'])('collected %s image emotes can send from favorites and collections', kind => {
  expect(shouldDirectSendWorkspaceEmote({ kind }, 'custom', true)).toBe(true);
  expect(shouldDirectSendWorkspaceEmote({ kind }, 'collection:synthetic-collection', true)).toBe(true);
  expect(shouldDirectSendWorkspaceEmote({ kind }, 'collection:synthetic-collection', false)).toBe(false);
  expect(shouldDirectSendWorkspaceEmote({ kind }, 'bili', true)).toBe(false);
});

test('custom emote draft tokens produce the Web/Go canonical emoji block between mention and attachment blocks', () => {
  const customId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const member = memberSchema.parse({ id: 'selected-member', displayName: '同行' });
  const selected = insertDraftEmote({ text: '前', mentionIds: [] }, { id: customId.toUpperCase(), kind: 'custom' }, `[custom:${customId.toUpperCase()}]`);
  const draft = insertDraftMention(editDraftText(selected, `${selected.text}后 @同`), member);
  expect(composeBlocks(draft.text, [member], draft.mentionIds, 'synthetic-file', draft.mentionSpans, draft.emoteSpans)).toEqual([
    { type: 'text', text: '前' },
    { type: 'emoji', shortcode: `custom:${customId}` },
    { type: 'text', text: '后 ' },
    { type: 'mention', userId: member.id, label: member.displayName },
    { type: 'text', text: ' ' },
    { type: 'attachment', attachmentId: 'synthetic-file' },
  ]);
});

test('multiple canonical custom tokens split cleanly while built-in tokens, Unicode and unknown references remain text', () => {
  const customId = '11111111-1111-4111-8111-111111111111';
  const item = { id: customId, kind: 'custom' };
  const selected = insertDraftEmote(insertDraftEmote({ text: '', mentionIds: [] }, item, `[custom:${customId}]`), item, `[custom:${customId}]`);
  const draft = insertDraftEmote(selected, { id: 'builtin-favorite-id', kind: 'builtin' }, ' [bili:melon] 😄 [custom:unknown]');
  expect(composeBlocks(draft.text, [], [], undefined, [], draft.emoteSpans)).toEqual([
    { type: 'emoji', shortcode: `custom:${customId}` },
    { type: 'emoji', shortcode: `custom:${customId}` },
    { type: 'text', text: ' [bili:melon] 😄 [custom:unknown]' },
  ]);
  expect(composeBlocks('[custom:../../private] [custom:11111111-1111-4111-8111-111111111111x]', [])).toEqual([
    { type: 'text', text: '[custom:../../private] [custom:11111111-1111-4111-8111-111111111111x]' },
  ]);
});

const selectedId = '11111111-1111-4111-8111-111111111111';
const selectedToken = `[custom:${selectedId}]`;
const selectedItem = { id: selectedId, kind: 'custom' };
const emptyDraft: Draft = { text: '', mentionIds: [] };
function draftBlocks(draft: Draft, members: Member[] = []) {
  return composeBlocks(draft.text, members, draft.mentionIds, undefined, draft.mentionSpans, draft.emoteSpans);
}

test('handwritten, pasted, legacy and Markdown/code custom references stay text without a selected resource', () => {
  const text = `${selectedToken} \`${selectedToken}\`\n\`\`\`text\n${selectedToken}\n\`\`\`\n~~~\n${selectedToken}\n~~~`;
  const legacy = draftSchema.parse({ text, mentionIds: [] });
  expect(legacy.emoteSpans).toBeUndefined();
  expect(draftBlocks(legacy)).toEqual([{ type: 'text', text }]);
  expect(draftBlocks(editDraftText(emptyDraft, text))).toEqual([{ type: 'text', text }]);
});

test('selection edits preserve UTF-16 positions but cannot restore deleted or edited identities', () => {
  const selected = insertDraftEmote({ ...emptyDraft, text: '😀 前' }, selectedItem, selectedToken);
  const prefixed = editDraftText(selected, `前言 ${selected.text}`);
  const shifted = editDraftText(prefixed, `${prefixed.text}后`);
  expect(shifted.emoteSpans?.[0]?.start).toBe('前言 😀 前'.length);
  expect(draftBlocks(shifted)).toContainEqual({ type: 'emoji', shortcode: `custom:${selectedId}` });
  const modified = editDraftText(shifted, shifted.text.replace('custom:', 'customx:'));
  expect(modified.emoteSpans).toEqual([]);
  const restored = editDraftText(modified, shifted.text);
  expect(draftBlocks(restored)).toEqual([{ type: 'text', text: shifted.text }]);
  const duplicated = insertDraftEmote(insertDraftEmote(emptyDraft, selectedItem, selectedToken), selectedItem, selectedToken);
  const removed = editDraftText(duplicated, selectedToken);
  expect(removed.emoteSpans).toEqual([]);
  expect(draftBlocks(removed)).toEqual([{ type: 'text', text: selectedToken }]);
});

test('exact insertions preserve repeated selection identities and invalidate overlapping mention/emote ranges', () => {
  const member = memberSchema.parse({ id: 'peer', displayName: '同行' });
  const mentioned = insertDraftMention(emptyDraft, member);
  const selected = insertDraftEmote(mentioned, selectedItem, selectedToken, { start: 0, end: 0 });
  expect(draftBlocks(selected, [member])).toEqual([
    { type: 'emoji', shortcode: `custom:${selectedId}` },
    { type: 'mention', userId: member.id, label: member.displayName }, { type: 'text', text: ' ' },
  ]);
  const replacedMention = insertDraftEmote(mentioned, selectedItem, selectedToken, { start: 0, end: 2 });
  expect(replacedMention.mentionIds).toEqual([]);
  const replacedEmote = insertDraftMention(selected, member, { start: 1, end: 3 });
  expect(replacedEmote.emoteSpans).toEqual([]);
  const repeated = insertDraftEmote(selected, selectedItem, selectedToken, { start: 0, end: 0 });
  expect(draftBlocks(repeated, [member]).filter(block => block.type === 'emoji')).toHaveLength(2);
  expect(repeated.mentionSpans?.[0]?.start).toBe(selectedToken.length * 2);
});

test('malformed, stale, overlapping or mismatched resource ranges safely remain plain text', () => {
  const selected = insertDraftEmote(emptyDraft, selectedItem, selectedToken);
  const span = selected.emoteSpans![0]!;
  expect(draftBlocks({ ...selected, emoteSpans: [span, span] })).toEqual([{ type: 'text', text: selectedToken }]);
  expect(draftBlocks({ ...selected, emoteSpans: [{ ...span, start: 1, end: span.end + 1 }] })).toEqual([{ type: 'text', text: selectedToken }]);
  const secondId = '22222222-2222-4222-8222-222222222222';
  expect(draftBlocks({ ...selected, emoteSpans: [{ ...span, customId: secondId }] })).toEqual([{ type: 'text', text: selectedToken }]);
  const text = `@${selectedToken}`;
  const member = memberSchema.parse({ id: 'peer', displayName: selectedToken });
  expect(composeBlocks(text, [member], [member.id], undefined,
    [{ start: 0, end: text.length, userId: member.id, label: member.displayName }],
    [{ ...span, start: 1, end: text.length }])).toEqual([{ type: 'text', text }]);
  expect(draftSchema.safeParse({ ...selected, emoteSpans: [{ ...span, end: span.end + 1 }] }).success).toBe(false);
  expect(draftBlocks(insertDraftEmote(emptyDraft, { id: secondId, kind: 'custom' }, selectedToken))).toEqual([{ type: 'text', text: selectedToken }]);
});

test('saved built-ins and Unicode keep the text protocol while preserving earlier custom/mention identities', () => {
  const selected = insertDraftEmote(emptyDraft, selectedItem, selectedToken);
  const builtin = insertDraftEmote(selected, { id: 'builtin-favorite-id', kind: 'builtin' }, '[bili:melon]');
  const unicode = insertDraftEmote(builtin, { id: 'smile', kind: 'unicode' }, '😄');
  expect(draftBlocks(unicode)).toEqual([
    { type: 'emoji', shortcode: `custom:${selectedId}` }, { type: 'text', text: '[bili:melon]😄' },
  ]);
});

test('store text-only edits invalidate stale selected ranges and draft cache schema preserves valid spans', () => {
  const selected = { ...insertDraftEmote(emptyDraft, selectedItem, selectedToken), replyToMessageId: 'quote' };
  const restored = draftSchema.parse(JSON.parse(JSON.stringify(selected)));
  expect(draftBlocks(restored)).toEqual([{ type: 'emoji', shortcode: `custom:${selectedId}` }]);
  useWorkspace.getState().reset();
  useWorkspace.getState().setDraft('conversation', selected);
  useWorkspace.getState().setDraft('conversation', { text: '[custom:changed]' });
  expect(useWorkspace.getState().drafts.conversation?.emoteSpans).toEqual([]);
  expect(useWorkspace.getState().drafts.conversation?.replyToMessageId).toBe('quote');
  useWorkspace.getState().setDraft('conversation', selected);
  useWorkspace.getState().setDraft('conversation', '');
  expect(useWorkspace.getState().drafts.conversation?.emoteSpans).toEqual([]);
  useWorkspace.getState().reset();
});

test('legacy explicit mention IDs retain absent identity ranges while stale selected emote ranges still invalidate', () => {
  useWorkspace.getState().reset();
  useWorkspace.getState().setDraft('conversation', { text: '@Peer', mentionIds: ['legacy-peer'], replyToMessageId: 'quote' });
  const legacy = useWorkspace.getState().drafts.conversation!;
  expect(legacy.mentionSpans).toBeUndefined();
  expect(legacy.mentionIds).toEqual(['legacy-peer']);
  expect(legacy.replyToMessageId).toBe('quote');
  const selected = insertDraftEmote(emptyDraft, selectedItem, selectedToken);
  useWorkspace.getState().setDraft('emote', { ...selected, mentionSpans: undefined });
  useWorkspace.getState().setDraft('emote', { text: '@Peer', mentionIds: ['legacy-peer'] });
  expect(useWorkspace.getState().drafts.emote?.emoteSpans).toEqual([]);
  expect(useWorkspace.getState().drafts.emote?.mentionSpans).toBeUndefined();
  // A real text edit of a legacy draft discards its unscoped IDs as before.
  useWorkspace.getState().setDraft('conversation', { text: '@Peer changed' });
  expect(useWorkspace.getState().drafts.conversation?.mentionIds).toEqual([]);
  expect(useWorkspace.getState().drafts.conversation?.mentionSpans).toEqual([]);
  useWorkspace.getState().reset();
});
