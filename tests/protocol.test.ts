import { parseMessage } from '../src/domain/contracts';
import { ReplayTracker } from '../src/domain/replay';

// Public DTO fields from apps/backend/internal/workspace/messages/model.go.
const message = { id:'m1', conversationId:'c1', authorId:'u1', authorName:'Member', authorKind:'human', kind:'user', clientMessageId:'local1', createdAt:'2026-09-16T00:00:00Z', editedAt:null, deletedAt:null, recalledAt:null, attachments:[], hiddenByCurrentUser:false };
const content = { format:'duallane.message+json;v=1', plainText:'safe summary', blocks:[{ type:'text', text:'safe summary' }] };

test('Go HTTP message DTO needs no envelope version', () => {
  expect(parseMessage({ ...message, content })?.fallback).toBe(false);
});

test.each([
  { ...content, blocks:[{ type:'future', payload:{ html:'<script>execute()</script>' } }] },
  { ...content, format:'duallane.message+json;v=2' },
])('unknown protocol content preserves its nested safe summary', value => {
  const parsed = parseMessage({ ...message, content:value });
  expect(parsed?.plainText).toBe('safe summary');
  expect(parsed?.fallback).toBe(true);
  expect(parsed?.blocks).toEqual([]);
  expect(JSON.stringify(parsed)).not.toContain('execute');
});

test('missing fallback text and unknown message kind are safe and readable', () => {
  expect(parseMessage({ ...message, kind:'future', content:{ blocks:[] } })?.plainText).toBe('此消息暂不支持，请更新应用后查看');
});

test('recalled and hidden DTOs cannot retain original text or attachments', () => {
  for (const visibility of [{ recalledAt:'2026-09-16T01:00:00Z' }, { hiddenByCurrentUser:true }]) {
    const parsed = parseMessage({ ...message, ...visibility, content, plainText:'old body' });
    expect(parsed?.plainText).toBe('消息已不可用');
    expect(parsed?.blocks).toEqual([]);
    expect(parsed?.attachments).toEqual([]);
  }
});

test('permission-filtered paginated replay only advances high water after the last page', () => {
  const tracker = new ReplayTracker(1);
  const event = (id:string, seq:number) => ({ version:1, type:'event', event:{ version:1, id, seq, spaceId:'spc_default', type:'message.created', payload:{ message } } });
  tracker.accept({ version:1, type:'ready', currentSeq:20, replayCount:1, hasMore:true });
  expect(tracker.accept(event('e1', 4))).toMatchObject({ replay:true, hello:true });
  expect(tracker.cursor).toBe(4);
  tracker.accept({ version:1, type:'ready', currentSeq:20, replayCount:1, hasMore:false });
  expect(tracker.accept(event('e2', 17))).toMatchObject({ replay:true });
  expect(tracker.cursor).toBe(20);
  expect(tracker.accept(event('e3', 22))).toMatchObject({ replay:false });
});

test('an unsupported outer realtime major requests synchronization', () => {
  const tracker = new ReplayTracker(0);
  expect(tracker.accept({ version:2, type:'event', event:{} })).toEqual({ sync:true });
});
