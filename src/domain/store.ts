import { create } from 'zustand';
import type { Attachment, Bootstrap, ChatSettings, Conversation, Draft, Message, Topic } from './contracts';
import type { ReleasePolicy } from './updates';

type State = {
  bootstrap: Bootstrap | null;
  conversations: Record<string, Conversation>;
  topics: Record<string, Topic>;
  messages: Record<string, Message[]>;
  files: Attachment[];
  drafts: Record<string, Draft>;
  chatSettings: ChatSettings | null;
  cursor: number;
  cardRevisions: Record<string, number>;
  cardSyncVersion: number;
  connection: string;
  policy: ReleasePolicy | null;
  ready: boolean;
  busy: boolean;
  error: string;
  accountKey: string;
  applyBootstrap: (b: Bootstrap, accountKey: string) => void;
  setTopics: (topics: Topic[]) => void;
  upsertTopic: (topic: Topic) => void;
  setMessages: (id: string, messages: Message[], older?: boolean) => void;
  upsertMessage: (message: Message, bucket?: string) => void;
  patchMessage: (bucket: string, id: string, patch: Partial<Message>) => void;
  pruneTopics: (allowedIds: Set<string>) => void;
  setDraft: (id: string, draft: Partial<Draft> | string) => void;
  setChatSettings: (settings: ChatSettings | null) => void;
  invalidateCard: (id: string, revision: number, invalidated?: boolean) => void;
  refreshCards: () => void;
  reset: () => void;
};

const emptyDraft = (): Draft => ({ text: '', mentionIds: [] });
const initial = {
  bootstrap: null, conversations: {}, topics: {}, messages: {}, files: [], drafts: {}, chatSettings: null,
  cursor: 0, cardRevisions: {} as Record<string, number>, cardSyncVersion: 0,
  connection: '正在连接', policy: null, ready: false, busy: false, error: '', accountKey: '',
};

export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const list = [...existing];
  for (const m of incoming) {
    const i = list.findIndex(v => v.id === m.id || (!!m.clientMessageId && v.clientMessageId === m.clientMessageId && v.authorId === m.authorId && v.conversationId === m.conversationId));
    if (i < 0) list.push(m);
    else if (!m.status || list[i]?.status) list[i] = m;
  }
  return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

function messageBucket(message: Message) {
  return message.topicId ? `topic:${message.topicId}` : message.conversationId;
}

export const useWorkspace = create<State>(set => ({
  ...initial,
  applyBootstrap: (b, accountKey) => set(s => {
    const sameAccount = s.accountKey === accountKey && s.bootstrap?.space.id === b.space.id;
    const conversations = Object.fromEntries((b.permissions.canReadConversations ? b.conversations : []).map(c => [c.id, c]));
    const messages = sameAccount ? Object.fromEntries(Object.entries(s.messages).filter(([id]) => {
      if (id.startsWith('topic:')) {
        const topic = s.topics[id.slice(6)];
        return !!topic?.joined && topic.conversationId in conversations;
      }
      return id in conversations;
    })) : {};
    const drafts = sameAccount ? Object.fromEntries(Object.entries(s.drafts).filter(([id]) => {
      if (id.startsWith('topic:')) {
        const topic = s.topics[id.slice(6)];
        return !!topic?.joined && topic.conversationId in conversations;
      }
      return id in conversations;
    })) : {};
    const topics = sameAccount ? Object.fromEntries(Object.entries(s.topics).filter(([, topic]) => topic.conversationId in conversations)) : {};
    return {
      bootstrap: b, accountKey, conversations, messages, drafts, topics, files: b.permissions.canDownload ? b.files : [], ready: true, error: '', cursor: b.eventCursor,
      cardRevisions: sameAccount ? s.cardRevisions : {},
      // A fresh snapshot recovers projection events that were missed while disconnected.
      cardSyncVersion: s.cardSyncVersion + (!sameAccount || s.bootstrap?.eventCursor !== b.eventCursor ? 1 : 0),
    };
  }),
  setTopics: incoming => set(s => {
    const topics = Object.fromEntries(incoming.map(topic => [topic.id, topic]));
    const readable = (id: string) => !id.startsWith('topic:') || (!!topics[id.slice(6)]?.joined && !!s.conversations[topics[id.slice(6)]!.conversationId]);
    return { topics, messages: Object.fromEntries(Object.entries(s.messages).filter(([id]) => readable(id))), drafts: Object.fromEntries(Object.entries(s.drafts).filter(([id]) => readable(id))) };
  }),
  upsertTopic: topic => set(s => {
    const topics = { ...s.topics, [topic.id]: topic };
    if (topic.joined && s.conversations[topic.conversationId]) return { topics };
    const messages = { ...s.messages }, drafts = { ...s.drafts };
    delete messages[`topic:${topic.id}`];
    delete drafts[`topic:${topic.id}`];
    return { topics, messages, drafts };
  }),
  setMessages: (id, incoming, older) => set(s => ({ messages: { ...s.messages, [id]: older ? mergeMessages(s.messages[id] ?? [], incoming) : mergeMessages(incoming, (s.messages[id] ?? []).filter(m => m.status)) } })),
  upsertMessage: (m, bucket) => set(s => {
    const key = bucket ?? messageBucket(m);
    return { messages: { ...s.messages, [key]: mergeMessages(s.messages[key] ?? [], [m]) } };
  }),
  patchMessage: (bucket, id, patch) => set(s => ({
    messages: {
      ...s.messages,
      [bucket]: (s.messages[bucket] ?? []).map(message => message.id === id ? { ...message, ...patch } : message),
    },
  })),
  pruneTopics: allowedIds => set(s => {
    const topics = Object.fromEntries(Object.entries(s.topics).filter(([id]) => allowedIds.has(id)));
    const messages = Object.fromEntries(Object.entries(s.messages).filter(([id]) => !id.startsWith('topic:') || allowedIds.has(id.slice(6))));
    const drafts = Object.fromEntries(Object.entries(s.drafts).filter(([id]) => !id.startsWith('topic:') || allowedIds.has(id.slice(6))));
    return { topics, messages, drafts };
  }),
  setDraft: (id, draft) => set(s => {
    const current = s.drafts[id] ?? emptyDraft();
    const next = typeof draft === 'string' ? { ...current, text: draft } : { ...current, ...draft };
    return { drafts: { ...s.drafts, [id]: next } };
  }),
  setChatSettings: chatSettings => set({ chatSettings }),
  invalidateCard: (id, revision, invalidated = false) => set(s => {
    const previous = s.cardRevisions[id] ?? 0;
    if (revision <= previous && !invalidated) return s;
    return { cardRevisions: { ...s.cardRevisions, [id]: Math.max(revision, previous + (invalidated && revision <= previous ? 1 : 0)) } };
  }),
  refreshCards: () => set(s => ({ cardSyncVersion: s.cardSyncVersion + 1 })),
  reset: () => set({ ...initial }),
}));
