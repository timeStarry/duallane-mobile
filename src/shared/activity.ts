// Only activity metadata is retained here. Draft content and credentials stay
// with their owning stores; OTA must not reload across an unfinished write.
let writes = 0;
const drafts = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) {
    try { listener(); } catch { /* Observers must not change the outcome of a write. */ }
  }
};

export function beginMobileWrite(): () => void {
  writes++;
  changed();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    writes--;
    changed();
  };
}

export function isMobileWritePending(): boolean { return writes > 0; }
export function hasMobileDrafts(): boolean { return drafts.size > 0; }
export function setMobileDraftActivity(conversationId: string, hasDraft: boolean): void {
  const hadDraft = drafts.has(conversationId);
  if (hasDraft) drafts.add(conversationId); else drafts.delete(conversationId);
  if (hadDraft !== hasDraft) changed();
}
export function subscribeMobileWriteActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
