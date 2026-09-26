export function recalledNotice(message: {
  recalledAt?: string | null;
  authorName?: string;
  recallReason?: string | null;
  plainText?: string;
}): string | null {
  if (!message.recalledAt) return null;
  const existing = message.plainText?.trim() ?? '';
  if (existing && existing !== '消息已不可用' && existing.includes('撤回了一条消息')) return existing;
  const reason = message.recallReason?.trim() || '内容有误';
  const name = message.authorName?.trim() || '成员';
  return `${name}因${reason}撤回了一条消息`;
}
