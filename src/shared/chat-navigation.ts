export interface ComposerMention {
  userId: string;
  label: string;
  start: number;
  end: number;
}

export type ComposerContentBlock =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string; label: string };

function matchesSelectedMention(text: string, mention: ComposerMention): boolean {
  const before = mention.start > 0 ? text[mention.start - 1] : "";
  const after = mention.end < text.length ? text[mention.end] : "";
  return Boolean(mention.userId && Number.isInteger(mention.start) && Number.isInteger(mention.end) &&
    mention.start >= 0 && mention.end > mention.start && mention.end <= text.length &&
    text.slice(mention.start, mention.end) === `@${mention.label}` &&
    (!before || /\s/u.test(before)) && (!after || /[\s.,!?，。！？、:：;；()（）[\]{}]/u.test(after)));
}

/** Keep identity only while the exact selected text remains outside the edit. */
export function reconcileComposerMentions(
  previous: string,
  next: string,
  mentions: readonly ComposerMention[]
): ComposerMention[] {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) suffix++;
  const oldEnd = previous.length - suffix;
  const delta = next.length - previous.length;
  return mentions.flatMap((mention) => {
    const moved = mention.end <= prefix
      ? mention
      : mention.start >= oldEnd
      ? { ...mention, start: mention.start + delta, end: mention.end + delta }
      : null;
    return moved && matchesSelectedMention(next, moved)
      ? [moved]
      : [];
  });
}

export function insertComposerMention(
  text: string,
  mentions: readonly ComposerMention[],
  userId: string,
  label: string,
  replaceQuery: boolean
): { text: string; mentions: ComposerMention[] } {
  const query = replaceQuery ? /@[^\s@]*$/u.exec(text) : null;
  const prefix = query ? text.slice(0, query.index) : `${text}${text && !text.endsWith(" ") ? " " : ""}`;
  const next = `${prefix}@${label} `;
  return {
    text: next,
    mentions: [
      ...reconcileComposerMentions(text, next, mentions),
      { userId, label, start: prefix.length, end: prefix.length + label.length + 1 },
    ],
  };
}

/** The visible label is never used to rediscover a selected member's identity. */
export function buildSelectedMentionBlocks(
  text: string,
  mentions: readonly ComposerMention[]
): ComposerContentBlock[] | undefined {
  const trimStart = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const valid = mentions
    .filter((mention) => mention.start >= trimStart &&
      mention.end <= trimStart + trimmed.length && matchesSelectedMention(text, mention))
    .sort((a, b) => a.start - b.start);
  if (valid.length === 0) return undefined;
  const blocks: ComposerContentBlock[] = [];
  let cursor = trimStart;
  for (const mention of valid) {
    if (mention.start < cursor) continue;
    if (mention.start > cursor) blocks.push({ type: "text", text: text.slice(cursor, mention.start) });
    blocks.push({ type: "mention", userId: mention.userId, label: mention.label });
    cursor = mention.end;
  }
  if (cursor < trimStart + trimmed.length) blocks.push({ type: "text", text: text.slice(cursor, trimStart + trimmed.length) });
  return blocks;
}

export interface UnreadNavigation {
  count: number;
  firstMessageId: string;
  availableCount: number;
}

interface NavigationMessage {
  id: string;
  senderId: string;
  kind?: string;
  recalledAt?: string;
  hiddenByCurrentUser?: boolean;
  threadRootId?: string;
  alsoSendToChannel?: boolean;
}

export function captureUnreadNavigation(
  messages: readonly NavigationMessage[],
  unreadCount: number,
  currentUserId?: string,
  firstUnreadMessageId?: string
): UnreadNavigation | null {
  const incoming = messages.filter(
    (message) =>
      message.senderId !== currentUserId &&
      message.kind !== "system" &&
      !message.recalledAt &&
      !message.hiddenByCurrentUser &&
      (!message.threadRootId || message.alsoSendToChannel)
  );
  const count = Math.max(0, Math.trunc(unreadCount));
  if (count === 0) return null;
  if (firstUnreadMessageId) {
    const idx = incoming.findIndex((m) => m.id === firstUnreadMessageId);
    return {
      count,
      firstMessageId: firstUnreadMessageId,
      availableCount: idx >= 0 ? Math.min(count, incoming.length - idx) : Math.min(count, incoming.length),
    };
  }
  if (incoming.length === 0) return null;
  return {
    count,
    firstMessageId: incoming[Math.max(0, incoming.length - count)].id,
    availableCount: Math.min(count, incoming.length),
  };
}

type MenuViewport = {
  getBoundingClientRect(): Pick<DOMRect, "top">;
  clientTop: number;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};
type MenuOption = { getBoundingClientRect(): Pick<DOMRect, "top" | "bottom"> };

/** scrollIntoView would also move the message list and the surrounding page. */
export function revealChatAutocompleteOption(viewport: MenuViewport, option: MenuOption): void {
  if (viewport.clientHeight <= 0) return;
  const top = viewport.getBoundingClientRect().top + viewport.clientTop;
  const bottom = top + viewport.clientHeight;
  const rect = option.getBoundingClientRect();
  const delta = rect.top < top || rect.bottom - rect.top > viewport.clientHeight
    ? rect.top - top
    : rect.bottom > bottom ? rect.bottom - bottom : 0;
  if (delta) viewport.scrollTop = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + delta));
}

export function chatAutocompleteKeyAction(
  event: { key: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number },
  optionCount: number
): "next" | "previous" | "select" | "dismiss" | null {
  if (optionCount <= 0 || event.isComposing || event.keyCode === 229) return null;
  if (event.key === "ArrowDown") return "next";
  if (event.key === "ArrowUp") return "previous";
  if (event.key === "Escape") return "dismiss";
  if (event.key === "Enter" && !event.shiftKey) return "select";
  return null;
}
