import type { Attachment, Conversation, Member, Message } from '../domain/contracts';

const now = '2026-09-17T04:20:00.000Z';

export const syntheticSelf: Member = {
  id: 'user-a',
  displayName: '成员甲',
  kind: 'human',
  avatarUrl: null,
  capabilities: { canStartDirectConversation: true },
};

export const syntheticMembers: Member[] = [
  syntheticSelf,
  { id: 'user-b', displayName: '成员乙', kind: 'human', avatarUrl: null, capabilities: { canStartDirectConversation: true } },
  { id: 'bot-echo', displayName: 'Echo', kind: 'bot', avatarUrl: null, capabilities: { canStartDirectConversation: true } },
];

export const syntheticConversations: Conversation[] = [
  {
    id: 'c-direct',
    displayTitle: '成员乙',
    type: 'direct',
    lastMessagePlainText: '把纪要发到话题里，不要同步到群。',
    lastActivityAt: now,
    unreadCount: 2,
    notificationLevel: 'all',
    retentionText: '最近 500 条',
    members: syntheticMembers.filter(member => member.kind !== 'bot'),
    capabilities: { canSendMessage: true, canUploadFile: true },
  },
  {
    id: 'c-group',
    displayTitle: '工程协作 G1',
    type: 'group',
    lastMessagePlainText: '图片加载失败时应显示文件名，而不是空白气泡。',
    lastActivityAt: '2026-09-16T12:00:00.000Z',
    unreadCount: 0,
    notificationLevel: 'mentions',
    retentionText: '最近 500 条',
    members: syntheticMembers,
    capabilities: { canSendMessage: true, canUploadFile: true },
  },
  {
    id: 'c-muted',
    displayTitle: '公告群',
    type: 'group',
    lastMessagePlainText: '本周维护窗口已发布。',
    lastActivityAt: '2026-09-15T08:00:00.000Z',
    unreadCount: 12,
    notificationLevel: 'muted',
    retentionText: '最近 200 条',
    members: syntheticMembers,
    capabilities: { canSendMessage: false, canUploadFile: false },
  },
];

export const syntheticTopics = [
  { id: 't1', title: 'Android 返回栈', groupName: '工程协作 G1', preview: '详情关闭后应回到聊天而不是列表。', joined: true, closed: false, unreadCount: 1 },
  { id: 't2', title: '已关闭的发布核对', groupName: '工程协作 G1', preview: '此话题已关闭，不能发送。', joined: false, closed: true, unreadCount: 0 },
];

export const syntheticFiles: Attachment[] = [
  { id: 'f-note', fileName: '验收记录-合成.txt', mimeType: 'text/plain', byteSize: 2048, status: 'available', capabilities: { canDownload: true } },
  { id: 'f-long', fileName: '非常长的中文文件名用于检查折行与完整查看-设计对照.pdf', mimeType: 'application/pdf', byteSize: 1048576, status: 'available', capabilities: { canDownload: true } },
  { id: 'f-denied', fileName: 'expired.bin', mimeType: 'application/octet-stream', byteSize: 12, status: 'unavailable', capabilities: { canDownload: false } },
];

export const syntheticMessages: Message[] = [
  {
    id: 'm-text',
    conversationId: 'c-group',
    authorId: 'user-b',
    authorName: '成员乙',
    kind: 'user',
    createdAt: '2026-09-17T04:00:00.000Z',
    plainText: '请在手机上核对长中文、链接 https://example.test/path 和换行。',
    hiddenByCurrentUser: false,
    attachments: [],
    blocks: [{ type: 'text', text: '请在手机上核对长中文、链接 https://example.test/path 和换行。' }],
    fallback: false,
  },
  {
    id: 'm-own',
    conversationId: 'c-group',
    authorId: 'user-a',
    authorName: '成员甲',
    kind: 'user',
    createdAt: '2026-09-17T04:05:00.000Z',
    plainText: '这条是本人消息，用于检查气泡宽度和发送中状态。',
    hiddenByCurrentUser: false,
    attachments: [],
    blocks: [{ type: 'text', text: '这条是本人消息，用于检查气泡宽度和发送中状态。' }],
    fallback: false,
    status: 'sending',
  },
  {
    id: 'm-fail',
    conversationId: 'c-group',
    authorId: 'user-a',
    authorName: '成员甲',
    kind: 'user',
    clientMessageId: 'client-fail',
    createdAt: '2026-09-17T04:06:00.000Z',
    plainText: '发送失败应保留原文和重试。',
    hiddenByCurrentUser: false,
    attachments: [],
    blocks: [{ type: 'text', text: '发送失败应保留原文和重试。' }],
    fallback: false,
    status: 'failed',
    error: '网络中断，请重试',
  },
  {
    id: 'm-file',
    conversationId: 'c-group',
    authorId: 'user-b',
    authorName: '成员乙',
    kind: 'user',
    createdAt: '2026-09-17T04:10:00.000Z',
    plainText: '验收记录-合成.txt',
    hiddenByCurrentUser: false,
    attachments: [syntheticFiles[0]!],
    blocks: [{ type: 'attachment', attachmentId: 'f-note' }],
    fallback: false,
  },
  {
    id: 'm-fallback',
    conversationId: 'c-group',
    authorId: 'bot-echo',
    authorName: 'Echo',
    kind: 'bot',
    createdAt: '2026-09-17T04:12:00.000Z',
    plainText: '未知卡片的安全摘要',
    hiddenByCurrentUser: false,
    attachments: [],
    blocks: [],
    fallback: true,
  },
];
