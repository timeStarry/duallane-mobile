import { markInboxRead } from '../src/data/inbox-read';
import type { ApiClient } from '../src/data/client';

test('markInboxRead posts empty JSON bodies and parses topic {read} envelopes', async () => {
  const json = jest.fn();
  const api = { json } as unknown as ApiClient;
  json.mockResolvedValueOnce({ conversation: { id: 'c1' } });
  await markInboxRead(api, 'conversation', 'c1');
  expect(json.mock.calls[0]?.[0]).toBe('/api/workspace/conversations/c1/read');
  expect(json.mock.calls[0]?.[2]).toEqual({});
  expect(json.mock.calls[0]?.[3]).toBe('POST');

  json.mockResolvedValueOnce({ read: { topicId: 't1', lastReadMessageId: 'm9', unreadCount: 0 } });
  const topic = await markInboxRead(api, 'topic', 't1');
  expect(json.mock.calls[1]?.[0]).toBe('/api/workspace/topics/t1/read');
  expect(json.mock.calls[1]?.[2]).toEqual({});
  expect(json.mock.calls[1]?.[3]).toBe('POST');
  expect(topic).toEqual({ read: { topicId: 't1', lastReadMessageId: 'm9', unreadCount: 0 } });
});
