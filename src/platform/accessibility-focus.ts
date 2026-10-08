import { NativeModules, Platform, findNodeHandle, type View } from 'react-native';

interface AccessibilityFocusModule {
  captureTarget(tag: number, ticket: number): Promise<unknown>;
  restoreFocus(ticket: number): Promise<unknown>;
  cancelTarget(ticket: number): void;
}

export interface AccessibilityFocusTarget {
  readonly ready: Promise<boolean>;
  restore(): Promise<boolean>;
  cancel(): void;
}

let nextTicket = 0;

export function captureAccessibilityFocus(node: View): AccessibilityFocusTarget | undefined {
  const candidate: unknown = Platform.OS === 'android' ? NativeModules.DualLaneAccessibilityFocus : undefined;
  if (typeof candidate !== 'object' || candidate === null ||
      !('captureTarget' in candidate) || typeof candidate.captureTarget !== 'function' ||
      !('restoreFocus' in candidate) || typeof candidate.restoreFocus !== 'function' ||
      !('cancelTarget' in candidate) || typeof candidate.cancelTarget !== 'function' ||
      nextTicket >= Number.MAX_SAFE_INTEGER) return undefined;
  const native = candidate as AccessibilityFocusModule;
  let tag: number | null;
  try { tag = findNodeHandle(node); } catch { return undefined; }
  if (typeof tag !== 'number' || !Number.isSafeInteger(tag) || tag <= 0) return undefined;
  const ticket = ++nextTicket;
  let closed = false, captured = false, restoring = false;
  const cancel = () => {
    if (closed) return;
    closed = true;
    try { native.cancelTarget(ticket); } catch { /* The host may already be invalidated. */ }
  };
  let request: Promise<unknown>;
  try { request = native.captureTarget(tag, ticket); } catch { cancel(); return undefined; }
  const ready = Promise.resolve(request).then(value => {
    captured = !closed && value === true;
    if (!captured) cancel();
    return captured;
  }, () => { cancel(); return false; });
  return {
    ready,
    cancel,
    restore: async () => {
      if (closed || restoring) return false;
      if (!captured) { cancel(); return false; }
      restoring = true;
      // This consumes the captured native instance once. Sending RN's event 8
      // does not perform Android's auxiliary accessibility focus action.
      try { return !closed && await native.restoreFocus(ticket) === true && !closed; }
      catch {
        try { native.cancelTarget(ticket); } catch { /* The host is unavailable. */ }
        return false;
      }
      finally { closed = true; }
    },
  };
}
