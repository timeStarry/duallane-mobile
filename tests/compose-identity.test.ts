import { appendDraftMention, composeBlocks, editDraftText, insertDraftMention } from '../src/domain/compose';
import { draftSchema, memberSchema, type Draft, type Member } from '../src/domain/contracts';

const first = memberSchema.parse({ id: 'member-a', displayName: '同名成员' });
const second = memberSchema.parse({ id: 'member-b', displayName: '同名成员' });
const members = [first, second];
const empty: Draft = { text: '', mentionIds: [] };

function blocks(draft: Draft, allowed: Member[] = members, attachmentId?: string) {
  return composeBlocks(draft.text, allowed, draft.mentionIds, attachmentId, draft.mentionSpans);
}

test('same-name candidate selections retain both chosen identities in order', () => {
  const a = insertDraftMention({ ...empty, text: '@同' }, first);
  const b = insertDraftMention(editDraftText(a, `${a.text}@同`), second);
  expect(b.mentionIds).toEqual(['member-a', 'member-b']);
  expect(blocks(b)).toEqual([
    { type: 'mention', userId: 'member-a', label: '同名成员' },
    { type: 'text', text: ' ' },
    { type: 'mention', userId: 'member-b', label: '同名成员' },
    { type: 'text', text: ' ' },
  ]);
});

test('deleting a selection then selecting its namesake cannot retain the old identity', () => {
  const a = insertDraftMention(empty, first);
  const erased = editDraftText(a, '@');
  expect(erased.mentionIds).toEqual([]);
  const b = insertDraftMention(erased, second);
  expect(b.mentionIds).toEqual(['member-b']);
  expect(blocks(b)[0]).toEqual({ type: 'mention', userId: 'member-b', label: '同名成员' });
});

test('editing within a label invalidates its identity even if the text is later restored', () => {
  const selected = insertDraftMention(empty, first);
  const changed = editDraftText(selected, '@其他成员 ');
  const restored = editDraftText(changed, selected.text);
  expect(changed.mentionSpans).toEqual([]);
  expect(restored.mentionIds).toEqual([]);
  expect(blocks(restored)).toEqual([{ type: 'text', text: selected.text }]);
});

test('edits before and after a selected mention shift its UTF-16 range', () => {
  const selected = insertDraftMention({ ...empty, text: '😀 提醒 @同' }, second);
  const prefixed = editDraftText(selected, `前言 ${selected.text}`);
  const suffixed = editDraftText(prefixed, `${prefixed.text}收到`);
  const start = suffixed.text.indexOf('@同名成员');
  expect(suffixed.mentionSpans).toEqual([{ userId: second.id, label: second.displayName, start, end: start + '@同名成员'.length }]);
  expect(blocks(suffixed)).toEqual([
    { type: 'text', text: '前言 😀 提醒 ' },
    { type: 'mention', userId: second.id, label: second.displayName },
    { type: 'text', text: ' 收到' },
  ]);
  const shortened = editDraftText(suffixed, suffixed.text.slice('前言 '.length));
  expect(shortened.mentionSpans?.[0]?.start).toBe(start - '前言 '.length);
});

test('ambiguous deletion among identical labels safely discards affected identities', () => {
  const both = appendDraftMention(appendDraftMention(empty, first), second);
  const oneVisibleToken = editDraftText(both, '@同名成员 ');
  expect(oneVisibleToken.mentionSpans).toEqual([]);
  expect(blocks(oneVisibleToken)).toEqual([{ type: 'text', text: '@同名成员 ' }]);
});

test('compose only emits the selected range and current allowed member', () => {
  const selected = insertDraftMention(empty, second);
  const extraText = editDraftText(selected, `${selected.text}手写 @同名成员`);
  expect(blocks(extraText)).toEqual([
    { type: 'mention', userId: second.id, label: second.displayName },
    { type: 'text', text: ' 手写 @同名成员' },
  ]);
  expect(blocks(extraText, [first], 'file-synthetic')).toEqual([
    { type: 'text', text: extraText.text },
    { type: 'attachment', attachmentId: 'file-synthetic' },
  ]);
});

test('legacy drafts parse unchanged and ambiguous names remain plain text', () => {
  const legacy = draftSchema.parse({ text: '@同名成员 ', mentionIds: [first.id, second.id], replyToMessageId: 'reply-synthetic' });
  expect(legacy.mentionSpans).toBeUndefined();
  expect(blocks(legacy)).toEqual([{ type: 'text', text: legacy.text }]);
  expect(blocks({ ...legacy, mentionIds: [second.id] })).toEqual([{ type: 'text', text: legacy.text }]);
  const unique = memberSchema.parse({ id: 'unique-member', displayName: '唯一成员' });
  expect(composeBlocks('@唯一成员 ', [unique], [unique.id])).toEqual([
    { type: 'mention', userId: unique.id, label: unique.displayName },
    { type: 'text', text: ' ' },
  ]);
  const edited = editDraftText(legacy, `${legacy.text}修改`);
  expect(edited.replyToMessageId).toBe('reply-synthetic');
  expect(edited.mentionIds).toEqual([]);
});

test('an explicit empty span list disables stale legacy IDs', () => {
  expect(composeBlocks('@同名成员 ', [first], [first.id], undefined, [])).toEqual([{ type: 'text', text: '@同名成员 ' }]);
});

test('legacy labels cannot mention a prefix of another current member name', () => {
  const short = memberSchema.parse({ id: 'short-name', displayName: 'Member' });
  const longer = memberSchema.parse({ id: 'long-name', displayName: 'Member Extra' });
  expect(composeBlocks('@Member Extra ', [short, longer], [short.id])).toEqual([{ type: 'text', text: '@Member Extra ' }]);
  expect(composeBlocks('email@Member @MemberSuffix', [short], [short.id])).toEqual([{ type: 'text', text: 'email@Member @MemberSuffix' }]);
});

test('reply auto mention deduplicates by chosen ID and preserves a same-name author', () => {
  const draft = insertDraftMention({ ...empty, text: '😀 回复' }, first);
  const replied = appendDraftMention({ ...draft, replyToMessageId: 'reply-synthetic' }, second);
  expect(replied.mentionIds).toEqual([first.id, second.id]);
  expect(replied.replyToMessageId).toBe('reply-synthetic');
  expect(blocks(replied).filter(block => block.type === 'mention').map(block => block.userId)).toEqual([first.id, second.id]);
  expect(appendDraftMention(replied, second)).toBe(replied);
});

test('invalid or overlapping ranges cannot turn plain text into identity-bearing blocks', () => {
  const selected = insertDraftMention(empty, first);
  const span = selected.mentionSpans![0]!;
  expect(composeBlocks(selected.text, members, selected.mentionIds, undefined, [span, { ...span, userId: second.id }])).toEqual([{ type: 'text', text: selected.text }]);
  expect(composeBlocks(selected.text, members, selected.mentionIds, undefined, [{ ...span, end: span.end + 1 }])).toEqual([{ type: 'text', text: selected.text }]);
  expect(draftSchema.safeParse({ ...selected, mentionSpans: [{ ...span, start: -1 }] }).success).toBe(false);
  expect(draftSchema.safeParse({ ...selected, mentionSpans: [{ ...span, end: span.start }] }).success).toBe(false);
});
