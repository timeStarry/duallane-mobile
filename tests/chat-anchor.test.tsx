import { act, renderHook } from '@testing-library/react-native';
import type { FlatList, MeasureInWindowOnSuccessCallback, View } from 'react-native';
import type { Runtime } from '../src/data/runtime';
import { bootstrapSchema, parseMessage, topicSchema, type Message } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { useTranscriptAnchor } from '../src/features/chat/useTranscriptAnchor';

function message(id: string): Message {
  return parseMessage({ id, conversationId: 'c1', authorId: 'self', authorName: 'Synthetic', kind: 'user', createdAt: '2026-10-06T00:00:00Z', plainText: 'Synthetic fixture', content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'Synthetic fixture' }] }, attachments: [] })!;
}

beforeEach(() => {
  useWorkspace.getState().reset();
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Synthetic' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 0,
    permissions: { canReadConversations: true }, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 },
    members: [], files: [], conversations: [{ id: 'c1', displayTitle: 'Synthetic', type: 'group', lastActivityAt: '2026-10-06T00:00:00Z' }],
  }), 'test:self');
  useWorkspace.getState().setMessages('c1', [message('reader'), message('partial'), message('tail')]);
});

function setup(mode: 'history' | 'complete' = 'history') {
  let readerY = 150, nativeOffset = 300;
  const viewport = jest.fn<void, [MeasureInWindowOnSuccessCallback]>(callback => callback(0, 100, 390, 500));
  const measure = jest.fn<void, [MeasureInWindowOnSuccessCallback]>(callback => callback(0, readerY, 390, 300));
  const rawMeasure = jest.fn<void, Parameters<View['measureLayout']>>((_relative, callback) => {
    const relativeY = readerY - 100;
    callback(0, mode === 'history' ? 500 + nativeOffset - relativeY - 300 : nativeOffset + relativeY, 390, 300);
  });
  const row = { measureInWindow: measure, measureLayout: rawMeasure } as unknown as View;
  const scroll = jest.fn(({ offset }: { offset: number; animated: boolean }) => {
    readerY += (mode === 'history' ? 1 : -1) * (offset - nativeOffset);
    nativeOffset = offset;
  });
  const runtime = { api: {} } as Runtime;
  const pinToLatest = { current: false };
  const content = { measureInWindow: jest.fn() };
  const list = { current: { getNativeScrollRef: () => ({ measureInWindow: viewport }), getScrollResponder: () => ({ getInnerViewRef: () => content }), scrollToOffset: scroll } as unknown as FlatList };
  const initialProps = { accountKey: 'test:self', bucketKey: 'c1', conversationId: 'c1', topicId: undefined as string | undefined, mode, runtime, messages: useWorkspace.getState().messages.c1!, focused: true, foreground: true, focusMessageId: undefined as string | undefined, list, pinToLatest };
  const hook = renderHook((props: typeof initialProps) => useTranscriptAnchor(props), { initialProps });
  const capture = () => act(() => {
    hook.result.current.register('reader', row);
    hook.result.current.beginUserScroll();
    hook.result.current.offset(nativeOffset, true);
    hook.result.current.visible(new Set(['reader']));
    hook.result.current.endUserScroll();
  });
  const drift = (y: number, offset = nativeOffset) => { readerY = y; nativeOffset = offset; act(() => hook.result.current.offset(offset, false)); };
  return { ...hook, props: initialProps, viewport, measure, rawMeasure, row, scroll, runtime, pinToLatest, capture, drift, physical: (y: number) => { readerY = y; }, y: () => readerY };
}

test.each(['history', 'complete'] as const)('canonical/card re-layout restores the same visual reader coordinate in %s direction', mode => {
  const test = setup(mode);
  test.capture();
  test.drift(50);
  act(() => test.result.current.changed());
  expect(test.y()).toBe(150);
  expect(test.scroll).toHaveBeenCalledWith({ offset: mode === 'history' ? 400 : 200, animated: false });
});

test('the fully visible top reader is preferred over a native bottom partial cell', () => {
  const test = setup();
  const partial = { measureInWindow: (callback: MeasureInWindowOnSuccessCallback) => callback(0, 520, 390, 300) } as View;
  act(() => {
    test.result.current.register('partial', partial);
    test.result.current.register('reader', test.row);
    test.result.current.beginUserScroll();
    test.result.current.offset(300, true);
    test.result.current.visible(new Set(['partial', 'reader']));
    test.result.current.endUserScroll();
  });
  test.drift(-150);
  act(() => useWorkspace.getState().refreshCards());
  expect(test.scroll).toHaveBeenCalledWith({ offset: 600, animated: false });
  expect(test.y()).toBe(150);
});

test('a very long visible card keeps its intra-row reader coordinate', () => {
  const test = setup();
  test.measure.mockImplementation(callback => callback(0, test.y(), 390, 1600));
  test.drift(-600);
  test.capture();
  test.drift(-900);
  act(() => test.result.current.changed());
  expect(test.y()).toBe(-600);
});

test('two same-size native shifts restore the saved anchor with a bounded correction budget', () => {
  const test = setup();
  test.capture();
  test.drift(-150, 400);
  act(() => test.result.current.changed());
  expect(test.y()).toBe(150);
  test.drift(-250, 800);
  expect(test.y()).toBe(150);
  expect(test.scroll).toHaveBeenCalledTimes(2);
  for (const offset of [900, 1000, 1100, 1200]) test.drift(-100, offset);
  expect(test.scroll).toHaveBeenCalledTimes(2);
  // A genuinely changed mounted row height gets a new finite layout budget.
  act(() => { test.result.current.rowLayout('reader', 300); test.result.current.rowLayout('reader', 500); });
  expect(test.y()).toBe(150);
  expect(test.scroll).toHaveBeenCalledTimes(3);
});

test('failed/delayed measurements do not run on every later native offset frame', () => {
  const test = setup();
  test.capture();
  test.viewport.mockClear().mockImplementation(callback => callback(0, 0, 0, 0));
  act(() => test.result.current.changed());
  for (const offset of [400, 500, 600, 700, 800, 900]) test.drift(0, offset);
  expect(test.viewport).toHaveBeenCalledTimes(3);
  expect(test.scroll).not.toHaveBeenCalled();
});

test('background refresh waits for the same route to be active before restoring history', () => {
  const test = setup();
  test.capture();
  test.rerender({ ...test.props, foreground: false });
  test.drift(-150, 400);
  act(() => useWorkspace.getState().refreshCards());
  expect(test.scroll).not.toHaveBeenCalled();
  test.rerender({ ...test.props, foreground: true });
  expect(test.y()).toBe(150);
});

test.each(['account', 'api', 'route', 'mode', 'focus', 'activity', 'drag', 'row', 'deleted', 'read', 'topic', 'unmount'] as const)('a late native anchor measurement cannot restore after %s changes', change => {
  const test = setup();
  test.capture();
  test.drift(-150);
  let callback!: MeasureInWindowOnSuccessCallback;
  test.measure.mockImplementation(next => { callback = next; });
  act(() => test.result.current.changed());
  expect(callback).toBeDefined();
  if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'test:other' }));
  if (change === 'api') test.runtime.api = {} as Runtime['api'];
  if (change === 'route') test.rerender({ ...test.props, bucketKey: 'c2', conversationId: 'c2' });
  if (change === 'mode') test.rerender({ ...test.props, mode: 'complete' });
  if (change === 'focus') test.rerender({ ...test.props, focusMessageId: 'tail' });
  if (change === 'activity') test.rerender({ ...test.props, focused: false });
  if (change === 'drag') act(() => test.result.current.beginUserScroll());
  if (change === 'row') act(() => test.result.current.register('reader', null));
  if (change === 'deleted') act(() => useWorkspace.getState().setMessages('c1', [message('tail')]));
  if (change === 'read') act(() => useWorkspace.setState(state => ({ bootstrap: { ...state.bootstrap!, permissions: { ...state.bootstrap!.permissions, canReadConversations: false } } })));
  if (change === 'topic') {
    act(() => useWorkspace.getState().upsertTopic(topicSchema.parse({ id: 't1', conversationId: 'c1', title: 'Synthetic', joined: false })));
    test.rerender({ ...test.props, topicId: 't1' });
  }
  if (change === 'unmount') test.unmount();
  act(() => callback(0, -150, 390, 300));
  expect(test.scroll).not.toHaveBeenCalled();
});

test('a deleted anchor is discarded rather than resurrected or re-mounted from an old snapshot', () => {
  const test = setup();
  test.capture();
  test.drift(-150);
  act(() => useWorkspace.getState().setMessages('c1', [message('tail')]));
  act(() => test.result.current.changed());
  expect(test.scroll).not.toHaveBeenCalled();
  expect(useWorkspace.getState().messages.c1?.map(message => message.id)).toEqual(['tail']);
});

test('pin-to-latest and a fresh user drag cancel the history restoration target', () => {
  const test = setup();
  test.capture();
  test.pinToLatest.current = true;
  test.drift(-150);
  act(() => test.result.current.changed());
  expect(test.scroll).not.toHaveBeenCalled();
  test.pinToLatest.current = false;
  act(() => test.result.current.beginUserScroll());
  act(() => test.result.current.changed());
  expect(test.scroll).not.toHaveBeenCalled();
});

test('an unmounted virtualized anchor has only one mount hint before an actual row layout', () => {
  const test = setup();
  test.capture();
  act(() => { test.result.current.register('reader', null); test.result.current.changed(); });
  expect(test.scroll).toHaveBeenCalledTimes(1);
  for (const offset of [400, 500, 600]) test.drift(-150, offset);
  expect(test.scroll).toHaveBeenCalledTimes(1);
  act(() => { test.result.current.register('reader', test.row); test.result.current.rowLayout('reader', 300); });
  expect(test.y()).toBe(150);
  expect(test.scroll).toHaveBeenCalledTimes(2);
});

test('a second layout after a native command does not base its correction on the still-delayed JS offset', () => {
  const test = setup();
  test.capture();
  test.drift(50);
  act(() => test.result.current.changed());
  expect(test.y()).toBe(150);
  // Native has already applied 300 -> 400, but JS has not received that scroll.
  // Another card moves the reader before this command's event arrives.
  test.physical(50);
  act(() => test.result.current.changed());
  act(() => test.result.current.visible(new Set(['reader'])));
  act(() => test.result.current.offset(400, false));
  expect(test.y()).toBe(150);
  expect(test.scroll).toHaveBeenLastCalledWith({ offset: 500, animated: false });
});

test('user inertia after drag-end cancels the old anchor until momentum-end captures the new position', () => {
  const test = setup();
  test.capture(); // The drag-end position is only provisional while inertia continues.
  test.physical(50);
  test.drift(50, 400);
  act(() => test.result.current.offset(400, true));
  act(() => test.result.current.changed());
  expect(test.scroll).not.toHaveBeenCalled();
  act(() => test.result.current.endUserScroll());
  test.physical(-50);
  act(() => test.result.current.changed());
  expect(test.y()).toBe(50);
});

test.each(['account', 'api', 'row', 'canonical', 'content', 'user'] as const)('the final relative-layout callback is rejected after %s changes', change => {
  const test = setup();
  test.capture();
  let callback!: Parameters<View['measureLayout']>[1];
  test.rawMeasure.mockImplementation((_relative, next) => { callback = next; });
  test.drift(50);
  act(() => test.result.current.changed());
  expect(callback).toBeDefined();
  if (change === 'account') act(() => useWorkspace.setState({ accountKey: 'test:other' }));
  if (change === 'api') test.runtime.api = {} as Runtime['api'];
  if (change === 'row') act(() => test.result.current.register('reader', null));
  if (change === 'canonical') act(() => useWorkspace.getState().patchMessage('c1', 'reader', { recalledAt: '2026-10-06T00:00:01Z', plainText: '' }));
  if (change === 'content') test.props.list.current.getScrollResponder = () => ({ getInnerViewRef: () => ({ measureInWindow: jest.fn() }) } as unknown as ReturnType<FlatList['getScrollResponder']>);
  if (change === 'user') act(() => test.result.current.offset(400, true));
  act(() => callback(0, 650, 390, 300));
  expect(test.scroll).not.toHaveBeenCalled();
});

test.each(['missing', 'throws'])('unavailable public relative layout (%s) never falls back to an estimated JS offset', failure => {
  const test = setup();
  test.capture();
  test.drift(50);
  if (failure === 'missing') test.props.list.current.getScrollResponder = () => ({} as ReturnType<FlatList['getScrollResponder']>);
  else test.rawMeasure.mockImplementation(() => { throw new Error('Detached synthetic native row'); });
  act(() => test.result.current.changed());
  expect(test.scroll).not.toHaveBeenCalled();
});
