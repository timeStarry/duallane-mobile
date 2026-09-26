import { hideResultSchema, reactionResultSchema, topicCreatedRef } from '../src/domain/command-results';
import { applyMentionSuggestions } from '../src/ui/composerDock';

test('Go hide and reaction envelopes patch local state without a full message', () => {
  expect(hideResultSchema.parse({ messageId: 'm1', hidden: true, changed: true })).toEqual({
    messageId: 'm1',
    hidden: true,
    changed: true,
  });
  expect(reactionResultSchema.parse({
    messageId: 'm1',
    reactions: [{ emoteKey: '👍', count: 1, reactedByCurrentUser: true }],
  }).reactions[0]?.count).toBe(1);
});

test('topic.message.created carries a topic ref instead of a full message', () => {
  expect(topicCreatedRef({ topicId: 't1', topicMessageId: 'tm1' })).toEqual({ topicId: 't1', topicMessageId: 'tm1' });
  expect(topicCreatedRef({})).toEqual({ topicId: '', topicMessageId: '' });
});

test('dismissed mention suggestions stay closed until the query changes', () => {
  expect(applyMentionSuggestions({ suggestionCount: 2, current: 'attach', mentionDismissed: true }).nextPanel).toBe('attach');
});
