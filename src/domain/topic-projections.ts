import { z } from 'zod';
import type { Conversation, Message, Topic } from './contracts';

export const topicProjectionSchema = z.object({
  id: z.string().min(1),
  topicMessageId: z.string().min(1),
  removedAt: z.string().nullish(),
});
export const topicProjectionsSchema = z.object({ projections: z.array(topicProjectionSchema) });
export const topicProjectionResultSchema = z.object({ projection: topicProjectionSchema.nullable() });
export type TopicProjection = z.infer<typeof topicProjectionSchema>;
// The existing server list contract is capped and has no cursor or target filter.
export const topicProjectionLimit = 200;

export function isTopicMessageProjected(projections: TopicProjection[], messageId: string) {
  return projections.some(projection => projection.topicMessageId === messageId && !projection.removedAt);
}

export function canToggleTopicProjection(message: Message, topic?: Topic, conversation?: Conversation) {
  return !!topic?.joined && topic.status === 'open' && topic.allowSyncToGroup
    && conversation?.type === 'group' && conversation.id === topic.conversationId && conversation.capabilities.canSendMessage
    && message.topicId === topic.id && message.conversationId === topic.conversationId
    && !message.status && !message.recalledAt && !message.deletedAt && !message.hiddenByCurrentUser;
}
