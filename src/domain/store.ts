import { create } from 'zustand';
import type { Bootstrap, Conversation, Message, Attachment } from './contracts';
import type { ReleasePolicy } from './updates';
type State = {
  bootstrap: Bootstrap|null; conversations: Record<string,Conversation>; messages: Record<string,Message[]>;
  files: Attachment[]; drafts: Record<string,string>; cursor: number; connection: string;
  policy: ReleasePolicy|null; ready: boolean; busy: boolean; error: string; accountKey: string;
  applyBootstrap: (b: Bootstrap, accountKey: string) => void;
  setMessages: (id: string, messages: Message[], older?: boolean) => void;
  upsertMessage: (message: Message) => void;
  setDraft: (id: string, text: string) => void;
  reset: () => void;
};
const initial = { bootstrap: null, conversations: {}, messages: {}, files: [], drafts: {}, cursor: 0, connection: '正在连接', policy: null, ready: false, busy: false, error: '', accountKey: '' };
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const list = [...existing];
  for (const m of incoming) {
    const i = list.findIndex(v => v.id === m.id || (!!m.clientMessageId && v.clientMessageId === m.clientMessageId && v.authorId === m.authorId));
    if (i < 0) list.push(m); else list[i] = m;
  }
  return list.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export const useWorkspace = create<State>(set => ({ ...initial,
  applyBootstrap: (b, accountKey) => set(s => ({ bootstrap:b, accountKey, conversations:Object.fromEntries(b.conversations.map(c=>[c.id,c])), files:b.files, ready:true, error:'', cursor:Math.max(s.cursor,b.eventCursor) })),
  setMessages: (id, incoming, older) => set(s => ({ messages:{...s.messages,[id]:older ? mergeMessages(s.messages[id]??[],incoming) : mergeMessages(incoming,(s.messages[id]??[]).filter(m=>m.status))} })),
  upsertMessage: m => set(s => ({messages:{...s.messages,[m.conversationId]:mergeMessages(s.messages[m.conversationId]??[],[m])}})),
  setDraft: (id,text) => set(s=>({drafts:{...s.drafts,[id]:text}})),
  reset: () => set({...initial}),
}));
