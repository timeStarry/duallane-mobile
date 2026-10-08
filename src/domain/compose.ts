import type { Block, Draft, Member, MentionSpan } from './contracts';

function validMentionSpans(text: string, spans: MentionSpan[]): MentionSpan[] {
  const sorted = spans.filter(span => Number.isInteger(span.start) && Number.isInteger(span.end)
    && span.start >= 0 && span.end > span.start && span.end <= text.length
    && !!span.userId && !!span.label && text.slice(span.start, span.end) === `@${span.label}`)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  // Conflicting ranges cannot establish which identity the user selected.
  return sorted.filter((span, index) => !sorted.some((other, otherIndex) => index !== otherIndex
    && span.start < other.end && other.start < span.end));
}

function withMentions(draft: Draft, text: string, mentionSpans: MentionSpan[]): Draft {
  return { ...draft, text, mentionSpans, mentionIds: Array.from(new Set(mentionSpans.map(span => span.userId))) };
}

export function editDraftText(draft: Draft, text: string): Draft {
  if (text === draft.text) return draft;
  let prefix = 0;
  const commonLength = Math.min(draft.text.length, text.length);
  while (prefix < commonLength && draft.text[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < commonLength && draft.text[draft.text.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  // Repeated text can make several edit positions indistinguishable. Invalidate
  // every affected range instead of silently retaining the wrong same-name ID.
  const start = Math.min(prefix, commonLength - suffix);
  const end = Math.max(draft.text.length - suffix, draft.text.length - commonLength + prefix);
  const delta = text.length - draft.text.length;
  const spans = validMentionSpans(draft.text, draft.mentionSpans ?? []).flatMap(span => {
    if (span.end <= start) return [span];
    if (span.start >= end) return [{ ...span, start: span.start + delta, end: span.end + delta }];
    return [];
  });
  return withMentions(draft, text, validMentionSpans(text, spans));
}

export function insertDraftMention(
  draft: Draft,
  member: Pick<Member, 'id' | 'displayName'>,
  selection?: { start: number; end: number },
): Draft {
  const query = activeMentionQuery(draft.text);
  const range = selection ?? { start: query === null ? draft.text.length : draft.text.length - query.length - 1, end: draft.text.length };
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > draft.text.length) {
    throw new RangeError('Invalid mention insertion range');
  }
  if (!member.id || !member.displayName) return draft;
  const prefix = draft.text.slice(0, range.start);
  const separator = range.start === range.end && prefix && !/\s$/.test(prefix) ? ' ' : '';
  const token = `@${member.displayName}`;
  const text = `${prefix}${separator}${token} ${draft.text.slice(range.end)}`;
  const start = prefix.length + separator.length;
  const span: MentionSpan = { userId: member.id, label: member.displayName, start, end: start + token.length };
  const delta = text.length - draft.text.length;
  // Candidate selection supplies the exact edit range, including when labels
  // repeat. Do not infer a different position from identical visible text.
  const spans = validMentionSpans(draft.text, draft.mentionSpans ?? []).flatMap(other => {
    if (other.end <= range.start) return [other];
    if (other.start >= range.end) return [{ ...other, start: other.start + delta, end: other.end + delta }];
    return [];
  });
  return withMentions(draft, text, [...spans, span].sort((a, b) => a.start - b.start));
}

export function appendDraftMention(draft: Draft, member: Pick<Member, 'id' | 'displayName'>): Draft {
  if (validMentionSpans(draft.text, draft.mentionSpans ?? []).some(span => span.userId === member.id)) return draft;
  return insertDraftMention(draft, member, { start: draft.text.length, end: draft.text.length });
}

function legacyMentionSpans(text: string, members: Member[], mentionIds: string[]): MentionSpan[] {
  const labels = members.filter(member => mentionIds.includes(member.id) && member.displayName
    && members.filter(other => other.displayName === member.displayName).length === 1)
    .map(member => ({ member, token: `@${member.displayName}` })).sort((a, b) => b.token.length - a.token.length);
  const spans: MentionSpan[] = [];
  let offset = 0;
  while (offset < text.length) {
    let hit: { index: number; token: string; member: Member } | undefined;
    for (const item of labels) {
      let index = text.indexOf(item.token, offset);
      while (index >= 0) {
        const end = index + item.token.length;
        const delimited = (index === 0 || /\s/.test(text[index - 1]!))
          && (end === text.length || /[\s.,!?，。！？、;；:：()[\]{}]/.test(text[end]!));
        const longerName = members.some(member => member.displayName.length > item.member.displayName.length
          && text.startsWith(`@${member.displayName}`, index));
        if (delimited && !longerName) break;
        index = text.indexOf(item.token, index + 1);
      }
      if (index >= 0 && (!hit || index < hit.index)) hit = { index, token: item.token, member: item.member };
    }
    if (!hit) break;
    spans.push({ userId: hit.member.id, label: hit.member.displayName, start: hit.index, end: hit.index + hit.token.length });
    offset = hit.index + hit.token.length;
  }
  return spans;
}

export function composeBlocks(text: string, members: Member[], mentionIds: string[] = [], attachmentId?: string, mentionSpans?: MentionSpan[]): Block[] {
  const spans = mentionSpans === undefined ? legacyMentionSpans(text, members, mentionIds) : validMentionSpans(text, mentionSpans);
  const byId = new Map(members.map(member => [member.id, member]));
  const blocks: Block[] = [];
  let offset = 0;
  for (const span of spans) {
    const member = byId.get(span.userId);
    if (!member) continue;
    if (span.start > offset) blocks.push({ type: 'text', text: text.slice(offset, span.start) });
    blocks.push({ type: 'mention', userId: member.id, label: member.displayName });
    offset = span.end;
  }
  if (offset < text.length) blocks.push({ type: 'text', text: text.slice(offset) });
  if (attachmentId) blocks.push({ type: 'attachment', attachmentId });
  return blocks.filter(block => block.type !== 'text' || block.text.length > 0);
}

export function mentionCandidates(query: string, members: Member[]) {
  const needle = query.trim().toLowerCase();
  return members.filter(member => {
    const name = member.displayName.toLowerCase();
    const nick = (member.nickname ?? '').toLowerCase();
    return !needle || name.includes(needle) || nick.includes(needle);
  }).slice(0, 8);
}

export function activeMentionQuery(text: string) {
  const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
  return match ? match[1] ?? '' : null;
}
