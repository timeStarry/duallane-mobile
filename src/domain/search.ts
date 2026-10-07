import type { Bootstrap, Conversation, Topic } from './contracts';

export const SEARCH_HISTORY_LIMIT = 12;
export const SEARCH_TERM_LIMIT = 256;
export const SEARCH_SCOPE_TEXT = '搜索已加载的会话与话题';

export function normalizeSearchTerm(value: string): string {
  const term = value.trim().replace(/\s+/g, ' ');
  return term.length <= SEARCH_TERM_LIMIT ? term : '';
}

export function normalizeSearchHistory(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const term = normalizeSearchTerm(value);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === SEARCH_HISTORY_LIMIT) break;
  }
  return terms;
}

export function rememberSearchTerm(history: readonly string[], query: string): string[] {
  const term = normalizeSearchTerm(query);
  return normalizeSearchHistory(term ? [term, ...history] : history);
}

export type LoadedSearchWorkspace = {
  accountKey: string;
  bootstrap: Bootstrap | null;
  conversations: Record<string, Conversation>;
  topics: Record<string, Topic>;
};

export function searchLoadedWorkspace(workspace: LoadedSearchWorkspace, query: string): { conversations: Conversation[]; topics: Topic[] } {
  const term = normalizeSearchTerm(query).toLowerCase();
  if (!term || !workspace.bootstrap?.permissions.canReadConversations
    || !workspace.accountKey.endsWith(`:${workspace.bootstrap.auth.currentUser.id}`)) return { conversations: [], topics: [] };
  const selfId = workspace.bootstrap.auth.currentUser.id;
  const directory = new Map(workspace.bootstrap.members.map(member => [member.id, member]));
  const rank = (values: string[]) => values.reduce((best, value) => {
    const text = value.toLowerCase();
    return Math.min(best, text === term ? 0 : text.startsWith(term) ? 1 : text.includes(term) ? 2 : 3);
  }, 3);
  const conversations = Object.values(workspace.conversations).map(item => {
    const fields = [item.displayTitle];
    if (item.type === 'direct') for (const peer of item.members) {
      if (peer.id === selfId) continue;
      const listed = directory.get(peer.id);
      fields.push(listed?.displayName ?? peer.displayName, listed?.githubLogin ?? peer.githubLogin ?? '');
    }
    return { item, rank: rank(fields) };
  }).filter(result => result.rank < 3)
    .sort((a, b) => a.rank - b.rank || b.item.lastActivityAt.localeCompare(a.item.lastActivityAt) || a.item.id.localeCompare(b.item.id))
    .map(result => result.item);
  // A loaded topic DTO is discoverable metadata, including for an unjoined topic;
  // its messages still require joining. Never reveal an orphaned parent's topic.
  const topics = Object.values(workspace.topics).filter(item => {
    const parent = workspace.conversations[item.conversationId];
    return parent?.type === 'group' && [item.title, item.descriptionPreview ?? item.description ?? '']
      .some(value => value.toLowerCase().includes(term));
  }).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { conversations, topics };
}
