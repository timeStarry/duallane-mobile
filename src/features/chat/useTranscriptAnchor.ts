import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { FlatList, View } from 'react-native';
import type { Runtime } from '../../data/runtime';
import type { Message } from '../../domain/contracts';
import { useWorkspace } from '../../domain/store';

type NativeRow = Pick<View, 'measureInWindow' | 'measureLayout'>;
type Rect = { x: number; y: number; width: number; height: number };
type ReaderAnchor = { id: string; y: number; offset: number };
const maximumRows = 256;
const maximumVisibleRows = 32;
const maximumCorrections = 2;
const maximumMeasurements = 3;

function validRect(rect: Rect) {
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

// MVCP follows a raw cell's top. Inverted/transformed cards can change their
// internal height while that cell remains fixed, moving the reader's visual row.
export function useTranscriptAnchor({ accountKey, bucketKey, conversationId, topicId, mode, runtime, messages, focused, foreground, focusMessageId, list, pinToLatest }: {
  accountKey: string; bucketKey: string; conversationId: string; topicId?: string;
  mode: 'history' | 'complete'; runtime: Runtime; messages: Message[];
  focused: boolean; foreground: boolean; focusMessageId?: string;
  list: React.RefObject<FlatList | null>; pinToLatest: React.RefObject<boolean>;
}) {
  const api = runtime.api;
  const syncVersion = useWorkspace(state => state.cardSyncVersion);
  const cardRevisions = useWorkspace(state => state.cardRevisions);
  const canRead = useWorkspace(state => !!state.bootstrap?.permissions.canReadConversations && !!state.conversations[conversationId]
    && (!topicId || (!!state.topics[topicId]?.joined && state.topics[topicId]?.conversationId === conversationId)));
  const state = useMemo(() => ({
    accountKey, bucketKey, conversationId, topicId, mode, runtime, api, focusMessageId, canRead,
    rows: new Map<string, NativeRow>(), heights: new Map<string, number>(), visible: new Set<string>(),
    anchor: undefined as ReaderAnchor | undefined, offset: 0, serial: 0,
    dragging: false, pending: false, corrections: 0, attempts: 0, mounting: false,
  }), [accountKey, api, bucketKey, canRead, conversationId, mode, runtime, topicId, focusMessageId]);
  const active = useMemo(() => ({ value: focused && foreground }), [focused, foreground]);
  const current = useRef({ state, active });
  current.current = { state, active };
  const authorized = useCallback(() => {
    const workspace = useWorkspace.getState();
    return current.current.state === state && state.canRead && state.runtime.api === state.api && workspace.accountKey === state.accountKey
      && !!workspace.bootstrap?.permissions.canReadConversations && !!workspace.conversations[state.conversationId]
      && (!state.topicId || (!!workspace.topics[state.topicId]?.joined && workspace.topics[state.topicId]?.conversationId === state.conversationId));
  }, [state]);
  const canonical = useCallback((id: string) => authorized() && !!useWorkspace.getState().messages[state.bucketKey]?.some(message => message.id === id), [authorized, state]);
  const readable = useCallback(() => authorized() && current.current.active === active && active.value && !state.dragging && !pinToLatest.current, [active, authorized, pinToLatest, state]);
  const viewport = useCallback(() => {
    const ref = list.current?.getNativeScrollRef() as NativeRow | null | undefined;
    return typeof ref?.measureInWindow === 'function' ? ref : undefined;
  }, [list]);
  const content = useCallback(() => {
    // This is a public ScrollView imperative method (also exposed on its host
    // ref). RN's TypeScript ScrollResponder union does not declare it.
    const responder = list.current?.getScrollResponder() as { getInnerViewRef?: () => NativeRow | null } | undefined;
    const ref = responder?.getInnerViewRef?.();
    return typeof ref?.measureInWindow === 'function' ? ref : undefined;
  }, [list]);
  const reset = useCallback(() => {
    state.serial++;
    state.anchor = undefined;
    state.pending = false;
    state.corrections = 0;
    state.attempts = 0;
    state.mounting = false;
  }, [state]);
  const capture = useCallback(() => {
    if (!readable()) return;
    const nativeViewport = viewport();
    if (!nativeViewport) return;
    const candidates = (useWorkspace.getState().messages[state.bucketKey] ?? [])
      .filter(message => state.visible.has(message.id) && state.rows.has(message.id))
      .slice(0, maximumVisibleRows);
    if (!candidates.length) return;
    const serial = ++state.serial;
    const offset = state.offset;
    const valid = () => readable() && state.serial === serial && state.offset === offset;
    try {
      nativeViewport.measureInWindow((x, y, width, height) => {
        const bounds = { x, y, width, height };
        if (!valid() || !validRect(bounds)) return;
        const visible: Array<{ id: string; rect: Rect }> = [];
        let remaining = candidates.length;
        for (const candidate of candidates) {
          const row = state.rows.get(candidate.id);
          const complete = () => {
            remaining--;
            if (remaining || !valid()) return;
            const full = visible.filter(item => item.rect.y >= bounds.y - 1 && item.rect.y + item.rect.height <= bounds.y + bounds.height + 1);
            const chosen = (full.length ? full : visible).sort((a, b) => a.rect.y - b.rect.y)[0];
            if (!chosen || !canonical(chosen.id)) return;
            state.anchor = { id: chosen.id, y: chosen.rect.y - bounds.y, offset };
            state.pending = false;
            state.corrections = 0;
            state.attempts = 0;
            state.mounting = false;
          };
          if (!row) { complete(); continue; }
          try {
            row.measureInWindow((rowX, rowY, rowWidth, rowHeight) => {
              if (!valid()) return;
              const rect = { x: rowX, y: rowY, width: rowWidth, height: rowHeight };
              if (state.rows.get(candidate.id) === row && canonical(candidate.id) && validRect(rect)
                && rowY < y + height && rowY + rowHeight > y && rowX < x + width && rowX + rowWidth > x) visible.push({ id: candidate.id, rect });
              complete();
            });
          } catch { complete(); }
        }
      });
    } catch { /* Missing native geometry never becomes a saved reader position. */ }
  }, [canonical, readable, state, viewport]);
  const restore = useCallback(() => {
    const anchor = state.anchor;
    if (!readable() || !state.pending || !anchor || state.corrections >= maximumCorrections || state.attempts >= maximumMeasurements) return;
    if (!canonical(anchor.id)) { reset(); return; }
    const row = state.rows.get(anchor.id);
    if (!row) {
      // One bounded mount attempt can recover a virtualized row after a native
      // jump. Its old offset is only a mount hint; native geometry must align it.
      if (!state.mounting) {
        state.mounting = true;
        list.current?.scrollToOffset({ offset: anchor.offset, animated: false });
      }
      return;
    }
    const nativeViewport = viewport();
    const nativeContent = content();
    if (!nativeViewport || !nativeContent || typeof row.measureLayout !== 'function') return;
    state.attempts++;
    const serial = ++state.serial;
    const offset = state.offset;
    const source = useWorkspace.getState().messages[state.bucketKey]?.find(message => message.id === anchor.id);
    const valid = () => readable() && state.serial === serial && state.anchor === anchor && state.rows.get(anchor.id) === row
      && state.offset === offset && content() === nativeContent && canonical(anchor.id) && useWorkspace.getState().messages[state.bucketKey]?.find(message => message.id === anchor.id) === source;
    try {
      nativeViewport.measureInWindow((x, y, width, height) => {
        const bounds = { x, y, width, height };
        if (!valid() || !validRect(bounds)) return;
        try {
          row.measureInWindow((rowX, rowY, rowWidth, rowHeight) => {
            if (!valid() || !validRect({ x: rowX, y: rowY, width: rowWidth, height: rowHeight })) return;
            const delta = rowY - y - anchor.y;
            if (Math.abs(delta) <= 1) return;
            // measureLayout excludes transforms and is relative to the actual
            // content view. Derive an absolute offset; a command may already
            // have reached native before its onScroll reaches JavaScript.
            try {
              row.measureLayout(nativeContent as Parameters<View['measureLayout']>[0], (_rawX, rawY, rawWidth, rawHeight) => {
                if (!valid() || !validRect({ x: _rawX, y: rawY, width: rawWidth, height: rawHeight })) return;
                const nextOffset = Math.max(0, state.mode === 'history' ? rawY + rawHeight + anchor.y - height : rawY - anchor.y);
                if (!Number.isFinite(nextOffset)) return;
                state.corrections++;
                list.current?.scrollToOffset({ offset: nextOffset, animated: false });
              }, () => {});
            } catch { /* A detached relative native ref cannot supply an absolute offset. */ }
          });
        } catch { /* A removed row cannot authorize a restoration. */ }
      });
    } catch { /* Wait for a real later layout, not a timer retry loop. */ }
  }, [canonical, content, list, readable, reset, state, viewport]);
  const changed = useCallback(() => {
    state.serial++;
    if (!state.anchor) return;
    state.pending = true;
    state.corrections = 0;
    state.attempts = 0;
    state.mounting = false;
    restore();
  }, [restore, state]);
  useEffect(() => {
    changed();
  }, [active, cardRevisions, changed, messages, syncVersion]);
  useEffect(() => () => { state.serial++; state.rows.clear(); state.heights.clear(); state.anchor = undefined; }, [state]);
  const register = useCallback((id: string, row: View | null) => {
    if (current.current.state !== state) return;
    if (!row) { state.rows.delete(id); state.heights.delete(id); return; }
    state.rows.set(id, row);
    if (state.rows.size > maximumRows) {
      const disposable = [...state.rows.keys()].find(key => key !== state.anchor?.id && !state.visible.has(key));
      if (disposable) { state.rows.delete(disposable); state.heights.delete(disposable); }
    }
  }, [state]);
  const rowLayout = useCallback((id: string, height: number) => {
    if (current.current.state !== state || !Number.isFinite(height) || height <= 0) return;
    const previous = state.heights.get(id);
    if (!state.rows.has(id)) return;
    state.heights.set(id, height);
    if (previous !== undefined && previous !== height) changed();
    else if (state.pending && id === state.anchor?.id) restore();
  }, [changed, restore, state]);
  const visible = useCallback((ids: Set<string>) => {
    if (current.current.state !== state) return;
    state.visible = new Set([...ids].slice(0, maximumVisibleRows));
    if (state.pending) restore();
    else capture();
  }, [capture, restore, state]);
  const offset = useCallback((y: number, fromUser: boolean) => {
    if (current.current.state !== state || !Number.isFinite(y)) return;
    if (fromUser) {
      if (!state.dragging) reset();
      state.dragging = true;
    }
    if (state.offset !== y) state.serial++;
    state.offset = y;
    if (!fromUser && state.pending) restore();
  }, [reset, restore, state]);
  const beginUserScroll = useCallback(() => { reset(); state.dragging = true; }, [reset, state]);
  const endUserScroll = useCallback(() => { state.dragging = false; capture(); }, [capture, state]);
  return { register, rowLayout, visible, offset, changed, reset, beginUserScroll, endUserScroll };
}
