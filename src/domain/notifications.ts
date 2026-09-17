import type { Conversation, Message, Topic } from './contracts';
export function shouldNotify(input: { background: boolean; replay: boolean; message: Message; userId: string; conversation?: Conversation; topic?: Topic }): boolean {
  const { background, replay, message, userId, conversation, topic } = input;
  const level = topic?.notificationLevel ?? conversation?.notificationLevel;
  if (!background || replay || !level || message.authorId === userId || message.recalledAt || message.deletedAt || message.hiddenByCurrentUser || message.kind === 'system') return false;
  if (level === 'muted') return false;
  if (level === 'mentions') return message.blocks.some(b => b.type === 'mention' && b.userId === userId);
  return true;
}
