export function visibleAuthorName(
  message: { authorId?: string | null; authorName?: string; kind?: string; authorKind?: string },
  members: Array<{ id: string; displayName: string }>,
  fallback = '',
): string {
  if (message.kind === 'system' || message.authorKind === 'system') return '系统';
  const member = message.authorId ? members.find(item => item.id === message.authorId) : undefined;
  const fromMember = member?.displayName?.trim();
  if (fromMember) return fromMember;
  const raw = message.authorName?.trim() ?? '';
  if (raw && !isInternalHandle(raw)) return raw;
  const named = fallback.trim();
  if (named) return named;
  return '成员';
}

function isInternalHandle(name: string) {
  return name.startsWith('__') && name.endsWith('__');
}
