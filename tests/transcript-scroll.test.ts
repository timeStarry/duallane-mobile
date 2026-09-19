import { isPinnedToLatest, newestFirstTranscript, shouldLoadOlderHistory } from '../src/domain/transcript-scroll';

test('newest-first transcript puts the latest chronological item at index 0', () => {
  expect(newestFirstTranscript(['old', 'mid', 'new'])).toEqual(['new', 'mid', 'old']);
  expect(newestFirstTranscript(['only'])).toEqual(['only']);
});

test('inverted latest pin is the start offset, not scrollToEnd', () => {
  expect(isPinnedToLatest(0)).toBe(true);
  expect(isPinnedToLatest(79)).toBe(true);
  expect(isPinnedToLatest(80)).toBe(false);
});

test('older pages do not autoload until the user has scrolled the transcript', () => {
  expect(shouldLoadOlderHistory({ historyReady: false, hasOlder: true, messageCount: 50 })).toBe(false);
  expect(shouldLoadOlderHistory({ historyReady: true, hasOlder: true, messageCount: 50 })).toBe(true);
  expect(shouldLoadOlderHistory({ historyReady: true, hasOlder: false, messageCount: 50 })).toBe(false);
  expect(shouldLoadOlderHistory({ historyReady: true, hasOlder: true, messageCount: 0 })).toBe(false);
});
