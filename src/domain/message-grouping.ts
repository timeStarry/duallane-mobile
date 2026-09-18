export type MessageGroupPosition = 'single' | 'start' | 'middle' | 'end';

export function getMessageDayKey(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function formatMessageDayLabel(value?: string, now = new Date()) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDelta = Math.round((startOfToday - startOfDate) / 86400000);
  if (dayDelta === 0) return '今天';
  if (dayDelta === 1) return '昨天';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export type GroupableMessage = {
  id: string;
  authorId?: string | null;
  authorKind?: string;
  kind?: string;
  hiddenByCurrentUser?: boolean;
  recalledAt?: string | null;
  replyToMessageId?: string | null;
  createdAt: string;
  self?: boolean;
};

function canContinueGroup(previous: GroupableMessage | undefined, message: GroupableMessage) {
  if (!previous || !message.authorId || message.authorId !== previous.authorId) return false;
  if ((message.authorKind ?? 'human') !== (previous.authorKind ?? 'human')) return false;
  if (message.self !== undefined && previous.self !== undefined && Boolean(message.self) !== Boolean(previous.self)) return false;
  if ([previous, message].some(entry =>
    entry.authorKind === 'system' || entry.kind === 'system' || entry.hiddenByCurrentUser || entry.recalledAt || entry.replyToMessageId
  )) return false;
  const previousTime = Date.parse(previous.createdAt ?? '');
  const messageTime = Date.parse(message.createdAt ?? '');
  return Number.isFinite(previousTime) && Number.isFinite(messageTime)
    && messageTime >= previousTime
    && messageTime - previousTime <= 5 * 60 * 1000
    && getMessageDayKey(previous.createdAt) === getMessageDayKey(message.createdAt);
}

export function getMessageGroupPositions(messages: readonly GroupableMessage[], unreadIndex = -1): MessageGroupPosition[] {
  const continues = messages.map((message, index) => index !== unreadIndex && canContinueGroup(messages[index - 1], message));
  return continues.map((fromPrevious, index) => {
    const toNext = continues[index + 1] ?? false;
    return fromPrevious ? toNext ? 'middle' : 'end' : toNext ? 'start' : 'single';
  });
}

export function workspaceUnreadIndex(messages: readonly { id: string }[], lastReadMessageId?: string | null) {
  if (!lastReadMessageId) return -1;
  const lastReadIndex = messages.findIndex(message => message.id === lastReadMessageId);
  if (lastReadIndex < 0) return -1;
  return Math.min(messages.length - 1, lastReadIndex + 1);
}
