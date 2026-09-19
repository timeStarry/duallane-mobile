import { z } from 'zod';
import { conversationSchema } from '../domain/contracts';
import type { ApiClient } from './client';

export const topicReadResultSchema = z.object({
  read: z.object({
    topicId: z.string(),
    lastReadMessageId: z.string().nullish(),
    unreadCount: z.number().optional(),
  }),
});

export async function markInboxRead(api: ApiClient, kind: 'conversation' | 'topic', id: string) {
  if (kind === 'topic') {
    return api.json(`/api/workspace/topics/${encodeURIComponent(id)}/read`, topicReadResultSchema, {}, 'POST');
  }
  return api.json(`/api/workspace/conversations/${encodeURIComponent(id)}/read`, z.object({ conversation: conversationSchema }), {}, 'POST');
}
