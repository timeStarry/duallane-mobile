import { z } from 'zod';
import { reactionSchema } from './contracts';

export const hideResultSchema = z.object({
  messageId: z.string().min(1),
  hidden: z.boolean(),
  changed: z.boolean().optional(),
});

export const reactionResultSchema = z.object({
  messageId: z.string().min(1),
  reactions: z.array(reactionSchema),
});

export function topicCreatedRef(payload: Record<string, unknown>) {
  const topicId = typeof payload.topicId === 'string' ? payload.topicId : '';
  const topicMessageId = typeof payload.topicMessageId === 'string' ? payload.topicMessageId : '';
  return { topicId, topicMessageId };
}
