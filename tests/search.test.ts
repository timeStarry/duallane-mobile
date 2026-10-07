import { bootstrapSchema, conversationSchema, memberSchema, topicSchema } from '../src/domain/contracts';
import { normalizeSearchHistory, rememberSearchTerm, searchLoadedWorkspace } from '../src/domain/search';

const conversation = (id: string, title: string, time: string, type: 'direct' | 'group' = 'group') => conversationSchema.parse({ id, displayTitle: title, type, lastActivityAt: time, lastMessagePlainText: 'Hidden body needle' });
const group = conversation('g1', 'Design Group', '2026-10-07T00:00:00.000Z');
const direct = conversation('d1', 'Design Person', '2026-10-07T01:00:00.000Z', 'direct');
const bootstrap = bootstrapSchema.parse({ auth: { currentUser: { id: 'u1', displayName: 'Synthetic' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 0, permissions: { canReadConversations: true }, policy: { dailyQuotaBytes: 1, remainingQuotaBytes: 1, messageRetentionCount: 50 }, members: [], conversations: [group, direct], files: [] });
const topic = topicSchema.parse({ id: 't1', conversationId: 'g1', title: 'Release', descriptionPreview: 'Design discussion', joined: false });
const workspace = { accountKey: 'https://synthetic.test:u1', bootstrap, conversations: { g1: group, d1: direct }, topics: { t1: topic } };

test('history preserves latest spelling, deduplicates and bounds at twelve without empty or invalid cache data', () => {
  const history = normalizeSearchHistory(['  Design  ', 5, '', 'design', ...Array.from({ length: 20 }, (_, i) => `Query ${i}`)]);
  expect(history).toHaveLength(12);
  expect(history[0]).toBe('Design');
  expect(rememberSearchTerm(history, ' DESIGN ')).toEqual(['DESIGN', ...history.slice(1)]);
  expect(rememberSearchTerm(history, '   ')).toEqual(history);
  expect(normalizeSearchHistory(['x'.repeat(257), 'normal'])).toEqual(['normal']);
});

test('search matches loaded names and topic public summaries, retains canonical rows and recent conversation order', () => {
  const result = searchLoadedWorkspace(workspace, '  DESIGN ');
  expect(result.conversations).toEqual([direct, group]);
  expect(result.topics).toEqual([topic]);
  expect(result.topics[0]?.joined).toBe(false);
  expect(searchLoadedWorkspace(workspace, 'Hidden body needle')).toEqual({ conversations: [], topics: [] });
  expect(searchLoadedWorkspace(workspace, '   ')).toEqual({ conversations: [], topics: [] });
});

test('no account, mismatched identity or read permission never yields cached results', () => {
  for (const state of [{ ...workspace, accountKey: '' }, { ...workspace, accountKey: 'https://synthetic.test:u2' }, { ...workspace, bootstrap: null }, { ...workspace, bootstrap: { ...bootstrap, permissions: { ...bootstrap.permissions, canReadConversations: false } } }]) {
    expect(searchLoadedWorkspace(state, 'design')).toEqual({ conversations: [], topics: [] });
  }
});

test('orphan topics and topics attached to a private conversation cannot reveal metadata', () => {
  const bad = { ...topic, id: 't2', conversationId: 'missing' };
  const privateTopic = { ...topic, id: 't3', conversationId: 'd1' };
  expect(searchLoadedWorkspace({ ...workspace, topics: { t1: topic, t2: bad, t3: privateTopic } }, 'design').topics).toEqual([topic]);
  expect(searchLoadedWorkspace({ ...workspace, conversations: { d1: direct } }, 'design').topics).toEqual([]);
});

test('direct peers match display name and GitHub login but self and group members are not searchable fields', () => {
  const self = memberSchema.parse({ id: 'u1', displayName: 'Self Needle', githubLogin: 'self-needle' });
  const peer = memberSchema.parse({ id: 'u2', displayName: 'Peer Needle', githubLogin: 'peer-login' });
  const dm = conversationSchema.parse({ ...direct, displayTitle: 'Friendly remark', members: [self, { id: peer.id, displayName: 'Stale peer name' }] });
  const state = { ...workspace, bootstrap: { ...bootstrap, members: [self, peer] }, conversations: { d1: dm, g1: conversationSchema.parse({ ...group, members: [peer] }) } };
  expect(searchLoadedWorkspace(state, 'peer needle').conversations).toEqual([dm]);
  expect(searchLoadedWorkspace(state, 'peer-login').conversations).toEqual([dm]);
  expect(searchLoadedWorkspace(state, 'Self Needle').conversations).toEqual([]);
  expect(searchLoadedWorkspace(state, 'self-needle').conversations).toEqual([]);
});

test('conversation matches rank exact then prefix before recent activity, including peer names', () => {
  const contains = conversation('contains', 'Project Design', '2026-10-07T03:00:00.000Z');
  const prefix = conversation('prefix', 'Design team', '2026-10-07T02:00:00.000Z');
  const exact = conversation('exact', 'Design', '2026-10-07T00:00:00.000Z');
  const peerExact = conversationSchema.parse({ ...direct, id: 'peer-exact', members: [{ id: 'u2', displayName: 'Design' }] });
  expect(searchLoadedWorkspace({ ...workspace, conversations: { contains, prefix, exact, 'peer-exact': peerExact } }, 'design').conversations.map(item => item.id)).toEqual(['peer-exact', 'exact', 'prefix', 'contains']);
});
