import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";
import type { DualLaneCardKitDocument } from "@/shared/card-kit";
import {
  ApiClientError,
  mobileApi,
  type EmoteCollectionShareSummaryDTO,
  type SystemAnnouncementDTO,
  type ThreadViewResponse,
} from "@/shared/api";
import { normalizeReactionEmoteKey } from "@/shared/emotes";
import {
  buildP2PShareUrl,
  connectP2PRoomTransport,
  createRemoteP2PRoom,
  createSafeP2PBlobUrl,
  deriveAesKey,
  generateRoomKeyString,
  P2P_MAX_FILE_BYTES,
  parseP2PInviteInput,
  type P2PChatMessage,
  type P2PRoomSession,
  type P2PRoomTransport,
} from "@/shared/p2p-crypto";
import { useEmoteStore } from "./emote-store";
import { useNavStore } from "./nav-store";
import { useUpdateStore } from "@/shared/updater";
import { beginMobileWrite, setMobileDraftActivity } from "@/shared/activity";
import { readWorkspaceCardReferences, projectWorkspaceCard, type WorkspaceCardReference } from "@/shared/workspace-cards";
import type { ComposerMention } from "@/shared/chat-navigation";

export interface V1User {
  id: string;
  displayName: string;
  rawDisplayName?: string;
  remark?: string;
  handle?: string;
  role: "owner" | "admin" | "member" | "bot";
  avatarUrl?: string;
  avatarColor?: string;
  description?: string;
  bio?: string;
  statusText?: string;
  online?: boolean;
  botOnline?: boolean;
}

export interface TypingIndicatorEntry {
  userId: string;
  displayName: string;
  kind: "human" | "bot";
  state: "typing" | "thinking";
  expiresAt: number;
}

export interface RecalledDraftEntry {
  text: string;
  replyToId?: string;
}

export interface V1MessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  url: string;
  downloadUrl?: string;
  width?: number;
  height?: number;
  sourceMessageId?: string;
}

export type V1MessageBlock =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string; label: string }
  | { type: "link"; url: string; label?: string }
  | { type: "emoji"; shortcode: string }
  | {
      type: "emote_collection";
      shareId: string;
      share?: EmoteCollectionShareSummaryDTO;
    };

export interface V1Message {
  id: string;
  clientMessageId?: string;
  conversationId: string;
  creationSeq?: number;
  hiddenByCurrentUser?: boolean;
  kind?: "user" | "bot" | "system";
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  plainText: string;
  blocks?: V1MessageBlock[];
  replyToId?: string;
  threadRootId?: string;
  threadTitle?: string;
  threadReplyCount?: number;
  threadLastRepliedAt?: string;
  threadPreviewReplies?: Array<{
    id: string;
    authorId: string;
    authorName: string;
    plainText: string;
    createdAt: string;
  }>;
  editedAt?: string;
  recalledAt?: string;
  createdAt: string;
  status?: "sending" | "sent" | "read" | "failed";
  reactions: Record<string, { count: number; reactedByMe: boolean; users?: string[] }>;
  attachments?: V1MessageAttachment[];
  card?: DualLaneCardKitDocument;
  cardReferences?: WorkspaceCardReference[];
}

export type ConversationNotificationLevel = "all" | "mentions" | "muted";

export interface CollapsePreferences {
  collapseImages: boolean;
  collapseStickers: boolean;
  collapseLongMessages: boolean;
  localOnly: boolean;
}

export interface V1Conversation {
  id: string;
  kind: "saved" | "direct" | "group";
  title: string;
  avatarUrl?: string;
  avatarEmoji?: string;
  unreadCount: number;
  lastReadAt?: string;
  lastReadMessageId?: string;
  lastReadSeq?: number;
  firstUnreadMessageId?: string;
  mentionCount: number;
  pinnedMessageIds: string[];
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: string;
  lastMessageSenderId?: string;
  lastMessageSenderName?: string;
  lastMessageRecalled?: boolean;
  notificationLevel?: ConversationNotificationLevel;
  peerLastReadAt?: string;
  myGroupRole?: string;
  capabilities?: {
    canEditGroup: boolean;
    canInviteMembers: boolean;
    canRemoveMembers: boolean;
    canPin: boolean;
  };
}

function nonnegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function latestReadAnchorId(messages: readonly V1Message[]): string | undefined {
  let last: V1Message | undefined;
  let latestCreation: V1Message | undefined;
  for (const message of messages) {
    if (message.hiddenByCurrentUser || message.status === "sending" || message.status === "failed") continue;
    last = message;
    if (message.creationSeq !== undefined && message.creationSeq > (latestCreation?.creationSeq ?? 0)) {
      latestCreation = message;
    }
  }
  if (!last) return undefined;
  // Only prefer latestCreation when the tail message itself carries a creationSeq;
  // otherwise an older WS message with creationSeq would trap markRead behind newer HTTP messages.
  return last.creationSeq !== undefined ? (latestCreation ?? last).id : last.id;
}

function projectedUnread(raw: Record<string, unknown>, previous?: V1Conversation) {
  const seq = nonnegativeInteger(raw.lastReadSeq);
  if (seq !== undefined && seq < (previous?.lastReadSeq ?? -1)) {
    return { unreadCount: previous?.unreadCount, mentionCount: previous?.mentionCount };
  }
  const count = nonnegativeInteger(raw.unreadCount);
  const rawMention = nonnegativeInteger(raw.mentionCount);
  const mentionCount =
    count === 0
      ? 0
      : rawMention !== undefined
        ? count !== undefined
          ? Math.min(rawMention, count)
          : rawMention
        : previous?.mentionCount !== undefined && count !== undefined
          ? Math.min(previous.mentionCount, count)
          : previous?.mentionCount;
  return {
    unreadCount: count,
    ...(mentionCount !== undefined ? { mentionCount } : {}),
    ...(count === 0 || raw.firstUnreadMessageId === null ? { firstUnreadMessageId: undefined }
      : typeof raw.firstUnreadMessageId === "string" ? { firstUnreadMessageId: raw.firstUnreadMessageId } : {}),
    ...(typeof raw.lastReadMessageId === "string" ? { lastReadMessageId: raw.lastReadMessageId } : {}),
    ...(typeof raw.lastReadAt === "string" ? { lastReadAt: raw.lastReadAt } : {}),
    ...(seq !== undefined ? { lastReadSeq: seq } : {}),
  };
}

export interface DraftEntry {
  text: string;
  replyToMessageId?: string;
  mentions?: ComposerMention[];
}

interface WorkspaceState {
  authStatus: "checking" | "unauthenticated" | "authenticated";
  connectionStatus: "connected" | "reconnecting" | "offline";
  statusError: string | null;
  pendingInviteCode: string;
  currentUser: V1User | null;
  boundEmail: string;
  systemAnnouncement: SystemAnnouncementDTO | null;
  dismissedAnnouncementKey: string | null;
  quotaUsedBytes: number;
  quotaLimitBytes: number;

  conversations: Record<string, V1Conversation>;
  conversationOrder: string[];
  pinnedConversationIds: string[];
  userPreferences: Record<string, unknown>;
  collapsePrefs: CollapsePreferences;
  messageCollapseOverrides: Record<string, boolean>;
  messagesByConv: Record<string, V1Message[]>;
  cardRevisions: Record<string, number>;
  readingConversationId: string | null;
  setConversationReading: (conversationId: string, reading: boolean) => void;
  members: Record<string, V1User>;
  threadsByRootId: Record<string, ThreadViewResponse>;

  drafts: Record<string, DraftEntry>;
  editingMessageId: string | null;
  highlightedMessageId: string | null;
  typingByConv: Record<string, TypingIndicatorEntry[]>;
  recalledDrafts: Record<string, RecalledDraftEntry>;

  // P2P Direct Lane (RAM-only)
  p2pRoom: P2PRoomSession | null;
  p2pMessages: P2PChatMessage[];
  p2pDraft: string;

  setPendingInviteCode: (code: string) => void;
  bootstrapWorkspace: () => Promise<void>;
  logout: () => Promise<void>;
  loadConversationMessages: (conversationId: string) => Promise<boolean>;
  loadOlderMessages: (conversationId: string) => Promise<number>;
  loadMessagesAround: (conversationId: string, messageId: string) => Promise<boolean>;
  hasMoreBeforeByConv: Record<string, boolean>;
  loadingOlderByConv: Record<string, boolean>;
  markRead: (conversationId: string, options?: { explicit?: boolean; messageId?: string }) => void;
  setDraft: (conversationId: string, text: string, replyToMessageId?: string, mentions?: ComposerMention[]) => void;
  setEditingMessageId: (messageId: string | null) => void;
  jumpToMessage: (conversationId: string, messageId: string) => void;
  clearHighlightedMessage: () => void;

  sendWorkspaceMessage: (
    conversationId: string,
    text: string,
    replyToId?: string,
    attachments?: V1MessageAttachment[],
    contentBlocks?: Array<Extract<V1MessageBlock, { type: "text" | "mention" }>>
  ) => Promise<void>;
  sendCustomSticker: (
    conversationId: string,
    customEmoteId: string,
    replyToId?: string
  ) => Promise<void>;
  sendStickerPackShare: (
    conversationId: string,
    share: EmoteCollectionShareSummaryDTO
  ) => Promise<void>;
  editWorkspaceMessage: (conversationId: string, messageId: string, newText: string) => Promise<void>;
  recallWorkspaceMessage: (conversationId: string, messageId: string) => Promise<void>;
  restoreRecalledDraft: (conversationId: string, messageId: string) => void;
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => Promise<void>;
  togglePinMessage: (conversationId: string, messageId: string) => Promise<void>;
  togglePinConversation: (conversationId: string) => Promise<void>;
  setConversationNotificationLevel: (
    conversationId: string,
    level: ConversationNotificationLevel
  ) => Promise<void>;
  setMemberRemark: (userId: string, remark: string) => Promise<void>;
  updateCollapsePreferences: (patch: Partial<CollapsePreferences>) => Promise<void>;
  setLocalMessageCollapsed: (messageId: string, collapsed: boolean | null) => void;
  updateUserPreferences: (patch: Record<string, unknown>) => Promise<void>;
  startDirectChatWithUser: (userId: string) => Promise<string | null>;
  createGroup: (title: string, memberIds: string[], avatar?: string) => Promise<string | null>;
  updateGroupProfile: (
    conversationId: string,
    patch: { title?: string; avatar?: string | null }
  ) => Promise<void>;
  inviteGroupMembers: (conversationId: string, userIds: string[]) => Promise<void>;
  removeGroupMember: (conversationId: string, userId: string) => Promise<void>;
  leaveGroup: (conversationId: string) => Promise<void>;
  forwardMessage: (messageIds: string[], targetConversationId: string) => Promise<void>;
  loadThread: (rootMessageId: string) => Promise<void>;
  sendThreadReply: (rootMessageId: string, text: string, alsoSendToChannel: boolean) => Promise<void>;
  triggerCardAction: (
    cardId: string,
    actionId: string,
    payload?: Record<string, unknown>,
    expectedRevision?: number
  ) => Promise<void>;
  applyRealtimeEvent: (eventObj: Record<string, unknown>) => void;
  handleDeepLink: (rawUrl: string) => Promise<void>;
  patchMemberLocal: (userId: string, patch: Partial<V1User>) => void;
  dismissSystemAnnouncement: () => Promise<void>;
  setBoundEmailLocal: (email: string) => void;

  createP2PRoom: () => Promise<string>;
  joinP2PRoom: (roomId: string, keyStr: string) => Promise<void>;
  leaveP2PRoom: () => void;
  setP2PDraft: (text: string) => void;
  sendP2PMessage: (text: string, replyToId?: string) => Promise<void>;
  sendP2PPickedFile: (
    pickedFileId: string,
    fileName: string,
    mimeType: string,
    caption?: string
  ) => Promise<void>;
}

const SHELL_CACHE_KEY = "duallane:mobile:shell:v1";
const MESSAGES_CACHE_KEY = "duallane:mobile:messages:v1";
const DRAFTS_CACHE_KEY = "duallane:mobile:drafts:v1";
const COLLAPSE_PREFS_KEY = "duallane:mobile:collapse-prefs:v1";
const MSG_COLLAPSE_OVERRIDES_KEY = "duallane:mobile:msg-collapse-overrides:v1";

const DEFAULT_COLLAPSE_PREFS: CollapsePreferences = {
  collapseImages: false,
  collapseStickers: false,
  collapseLongMessages: false,
  localOnly: true,
};

function loadLocalCollapsePrefs(): CollapsePreferences {
  try {
    const raw = window.localStorage.getItem(COLLAPSE_PREFS_KEY);
    if (!raw) return { ...DEFAULT_COLLAPSE_PREFS };
    const parsed = JSON.parse(raw) as Partial<CollapsePreferences>;
    return {
      collapseImages: Boolean(parsed.collapseImages),
      collapseStickers: Boolean(parsed.collapseStickers),
      collapseLongMessages: Boolean(parsed.collapseLongMessages),
      localOnly: parsed.localOnly !== false,
    };
  } catch {
    return { ...DEFAULT_COLLAPSE_PREFS };
  }
}

function saveLocalCollapsePrefs(prefs: CollapsePreferences) {
  try {
    window.localStorage.setItem(COLLAPSE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

function mergeRemoteCollapsePrefs(
  local: CollapsePreferences,
  userPrefs: Record<string, unknown>
): CollapsePreferences {
  if (local.localOnly) return local;
  const nested =
    userPrefs.autoCollapse && typeof userPrefs.autoCollapse === "object"
      ? (userPrefs.autoCollapse as Record<string, unknown>)
      : {};
  return {
    collapseImages:
      typeof userPrefs.collapseImages === "boolean"
        ? userPrefs.collapseImages
        : typeof nested.collapseImages === "boolean"
        ? nested.collapseImages
        : local.collapseImages,
    collapseStickers:
      typeof userPrefs.collapseStickers === "boolean"
        ? userPrefs.collapseStickers
        : typeof nested.collapseStickers === "boolean"
        ? nested.collapseStickers
        : local.collapseStickers,
    collapseLongMessages:
      typeof userPrefs.collapseLongMessages === "boolean"
        ? userPrefs.collapseLongMessages
        : typeof nested.collapseLongMessages === "boolean"
        ? nested.collapseLongMessages
        : local.collapseLongMessages,
    localOnly: false,
  };
}

function loadMsgCollapseOverrides(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(MSG_COLLAPSE_OVERRIDES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMsgCollapseOverrides(overrides: Record<string, boolean>) {
  try {
    const entries = Object.entries(overrides).slice(-240);
    window.localStorage.setItem(MSG_COLLAPSE_OVERRIDES_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // ignore
  }
}

export function normalizeNotificationLevel(raw: unknown): ConversationNotificationLevel {
  if (raw === "muted" || raw === "mute") return "muted";
  if (raw === "mentions" || raw === "mention") return "mentions";
  return "all";
}

export function computeTotalBadgeUnread(conversations: Record<string, V1Conversation>): number {
  let sum = 0;
  for (const c of Object.values(conversations)) {
    if (c.notificationLevel === "muted") {
      continue;
    }
    if (c.notificationLevel === "mentions") {
      sum += Math.max(0, c.mentionCount || 0);
      continue;
    }
    sum += Math.max(0, c.unreadCount || 0);
  }
  return sum;
}

function syncNativeNotificationState(state: {
  currentUser: V1User | null;
  conversations: Record<string, V1Conversation>;
  members: Record<string, V1User>;
}) {
  if (!state.currentUser?.id) return;
  const muteMap: Record<string, ConversationNotificationLevel> = {};
  const convTitles: Record<string, string> = {};
  const convKinds: Record<string, string> = {};
  for (const c of Object.values(state.conversations)) {
    muteMap[c.id] = c.notificationLevel || "all";
    if (c.title) convTitles[c.id] = c.title;
    convKinds[c.id] = c.kind;
  }
  const memberNames: Record<string, string> = {};
  for (const m of Object.values(state.members)) {
    if (m.id && m.displayName) {
      memberNames[m.id] = m.displayName;
    }
  }
  nativeBridge.syncNotificationContext({
    currentUserId: state.currentUser.id,
    currentUserDisplayName: state.currentUser.displayName || "我",
    muteMap,
    memberNames,
    convTitles,
    convKinds,
  });
}

function loadCachedDrafts(): Record<string, DraftEntry> {
  try {
    const raw = window.localStorage.getItem(DRAFTS_CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const drafts: Record<string, DraftEntry> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      if (typeof entry.text !== "string") continue;
      const draftText = entry.text;
      const mentions = Array.isArray(entry.mentions) ? entry.mentions.filter((item): item is ComposerMention => {
        if (!item || typeof item !== "object") return false;
        const mention = item as Record<string, unknown>;
        return typeof mention.userId === "string" && typeof mention.label === "string" &&
          Number.isSafeInteger(mention.start) && Number.isSafeInteger(mention.end) && Number(mention.start) >= 0 &&
          Number(mention.end) <= draftText.length && draftText.slice(Number(mention.start), Number(mention.end)) === `@${mention.label}`;
      }) : undefined;
      drafts[id] = { text: draftText, replyToMessageId: typeof entry.replyToMessageId === "string" ? entry.replyToMessageId : undefined, mentions };
    }
    return drafts;
  } catch {
    return {};
  }
}

function loadCachedMessages(): Record<string, V1Message[]> {
  try {
    const raw = window.localStorage.getItem(MESSAGES_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, V1Message[]> = {};
    for (const [cid, list] of Object.entries(parsed)) {
      if (Array.isArray(list)) {
        out[cid] = list as V1Message[];
      }
    }
    return out;
  } catch {
    return {};
  }
}

let persistMessagesTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersistMessages(
  messagesByConv: Record<string, V1Message[]>,
  conversationOrder: string[]
) {
  if (persistMessagesTimer) clearTimeout(persistMessagesTimer);
  persistMessagesTimer = setTimeout(() => {
    try {
      const ids =
        conversationOrder.length > 0
          ? conversationOrder.slice(0, 28)
          : Object.keys(messagesByConv).slice(0, 28);
      const snapshot: Record<string, V1Message[]> = {};
      for (const cid of ids) {
        const list = messagesByConv[cid];
        if (list && list.length > 0) {
          snapshot[cid] = list.slice(-45);
        }
      }
      window.localStorage.setItem(MESSAGES_CACHE_KEY, JSON.stringify(snapshot));
    } catch {
      // ignore storage quota errors
    }
  }, 240);
}

function persistDrafts(drafts: Record<string, DraftEntry>) {
  try {
    window.localStorage.setItem(DRAFTS_CACHE_KEY, JSON.stringify(drafts));
  } catch {
    // ignore
  }
}

export function computeOwnMessageStatus(
  convKind: V1Conversation["kind"] | undefined,
  peerLastReadAt: string | undefined,
  createdAt: string
): "sent" | "read" {
  if (convKind === "saved") return "read";
  if (peerLastReadAt) {
    const msgMs = Date.parse(createdAt);
    const peerMs = Date.parse(peerLastReadAt);
    if (Number.isFinite(msgMs) && Number.isFinite(peerMs) && msgMs <= peerMs) {
      return "read";
    }
  }
  return "sent";
}

function isMentionBoundaryChar(ch: string | undefined): boolean {
  if (!ch) return true;
  return /[\s,.;:!?，。；：！？、)）\]】]/u.test(ch);
}

export function buildTextAndMentionBlocks(
  text: string,
  conv: V1Conversation | undefined,
  members: Record<string, V1User>,
  currentUserId?: string
): Array<Record<string, unknown>> {
  if (!text) return [];
  const candidateIds = conv?.memberIds || [];
  const namedCandidates = [
    ...(conv?.kind === "group" ? [{ id: "all", displayName: "所有人" }] : []),
    ...candidateIds
      .filter((uid) => Boolean(uid && uid !== currentUserId && members[uid]?.displayName))
      .map((uid) => ({ id: uid, displayName: members[uid].displayName.trim() }))
      .filter((item) => item.displayName.length > 0),
  ].sort((a, b) => b.displayName.length - a.displayName.length);
  const candidates = namedCandidates.filter((candidate) =>
    namedCandidates.filter((other) => other.displayName === candidate.displayName).length === 1);

  if (candidates.length === 0 || !text.includes("@")) {
    return [{ type: "text", text }];
  }

  const blocks: Array<Record<string, unknown>> = [];
  let textStart = 0;
  let cursor = 0;

  while (cursor < text.length) {
    const atIdx = text.indexOf("@", cursor);
    if (atIdx === -1) break;

    let matched: { id: string; displayName: string } | null = null;
    for (const c of candidates) {
      if (text.startsWith(c.displayName, atIdx + 1)) {
        const nextChar = text[atIdx + 1 + c.displayName.length];
        if (isMentionBoundaryChar(nextChar)) {
          matched = c;
          break;
        }
      }
    }

    if (matched) {
      if (atIdx > textStart) {
        const plainSlice = text.slice(textStart, atIdx);
        if (plainSlice) blocks.push({ type: "text", text: plainSlice });
      }
      blocks.push({
        type: "mention",
        userId: matched.id,
        label: matched.displayName,
      });
      cursor = atIdx + 1 + matched.displayName.length;
      textStart = cursor;
    } else {
      cursor = atIdx + 1;
    }
  }

  if (textStart < text.length) {
    const tail = text.slice(textStart);
    if (tail) blocks.push({ type: "text", text: tail });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text }];
}

function sanitizeSyntheticHandle(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  if (!trimmed || trimmed.startsWith("__duallane_")) return undefined;
  return trimmed;
}

function sanitizeSyntheticMentionsInText(
  rawText: string,
  members: Record<string, V1User>,
  blocks?: V1MessageBlock[]
): string {
  if (!rawText || !rawText.includes("__duallane_")) return rawText;
  if (blocks && blocks.some((b) => b.type === "mention")) {
    let rebuilt = "";
    for (const b of blocks) {
      if (b.type === "text") rebuilt += b.text;
      else if (b.type === "mention") {
        const resolved =
          b.userId === "all"
            ? "所有人"
            : members[b.userId]?.displayName || sanitizeSyntheticHandle(b.label) || "机器人";
        rebuilt += `@${resolved}`;
      } else if (b.type === "link") rebuilt += b.label || b.url;
      else if (b.type === "emoji") rebuilt += `[${b.shortcode}]`;
    }
    if (rebuilt.trim()) return rebuilt;
  }
  return rawText.replace(/@__duallane_[a-zA-Z0-9_-]+/g, "@机器人");
}

function mapRawBlocks(
  rawContent: unknown,
  members?: Record<string, V1User>
): V1MessageBlock[] | undefined {
  if (!rawContent || typeof rawContent !== "object") return undefined;
  const blocksRaw = (rawContent as Record<string, unknown>).blocks;
  if (!Array.isArray(blocksRaw) || blocksRaw.length === 0) return undefined;
  const out: V1MessageBlock[] = [];
  for (const b of blocksRaw as Array<Record<string, unknown>>) {
    const t = String(b.type || "");
    if (t === "text" && typeof b.text === "string") {
      out.push({ type: "text", text: b.text });
    } else if (t === "mention" && b.userId) {
      const uid = String(b.userId);
      const rawLabel = typeof b.label === "string" ? b.label.replace(/^@+/, "").trim() : "";
      const resolvedLabel =
        uid === "all" || rawLabel === "所有人"
          ? "所有人"
          : members?.[uid]?.displayName ||
            sanitizeSyntheticHandle(rawLabel) ||
            (uid.startsWith("usr_bot_") ? "机器人" : uid);
      out.push({
        type: "mention",
        userId: uid,
        label: resolvedLabel,
      });
    } else if (t === "link" && b.url) {
      out.push({
        type: "link",
        url: String(b.url),
        label: b.label ? String(b.label) : undefined,
      });
    } else if (t === "emoji" && b.shortcode) {
      out.push({ type: "emoji", shortcode: String(b.shortcode) });
    } else if (t === "emote_collection" && b.shareId) {
      out.push({
        type: "emote_collection",
        shareId: String(b.shareId),
        share:
          b.share && typeof b.share === "object"
            ? (b.share as EmoteCollectionShareSummaryDTO)
            : undefined,
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function mapRawReactions(raw: unknown): Record<string, { count: number; reactedByMe: boolean; users?: string[] }> {
  const out: Record<string, { count: number; reactedByMe: boolean; users?: string[] }> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw as Array<Record<string, unknown>>) {
    const key = String(item.emoteKey || item.emoji || item.key || "");
    if (!key) continue;
    const count = Number(item.count || 0);
    if (count > 0) {
      const users = Array.isArray(item.users)
        ? item.users.map(String).filter(Boolean)
        : undefined;
      out[key] = {
        count,
        reactedByMe: Boolean(item.reactedByCurrentUser ?? item.reactedByMe),
        ...(users && users.length > 0 ? { users } : {}),
      };
    }
  }
  return out;
}

function mapRawAttachments(
  raw: unknown,
  fallbackMessageId?: string
): V1MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return (raw as Array<Record<string, unknown>>).map((a) => {
    const id = String(a.id || "");
    const mimeType = String(a.mimeType || "application/octet-stream");
    const defaultDownloadUrl = id ? `/api/workspace/files/${encodeURIComponent(id)}/download` : "";
    const defaultPreviewUrl =
      id && mimeType.startsWith("image/")
        ? `/api/workspace/files/${encodeURIComponent(id)}/preview`
        : defaultDownloadUrl;
    const downloadUrl = String(a.downloadUrl || a.url || defaultDownloadUrl);
    const url = String(a.previewUrl || a.url || a.downloadUrl || defaultPreviewUrl);
    return {
      id,
      fileName: String(a.fileName || a.name || "附件"),
      mimeType,
      byteSize: Number(a.byteSize || a.size || 0),
      url,
      downloadUrl,
      width: typeof a.width === "number" ? a.width : undefined,
      height: typeof a.height === "number" ? a.height : undefined,
      sourceMessageId: a.sourceMessageId ? String(a.sourceMessageId) : fallbackMessageId,
    };
  });
}

function upsertRawMemberRecord(
  target: Record<string, V1User>,
  m: Record<string, unknown> | null | undefined
): string {
  if (!m || typeof m !== "object") return "";
  const id = String(m.id || m.userId || "");
  if (!id) return "";
  const prev = target[id];
  const rawKind = String(m.kind || "");
  const rawRole = String(m.role || prev?.role || "member");
  const role: V1User["role"] =
    rawKind === "bot" || rawRole === "bot"
      ? "bot"
      : rawRole === "owner" || rawRole === "admin"
      ? rawRole
      : "member";
  const cleanGithubLogin = sanitizeSyntheticHandle(m.githubLogin);
  const cleanHandle = sanitizeSyntheticHandle(m.handle);
  const hasExplicitRemark = "remark" in m;
  const cleanRemark = hasExplicitRemark
    ? sanitizeSyntheticHandle(m.remark)
    : prev?.remark;
  const baseName =
    sanitizeSyntheticHandle(m.nickname) ||
    sanitizeSyntheticHandle(m.displayName) ||
    sanitizeSyntheticHandle(m.name) ||
    cleanGithubLogin ||
    cleanHandle ||
    prev?.rawDisplayName;
  const candidateName = cleanRemark || baseName;
  const resolvedName = candidateName
    ? String(candidateName)
    : prev?.displayName && !prev.displayName.startsWith("usr_") && !prev.displayName.startsWith("__duallane_")
    ? prev.displayName
    : role === "bot"
    ? "机器人"
    : id;
  const resolvedRawName = baseName ? String(baseName) : prev?.rawDisplayName || resolvedName;
  const hasExplicitAvatar = "avatarUrl" in m;
  const nextAvatarUrl = hasExplicitAvatar
    ? typeof m.avatarUrl === "string" && m.avatarUrl.trim()
      ? m.avatarUrl.trim()
      : undefined
    : prev?.avatarUrl;
  const hasExplicitColor = "avatarColor" in m;
  const nextAvatarColor = hasExplicitColor
    ? typeof m.avatarColor === "string" && m.avatarColor.trim()
      ? m.avatarColor.trim().toLowerCase()
      : undefined
    : prev?.avatarColor;
  const nextDescription =
    typeof m.description === "string" ? m.description.trim() || undefined : prev?.description;
  const nextBotOnline =
    typeof m.botOnline === "boolean" ? m.botOnline : prev?.botOnline;
  const nextOnline =
    role === "bot"
      ? undefined
      : typeof m.online === "boolean"
      ? m.online
      : prev?.online;
  const nextBio =
    typeof m.bio === "string" ? m.bio.trim() || undefined : prev?.bio;
  const nextStatusText =
    typeof m.statusText === "string" ? m.statusText.trim() || undefined : prev?.statusText;
  target[id] = {
    id,
    displayName: resolvedName,
    rawDisplayName: resolvedRawName,
    remark: cleanRemark ? String(cleanRemark) : undefined,
    handle: cleanGithubLogin || cleanHandle || prev?.handle,
    role,
    avatarUrl: nextAvatarUrl,
    avatarColor: nextAvatarColor,
    description: nextDescription,
    ...(nextBio ? { bio: nextBio } : {}),
    ...(nextStatusText ? { statusText: nextStatusText } : {}),
    ...(typeof nextOnline === "boolean" ? { online: nextOnline } : {}),
    ...(nextBotOnline !== undefined ? { botOnline: nextBotOnline } : {}),
  };
  return id;
}

function splitConversationAvatar(
  kind: V1Conversation["kind"],
  rawConv: Record<string, unknown>,
  members: Record<string, V1User>,
  memberIds: string[],
  currentUserId?: string
): { avatarUrl?: string; avatarEmoji?: string } {
  const rawVal = rawConv.avatarUrl ?? rawConv.avatarEmoji ?? rawConv.avatar;
  if (typeof rawVal === "string" && rawVal.trim()) {
    const val = rawVal.trim();
    if (
      val.startsWith("/") ||
      val.startsWith("blob:") ||
      val.startsWith("data:") ||
      val.startsWith("http://") ||
      val.startsWith("https://")
    ) {
      return { avatarUrl: val, avatarEmoji: undefined };
    }
    return { avatarUrl: undefined, avatarEmoji: val };
  }
  if (kind === "direct") {
    const otherObj =
      rawConv.otherMember && typeof rawConv.otherMember === "object"
        ? (rawConv.otherMember as Record<string, unknown>)
        : undefined;
    if (otherObj?.avatarUrl && typeof otherObj.avatarUrl === "string") {
      return { avatarUrl: otherObj.avatarUrl };
    }
    const peerId = memberIds.find((uid) => uid && uid !== currentUserId);
    if (peerId && members[peerId]?.avatarUrl) {
      return { avatarUrl: members[peerId].avatarUrl };
    }
  }
  return {};
}

export function mapRawMessage(
  conversationId: string,
  m: Record<string, unknown>,
  members: Record<string, V1User>,
  statusContext?: {
    currentUserId?: string;
    convKind?: V1Conversation["kind"];
    peerLastReadAt?: string;
  }
): V1Message {
  const authorObj = (m.author && typeof m.author === "object" ? m.author : {}) as Record<
    string,
    unknown
  >;
  const rawKind = typeof m.kind === "string" ? m.kind : undefined;
  const kind: V1Message["kind"] =
    rawKind === "system" ? "system" : rawKind === "bot" ? "bot" : "user";
  const senderId = String(m.authorId || m.senderId || authorObj.id || "");
  const id = String(m.id || "");
  const createdAt = String(m.createdAt || new Date().toISOString());
  const recalledAt =
    typeof m.recalledAt === "string" && m.recalledAt.trim() ? m.recalledAt.trim() : undefined;
  const isOwn = Boolean(statusContext?.currentUserId && senderId === statusContext.currentUserId);
  const resolvedStatus: V1Message["status"] = isOwn
    ? computeOwnMessageStatus(statusContext?.convKind, statusContext?.peerLastReadAt, createdAt)
    : "read";
  const rawAvatar =
    typeof m.authorAvatarUrl === "string" && m.authorAvatarUrl.trim()
      ? m.authorAvatarUrl.trim()
      : typeof authorObj.avatarUrl === "string" && authorObj.avatarUrl.trim()
      ? authorObj.avatarUrl.trim()
      : typeof m.senderAvatarUrl === "string" && m.senderAvatarUrl.trim()
      ? m.senderAvatarUrl.trim()
      : undefined;

  const mappedBlocks = recalledAt ? [] : mapRawBlocks(m.content, members);
  const rawPlain = String(m.plainText || m.text || "");
  const sanitizedPlain = sanitizeSyntheticMentionsInText(rawPlain, members, mappedBlocks);

  return {
    id,
    clientMessageId: m.clientMessageId ? String(m.clientMessageId) : undefined,
    conversationId,
    creationSeq: nonnegativeInteger(m.creationSeq),
    hiddenByCurrentUser: typeof m.hiddenByCurrentUser === "boolean" ? m.hiddenByCurrentUser : undefined,
    kind,
    senderId,
    senderName:
      members[senderId]?.displayName ||
      sanitizeSyntheticHandle(m.authorRemark) ||
      sanitizeSyntheticHandle(m.authorNickname) ||
      sanitizeSyntheticHandle(m.authorName) ||
      sanitizeSyntheticHandle(m.authorDisplayName) ||
      sanitizeSyntheticHandle(authorObj.displayName) ||
      sanitizeSyntheticHandle(m.senderName) ||
      (kind === "system" ? "系统通知" : kind === "bot" ? "机器人" : "成员"),
    senderAvatarUrl: members[senderId]?.avatarUrl || rawAvatar,
    plainText: sanitizedPlain,
    blocks: mappedBlocks,
    replyToId: recalledAt
      ? undefined
      : m.replyToMessageId
      ? String(m.replyToMessageId)
      : m.replyToId
      ? String(m.replyToId)
      : undefined,
    threadRootId: m.threadRootId ? String(m.threadRootId) : undefined,
    threadTitle: m.threadTitle ? String(m.threadTitle) : undefined,
    threadReplyCount: Number(m.threadReplyCount || m.replyCount || 0),
    threadLastRepliedAt: m.threadLastRepliedAt ? String(m.threadLastRepliedAt) : undefined,
    threadPreviewReplies: Array.isArray(m.threadPreviewReplies)
      ? m.threadPreviewReplies
          .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
          .map((item) => {
            const aid = String(item.authorId || "");
            return {
              id: String(item.id || ""),
              authorId: aid,
              authorName:
                members[aid]?.displayName ||
                sanitizeSyntheticHandle(item.authorName) ||
                "成员",
              plainText: String(item.plainText || ""),
              createdAt: String(item.createdAt || createdAt),
            };
          })
      : undefined,
    editedAt: m.editedAt ? String(m.editedAt) : undefined,
    recalledAt,
    createdAt,
    status: resolvedStatus,
    reactions: recalledAt ? {} : mapRawReactions(m.reactions),
    attachments: recalledAt ? undefined : mapRawAttachments(m.attachments, id),
    card: recalledAt ? undefined : (m.card as DualLaneCardKitDocument | undefined),
    cardReferences: recalledAt ? undefined : readWorkspaceCardReferences(m.content),
  };
}

export function parseRawSystemAnnouncement(rawAnn: unknown): SystemAnnouncementDTO | null {
  if (!rawAnn || typeof rawAnn !== "object" || Array.isArray(rawAnn)) return null;
  const a = rawAnn as Record<string, unknown>;
  const id = String(a.id || "").trim();
  const title = String(a.title || "").trim();
  const content = String(a.content || "").trim();
  if (!id || (!title && !content)) return null;
  const displayMode: "once" | "always" = a.displayMode === "always" ? "always" : "once";
  return {
    id,
    enabled: Boolean(a.enabled),
    displayMode,
    badge: typeof a.badge === "string" && a.badge.trim() ? a.badge.trim() : undefined,
    title,
    content,
    ctaLabel: typeof a.ctaLabel === "string" && a.ctaLabel.trim() ? a.ctaLabel.trim() : undefined,
    ctaUrl: typeof a.ctaUrl === "string" && a.ctaUrl.trim() ? a.ctaUrl.trim() : undefined,
    updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : undefined,
    updatedBy: typeof a.updatedBy === "string" ? a.updatedBy : undefined,
    shouldShow: typeof a.shouldShow === "boolean" ? a.shouldShow : Boolean(a.enabled),
  };
}

export function parseBootstrapPayload(raw: Record<string, unknown>) {
  const authObj = (raw.auth || {}) as Record<string, unknown>;
  const workspaceEnabled = authObj.enabled !== false;
  const boundEmail =
    typeof authObj.boundEmail === "string" ? authObj.boundEmail.trim() : "";
  const systemAnnouncement = parseRawSystemAnnouncement(raw.announcement);
  const userObj = (authObj.currentUser || raw.currentUser || raw.user || {}) as Record<
    string,
    unknown
  >;
  const currentUser: V1User | null = userObj.id
    ? {
        id: String(userObj.id),
        displayName: String(userObj.nickname || userObj.displayName || userObj.name || "我"),
        handle: userObj.githubLogin
          ? String(userObj.githubLogin)
          : userObj.handle
          ? String(userObj.handle)
          : undefined,
        role: (userObj.role as V1User["role"]) || "member",
        avatarUrl: userObj.avatarUrl ? String(userObj.avatarUrl) : undefined,
      }
    : null;

  const policyObj = (raw.policy || {}) as Record<string, unknown>;
  const quotaUsedBytes = Number(policyObj.usedTodayBytes || 0);
  const quotaLimitBytes = Number(policyObj.dailyQuotaBytes || 512 * 1024 * 1024);

  const members: Record<string, V1User> = {};
  const rawMembers = Array.isArray(raw.members) ? raw.members : [];
  for (const m of rawMembers as Array<Record<string, unknown>>) {
    upsertRawMemberRecord(members, m);
  }
  if (currentUser && !members[currentUser.id]) {
    members[currentUser.id] = currentUser;
  }

  const conversations: Record<string, V1Conversation> = {};
  const conversationOrder: string[] = [];
  const messagesByConv: Record<string, V1Message[]> = {};
  const rawConvs = Array.isArray(raw.conversations) ? raw.conversations : [];
  for (const c of rawConvs as Array<Record<string, unknown>>) {
    const id = String(c.id || "");
    if (!id) continue;
    conversationOrder.push(id);
    const rawType = String(c.kind || c.type || "group");
    const kind: V1Conversation["kind"] =
      rawType === "saved" ? "saved" : rawType === "direct" ? "direct" : "group";
    const lastMsg = (c.lastMessage || {}) as Record<string, unknown>;
    if (c.otherMember && typeof c.otherMember === "object") {
      upsertRawMemberRecord(members, c.otherMember as Record<string, unknown>);
    }
    const rawMemberList = Array.isArray(c.members)
      ? (c.members as Array<Record<string, unknown>>).map((item) =>
          upsertRawMemberRecord(members, item)
        )
      : Array.isArray(c.memberIds)
      ? c.memberIds.map(String)
      : [];
    const cleanedMemberIds = rawMemberList.filter(Boolean);
    const resolvedAvatar = splitConversationAvatar(
      kind,
      c,
      members,
      cleanedMemberIds,
      currentUser?.id
    );
    const peerLastReadAt =
      typeof c.peerLastReadAt === "string" && c.peerLastReadAt.trim()
        ? c.peerLastReadAt.trim()
        : undefined;
    const rawMsgs = Array.isArray(c.latestMessages)
      ? c.latestMessages
      : Array.isArray(c.messages)
      ? c.messages
      : [];
    const mappedConvMsgs = rawMsgs.map((msg) =>
      mapRawMessage(id, msg as Record<string, unknown>, members, {
        currentUserId: currentUser?.id,
        convKind: kind,
        peerLastReadAt,
      })
    );
    messagesByConv[id] = mappedConvMsgs;

    const tailMsg = mappedConvMsgs.length > 0 ? mappedConvMsgs[mappedConvMsgs.length - 1] : undefined;
    const lastAuthorObj =
      lastMsg.author && typeof lastMsg.author === "object"
        ? (lastMsg.author as Record<string, unknown>)
        : undefined;
    const rawLastSenderId = String(
      c.lastMessageSenderId ||
        c.lastMessageAuthorId ||
        lastMsg.authorId ||
        lastMsg.senderId ||
        lastAuthorObj?.id ||
        tailMsg?.senderId ||
        ""
    ).trim();
    const resolvedLastSenderName =
      (rawLastSenderId ? members[rawLastSenderId]?.displayName : undefined) ||
      sanitizeSyntheticHandle(c.lastMessageSenderName) ||
      sanitizeSyntheticHandle(c.lastMessageAuthorName) ||
      sanitizeSyntheticHandle(lastMsg.authorRemark) ||
      sanitizeSyntheticHandle(lastMsg.authorNickname) ||
      sanitizeSyntheticHandle(lastMsg.authorName) ||
      sanitizeSyntheticHandle(lastAuthorObj?.displayName) ||
      sanitizeSyntheticHandle(lastMsg.senderName) ||
      tailMsg?.senderName ||
      undefined;
    const rawNotificationLevel =
      c.notificationLevel ?? c.muteLevel ?? (c.muted === true ? "muted" : undefined);
    const resolvedLastText = c.lastMessagePlainText
      ? sanitizeSyntheticMentionsInText(String(c.lastMessagePlainText), members)
      : c.lastMessageText
      ? sanitizeSyntheticMentionsInText(String(c.lastMessageText), members)
      : lastMsg.plainText
      ? sanitizeSyntheticMentionsInText(String(lastMsg.plainText), members)
      : tailMsg
      ? tailMsg.recalledAt
        ? tailMsg.senderId === currentUser?.id
          ? "你撤回了一条消息"
          : `${tailMsg.senderName} 撤回了一条消息`
        : tailMsg.plainText
      : undefined;
    const resolvedRecalled = Boolean(
      c.lastMessageRecalled ||
        lastMsg.recalledAt ||
        (tailMsg?.recalledAt && !c.lastMessagePlainText && !c.lastMessageText) ||
        resolvedLastText === "消息已撤回" ||
        (resolvedLastText && resolvedLastText.endsWith("撤回了一条消息"))
    );

    conversations[id] = {
      id,
      kind,
      title:
        kind === "saved"
          ? "我的收藏"
          : String(c.displayTitle || c.title || c.name || "未命名对话"),
      avatarUrl: resolvedAvatar.avatarUrl,
      avatarEmoji: resolvedAvatar.avatarEmoji,
      unreadCount: Number(c.unreadCount || 0),
      lastReadAt: typeof c.lastReadAt === "string" ? c.lastReadAt : undefined,
      lastReadMessageId: typeof c.lastReadMessageId === "string" ? c.lastReadMessageId : undefined,
      lastReadSeq: typeof c.lastReadSeq === "number" ? c.lastReadSeq : undefined,
      firstUnreadMessageId: typeof c.firstUnreadMessageId === "string" ? c.firstUnreadMessageId : undefined,
      mentionCount: Number(c.mentionCount || 0),
      pinnedMessageIds: Array.isArray(c.pinnedMessageIds) ? c.pinnedMessageIds.map(String) : [],
      memberIds: cleanedMemberIds,
      lastMessageText: resolvedLastText,
      lastMessageAt: c.lastMessageAt
        ? String(c.lastMessageAt)
        : lastMsg.createdAt
        ? String(lastMsg.createdAt)
        : tailMsg?.createdAt,
      lastMessageSenderId: rawLastSenderId || undefined,
      lastMessageSenderName: resolvedLastSenderName,
      lastMessageRecalled: resolvedRecalled,
      notificationLevel: normalizeNotificationLevel(rawNotificationLevel),
      peerLastReadAt,
      ...(typeof c.myGroupRole === "string" && c.myGroupRole ? { myGroupRole: c.myGroupRole } : {}),
      ...(c.capabilities && typeof c.capabilities === "object"
        ? {
            capabilities: {
              canEditGroup: Boolean((c.capabilities as Record<string, unknown>).canEditGroup),
              canInviteMembers: Boolean((c.capabilities as Record<string, unknown>).canInviteMembers),
              canRemoveMembers: Boolean((c.capabilities as Record<string, unknown>).canRemoveMembers),
              canPin: Boolean((c.capabilities as Record<string, unknown>).canPin),
            },
          }
        : {}),
    };
  }

  const eventCursor = Number(raw.eventCursor || 0);
  const userPreferences: Record<string, unknown> =
    raw.preferences && typeof raw.preferences === "object" && !Array.isArray(raw.preferences)
      ? { ...(raw.preferences as Record<string, unknown>) }
      : {};
  const pinnedConversationIds: string[] = Array.isArray(userPreferences.pinnedConversationIds)
    ? userPreferences.pinnedConversationIds.map(String).filter(Boolean)
    : [];

  return {
    workspaceEnabled,
    currentUser,
    boundEmail,
    systemAnnouncement,
    quotaUsedBytes,
    quotaLimitBytes,
    members,
    conversations,
    conversationOrder,
    messagesByConv,
    eventCursor,
    userPreferences,
    pinnedConversationIds,
  };
}

let workspaceWsHandle: { send: (data: string) => void; close: () => void } | null = null;
let workspaceReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let workspaceHandshakeTimer: ReturnType<typeof setTimeout> | null = null;
let latestRealtimeCursor = 0;
let resumeHooksAttached = false;
let lastResumeSyncAt = 0;
let activeP2PTransport: P2PRoomTransport | null = null;

function clearHandshakeTimer() {
  if (workspaceHandshakeTimer) {
    clearTimeout(workspaceHandshakeTimer);
    workspaceHandshakeTimer = null;
  }
}

function teardownWorkspaceRealtime() {
  clearHandshakeTimer();
  if (workspaceReconnectTimer) {
    clearTimeout(workspaceReconnectTimer);
    workspaceReconnectTimer = null;
  }
  if (workspaceWsHandle) {
    const h = workspaceWsHandle;
    workspaceWsHandle = null;
    h.close();
  }
}

interface InitialShellHydration {
  currentUser: V1User;
  boundEmail: string;
  members: Record<string, V1User>;
  conversations: Record<string, V1Conversation>;
  conversationOrder: string[];
  pinnedConversationIds: string[];
  userPreferences: Record<string, unknown>;
}

function loadInitialShellHydration(): InitialShellHydration | null {
  try {
    if (typeof window === "undefined") return null;
    const snap = nativeBridge.getSessionSnapshot();
    if (nativeBridge.isNativeAndroid() && !snap.authenticated) return null;
    const cachedRaw = window.localStorage.getItem(SHELL_CACHE_KEY);
    if (!cachedRaw) return null;
    const cached = JSON.parse(cachedRaw) as Partial<InitialShellHydration>;
    if (!cached.currentUser?.id || !cached.conversations || !Array.isArray(cached.conversationOrder)) {
      return null;
    }
    return {
      currentUser: cached.currentUser,
      boundEmail: typeof cached.boundEmail === "string" ? cached.boundEmail : "",
      members: cached.members || {},
      conversations: cached.conversations || {},
      conversationOrder: cached.conversationOrder,
      pinnedConversationIds: Array.isArray(cached.pinnedConversationIds)
        ? cached.pinnedConversationIds
        : [],
      userPreferences: cached.userPreferences || {},
    };
  } catch {
    return null;
  }
}

function teardownP2P() {
  if (activeP2PTransport) {
    const t = activeP2PTransport;
    activeP2PTransport = null;
    t.close();
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const pendingReads = new Map<string, { messageId?: string; queuedMessageId?: string; arrived: Set<string> }>();
  const seenCreatedMessages = new Set<string>();
  const canReadConversation = (conversationId: string) => {
    const nav = useNavStore.getState();
    return get().readingConversationId === conversationId && nav.activeChatId === conversationId &&
      !nav.searchOpen && !nav.directOverlayOpen && !nav.lightboxMedia && !nav.chatDetailOpen &&
      !nav.threadRootId && !nav.serverConfigOpen && !nav.botManageOpen &&
      !nav.updateSheetOpen && !nav.pendingExternalUrl &&
      !nav.actionMessageId && !nav.forwardingMessageIds && !nav.sharedPackId &&
      !nav.botSetupSessionId && !nav.stickerStudioOpen && !nav.createChatMode &&
      (typeof document === "undefined" || (!document.hidden && document.visibilityState !== "hidden"));
  };
  let persistShellTimer: ReturnType<typeof setTimeout> | null = null;
  const schedulePersistShellCache = () => {
    if (typeof window === "undefined") return;
    if (persistShellTimer) clearTimeout(persistShellTimer);
    persistShellTimer = setTimeout(() => {
      persistShellTimer = null;
      const snap = get();
      if (snap.authStatus !== "authenticated" || !snap.currentUser) return;
      try {
        window.localStorage.setItem(
          SHELL_CACHE_KEY,
          JSON.stringify({
            currentUser: snap.currentUser,
            boundEmail: snap.boundEmail,
            members: snap.members,
            conversations: snap.conversations,
            conversationOrder: snap.conversationOrder.slice(0, 80),
            pinnedConversationIds: snap.pinnedConversationIds,
            userPreferences: snap.userPreferences,
          })
        );
      } catch {
        // ignore quota errors
      }
    }, 320);
  };
  const confirmRead = (conversationId: string, response: Record<string, unknown>, unchanged?: V1Conversation) => {
    set((state) => {
      const conversation = state.conversations[conversationId];
      if (!conversation) return state;
      const readAt = typeof response.readAt === "string" ? response.readAt : "";
      const readMs = Date.parse(readAt);
      const previousReadMs = Date.parse(conversation.lastReadAt || "");
      const readSeq = typeof response.lastReadSeq === "number" ? response.lastReadSeq : undefined;
      if (readSeq !== undefined && conversation.lastReadSeq !== undefined && readSeq < conversation.lastReadSeq) return state;
      if (readSeq === undefined && Number.isFinite(previousReadMs) && (!Number.isFinite(readMs) || readMs < previousReadMs)) return state;
      const lastReadMessageId = typeof response.lastReadMessageId === "string" ? response.lastReadMessageId : "";
      // A realtime projection of the newly committed marker already includes
      // changes that could have happened after the HTTP snapshot was taken.
      if (unchanged && lastReadMessageId && unchanged.lastReadMessageId !== lastReadMessageId &&
        conversation.lastReadMessageId === lastReadMessageId) return state;
      const messages = state.messagesByConv[conversationId] || [];
      const boundaryIndex = messages.findIndex((message) => message.id === lastReadMessageId);
      const newerMessages = messages.filter((message, index) =>
        (readSeq !== undefined && message.creationSeq !== undefined ? message.creationSeq > readSeq : boundaryIndex >= 0 && index > boundaryIndex) &&
        message.senderId !== state.currentUser?.id && message.kind !== "system" && !message.recalledAt && !message.hiddenByCurrentUser &&
        (message.creationSeq !== undefined || !message.threadRootId) && (message.status === "sent" || message.status === "read"));
      const hasNewerMessage = Number.isFinite(readMs) && Date.parse(conversation.lastMessageAt || "") > readMs;
      const clearsSnapshot = Number.isFinite(readMs) ? !hasNewerMessage : conversation === unchanged;
      const arrived = pendingReads.get(conversationId)?.arrived;
      const concurrent = newerMessages.filter((message) => arrived?.has(message.id));
      const snapshotCount = nonnegativeInteger(response.unreadCount) ?? Math.max(newerMessages.length, clearsSnapshot ? 0 : conversation.unreadCount);
      const unreadCount = Math.max(concurrent.length, snapshotCount);
      const mentionCount = nonnegativeInteger(response.mentionCount) ?? (unreadCount === 0 ? 0 : Math.min(conversation.mentionCount, unreadCount));
      return { conversations: { ...state.conversations, [conversationId]: {
        ...conversation, unreadCount, mentionCount,
        ...(Number.isFinite(readMs) ? { lastReadAt: previousReadMs > readMs ? conversation.lastReadAt : readAt } : {}),
        ...(lastReadMessageId ? { lastReadMessageId } : {}),
        ...(readSeq !== undefined ? { lastReadSeq: readSeq } : {}),
        firstUnreadMessageId: unreadCount === 0 ? undefined : typeof response.firstUnreadMessageId === "string"
          ? response.firstUnreadMessageId : concurrent[0]?.id,
      } } };
    });
    schedulePersistShellCache();
  };
  const connectRealtime = (initialCursor: number) => {
    teardownWorkspaceRealtime();
    let cursor = Math.max(latestRealtimeCursor, Math.max(0, Math.trunc(initialCursor || 0)));
    latestRealtimeCursor = cursor;

    const open = () => {
      if (get().authStatus !== "authenticated") return;
      clearHandshakeTimer();
      const handle = nativeBridge.connectSocket("/ws/workspace", true, {
        onOpen: () => {
          if (workspaceWsHandle !== handle) return;
          handle.send(JSON.stringify({ type: "hello", version: 1, lastSeq: cursor }));
          clearHandshakeTimer();
          // Watchdog: if half-open NAT socket never delivers "ready" within 3.8s, cycle cleanly
          workspaceHandshakeTimer = setTimeout(() => {
            if (workspaceWsHandle !== handle) return;
            workspaceWsHandle = null;
            handle.close();
            if (get().authStatus === "authenticated") {
              workspaceReconnectTimer = setTimeout(open, 600);
            }
          }, 3800);
        },
        onMessage: (rawText) => {
          if (workspaceWsHandle !== handle) return;
          let frame: Record<string, unknown>;
          try {
            frame = JSON.parse(rawText) as Record<string, unknown>;
          } catch {
            return;
          }
          if (frame.type === "ready") {
            clearHandshakeTimer();
            if (typeof frame.currentSeq === "number" && frame.currentSeq > cursor) {
              cursor = frame.currentSeq;
              latestRealtimeCursor = cursor;
            }
            set({ connectionStatus: "connected" });
            return;
          }
          if (frame.type === "sync.required") {
            clearHandshakeTimer();
            if (typeof frame.currentSeq === "number") {
              cursor = frame.currentSeq;
              latestRealtimeCursor = cursor;
            }
            void get().bootstrapWorkspace();
            return;
          }
          if (frame.type === "event" && frame.event && typeof frame.event === "object") {
            clearHandshakeTimer();
            const evObj = frame.event as Record<string, unknown>;
            const seq = Number(evObj.seq || 0);
            if (seq > cursor) {
              cursor = seq;
              latestRealtimeCursor = cursor;
            }
            if (get().connectionStatus !== "connected") {
              set({ connectionStatus: "connected" });
            }
            get().applyRealtimeEvent(evObj);
          }
        },
        onClose: () => {
          if (workspaceWsHandle !== handle) return;
          clearHandshakeTimer();
          workspaceWsHandle = null;
          if (get().authStatus === "authenticated") {
            set({ connectionStatus: "reconnecting" });
            workspaceReconnectTimer = setTimeout(open, 1600);
          }
        },
      });
      workspaceWsHandle = handle;
    };

    open();
  };

  if (!resumeHooksAttached && typeof window !== "undefined") {
    resumeHooksAttached = true;
    const handleForegroundResume = () => {
      const state = get();
      if (state.authStatus !== "authenticated") return;
      const now = Date.now();
      // Always re-anchor realtime socket if missing or stuck in reconnecting after background freeze
      if (!workspaceWsHandle || state.connectionStatus !== "connected") {
        connectRealtime(latestRealtimeCursor);
      }
      // Pull lightweight bootstrap catch-up (throttled to 3s) so missed events clear "加载中…" immediately
      if (now - lastResumeSyncAt >= 3000) {
        lastResumeSyncAt = now;
        void state.bootstrapWorkspace();
      }
    };
    nativeBridge.onAppResumed(handleForegroundResume);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          handleForegroundResume();
        }
      });
    }
  }

  const initialHydration = loadInitialShellHydration();

  return {
    authStatus: initialHydration ? "authenticated" : "checking",
    connectionStatus: initialHydration ? "reconnecting" : "connected",
    statusError: null,
    pendingInviteCode: "",
    currentUser: initialHydration?.currentUser ?? null,
    boundEmail: initialHydration?.boundEmail ?? "",
    systemAnnouncement: null,
    dismissedAnnouncementKey: null,
    quotaUsedBytes: 0,
    quotaLimitBytes: 512 * 1024 * 1024,

    conversations: initialHydration?.conversations ?? {},
    conversationOrder: initialHydration?.conversationOrder ?? [],
    pinnedConversationIds: initialHydration?.pinnedConversationIds ?? [],
    userPreferences: initialHydration?.userPreferences ?? {},
    collapsePrefs: loadLocalCollapsePrefs(),
    messageCollapseOverrides: loadMsgCollapseOverrides(),
    messagesByConv: loadCachedMessages(),
    hasMoreBeforeByConv: {},
    loadingOlderByConv: {},
    cardRevisions: {},
    readingConversationId: null,
    members: initialHydration?.members ?? {},
    threadsByRootId: {},

    drafts: loadCachedDrafts(),
    editingMessageId: null,
    highlightedMessageId: null,
    typingByConv: {},
    recalledDrafts: {},

    p2pRoom: null,
    p2pMessages: [],
    p2pDraft: "",

    setPendingInviteCode: (pendingInviteCode) => set({ pendingInviteCode }),

    bootstrapWorkspace: async () => {
      const wasUnauthenticated = get().authStatus !== "authenticated";
      const snap = nativeBridge.getSessionSnapshot();
      // Hydrate instant shell cache if native Keystore says authenticated
      if (snap.authenticated && wasUnauthenticated) {
        try {
          const cachedRaw = window.localStorage.getItem(SHELL_CACHE_KEY);
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as {
              currentUser: V1User;
              members: Record<string, V1User>;
              conversations: Record<string, V1Conversation>;
              conversationOrder: string[];
              pinnedConversationIds: string[];
              userPreferences: Record<string, unknown>;
            };
            if (cached.currentUser?.id) {
              set({
                authStatus: "authenticated",
                connectionStatus: "reconnecting",
                currentUser: cached.currentUser,
                members: cached.members || {},
                conversations: cached.conversations || {},
                conversationOrder: cached.conversationOrder || [],
                pinnedConversationIds: cached.pinnedConversationIds || [],
                userPreferences: cached.userPreferences || {},
              });
            }
          }
        } catch {
          // ignore cache error
        }
      }

      if (nativeBridge.isNativeAndroid() && !snap.authenticated) {
        teardownWorkspaceRealtime();
        set({ authStatus: "unauthenticated", statusError: null });
        return;
      }

      try {
        const raw = await mobileApi.getBootstrap();
        const parsed = parseBootstrapPayload(raw);
        if (!parsed.workspaceEnabled || !parsed.currentUser) {
          teardownWorkspaceRealtime();
          window.localStorage.removeItem(SHELL_CACHE_KEY);
          set({
            authStatus: "unauthenticated",
            statusError: !parsed.workspaceEnabled ? "当前服务尚未启用共享空间" : null,
          });
          return;
        }

        const hasSaved = Object.values(parsed.conversations).some((c) => c.kind === "saved");
        if (!hasSaved) {
          try {
            const savedRes = await mobileApi.ensureSavedConversation();
            if (savedRes.conversationId && !parsed.conversations[savedRes.conversationId]) {
              parsed.conversations[savedRes.conversationId] = {
                id: savedRes.conversationId,
                kind: "saved",
                title: "我的收藏",
                unreadCount: 0,
                mentionCount: 0,
                pinnedMessageIds: [],
                memberIds: [parsed.currentUser.id],
              };
              parsed.conversationOrder.unshift(savedRes.conversationId);
              parsed.messagesByConv[savedRes.conversationId] = [];
            }
          } catch {
            // non-fatal
          }
        }

        let userPreferences = parsed.userPreferences;
        let pinnedConversationIds = parsed.pinnedConversationIds;
        const hasEmbeddedPreferences = Boolean(
          raw && typeof raw === "object" && "preferences" in raw
        );
        if (!hasEmbeddedPreferences && Object.keys(userPreferences).length === 0) {
          try {
            const prefRes = await mobileApi.getPreferences();
            if (prefRes.preferences) {
              userPreferences = prefRes.preferences;
              if (Array.isArray(prefRes.preferences.pinnedConversationIds)) {
                pinnedConversationIds = prefRes.preferences.pinnedConversationIds
                  .map(String)
                  .filter(Boolean);
              }
            }
          } catch {
            // non-fatal
          }
        }

        const prevState = get();
        const sameUser = prevState.currentUser?.id === parsed.currentUser.id;
        const prevMessages = prevState.messagesByConv;
        const mergedMessages: Record<string, V1Message[]> = {};
        const mergedConversations: Record<string, V1Conversation> = {};

        for (const cid of Object.keys(parsed.conversations)) {
          const incomingConv = parsed.conversations[cid];
          const prevConv = sameUser ? prevState.conversations[cid] : undefined;
          const prevSeq = prevConv?.lastReadSeq;
          const incSeq = incomingConv.lastReadSeq;
          const keepLocalRead =
            Boolean(prevConv) &&
            (pendingReads.has(cid) ||
              (prevSeq !== undefined && (incSeq === undefined || prevSeq > incSeq)));
          mergedConversations[cid] = keepLocalRead && prevConv
            ? {
                ...incomingConv,
                unreadCount: prevConv.unreadCount,
                mentionCount: prevConv.mentionCount,
                firstUnreadMessageId: prevConv.firstUnreadMessageId,
                lastReadMessageId: prevConv.lastReadMessageId,
                lastReadAt: prevConv.lastReadAt,
                lastReadSeq: prevConv.lastReadSeq,
              }
            : incomingConv;

          const inc = parsed.messagesByConv[cid] || [];
          const prevList = sameUser ? prevMessages[cid] || [] : [];
          if (prevList.length === 0) {
            mergedMessages[cid] = inc;
          } else if (inc.length === 0) {
            mergedMessages[cid] = prevList;
          } else {
            // Merge without wiping loaded 90-message history or in-flight optimistic messages
            const byId = new Map<string, V1Message>();
            for (const m of prevList) byId.set(m.id, m);
            for (const m of inc) byId.set(m.id, m);
            mergedMessages[cid] = Array.from(byId.values()).sort((a, b) => {
              const dt = Date.parse(a.createdAt) - Date.parse(b.createdAt);
              if (Number.isFinite(dt) && dt !== 0) return dt;
              return a.id.localeCompare(b.id);
            });
          }
        }

        set((prev) => ({
          authStatus: "authenticated",
          connectionStatus: "connected",
          statusError: null,
          currentUser: parsed.currentUser,
          boundEmail: parsed.boundEmail,
          systemAnnouncement: parsed.systemAnnouncement,
          dismissedAnnouncementKey: wasUnauthenticated ? null : prev.dismissedAnnouncementKey,
          quotaUsedBytes: parsed.quotaUsedBytes,
          quotaLimitBytes: parsed.quotaLimitBytes,
          members: parsed.members,
          conversations: mergedConversations,
          conversationOrder: parsed.conversationOrder,
          pinnedConversationIds,
          userPreferences,
          collapsePrefs: mergeRemoteCollapsePrefs(prev.collapsePrefs, userPreferences),
          messagesByConv: mergedMessages,
        }));

        syncNativeNotificationState({
          currentUser: parsed.currentUser,
          conversations: mergedConversations,
          members: parsed.members,
        });

        try {
          window.localStorage.setItem(
            SHELL_CACHE_KEY,
            JSON.stringify({
              currentUser: parsed.currentUser,
              boundEmail: parsed.boundEmail,
              members: parsed.members,
              conversations: mergedConversations,
              conversationOrder: parsed.conversationOrder.slice(0, 80),
              pinnedConversationIds,
              userPreferences,
            })
          );
        } catch {
          // ignore
        }

        useEmoteStore.getState().hydrateTabOrderFromPreferences(userPreferences.emoteTabOrder);
        void useEmoteStore.getState().refreshLibrary(true);
        connectRealtime(parsed.eventCursor);

        // Prewarm member & conversation avatars into persistent native MediaDiskCache
        const avatarUrls: string[] = [];
        if (parsed.currentUser.avatarUrl) avatarUrls.push(parsed.currentUser.avatarUrl);
        for (const cid of parsed.conversationOrder.slice(0, 24)) {
          const av = parsed.conversations[cid]?.avatarUrl;
          if (av) avatarUrls.push(av);
        }
        for (const m of Object.values(parsed.members).slice(0, 32)) {
          if (m.avatarUrl) avatarUrls.push(m.avatarUrl);
        }
        if (avatarUrls.length > 0) {
          nativeBridge.prefetchMedia(avatarUrls);
        }

        // Background prefetch top conversations so tapping any chat renders 0ms with full history
        const prefetchIds = parsed.conversationOrder
          .filter((cid) => (mergedMessages[cid]?.length || 0) < 2)
          .slice(0, 8);
        if (prefetchIds.length > 0) {
          void Promise.allSettled(
            prefetchIds.map((cid) => get().loadConversationMessages(cid))
          );
        }

        // Silent background update check once session is ready
        setTimeout(() => {
          void useUpdateStore.getState().checkForUpdates(true);
        }, 1800);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          teardownWorkspaceRealtime();
          window.localStorage.removeItem(SHELL_CACHE_KEY);
          window.localStorage.removeItem(MESSAGES_CACHE_KEY);
          set({ authStatus: "unauthenticated", statusError: null });
          return;
        }
        set({
          connectionStatus: "offline",
          statusError: err instanceof Error ? err.message : "连接服务失败",
          authStatus: get().currentUser ? "authenticated" : "unauthenticated",
        });
      }
    },

    logout: async () => {
      if (persistMessagesTimer) {
        clearTimeout(persistMessagesTimer);
        persistMessagesTimer = null;
      }
      if (persistShellTimer) {
        clearTimeout(persistShellTimer);
        persistShellTimer = null;
      }
      pendingReads.clear();
      seenCreatedMessages.clear();
      teardownWorkspaceRealtime();
      teardownP2P();
      window.localStorage.removeItem(SHELL_CACHE_KEY);
      window.localStorage.removeItem(MESSAGES_CACHE_KEY);
      useEmoteStore.getState().clearCache();
      nativeBridge.logout();
      useNavStore.setState({
        entryLane: "welcome",
        activeTab: "chats",
        activeChatId: null,
        searchOpen: false,
        directOverlayOpen: false,
      });
      set({
        authStatus: "unauthenticated",
        currentUser: null,
        boundEmail: "",
        systemAnnouncement: null,
        dismissedAnnouncementKey: null,
        conversations: {},
        conversationOrder: [],
        messagesByConv: {},
        cardRevisions: {},
        readingConversationId: null,
        members: {},
        p2pRoom: null,
        p2pMessages: [],
      });
    },

    setConversationReading: (conversationId, reading) => set((state) => ({
      readingConversationId: reading ? conversationId : state.readingConversationId === conversationId ? null : state.readingConversationId,
    })),

    loadConversationMessages: async (conversationId) => {
      const actorId = get().currentUser?.id;
      const previousIds = new Set((get().messagesByConv[conversationId] || []).map((message) => message.id));
      try {
        const res = await mobileApi.listMessages(conversationId, 90);
        const rawList = Array.isArray(res.messages) ? res.messages : [];
        const s = get();
        if (s.currentUser?.id !== actorId) return false;
        const conv = s.conversations[conversationId];
        const mapped = rawList.map((m) =>
          mapRawMessage(conversationId, m, s.members, {
            currentUserId: s.currentUser?.id,
            convKind: conv?.kind,
            peerLastReadAt: conv?.peerLastReadAt,
          })
        );
        set((state) => ({
          messagesByConv: {
            ...state.messagesByConv,
            [conversationId]: [...mapped, ...(state.messagesByConv[conversationId] || []).filter((message) =>
              !mapped.some((fresh) => fresh.id === message.id || (message.clientMessageId && fresh.clientMessageId === message.clientMessageId)) &&
              (!previousIds.has(message.id) || message.status === "sending" || message.status === "failed"))],
          },
          hasMoreBeforeByConv: {
            ...state.hasMoreBeforeByConv,
            [conversationId]: mapped.length >= 90,
          },
        }));
        return true;
      } catch {
        // keep optimistic or bootstrap messages
        return false;
      }
    },

    loadOlderMessages: async (conversationId) => {
      const initial = get();
      if (initial.loadingOlderByConv[conversationId] || initial.hasMoreBeforeByConv[conversationId] === false) {
        return 0;
      }
      const existing = initial.messagesByConv[conversationId] || [];
      const oldestAnchor = existing.find((m) => m.status !== "sending" && m.status !== "failed");
      if (!oldestAnchor) return 0;
      const actorId = initial.currentUser?.id;
      set((state) => ({
        loadingOlderByConv: { ...state.loadingOlderByConv, [conversationId]: true },
      }));
      try {
        const res = await mobileApi.listMessages(conversationId, {
          before: oldestAnchor.id,
          limit: 60,
        });
        const rawList = Array.isArray(res.messages) ? res.messages : [];
        const s = get();
        if (s.currentUser?.id !== actorId) return 0;
        const conv = s.conversations[conversationId];
        const mapped = rawList.map((m) =>
          mapRawMessage(conversationId, m, s.members, {
            currentUserId: s.currentUser?.id,
            convKind: conv?.kind,
            peerLastReadAt: conv?.peerLastReadAt,
          })
        );
        const currentList = s.messagesByConv[conversationId] || [];
        const existingIds = new Set(currentList.map((m) => m.id));
        const prepended = mapped.filter((m) => !existingIds.has(m.id));
        set((state) => ({
          messagesByConv: {
            ...state.messagesByConv,
            [conversationId]: [...prepended, ...currentList],
          },
          hasMoreBeforeByConv: {
            ...state.hasMoreBeforeByConv,
            [conversationId]: mapped.length >= 60,
          },
        }));
        return prepended.length;
      } catch {
        return 0;
      } finally {
        set((state) => ({
          loadingOlderByConv: { ...state.loadingOlderByConv, [conversationId]: false },
        }));
      }
    },

    loadMessagesAround: async (conversationId, messageId) => {
      const actorId = get().currentUser?.id;
      try {
        const res = await mobileApi.listMessages(conversationId, {
          around: messageId,
          limit: 80,
        });
        const rawList = Array.isArray(res.messages) ? res.messages : [];
        const s = get();
        if (s.currentUser?.id !== actorId || rawList.length === 0) return false;
        const conv = s.conversations[conversationId];
        const mapped = rawList.map((m) =>
          mapRawMessage(conversationId, m, s.members, {
            currentUserId: s.currentUser?.id,
            convKind: conv?.kind,
            peerLastReadAt: conv?.peerLastReadAt,
          })
        );
        const currentList = s.messagesByConv[conversationId] || [];
        const byId = new Map<string, V1Message>();
        for (const m of mapped) byId.set(m.id, m);
        for (const m of currentList) {
          if (!byId.has(m.id)) byId.set(m.id, m);
        }
        const merged = Array.from(byId.values()).sort((a, b) => {
          const dt = Date.parse(a.createdAt) - Date.parse(b.createdAt);
          if (Number.isFinite(dt) && dt !== 0) return dt;
          return a.id.localeCompare(b.id);
        });
        set((state) => ({
          messagesByConv: {
            ...state.messagesByConv,
            [conversationId]: merged,
          },
          hasMoreBeforeByConv: {
            ...state.hasMoreBeforeByConv,
            [conversationId]: true,
          },
        }));
        return merged.some((m) => m.id === messageId);
      } catch {
        return false;
      }
    },

    markRead: (conversationId, options) => {
      if (!options?.explicit && !canReadConversation(conversationId)) return;
      const conv = get().conversations[conversationId];
      if (!conv || (!options?.explicit && conv.unreadCount === 0 && conv.mentionCount === 0)) return;
      const messageId = options?.explicit ? undefined : options?.messageId || latestReadAnchorId(get().messagesByConv[conversationId] || []);
      if (!options?.explicit && !messageId) return;
      const pending = pendingReads.get(conversationId);
      if (pending) { if (messageId && messageId !== pending.messageId) pending.queuedMessageId = messageId; return; }
      const attempt: { messageId?: string; queuedMessageId?: string; arrived: Set<string> } = { messageId, arrived: new Set() };
      const actorId = get().currentUser?.id;
      pendingReads.set(conversationId, attempt);
      let succeeded = false;
      void mobileApi.markConversationRead(conversationId, messageId).then((response) => {
        if (get().currentUser?.id !== actorId || pendingReads.get(conversationId) !== attempt) return;
        succeeded = true;
        confirmRead(conversationId, response, conv);
        if (get().conversations[conversationId]?.unreadCount === 0) nativeBridge.clearConversationNotification(conversationId);
      }).catch(() => {
        // A failed write must leave the authoritative unread projection intact.
      }).finally(() => {
        if (pendingReads.get(conversationId) !== attempt) return;
        pendingReads.delete(conversationId);
        if (succeeded && attempt.queuedMessageId && canReadConversation(conversationId)) get().markRead(conversationId, { messageId: attempt.queuedMessageId });
      });
    },

    setDraft: (conversationId, text, replyToMessageId, mentions) => {
      set((s) => {
        const nextDrafts = { ...s.drafts };
        const effectiveReply =
          replyToMessageId !== undefined ? replyToMessageId : nextDrafts[conversationId]?.replyToMessageId;
        if (!text && !effectiveReply) {
          delete nextDrafts[conversationId];
        } else {
          nextDrafts[conversationId] = {
            text,
            replyToMessageId: effectiveReply || undefined,
            mentions: mentions ?? (nextDrafts[conversationId]?.text === text ? nextDrafts[conversationId]?.mentions : undefined),
          };
        }
        persistDrafts(nextDrafts);
        return { drafts: nextDrafts };
      });
    },

    setEditingMessageId: (editingMessageId) => set({ editingMessageId }),

    jumpToMessage: (conversationId, messageId) => {
      useNavStore.getState().openChat(conversationId);
      set({ highlightedMessageId: messageId });
      const alreadyLoaded = (get().messagesByConv[conversationId] || []).some((m) => m.id === messageId);
      if (!alreadyLoaded) {
        void get().loadMessagesAround(conversationId, messageId);
      }
    },

    clearHighlightedMessage: () => set({ highlightedMessageId: null }),

    sendWorkspaceMessage: async (conversationId, text, replyToId, attachments, contentBlocks) => {
      const user = get().currentUser;
      const trimmed = text.trim();
      const attList = attachments && attachments.length > 0 ? attachments : undefined;
      if (!user || (!trimmed && !attList)) return;

      const convSnap = get().conversations[conversationId];
      const parsedBlocks: Array<Record<string, unknown>> = contentBlocks ?? (trimmed
        ? buildTextAndMentionBlocks(trimmed, convSnap, get().members, user.id)
        : []);
      const optimisticBlocks: V1MessageBlock[] = parsedBlocks.map((b) =>
        b.type === "mention"
          ? { type: "mention", userId: String(b.userId), label: String(b.label) }
          : { type: "text", text: String(b.text || "") }
      );
      const displayPlain = trimmed || (attList ? `[附件] ${attList[0].fileName}` : "");
      const clientMessageId = `cli_${crypto.randomUUID()}`;
      const tempId = `opt_${clientMessageId}`;

      const optimistic: V1Message = {
        id: tempId,
        clientMessageId,
        conversationId,
        senderId: user.id,
        senderName: user.displayName,
        senderAvatarUrl: user.avatarUrl,
        plainText: displayPlain,
        blocks: optimisticBlocks,
        replyToId,
        createdAt: new Date().toISOString(),
        status: "sending",
        reactions: {},
        attachments: attList,
      };

      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: [...(s.messagesByConv[conversationId] || []), optimistic],
        },
        conversations: s.conversations[conversationId]
          ? {
              ...s.conversations,
              [conversationId]: {
                ...s.conversations[conversationId],
                lastMessageText: displayPlain,
                lastMessageAt: optimistic.createdAt,
                lastMessageSenderId: user.id,
                lastMessageSenderName: user.displayName,
                lastMessageRecalled: false,
              },
            }
          : s.conversations,
      }));
      get().setDraft(conversationId, "", "");

      const releaseWrite = beginMobileWrite();
      try {
        const requestBlocks: Array<Record<string, unknown>> = [...parsedBlocks];
        for (const a of attList || []) {
          if (a.id) requestBlocks.push({ type: "attachment", attachmentId: a.id });
        }
        const res = await mobileApi.sendMessage(conversationId, trimmed, {
          replyToMessageId: replyToId,
          clientMessageId,
          attachmentIds: attList?.map((a) => a.id),
          blocks: requestBlocks.length > 0 ? requestBlocks : undefined,
        });
        const msgObj = (res.message || {}) as Record<string, unknown>;
        const realId = msgObj.id ? String(msgObj.id) : tempId;
        const latest = get();
        const latestConv = latest.conversations[conversationId];
        const serverMapped = msgObj.id
          ? mapRawMessage(conversationId, msgObj, latest.members, {
              currentUserId: user.id,
              convKind: latestConv?.kind,
              peerLastReadAt: latestConv?.peerLastReadAt,
            })
          : null;
        const finalStatus = computeOwnMessageStatus(
          latestConv?.kind,
          latestConv?.peerLastReadAt,
          serverMapped?.createdAt || optimistic.createdAt
        );
        set((s) => {
          const list = s.messagesByConv[conversationId] || [];
          const alreadyDelivered = list.some((m) => m.id === realId && m.id !== tempId);
          const nextList = alreadyDelivered
            ? list.filter((m) => m.id !== tempId)
            : list.map((m) =>
                m.id === tempId
                  ? serverMapped
                    ? { ...serverMapped, status: finalStatus }
                    : { ...m, id: realId, status: finalStatus }
                  : m
              );
          return {
            messagesByConv: { ...s.messagesByConv, [conversationId]: nextList },
                conversations: s.conversations[conversationId]
                  ? {
                      ...s.conversations,
                      [conversationId]: {
                        ...s.conversations[conversationId],
                        lastMessageText: serverMapped?.plainText || displayPlain,
                        lastMessageAt: serverMapped?.createdAt || optimistic.createdAt,
                        lastMessageSenderId: user.id,
                        lastMessageSenderName: user.displayName,
                        lastMessageRecalled: false,
                      },
                    }
                  : s.conversations,
          };
        });
      } catch {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
              m.id === tempId ? { ...m, status: "failed" } : m
            ),
          },
        }));
        useNavStore.getState().showToast("消息发送失败，请重试", "danger");
      } finally {
        releaseWrite();
      }
    },

    sendCustomSticker: async (conversationId, customEmoteId, replyToId) => {
      const user = get().currentUser;
      const cleaned = customEmoteId.trim();
      if (!user || !cleaned) return;
      const shortcode = cleaned.startsWith("custom:") ? cleaned : `custom:${cleaned}`;
      const clientMessageId = `cli_${crypto.randomUUID()}`;
      const tempId = `opt_${clientMessageId}`;
      const optimistic: V1Message = {
        id: tempId,
        clientMessageId,
        conversationId,
        senderId: user.id,
        senderName: user.displayName,
        senderAvatarUrl: user.avatarUrl,
        plainText: "[表情]",
        blocks: [{ type: "emoji", shortcode }],
        replyToId,
        createdAt: new Date().toISOString(),
        status: "sending",
        reactions: {},
      };
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: [...(s.messagesByConv[conversationId] || []), optimistic],
        },
        conversations: s.conversations[conversationId]
          ? {
              ...s.conversations,
              [conversationId]: {
                ...s.conversations[conversationId],
                lastMessageText: "[表情]",
                lastMessageAt: optimistic.createdAt,
                lastMessageSenderId: user.id,
                lastMessageSenderName: user.displayName,
                lastMessageRecalled: false,
              },
            }
          : s.conversations,
      }));
      if (replyToId) get().setDraft(conversationId, get().drafts[conversationId]?.text || "", "");

      try {
        const res = await mobileApi.sendMessage(conversationId, "[表情]", {
          replyToMessageId: replyToId,
          clientMessageId,
          blocks: [{ type: "emoji", shortcode }],
        });
        const msgObj = (res.message || {}) as Record<string, unknown>;
        const realId = msgObj.id ? String(msgObj.id) : tempId;
        const latest = get();
        const latestConv = latest.conversations[conversationId];
        const finalStatus = computeOwnMessageStatus(
          latestConv?.kind,
          latestConv?.peerLastReadAt,
          optimistic.createdAt
        );
        set((s) => {
          const list = s.messagesByConv[conversationId] || [];
          const alreadyDelivered = list.some((m) => m.id === realId && m.id !== tempId);
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [conversationId]: alreadyDelivered
                ? list.filter((m) => m.id !== tempId)
                : list.map((m) =>
                    m.id === tempId ? { ...m, id: realId, status: finalStatus } : m
                  ),
            },
          };
        });
      } catch (err) {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
              m.id === tempId ? { ...m, status: "failed" } : m
            ),
          },
        }));
        useNavStore
          .getState()
          .showToast(
            err instanceof Error && err.message ? err.message : "贴纸发送失败，请重试",
            "danger"
          );
      }
    },

    sendStickerPackShare: async (conversationId, share) => {
      const user = get().currentUser;
      if (!user || !share?.id) return;
      const clientMessageId = `cli_${crypto.randomUUID()}`;
      const tempId = `opt_${clientMessageId}`;
      const displayPlain = `[表情包] ${share.name}`;
      const optimistic: V1Message = {
        id: tempId,
        clientMessageId,
        conversationId,
        senderId: user.id,
        senderName: user.displayName,
        senderAvatarUrl: user.avatarUrl,
        plainText: displayPlain,
        blocks: [{ type: "emote_collection", shareId: share.id, share }],
        createdAt: new Date().toISOString(),
        status: "sending",
        reactions: {},
      };
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: [...(s.messagesByConv[conversationId] || []), optimistic],
        },
        conversations: s.conversations[conversationId]
          ? {
              ...s.conversations,
              [conversationId]: {
                ...s.conversations[conversationId],
                lastMessageText: displayPlain,
                lastMessageAt: optimistic.createdAt,
                lastMessageSenderId: user.id,
                lastMessageSenderName: user.displayName,
                lastMessageRecalled: false,
              },
            }
          : s.conversations,
      }));
      try {
        const res = await mobileApi.sendMessage(conversationId, displayPlain, {
          clientMessageId,
          blocks: [{ type: "emote_collection", shareId: share.id }],
        });
        const msgObj = (res.message || {}) as Record<string, unknown>;
        const realId = msgObj.id ? String(msgObj.id) : tempId;
        const latestConv = get().conversations[conversationId];
        const finalStatus = computeOwnMessageStatus(
          latestConv?.kind,
          latestConv?.peerLastReadAt,
          optimistic.createdAt
        );
        set((s) => {
          const list = s.messagesByConv[conversationId] || [];
          const alreadyDelivered = list.some((m) => m.id === realId && m.id !== tempId);
          return {
            messagesByConv: {
              ...s.messagesByConv,
              [conversationId]: alreadyDelivered
                ? list.filter((m) => m.id !== tempId)
                : list.map((m) =>
                    m.id === tempId ? { ...m, id: realId, status: finalStatus } : m
                  ),
            },
          };
        });
      } catch (err) {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
              m.id === tempId ? { ...m, status: "failed" } : m
            ),
          },
        }));
        useNavStore
          .getState()
          .showToast(
            err instanceof Error && err.message ? err.message : "分享表情包卡片失败",
            "danger"
          );
      }
    },

    editWorkspaceMessage: async (conversationId, messageId, newText) => {
      const trimmed = newText.trim();
      if (!trimmed) return;
      const nowIso = new Date().toISOString();
      set((s) => ({
        editingMessageId: null,
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  plainText: trimmed,
                  blocks: [{ type: "text", text: trimmed }],
                  editedAt: nowIso,
                }
              : m
          ),
        },
      }));
      await mobileApi.editMessage(messageId, trimmed);
    },

    recallWorkspaceMessage: async (conversationId, messageId) => {
      const existing = (get().messagesByConv[conversationId] || []).find((m) => m.id === messageId);
      if (existing && existing.plainText) {
        set((s) => ({
          recalledDrafts: {
            ...s.recalledDrafts,
            [messageId]: { text: existing.plainText, replyToId: existing.replyToId },
          },
        }));
      }
      await mobileApi.recallMessage(messageId);
      const nowIso = new Date().toISOString();
      set((s) => {
        const list = s.messagesByConv[conversationId] || [];
        const isTail = list.length > 0 && list[list.length - 1].id === messageId;
        const prevConv = s.conversations[conversationId];
        return {
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: list.map((m) =>
              m.id === messageId
                ? {
                    ...m,
                    recalledAt: nowIso,
                    blocks: [],
                    reactions: {},
                    attachments: undefined,
                    card: undefined,
                  }
                : m
            ),
          },
          conversations:
            isTail && prevConv
              ? {
                  ...s.conversations,
                  [conversationId]: {
                    ...prevConv,
                    lastMessageText: "你撤回了一条消息",
                    lastMessageRecalled: true,
                  },
                }
              : s.conversations,
        };
      });
    },

    restoreRecalledDraft: (conversationId, messageId) => {
      const saved = get().recalledDrafts[messageId];
      if (!saved) return;
      get().setDraft(conversationId, saved.text, saved.replyToId || "");
    },

    toggleReaction: async (conversationId, messageId, emoji) => {
      const key = normalizeReactionEmoteKey(emoji);
      if (!key) return;
      nativeBridge.haptic("light");
      const myUserId = get().currentUser?.id;
      const targetMsg = (get().messagesByConv[conversationId] || []).find((m) => m.id === messageId);
      const prevReactions = targetMsg ? { ...targetMsg.reactions } : null;

      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] || []).map((m) => {
            if (m.id !== messageId) return m;
            const cur = m.reactions[key];
            const nextReactions = { ...m.reactions };
            const prevUsers = Array.isArray(cur?.users) ? cur.users : [];
            if (cur?.reactedByMe) {
              const nextUsers = myUserId ? prevUsers.filter((id) => id !== myUserId) : prevUsers;
              if (cur.count <= 1) delete nextReactions[key];
              else
                nextReactions[key] = {
                  count: cur.count - 1,
                  reactedByMe: false,
                  ...(nextUsers.length > 0 ? { users: nextUsers } : {}),
                };
            } else {
              const nextUsers =
                myUserId && !prevUsers.includes(myUserId) ? [...prevUsers, myUserId] : prevUsers;
              nextReactions[key] = {
                count: (cur?.count || 0) + 1,
                reactedByMe: true,
                ...(nextUsers.length > 0 ? { users: nextUsers } : {}),
              };
            }
            return { ...m, reactions: nextReactions };
          }),
        },
      }));
      try {
        await mobileApi.reactToMessage(messageId, key);
      } catch {
        if (prevReactions) {
          set((s) => ({
            messagesByConv: {
              ...s.messagesByConv,
              [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
                m.id === messageId ? { ...m, reactions: prevReactions } : m
              ),
            },
          }));
        }
      }
    },

    togglePinMessage: async (conversationId, messageId) => {
      const conv = get().conversations[conversationId];
      if (!conv) return;
      const isPinned = conv.pinnedMessageIds.includes(messageId);
      const nextPins = isPinned
        ? conv.pinnedMessageIds.filter((id) => id !== messageId)
        : [messageId, ...conv.pinnedMessageIds];
      set((s) => ({
        conversations: {
          ...s.conversations,
          [conversationId]: { ...conv, pinnedMessageIds: nextPins },
        },
      }));
      if (isPinned) {
        await mobileApi.unpinMessage(conversationId, messageId);
      } else {
        await mobileApi.pinMessage(conversationId, messageId);
      }
    },

    togglePinConversation: async (conversationId) => {
      const cur = get().pinnedConversationIds;
      const next = cur.includes(conversationId)
        ? cur.filter((id) => id !== conversationId)
        : [conversationId, ...cur];
      await get().updateUserPreferences({ pinnedConversationIds: next });
    },

    setConversationNotificationLevel: async (conversationId, level) => {
      const prev = get().conversations[conversationId];
      if (!prev) return;
      const prevLevel = prev.notificationLevel || "all";
      set((s) => ({
        conversations: {
          ...s.conversations,
          [conversationId]: {
            ...s.conversations[conversationId],
            notificationLevel: level,
          },
        },
      }));
      try {
        await mobileApi.updateConversationNotification(conversationId, level);
      } catch (err) {
        set((s) => ({
          conversations: s.conversations[conversationId]
            ? {
                ...s.conversations,
                [conversationId]: {
                  ...s.conversations[conversationId],
                  notificationLevel: prevLevel,
                },
              }
            : s.conversations,
        }));
        throw err;
      }
    },

    setMemberRemark: async (userId, remark) => {
      const clean = remark.trim();
      await mobileApi.setMemberRemark(userId, clean);
      set((s) => {
        const prevUser = s.members[userId];
        if (!prevUser) return s;
        const baseName = prevUser.rawDisplayName || prevUser.displayName;
        const nextDisplayName = clean || baseName;
        const updatedUser: V1User = {
          ...prevUser,
          displayName: nextDisplayName,
          rawDisplayName: baseName,
          remark: clean || undefined,
        };
        const nextConvs = { ...s.conversations };
        for (const [cid, conv] of Object.entries(nextConvs)) {
          let changed = false;
          let nextTitle = conv.title;
          let nextLastSenderName = conv.lastMessageSenderName;
          if (conv.kind === "direct" && conv.memberIds.includes(userId)) {
            nextTitle = nextDisplayName;
            changed = true;
          }
          if (conv.lastMessageSenderId === userId) {
            nextLastSenderName = nextDisplayName;
            changed = true;
          }
          if (changed) {
            nextConvs[cid] = {
              ...conv,
              title: nextTitle,
              lastMessageSenderName: nextLastSenderName,
            };
          }
        }
        return {
          members: {
            ...s.members,
            [userId]: updatedUser,
          },
          conversations: nextConvs,
        };
      });
    },

    updateCollapsePreferences: async (patch) => {
      const next: CollapsePreferences = {
        ...get().collapsePrefs,
        ...patch,
      };
      saveLocalCollapsePrefs(next);
      set({ collapsePrefs: next });
      if (!next.localOnly) {
        await get().updateUserPreferences({
          collapseImages: next.collapseImages,
          collapseStickers: next.collapseStickers,
          collapseLongMessages: next.collapseLongMessages,
          autoCollapse: {
            collapseImages: next.collapseImages,
            collapseStickers: next.collapseStickers,
            collapseLongMessages: next.collapseLongMessages,
          },
        });
      }
    },

    setLocalMessageCollapsed: (messageId, collapsed) => {
      if (!messageId) return;
      set((s) => {
        const next = { ...s.messageCollapseOverrides };
        if (collapsed === null) {
          delete next[messageId];
        } else {
          next[messageId] = collapsed;
        }
        saveMsgCollapseOverrides(next);
        return { messageCollapseOverrides: next };
      });
    },

    updateUserPreferences: async (patch) => {
      const merged = { ...get().userPreferences, ...patch };
      const pinnedConversationIds = Array.isArray(merged.pinnedConversationIds)
        ? merged.pinnedConversationIds.map(String).filter(Boolean)
        : get().pinnedConversationIds;
      set({ userPreferences: merged, pinnedConversationIds });
      await mobileApi.savePreferences(merged).catch(() => {});
    },

    startDirectChatWithUser: async (userId) => {
      const existing = Object.values(get().conversations).find(
        (c) => c.kind === "direct" && c.memberIds.includes(userId)
      );
      if (existing) {
        useNavStore.getState().setActiveTab("chats");
        useNavStore.getState().openChat(existing.id);
        return existing.id;
      }
      const res = await mobileApi.createDirectConversation(userId);
      const c = (res.conversation || res) as Record<string, unknown>;
      const cid = String(c.id || "");
      if (cid) {
        await get().bootstrapWorkspace();
        useNavStore.getState().setActiveTab("chats");
        useNavStore.getState().openChat(cid);
        return cid;
      }
      return null;
    },

    createGroup: async (title, memberIds, avatar) => {
      const res = await mobileApi.createGroupConversation(title.trim(), memberIds, avatar);
      const c = (res.conversation || res) as Record<string, unknown>;
      const cid = String(c.id || "");
      await get().bootstrapWorkspace();
      if (cid) {
        useNavStore.getState().setActiveTab("chats");
        useNavStore.getState().openChat(cid);
        return cid;
      }
      return null;
    },

    updateGroupProfile: async (conversationId, patch) => {
      await mobileApi.updateGroupConversation(conversationId, patch);
      set((s) => {
        const prev = s.conversations[conversationId];
        if (!prev) return s;
        return {
          conversations: {
            ...s.conversations,
            [conversationId]: {
              ...prev,
              ...(patch.title ? { title: patch.title } : {}),
              ...(patch.avatar !== undefined
                ? { avatarEmoji: patch.avatar || undefined, avatarUrl: undefined }
                : {}),
            },
          },
        };
      });
    },

    inviteGroupMembers: async (conversationId, userIds) => {
      await mobileApi.addGroupMembers(conversationId, userIds);
      await get().bootstrapWorkspace();
    },

    removeGroupMember: async (conversationId, userId) => {
      await mobileApi.removeGroupMember(conversationId, userId);
      set((s) => {
        const prev = s.conversations[conversationId];
        if (!prev) return s;
        return {
          conversations: {
            ...s.conversations,
            [conversationId]: {
              ...prev,
              memberIds: prev.memberIds.filter((id) => id !== userId),
            },
          },
        };
      });
    },

    leaveGroup: async (conversationId) => {
      await mobileApi.leaveGroupConversation(conversationId);
      useNavStore.getState().closeChat();
      set((s) => {
        const nextConvs = { ...s.conversations };
        delete nextConvs[conversationId];
        return {
          conversations: nextConvs,
          conversationOrder: s.conversationOrder.filter((id) => id !== conversationId),
        };
      });
    },

    forwardMessage: async (messageIds, targetConversationId) => {
      await mobileApi.forwardMessages(messageIds, targetConversationId);
      useNavStore.getState().showToast("已转发消息", "success");
    },

    loadThread: async (rootMessageId) => {
      const view = await mobileApi.getThread(rootMessageId);
      set((s) => ({
        threadsByRootId: { ...s.threadsByRootId, [rootMessageId]: view },
      }));
    },

    sendThreadReply: async (rootMessageId, text, alsoSendToChannel) => {
      const reply = await mobileApi.replyThread(rootMessageId, text.trim(), alsoSendToChannel);
      set((s) => {
        const prev = s.threadsByRootId[rootMessageId];
        const nextReplies = [...(prev?.replies || []), reply];
        const convMsgs = s.messagesByConv[reply.conversationId];
        const nextMessagesByConv = convMsgs
          ? {
              ...s.messagesByConv,
              [reply.conversationId]: convMsgs.map((m) =>
                m.id === rootMessageId
                  ? {
                      ...m,
                      threadReplyCount: Math.max(
                        (m.threadReplyCount || 0) + 1,
                        nextReplies.length
                      ),
                      threadLastRepliedAt: reply.createdAt,
                      threadPreviewReplies: [
                        ...(m.threadPreviewReplies || []),
                        {
                          id: reply.id,
                          authorId: reply.authorId,
                          authorName:
                            s.members[reply.authorId]?.displayName || reply.authorName || "我",
                          plainText: reply.plainText,
                          createdAt: reply.createdAt,
                        },
                      ].slice(-3),
                    }
                  : m
              ),
            }
          : s.messagesByConv;
        return {
          messagesByConv: nextMessagesByConv,
          threadsByRootId: {
            ...s.threadsByRootId,
            [rootMessageId]: {
              rootMessageId,
              threadTitle: prev?.threadTitle,
              replyCount: nextReplies.length,
              replies: nextReplies,
            },
          },
        };
      });
    },

    triggerCardAction: async (cardId, actionId, payload, expectedRevision = 1) => {
      nativeBridge.haptic("light");
      const res = await mobileApi.invokeCardAction(cardId, actionId, payload, expectedRevision);
      const outcome = res.action;
      if (!outcome || typeof outcome !== "object" || !("ok" in outcome) || outcome.ok !== true) {
        throw new Error("卡片操作回执无效");
      }
      const resolved = await mobileApi.resolveCard(cardId);
      const reference = Object.values(get().messagesByConv).flatMap((list) => list.flatMap((message) => message.cardReferences || []))
        .find((entry) => entry.cardId === cardId);
      const updatedCard = reference ? projectWorkspaceCard(reference, resolved.card) : undefined;
      if (updatedCard?.cardId) {
        set((s) => {
          const nextByConv: Record<string, V1Message[]> = {};
          for (const [cid, list] of Object.entries(s.messagesByConv)) {
            nextByConv[cid] = list.map((m) =>
              m.card?.cardId === updatedCard.cardId ? { ...m, card: updatedCard } : m
            );
          }
          return { messagesByConv: nextByConv };
        });
      }
    },

    applyRealtimeEvent: (eventObj) => {
      const evType = String(eventObj.type || "");
      const payload = (
        eventObj.payload && typeof eventObj.payload === "object" ? eventObj.payload : {}
      ) as Record<string, unknown>;

      if (evType === "workspace.member_joined" || evType === "workspace.member_updated") {
        const m = (payload.member || payload) as Record<string, unknown>;
        const id = String(m.id || payload.userId || eventObj.targetId || "");
        if (!id) return;
        set((s) => {
          const nextMembers = { ...s.members };
          upsertRawMemberRecord(nextMembers, { ...m, id });
          const updated = nextMembers[id];
          return {
            members: nextMembers,
            currentUser:
              s.currentUser?.id === id && updated
                ? { ...s.currentUser, ...updated }
                : s.currentUser,
          };
        });
        return;
      }

      if (evType === "emote.library.updated") {
        void useEmoteStore.getState().refreshLibrary(false);
        return;
      }

      if (evType === "workspace.announcement_updated") {
        const nextAnn = parseRawSystemAnnouncement(payload.announcement ?? payload);
        set((s) => {
          if (!nextAnn || !nextAnn.enabled) {
            return { systemAnnouncement: null };
          }
          const prevAckedId = String(s.userPreferences?.ackAnnouncementId || "");
          const shouldShow =
            nextAnn.displayMode === "always" || !prevAckedId || prevAckedId !== nextAnn.id;
          return {
            systemAnnouncement: { ...nextAnn, shouldShow },
          };
        });
        return;
      }

      if (evType === "conversation.read") {
        const convId = String(payload.conversationId || eventObj.conversationId || "");
        const readerId = String(payload.userId || eventObj.actorId || "");
        const readAt = String(payload.readAt || payload.lastReadAt || eventObj.createdAt || "");
        if (!convId || !readerId) return;
        if (get().currentUser?.id === readerId) {
          confirmRead(convId, readAt ? { ...payload, readAt } : payload);
          return;
        }
        const readMs = Date.parse(readAt);
        if (!Number.isFinite(readMs)) return;

        set((s) => {
          const prevConv = s.conversations[convId];
          const prevPeerMs = prevConv?.peerLastReadAt ? Date.parse(prevConv.peerLastReadAt) : 0;
          const nextPeerLastReadAt =
            !Number.isFinite(prevPeerMs) || readMs > prevPeerMs
              ? readAt
              : prevConv?.peerLastReadAt;
          const nextMsgs = (s.messagesByConv[convId] || []).map((msg) =>
            s.currentUser?.id &&
            msg.senderId === s.currentUser.id &&
            msg.status === "sent" &&
            Date.parse(msg.createdAt) <= readMs
              ? { ...msg, status: "read" as const }
              : msg
          );
          return {
            messagesByConv: { ...s.messagesByConv, [convId]: nextMsgs },
            ...(prevConv
              ? {
                  conversations: {
                    ...s.conversations,
                    [convId]: { ...prevConv, peerLastReadAt: nextPeerLastReadAt },
                  },
                }
              : {}),
          };
        });
        return;
      }

      if (evType === "conversation.typing") {
        const convId = String(payload.conversationId || eventObj.conversationId || "");
        const typerId = String(payload.userId || eventObj.actorId || "");
        if (!convId || !typerId || typerId === get().currentUser?.id) return;
        const parsedExp = Date.parse(String(payload.expiresAt || ""));
        const expiresAt = Number.isFinite(parsedExp) ? parsedExp : Date.now() + 5000;
        const now = Date.now();
        if (expiresAt <= now) return;
        const kind: "human" | "bot" =
          payload.kind === "bot" || get().members[typerId]?.role === "bot" ? "bot" : "human";
        const state: "typing" | "thinking" = payload.state === "thinking" ? "thinking" : "typing";
        const displayName = String(
          payload.displayName ||
            get().members[typerId]?.displayName ||
            (kind === "bot" ? "机器人" : "对方")
        );
        set((s) => ({
          typingByConv: {
            ...s.typingByConv,
            [convId]: [
              ...(s.typingByConv[convId] || []).filter(
                (e) => e.expiresAt > now && e.userId !== typerId
              ),
              { userId: typerId, displayName, kind, state, expiresAt },
            ],
          },
        }));
        setTimeout(() => {
          const ts = Date.now();
          set((s) => {
            const cur = s.typingByConv[convId] || [];
            const next = cur.filter((e) => e.expiresAt > ts);
            if (next.length === cur.length) return s;
            const copy = { ...s.typingByConv };
            if (next.length === 0) delete copy[convId];
            else copy[convId] = next;
            return { typingByConv: copy };
          });
        }, Math.min(12000, Math.max(300, expiresAt - now + 100)));
        return;
      }

      if (
        evType === "message.created" ||
        evType === "message.recalled" ||
        evType === "message.edited"
      ) {
        const rawMsg = (payload.message || {}) as Record<string, unknown>;
        const rawConversation = (payload.conversation || {}) as Record<string, unknown>;
        const convId = String(
          rawMsg.conversationId || payload.conversationId || eventObj.conversationId || ""
        );
        if (!convId || !rawMsg.id) return;
        const sSnap = get();
        const snapConv = sSnap.conversations[convId];
        const mapped = mapRawMessage(convId, rawMsg, sSnap.members, {
          currentUserId: sSnap.currentUser?.id,
          convKind: snapConv?.kind,
          peerLastReadAt: snapConv?.peerLastReadAt,
        });
        if (evType === "message.created") mapped.creationSeq ??= nonnegativeInteger(eventObj.seq);
        const isOwn = Boolean(sSnap.currentUser?.id && mapped.senderId === sSnap.currentUser.id);
        const isSys = mapped.kind === "system";

        const messageKey = `${sSnap.currentUser?.id}:${convId}:${mapped.id}`;
        const creationSeq = Number(eventObj.seq || 0);
        const replayedCreation = evType === "message.created" && (seenCreatedMessages.has(messageKey) ||
          snapConv?.lastReadMessageId === mapped.id ||
          (creationSeq > 0 && typeof snapConv?.lastReadSeq === "number" && creationSeq <= snapConv.lastReadSeq));
        if (evType === "message.created") {
          seenCreatedMessages.add(messageKey);
          if (seenCreatedMessages.size > 2000) seenCreatedMessages.delete(seenCreatedMessages.values().next().value!);
        }

        set((s) => {
          const prevConv = s.conversations[convId];
          let nextPeerLastReadAt = prevConv?.peerLastReadAt;
          if (evType === "message.created" && !isOwn && !isSys) {
            const mMs = Date.parse(mapped.createdAt);
            const pMs = nextPeerLastReadAt ? Date.parse(nextPeerLastReadAt) : 0;
            if (Number.isFinite(mMs) && (!Number.isFinite(pMs) || mMs > pMs)) {
              nextPeerLastReadAt = mapped.createdAt;
            }
          }
          const resolvedStatus: V1Message["status"] = isOwn
            ? computeOwnMessageStatus(prevConv?.kind, nextPeerLastReadAt, mapped.createdAt)
            : "read";
          const existing = s.messagesByConv[convId] || [];
          const matchIdx = existing.findIndex(
            (item) =>
              item.id === mapped.id ||
              (mapped.clientMessageId && item.clientMessageId === mapped.clientMessageId)
          );
          const recalledTs =
            evType === "message.recalled"
              ? mapped.recalledAt || new Date().toISOString()
              : mapped.recalledAt;

          let nextList =
            matchIdx >= 0
              ? existing.map((item, idx) =>
                  idx === matchIdx
                    ? evType === "message.recalled"
                      ? {
                          ...item,
                          ...mapped,
                          creationSeq: mapped.creationSeq ?? item.creationSeq,
                          hiddenByCurrentUser: mapped.hiddenByCurrentUser ?? item.hiddenByCurrentUser,
                          recalledAt: recalledTs,
                          blocks: [],
                          reactions: {},
                          attachments: undefined,
                          card: undefined,
                        }
                      : {
                          ...item,
                          ...mapped,
                          creationSeq: mapped.creationSeq ?? item.creationSeq,
                          hiddenByCurrentUser: mapped.hiddenByCurrentUser ?? item.hiddenByCurrentUser,
                          status: item.status === "read" ? "read" : resolvedStatus,
                        }
                    : item
                )
              : [...existing, { ...mapped, recalledAt: recalledTs, status: resolvedStatus }];

          if (evType === "message.created" && !isOwn && !isSys && nextPeerLastReadAt) {
            const pMs = Date.parse(nextPeerLastReadAt);
            nextList = nextList.map((item) =>
              s.currentUser?.id &&
              item.senderId === s.currentUser.id &&
              item.status === "sent" &&
              Date.parse(item.createdAt) <= pMs
                ? { ...item, status: "read" as const }
                : item
            );
          }

          const mentionedMe =
            evType === "message.created" &&
            !isOwn &&
            !isSys &&
            Boolean(
              mapped.blocks?.some(
                (b) =>
                  b.type === "mention" &&
                  (b.userId === s.currentUser?.id ||
                    b.userId === "all" ||
                    b.label === "所有人")
              ) ||
                ((prevConv?.kind === "group" || !prevConv) && mapped.plainText.includes("@所有人"))
            );

          const unread = projectedUnread(rawConversation, prevConv);
          const arrived = evType === "message.created" && matchIdx < 0 && !replayedCreation && !isOwn && !isSys &&
            !recalledTs && !mapped.hiddenByCurrentUser && unread.unreadCount !== 0;
          if (arrived) pendingReads.get(convId)?.arrived.add(mapped.id);
          const nextUnread = unread.unreadCount ?? (prevConv?.unreadCount || 0) + Number(arrived);
          const nextMention = nextUnread === 0 ? 0 : (prevConv?.mentionCount || 0) + Number(arrived && mentionedMe);

          const isRecalledEvent = Boolean(evType === "message.recalled" || recalledTs);
          const summaryText = isRecalledEvent
            ? isOwn
              ? "你撤回了一条消息"
              : `${mapped.senderName} 撤回了一条消息`
            : mapped.plainText;

          const nextTyping = { ...s.typingByConv };
          if (evType === "message.created" && nextTyping[convId]) {
            const rem = nextTyping[convId].filter((t) => t.userId !== mapped.senderId);
            if (rem.length === 0) delete nextTyping[convId];
            else nextTyping[convId] = rem;
          }

          return {
            typingByConv: nextTyping,
            messagesByConv: { ...s.messagesByConv, [convId]: nextList },
            conversations: {
              ...s.conversations,
              [convId]: prevConv
                ? {
                    ...prevConv,
                    ...unread,
                    lastMessageText: summaryText,
                    lastMessageAt:
                      evType === "message.created"
                        ? mapped.createdAt
                        : prevConv.lastMessageAt || mapped.createdAt,
                    lastMessageSenderId: mapped.senderId || prevConv.lastMessageSenderId,
                    lastMessageSenderName: mapped.senderName || prevConv.lastMessageSenderName,
                    lastMessageRecalled: isRecalledEvent,
                    unreadCount: nextUnread,
                    mentionCount: nextMention,
                    peerLastReadAt: nextPeerLastReadAt,
                  }
                : {
                    ...unread,
                    id: convId,
                    kind: "group",
                    title: mapped.senderName || "新对话",
                    unreadCount: nextUnread,
                    mentionCount: nextMention,
                    pinnedMessageIds: [],
                    memberIds: [],
                    lastMessageText: summaryText,
                    lastMessageAt: mapped.createdAt,
                    lastMessageSenderId: mapped.senderId,
                    lastMessageSenderName: mapped.senderName,
                    lastMessageRecalled: isRecalledEvent,
                    notificationLevel: "all",
                    peerLastReadAt: nextPeerLastReadAt,
                  },
            },
            conversationOrder: prevConv
              ? [convId, ...s.conversationOrder.filter((id) => id !== convId)]
              : [convId, ...s.conversationOrder],
          };
        });
        return;
      }

      if (evType === "reaction.added" || evType === "reaction.removed") {
        const msgId = String(payload.messageId || eventObj.targetId || "");
        const convId = String(payload.conversationId || eventObj.conversationId || "");
        if (!msgId || !convId) return;
        const nextReactions = mapRawReactions(payload.reactions);
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [convId]: (s.messagesByConv[convId] || []).map((m) =>
              m.id === msgId ? { ...m, reactions: nextReactions } : m
            ),
          },
        }));
        return;
      }

      if (evType === "card.updated") {
        const changed = (payload.card && typeof payload.card === "object" ? payload.card : payload) as Record<string, unknown>;
        const cardId = typeof changed.cardId === "string" ? changed.cardId : "";
        const revision = Number(changed.revision);
        if (!cardId || !Number.isSafeInteger(revision) || revision < 1) return;
        set((state) => ({ cardRevisions: { ...state.cardRevisions, [cardId]: Math.max(revision, state.cardRevisions[cardId] || 0) } }));
        return;
      }

      if (
        evType === "conversation.notification_updated" ||
        evType === "conversation.updated"
      ) {
        const convObj =
          payload.conversation && typeof payload.conversation === "object"
            ? (payload.conversation as Record<string, unknown>)
            : payload;
        const convId = String(
          convObj.id || payload.conversationId || eventObj.conversationId || ""
        );
        if (convId && get().conversations[convId]) {
          const rawLvl =
            convObj.notificationLevel ?? payload.level ?? payload.notificationLevel;
          set((s) => {
            const prev = s.conversations[convId];
            if (!prev) return s;
            const unread = projectedUnread(convObj, prev);
            return {
              conversations: {
                ...s.conversations,
                [convId]: {
                  ...prev,
                  ...unread,
                  unreadCount: unread.unreadCount ?? prev.unreadCount,
                  mentionCount: nonnegativeInteger(convObj.mentionCount) ?? (unread.unreadCount === 0 ? 0 : prev.mentionCount),
                  ...(typeof convObj.title === "string" && convObj.title.trim() && prev.kind === "group"
                    ? { title: convObj.title.trim() }
                    : {}),
                  ...(rawLvl !== undefined
                    ? { notificationLevel: normalizeNotificationLevel(rawLvl) }
                    : {}),
                },
              },
            };
          });
        }
        return;
      }

      if (evType === "message.pinned" || evType === "message.unpinned") {
        const convId = String(payload.conversationId || eventObj.conversationId || "");
        const msgId = String(payload.messageId || eventObj.targetId || "");
        if (!convId || !msgId) return;
        set((s) => {
          const prev = s.conversations[convId];
          if (!prev) return s;
          const nextPins =
            evType === "message.pinned"
              ? prev.pinnedMessageIds.includes(msgId)
                ? prev.pinnedMessageIds
                : [msgId, ...prev.pinnedMessageIds]
              : prev.pinnedMessageIds.filter((id) => id !== msgId);
          return {
            conversations: {
              ...s.conversations,
              [convId]: { ...prev, pinnedMessageIds: nextPins },
            },
          };
        });
      }
    },

    handleDeepLink: async (rawUrl) => {
      const p2p = parseP2PInviteInput(rawUrl);
      if (p2p) {
        if (get().authStatus === "authenticated") {
          useNavStore.getState().setDirectOverlayOpen(true);
        } else {
          useNavStore.getState().setEntryLane("direct_guest");
        }
        await get().joinP2PRoom(p2p.roomId, p2p.keyStr);
        return;
      }

      try {
        const parsed = new URL(rawUrl, "https://duallane.tsio.top");
        const invite = parsed.searchParams.get("invite");
        if (invite) {
          set({ pendingInviteCode: invite.trim() });
          if (get().authStatus !== "authenticated") {
            useNavStore.getState().setEntryLane("login");
          }
        }
        const packShare = parsed.searchParams.get("pack");
        if (packShare && get().authStatus === "authenticated") {
          useNavStore.getState().setSharedPackId(packShare.trim());
        }
        const setupId = parsed.searchParams.get("setup");
        if (setupId && get().authStatus === "authenticated") {
          useNavStore.getState().setBotSetupSessionId(setupId.trim());
        }
        const convId = parsed.searchParams.get("conversation");
        if (convId && get().authStatus === "authenticated" && get().conversations[convId]) {
          useNavStore.getState().setActiveTab("chats");
          useNavStore.getState().openChat(convId);
        }
      } catch {
        // ignore invalid deep link
      }
    },

    createP2PRoom: async () => {
      const created = await createRemoteP2PRoom();
      const keyStr = await generateRoomKeyString();
      await get().joinP2PRoom(created.roomId, keyStr);
      return buildP2PShareUrl(created.roomId, keyStr);
    },

    joinP2PRoom: async (roomId, keyStr) => {
      teardownP2P();
      const { key, fingerprint } = await deriveAesKey(keyStr);
      const shareUrl = buildP2PShareUrl(roomId, keyStr);
      set({
        p2pRoom: {
          roomId,
          keyFingerprint: fingerprint,
          connectedPeers: 1,
          remotePeerCount: 0,
          status: "connecting",
          shareUrl,
        },
        p2pMessages: [],
      });

      const transport = connectP2PRoomTransport(roomId, key, {
        onPresenceChange: (u) => {
          set((s) =>
            s.p2pRoom?.roomId === roomId
              ? {
                  p2pRoom: {
                    ...s.p2pRoom,
                    status: u.status,
                    connectedPeers: u.connectedPeers,
                    remotePeerCount: u.remotePeerCount,
                    errorMessage: u.errorMessage,
                  },
                }
              : s
          );
        },
        onIncomingChat: (msg) => {
          nativeBridge.haptic("light");
          set((s) => {
            if (s.p2pMessages.some((m) => m.id === msg.id)) return s;
            return {
              p2pMessages: [
                ...s.p2pMessages,
                {
                  id: msg.id,
                  senderName: msg.author,
                  isOwn: false,
                  text: msg.body,
                  replyToId: msg.replyToId,
                  createdAt: msg.at,
                  deliveryStatus: "delivered",
                  reactions: {},
                },
              ],
            };
          });
        },
        onIncomingFile: (f) => {
          nativeBridge.haptic("light");
          set((s) => {
            if (s.p2pMessages.some((m) => m.id === f.id)) return s;
            return {
              p2pMessages: [
                ...s.p2pMessages,
                {
                  id: f.id,
                  senderName: f.author,
                  isOwn: false,
                  text: f.caption,
                  createdAt: f.at,
                  deliveryStatus: "delivered",
                  reactions: {},
                  attachment: f.attachment,
                },
              ],
            };
          });
        },
        onDeliveryAck: (messageId) => {
          set((s) => ({
            p2pMessages: s.p2pMessages.map((m) =>
              m.id === messageId ? { ...m, deliveryStatus: "delivered" } : m
            ),
          }));
        },
        onKeyMismatch: () => {
          set((s) => ({
            p2pRoom: s.p2pRoom ? { ...s.p2pRoom, keyMismatchWarning: true } : null,
          }));
        },
      });
      activeP2PTransport = transport;
    },

    leaveP2PRoom: () => {
      teardownP2P();
      set({ p2pRoom: null, p2pMessages: [], p2pDraft: "" });
    },

    setP2PDraft: (p2pDraft) => set({ p2pDraft }),

    sendP2PMessage: async (text, replyToId) => {
      const trimmed = text.trim();
      if (!trimmed || !get().p2pRoom) return;
      const id = `p2p_${crypto.randomUUID()}`;
      const author = get().currentUser?.displayName || "直连访客";
      const at = new Date().toISOString();
      const msg: P2PChatMessage = {
        id,
        senderName: author,
        isOwn: true,
        text: trimmed,
        replyToId,
        createdAt: at,
        deliveryStatus: "sending",
        reactions: {},
      };
      set((s) => ({ p2pMessages: [...s.p2pMessages, msg], p2pDraft: "" }));
      const sent = activeP2PTransport
        ? await activeP2PTransport.sendChat({ id, author, body: trimmed, at, replyToId })
        : false;
      set((s) => ({
        p2pMessages: s.p2pMessages.map((m) =>
          m.id === id
            ? {
                ...m,
                deliveryStatus:
                  m.deliveryStatus === "delivered" ? "delivered" : sent ? "sent" : "failed",
              }
            : m
        ),
      }));
    },

    sendP2PPickedFile: async (pickedFileId, fileName, mimeType, caption) => {
      if (!get().p2pRoom || !activeP2PTransport) return;
      const bytes = await nativeBridge.readPickedFileBytes(pickedFileId);
      if (bytes.byteLength > P2P_MAX_FILE_BYTES) {
        useNavStore.getState().showToast("直连单文件上限为 8 MB", "warning");
        return;
      }
      const id = `p2pf_${crypto.randomUUID()}`;
      const author = get().currentUser?.displayName || "直连访客";
      const at = new Date().toISOString();
      const blobUrl = createSafeP2PBlobUrl(bytes, mimeType);
      const msg: P2PChatMessage = {
        id,
        senderName: author,
        isOwn: true,
        text: caption || "",
        createdAt: at,
        deliveryStatus: "sending",
        reactions: {},
        attachment: {
          fileName,
          mimeType,
          byteSize: bytes.byteLength,
          blobUrl,
        },
      };
      set((s) => ({ p2pMessages: [...s.p2pMessages, msg] }));
      const sent = await activeP2PTransport.sendFile({
        id,
        author,
        fileName,
        mimeType,
        bytes,
        caption,
        at,
      });
      set((s) => ({
        p2pMessages: s.p2pMessages.map((m) =>
          m.id === id
            ? {
                ...m,
                deliveryStatus:
                  m.deliveryStatus === "delivered" ? "delivered" : sent ? "sent" : "failed",
              }
            : m
        ),
      }));
    },

    patchMemberLocal: (userId, patch) => {
      if (!userId) return;
      set((s) => {
        const existing = s.members[userId];
        const updated: V1User = existing
          ? { ...existing, ...patch }
          : {
              id: userId,
              displayName: patch.displayName || userId,
              role: patch.role || "bot",
              ...patch,
            };
        return {
          members: {
            ...s.members,
            [userId]: updated,
          },
        };
      });
    },

    dismissSystemAnnouncement: async () => {
      const ann = get().systemAnnouncement;
      if (!ann) return;
      const key = `${ann.id}:${ann.updatedAt || ""}`;
      set((s) => ({
        dismissedAnnouncementKey: key,
        systemAnnouncement: s.systemAnnouncement
          ? { ...s.systemAnnouncement, shouldShow: false }
          : null,
        userPreferences: {
          ...s.userPreferences,
          ackAnnouncementId: ann.id,
        },
      }));
      if (ann.id) {
        await mobileApi.ackAnnouncement(ann.id).catch(() => {});
      }
    },

    setBoundEmailLocal: (email) => {
      set({ boundEmail: email.trim() });
    },
  };
});

useWorkspaceStore.subscribe((state, prevState) => {
  if (state.drafts !== prevState.drafts || state.p2pDraft !== prevState.p2pDraft) syncDraftActivity(state);
  if (state.messagesByConv !== prevState.messagesByConv && state.authStatus === "authenticated") {
    schedulePersistMessages(state.messagesByConv, state.conversationOrder);
  }
  if (
    state.authStatus === "authenticated" &&
    (state.conversations !== prevState.conversations ||
      state.members !== prevState.members ||
      state.currentUser !== prevState.currentUser)
  ) {
    syncNativeNotificationState(state);
  }
});

const registeredDrafts = new Set<string>();
function syncDraftActivity(state: Pick<WorkspaceState, "drafts" | "p2pDraft">) {
  const current = new Set(Object.entries(state.drafts).filter(([, draft]) => Boolean(draft.text || draft.replyToMessageId)).map(([id]) => `workspace:${id}`));
  if (state.p2pDraft) current.add("private-direct");
  for (const id of registeredDrafts) if (!current.has(id)) setMobileDraftActivity(id, false);
  for (const id of current) setMobileDraftActivity(id, true);
  registeredDrafts.clear();
  for (const id of current) registeredDrafts.add(id);
}
syncDraftActivity(useWorkspaceStore.getState());
