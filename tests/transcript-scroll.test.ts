import { hasOlderMessages, isMeasuredTailVisible, isPinnedToLatest, newestFirstTranscript, scrollResponderToEnd, shouldLoadOlderHistory, transcriptMode } from '../src/domain/transcript-scroll';

test.each([
  [{ x: 0, y: 500, width: 390, height: 100 }, true],
  [{ x: 0, y: -500, width: 390, height: 1100 }, true],
  [{ x: 0, y: -500, width: 390, height: 3000 }, false],
  [{ x: 0, y: 100, width: 390, height: 100 }, true],
  [{ x: 0, y: 500, width: 390, height: 102 }, false],
  [{ x: 0, y: 600, width: 390, height: 100 }, false],
  [{ x: 0, y: 0, width: 390, height: 100 }, false],
  [{ x: 400, y: 500, width: 390, height: 100 }, false],
  [{ x: 0, y: 500, width: 0, height: 100 }, false],
  [{ x: 0, y: Number.NaN, width: 390, height: 100 }, false],
])('native tail rectangle %j confirms its visible end: %s', (tail, expected) => {
  expect(isMeasuredTailVisible({ x: 0, y: 100, width: 390, height: 500 }, tail)).toBe(expected);
});

test('newest-first transcript puts the latest chronological item at index 0', () => {
  expect(newestFirstTranscript(['old', 'mid', 'new'])).toEqual(['new', 'mid', 'old']);
  expect(newestFirstTranscript(['only'])).toEqual(['only']);
});

test('a short first page means the whole history is already loaded', () => {
  expect(hasOlderMessages(6)).toBe(false);
  expect(hasOlderMessages(50)).toBe(true);
  expect(transcriptMode(false)).toBe('complete');
  expect(transcriptMode(true)).toBe('history');
});

test('inverted latest pin is the start offset, not scrollToEnd', () => {
  expect(isPinnedToLatest({ mode: 'history', offsetY: 0 })).toBe(true);
  expect(isPinnedToLatest({ mode: 'history', offsetY: 79 })).toBe(true);
  expect(isPinnedToLatest({ mode: 'history', offsetY: 80 })).toBe(false);
});

test('complete history that fits the viewport stays pinned without a jump control', () => {
  expect(isPinnedToLatest({ mode: 'complete', offsetY: 0 })).toBe(false);
  expect(isPinnedToLatest({ mode: 'complete', offsetY: 0, contentHeight: 0, layoutHeight: 0 })).toBe(false);
  expect(isPinnedToLatest({ mode: 'complete', offsetY: 0, contentHeight: 400, layoutHeight: 800 })).toBe(true);
  expect(isPinnedToLatest({ mode: 'complete', offsetY: 0, contentHeight: 1200, layoutHeight: 800 })).toBe(false);
  expect(isPinnedToLatest({ mode: 'complete', offsetY: 360, contentHeight: 1200, layoutHeight: 800 })).toBe(true);
});

test('complete transcript scrolling uses the public native responder with its receiver intact', () => {
  const calls: boolean[] = [];
  const responder = { scrollToEnd(options: { animated: boolean }) { expect(this).toBe(responder); calls.push(options.animated); } };
  scrollResponderToEnd(responder, false);
  scrollResponderToEnd(responder, true);
  expect(calls).toEqual([false, true]);
  expect(() => scrollResponderToEnd(null, false)).not.toThrow();
  expect(() => scrollResponderToEnd({ scrollToEnd: 'not callable' }, false)).not.toThrow();
});

test('older pages do not autoload until the user has scrolled the transcript', () => {
  expect(shouldLoadOlderHistory({ historyReady: false, hasOlder: true, messageCount: 50 })).toBe(false);
  expect(shouldLoadOlderHistory({ historyReady: true, hasOlder: true, messageCount: 50 })).toBe(true);
  expect(shouldLoadOlderHistory({ historyReady: true, hasOlder: false, messageCount: 50 })).toBe(false);
  expect(shouldLoadOlderHistory({ historyReady: true, hasOlder: true, messageCount: 0 })).toBe(false);
});
