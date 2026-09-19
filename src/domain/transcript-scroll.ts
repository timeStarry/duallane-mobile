export const LATEST_OFFSET_THRESHOLD = 80;

export function newestFirstTranscript<T>(items: readonly T[]): T[] {
  if (items.length < 2) return [...items];
  return items.slice().reverse();
}

export function isPinnedToLatest(offsetY: number, threshold = LATEST_OFFSET_THRESHOLD) {
  return offsetY < threshold;
}

export function shouldLoadOlderHistory(input: { historyReady: boolean; hasOlder: boolean; messageCount: number }) {
  return input.historyReady && input.hasOlder && input.messageCount > 0;
}
