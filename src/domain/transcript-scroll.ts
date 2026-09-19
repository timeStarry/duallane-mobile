export const LATEST_OFFSET_THRESHOLD = 80;
export const MESSAGE_PAGE_SIZE = 50;

export type TranscriptMode = 'history' | 'complete';

export function newestFirstTranscript<T>(items: readonly T[]): T[] {
  if (items.length < 2) return [...items];
  return items.slice().reverse();
}

export function hasOlderMessages(pageCount: number, pageSize = MESSAGE_PAGE_SIZE) {
  return pageCount >= pageSize;
}

export function transcriptMode(hasOlder: boolean): TranscriptMode {
  return hasOlder ? 'history' : 'complete';
}

export function isPinnedToLatest(input: {
  mode: TranscriptMode;
  offsetY: number;
  contentHeight?: number;
  layoutHeight?: number;
  threshold?: number;
}) {
  const threshold = input.threshold ?? LATEST_OFFSET_THRESHOLD;
  if (input.mode === 'history') return input.offsetY < threshold;
  const content = input.contentHeight ?? 0;
  const layout = input.layoutHeight ?? 0;
  if (content <= layout + threshold) return true;
  return content - input.offsetY - layout < threshold;
}

export function shouldLoadOlderHistory(input: { historyReady: boolean; hasOlder: boolean; messageCount: number }) {
  return input.historyReady && input.hasOlder && input.messageCount > 0;
}
