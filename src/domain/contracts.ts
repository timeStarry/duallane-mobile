import { z } from 'zod';
const id = z.string().min(1).max(256);
export const notificationLevel = z.enum(['all', 'mentions', 'muted']);
export const memberSchema = z.object({ id, displayName: z.string(), kind: z.string().default('human'), avatarUrl: z.string().nullish(), roleLabel: z.string().optional(), capabilities: z.object({ canStartDirectConversation: z.boolean().default(false) }).default({ canStartDirectConversation: false }) });
export const conversationSchema = z.object({ id, displayTitle: z.string(), type: z.enum(['direct','group']), lastMessagePlainText: z.string().default(''), lastActivityAt: z.string(), unreadCount: z.number().nonnegative().default(0), notificationLevel: notificationLevel.catch('muted'), retentionText: z.string().default(''), members: z.array(memberSchema).default([]), capabilities: z.object({ canSendMessage: z.boolean().default(false), canUploadFile: z.boolean().default(false) }).default({ canSendMessage: false, canUploadFile: false }) });
export const attachmentSchema = z.object({ id, fileName: z.string(), mimeType: z.string(), byteSize: z.number().nonnegative(), status: z.string(), capabilities: z.object({ canDownload: z.boolean().default(false) }).default({ canDownload: false }) });
export const bootstrapSchema = z.object({ auth: z.object({ currentUser: memberSchema }), space: z.object({ id, name: z.string() }), eventCursor: z.number().int().nonnegative(), permissions: z.object({ canReadConversations: z.boolean().default(false), canCreateDirect: z.boolean().default(false), canCreateGroup: z.boolean().default(false), canUpload: z.boolean().default(false), canDownload: z.boolean().default(false) }).default({ canReadConversations: false, canCreateDirect: false, canCreateGroup: false, canUpload: false, canDownload: false }), policy: z.object({ dailyQuotaBytes: z.number(), remainingQuotaBytes: z.number(), messageRetentionCount: z.number() }), members: z.array(memberSchema), conversations: z.array(conversationSchema), files: z.array(attachmentSchema) });
export const sessionSchema = z.object({ accessToken: z.string().min(16), refreshToken: z.string().min(16), accessTokenExpiresAt: z.string().datetime(), refreshTokenExpiresAt: z.string().datetime() });
export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(100000) }),
  z.object({ type: z.literal('mention'), userId: id, label: z.string() }),
  z.object({ type: z.literal('link'), url: z.string().url().refine(v => /^https?:\/\//i.test(v)), label: z.string().optional() }),
  z.object({ type: z.literal('emoji'), shortcode: z.string() }),
  z.object({ type: z.literal('attachment'), attachmentId: id }),
]);
const baseMessage = z.object({ id, conversationId: id, authorId: id.nullish(), authorName: z.string().default('成员'), kind: z.string(), clientMessageId: z.string().nullish(), createdAt: z.string(), plainText: z.string().max(100000).default(''), recalledAt: z.string().nullish(), deletedAt: z.string().nullish(), hiddenByCurrentUser: z.boolean().default(false), attachments: z.array(attachmentSchema).catch([]), content: z.unknown(), version: z.number().optional() });
export type Block = z.infer<typeof blockSchema>;
export type Message = Omit<z.infer<typeof baseMessage>, 'content'> & { blocks: Block[]; fallback: boolean; status?: 'sending'|'failed'; error?: string };
export function parseMessage(input: unknown): Message | null {
  const result = baseMessage.safeParse(input);
  if (!result.success) return null;
  const {content: rawContent, ...base} = result.data;
  if (base.recalledAt || base.deletedAt || base.hiddenByCurrentUser) return { ...base, plainText: '消息已不可用', attachments: [], blocks: [], fallback: false };
  const content = z.object({ format: z.literal('duallane.message+json;v=1'), blocks: z.array(blockSchema).max(1000), plainText: z.string().max(100000).optional() }).safeParse(rawContent);
  // Read the safe summary independently: an unknown block/format must not hide it.
  const summary = z.object({ plainText: z.string().max(100000) }).safeParse(rawContent);
  const fallback = !content.success || (base.version !== undefined && base.version !== 1) || !['user','bot','system'].includes(base.kind);
  // Current HTTP DTO has no envelope version: only realtime event envelopes require it.
  return { ...base, blocks: !fallback && content.success ? content.data.blocks : [], attachments: fallback ? [] : base.attachments, plainText: base.plainText || (summary.success ? summary.data.plainText : '') || (fallback ? '此消息暂不支持，请更新应用后查看' : ''), fallback };
}
export const eventSchema = z.object({ version: z.literal(1), id, spaceId: id, seq: z.number().int().nonnegative(), type: z.string(), conversationId: z.string().nullish(), payload: z.record(z.unknown()) });
export const readySchema = z.object({ type: z.literal('ready'), version: z.literal(1), currentSeq: z.number().int().nonnegative(), replayCount: z.number().int().nonnegative(), hasMore: z.boolean().default(false) });
export type WorkspaceEvent = z.infer<typeof eventSchema>;
export type Bootstrap = z.infer<typeof bootstrapSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type Member = z.infer<typeof memberSchema>;
