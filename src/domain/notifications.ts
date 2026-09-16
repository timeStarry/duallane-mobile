import type { Conversation, Message } from './contracts';
export function shouldNotify(input: { background: boolean; replay: boolean; message: Message; userId: string; conversation?: Conversation }): boolean {
  const { background, replay, message, userId, conversation } = input;
  if (!background || replay || !conversation || message.authorId === userId || message.recalledAt || message.deletedAt || message.hiddenByCurrentUser || message.kind === 'system') return false;
  if (conversation.notificationLevel === 'muted') return false;
  if (conversation.notificationLevel === 'mentions') return message.blocks.some(b => b.type === 'mention' && b.userId === userId);
  return true;
}
