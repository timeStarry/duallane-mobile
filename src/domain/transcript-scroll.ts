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
  if (!Number.isFinite(content) || !Number.isFinite(layout) || content < 0 || layout <= 0) return false;
  if (content <= layout + threshold) return true;
  return content - input.offsetY - layout < threshold;
}

// FlatList's declaration returns a JSX element, but its public responder exposes scrollToEnd.
export function scrollResponderToEnd(responder: unknown, animated: boolean) {
  if (responder && typeof responder === 'object' && 'scrollToEnd' in responder && typeof responder.scrollToEnd === 'function') {
    responder.scrollToEnd({ animated });
  }
}

export type MeasuredTranscriptRect = { x: number; y: number; width: number; height: number };

export function isMeasuredTailVisible(viewport: MeasuredTranscriptRect, tail: MeasuredTranscriptRect) {
  if (![viewport, tail].every(rect => Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0)) return false;
  const tailEnd = tail.y + tail.height;
  return tail.x < viewport.x + viewport.width && tail.x + tail.width > viewport.x
    && tail.y < viewport.y + viewport.height && tailEnd > viewport.y
    && tailEnd <= viewport.y + viewport.height + 1;
}

export function shouldLoadOlderHistory(input: { historyReady: boolean; hasOlder: boolean; messageCount: number }) {
  return input.historyReady && input.hasOlder && input.messageCount > 0;
}
