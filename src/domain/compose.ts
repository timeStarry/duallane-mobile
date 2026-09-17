import type { Block, Member } from './contracts';

export function composeBlocks(text: string, members: Member[], mentionIds: string[] = [], attachmentId?: string): Block[] {
  const allowed = members.filter(member => mentionIds.includes(member.id));
  const labels = allowed
    .map(member => ({ member, token: `@${member.displayName}` }))
    .sort((a, b) => b.token.length - a.token.length);
  const blocks: Block[] = [];
  let remaining = text;
  while (remaining.length) {
    let hit: { index: number; token: string; member: Member } | undefined;
    for (const item of labels) {
      const index = remaining.indexOf(item.token);
      if (index >= 0 && (!hit || index < hit.index)) hit = { index, token: item.token, member: item.member };
    }
    if (!hit) {
      blocks.push({ type: 'text', text: remaining });
      break;
    }
    if (hit.index > 0) blocks.push({ type: 'text', text: remaining.slice(0, hit.index) });
    blocks.push({ type: 'mention', userId: hit.member.id, label: hit.member.displayName });
    remaining = remaining.slice(hit.index + hit.token.length);
  }
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
