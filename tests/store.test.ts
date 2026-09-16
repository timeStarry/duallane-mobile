import { bootstrapSchema, parseMessage } from '../src/domain/contracts';
import { mergeMessages, useWorkspace } from '../src/domain/store';

const message = parseMessage({ id:'m1', conversationId:'c1', authorId:'u1', kind:'user', clientMessageId:'local1', createdAt:'2026-09-16T00:00:00Z', plainText:'canonical', content:{ format:'duallane.message+json;v=1', plainText:'canonical', blocks:[{ type:'text', text:'canonical' }] } })!;
const bootstrap = bootstrapSchema.parse({ auth:{ currentUser:{ id:'u1', displayName:'Member' } }, space:{ id:'spc_default', name:'Workspace' }, eventCursor:8, permissions:{ canReadConversations:true, canDownload:true }, policy:{ dailyQuotaBytes:2147483648, remainingQuotaBytes:2147483648, messageRetentionCount:10000 }, members:[], conversations:[{ id:'c1', type:'group', displayTitle:'Team', lastActivityAt:'2026-09-16T00:00:00Z', notificationLevel:'all' }], files:[] });

beforeEach(() => useWorkspace.getState().reset());

test('a canonical HTTP page wins over pending local text and late HTTP failure', () => {
  const pending = { ...message, id:'local1', plainText:'local', status:'sending' as const };
  useWorkspace.getState().upsertMessage(pending);
  useWorkspace.getState().setMessages('c1', [message]);
  useWorkspace.getState().upsertMessage({ ...pending, status:'failed' });
  expect(useWorkspace.getState().messages.c1).toEqual([message]);
});

test('message idempotency keys are scoped by author and conversation', () => {
  expect(mergeMessages([message], [{ ...message, id:'m2', authorId:'u2' }, { ...message, id:'m3', conversationId:'c2' }])).toHaveLength(3);
});

test('changing account drops messages, drafts and the previous account cursor', () => {
  useWorkspace.getState().applyBootstrap(bootstrap, 'https://workspace.test:u1');
  useWorkspace.getState().upsertMessage(message);
  useWorkspace.getState().setDraft('c1', 'private draft');
  useWorkspace.setState({ cursor:100 });
  useWorkspace.getState().applyBootstrap({ ...bootstrap, eventCursor:2 }, 'https://workspace.test:u2');
  expect(useWorkspace.getState().messages).toEqual({});
  expect(useWorkspace.getState().drafts).toEqual({});
  expect(useWorkspace.getState().cursor).toBe(2);
});

test('membership loss removes locally loaded messages and drafts for the conversation', () => {
  useWorkspace.getState().applyBootstrap(bootstrap, 'account');
  useWorkspace.getState().upsertMessage(message);
  useWorkspace.getState().setDraft('c1', 'private draft');
  useWorkspace.getState().applyBootstrap({ ...bootstrap, conversations:[] }, 'account');
  expect(useWorkspace.getState().messages).toEqual({});
  expect(useWorkspace.getState().drafts).toEqual({});
});

test('revoked read permission clears cached conversation content even in a stale bootstrap list', () => {
  useWorkspace.getState().applyBootstrap(bootstrap, 'account');
  useWorkspace.getState().upsertMessage(message);
  useWorkspace.getState().applyBootstrap({ ...bootstrap, permissions:{ ...bootstrap.permissions, canReadConversations:false } }, 'account');
  expect(useWorkspace.getState().conversations).toEqual({});
  expect(useWorkspace.getState().messages).toEqual({});
});
