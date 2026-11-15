import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";
import type { DualLaneCardKitDocument } from "@/shared/card-kit";
import {
  ApiClientError,
  mobileApi,
  type EmoteCollectionShareSummaryDTO,
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

export interface V1User {
  id: string;
  displayName: string;
  handle?: string;
  role: "owner" | "admin" | "member" | "bot";
  avatarUrl?: string;
  description?: string;
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
  kind?: "user" | "bot" | "system";
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  plainText: string;
  blocks?: V1MessageBlock[];
  replyToId?: string;
  threadRootId?: string;
  threadReplyCount?: number;
  editedAt?: string;
  recalledAt?: string;
  createdAt: string;
  status?: "sending" | "sent" | "read" | "failed";
  reactions: Record<string, { count: number; reactedByMe: boolean }>;
  attachments?: V1MessageAttachment[];
  card?: DualLaneCardKitDocument;
}

export interface V1Conversation {
  id: string;
  kind: "saved" | "direct" | "group";
  title: string;
  avatarUrl?: string;
  avatarEmoji?: string;
  unreadCount: number;
  mentionCount: number;
  pinnedMessageIds: string[];
  memberIds: string[];
  lastMessageText?: string;
  lastMessageAt?: string;
  peerLastReadAt?: string;
}

export interface DraftEntry {
  text: string;
  replyToMessageId?: string;
}

interface WorkspaceState {
  authStatus: "checking" | "unauthenticated" | "authenticated";
  connectionStatus: "connected" | "reconnecting" | "offline";
  statusError: string | null;
  pendingInviteCode: string;
  currentUser: V1User | null;
  quotaUsedBytes: number;
  quotaLimitBytes: number;

  conversations: Record<string, V1Conversation>;
  conversationOrder: string[];
  pinnedConversationIds: string[];
  userPreferences: Record<string, unknown>;
  messagesByConv: Record<string, V1Message[]>;
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
  loadConversationMessages: (conversationId: string) => Promise<void>;
  markRead: (conversationId: string) => void;
  setDraft: (conversationId: string, text: string, replyToMessageId?: string) => void;
  setEditingMessageId: (messageId: string | null) => void;
  jumpToMessage: (conversationId: string, messageId: string) => void;

  sendWorkspaceMessage: (
    conversationId: string,
    text: string,
    replyToId?: string,
    attachments?: V1MessageAttachment[]
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
const DRAFTS_CACHE_KEY = "duallane:mobile:drafts:v1";

function loadCachedDrafts(): Record<string, DraftEntry> {
  try {
    const raw = window.localStorage.getItem(DRAFTS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, DraftEntry>) : {};
  } catch {
    return {};
  }
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
  const candidates = candidateIds
    .filter((uid) => Boolean(uid && uid !== currentUserId && members[uid]?.displayName))
    .map((uid) => ({ id: uid, displayName: members[uid].displayName.trim() }))
    .filter((item) => item.displayName.length > 0)
    .sort((a, b) => b.displayName.length - a.displayName.length);

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

function mapRawBlocks(rawContent: unknown): V1MessageBlock[] | undefined {
  if (!rawContent || typeof rawContent !== "object") return undefined;
  const blocksRaw = (rawContent as Record<string, unknown>).blocks;
  if (!Array.isArray(blocksRaw) || blocksRaw.length === 0) return undefined;
  const out: V1MessageBlock[] = [];
  for (const b of blocksRaw as Array<Record<string, unknown>>) {
    const t = String(b.type || "");
    if (t === "text" && typeof b.text === "string") {
      out.push({ type: "text", text: b.text });
    } else if (t === "mention" && b.userId) {
      out.push({
        type: "mention",
        userId: String(b.userId),
        label: String(b.label || b.userId),
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

function mapRawReactions(raw: unknown): Record<string, { count: number; reactedByMe: boolean }> {
  const out: Record<string, { count: number; reactedByMe: boolean }> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw as Array<Record<string, unknown>>) {
    const key = String(item.emoteKey || item.emoji || item.key || "");
    if (!key) continue;
    const count = Number(item.count || 0);
    if (count > 0) {
      out[key] = {
        count,
        reactedByMe: Boolean(item.reactedByCurrentUser ?? item.reactedByMe),
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
  const candidateName =
    m.remark || m.nickname || m.displayName || m.name || m.githubLogin || m.handle;
  const resolvedName = candidateName
    ? String(candidateName)
    : prev?.displayName && !prev.displayName.startsWith("usr_")
    ? prev.displayName
    : id;
  const hasExplicitAvatar = "avatarUrl" in m;
  const nextAvatarUrl = hasExplicitAvatar
    ? typeof m.avatarUrl === "string" && m.avatarUrl.trim()
      ? m.avatarUrl.trim()
      : undefined
    : prev?.avatarUrl;
  const nextDescription =
    typeof m.description === "string" ? m.description.trim() || undefined : prev?.description;
  target[id] = {
    id,
    displayName: resolvedName,
    handle: m.githubLogin
      ? String(m.githubLogin)
      : m.handle
      ? String(m.handle)
      : prev?.handle,
    role,
    avatarUrl: nextAvatarUrl,
    description: nextDescription,
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

  return {
    id,
    clientMessageId: m.clientMessageId ? String(m.clientMessageId) : undefined,
    conversationId,
    kind,
    senderId,
    senderName:
      members[senderId]?.displayName ||
      String(
        m.authorRemark ||
          m.authorNickname ||
          m.authorName ||
          m.authorDisplayName ||
          authorObj.displayName ||
          m.senderName ||
          (kind === "system" ? "系统通知" : "成员")
      ),
    senderAvatarUrl: members[senderId]?.avatarUrl || rawAvatar,
    plainText: String(m.plainText || m.text || ""),
    blocks: recalledAt ? [] : mapRawBlocks(m.content),
    replyToId: recalledAt
      ? undefined
      : m.replyToMessageId
      ? String(m.replyToMessageId)
      : m.replyToId
      ? String(m.replyToId)
      : undefined,
    threadRootId: m.threadRootId ? String(m.threadRootId) : undefined,
    threadReplyCount: Number(m.threadReplyCount || m.replyCount || 0),
    editedAt: m.editedAt ? String(m.editedAt) : undefined,
    recalledAt,
    createdAt,
    status: resolvedStatus,
    reactions: recalledAt ? {} : mapRawReactions(m.reactions),
    attachments: recalledAt ? undefined : mapRawAttachments(m.attachments, id),
    card: recalledAt ? undefined : (m.card as DualLaneCardKitDocument | undefined),
  };
}

export function parseBootstrapPayload(raw: Record<string, unknown>) {
  const authObj = (raw.auth || {}) as Record<string, unknown>;
  const workspaceEnabled = authObj.enabled !== false;
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
      mentionCount: Number(c.mentionCount || 0),
      pinnedMessageIds: Array.isArray(c.pinnedMessageIds) ? c.pinnedMessageIds.map(String) : [],
      memberIds: cleanedMemberIds,
      lastMessageText: c.lastMessagePlainText
        ? String(c.lastMessagePlainText)
        : c.lastMessageText
        ? String(c.lastMessageText)
        : lastMsg.plainText
        ? String(lastMsg.plainText)
        : undefined,
      lastMessageAt: c.lastMessageAt
        ? String(c.lastMessageAt)
        : lastMsg.createdAt
        ? String(lastMsg.createdAt)
        : undefined,
      peerLastReadAt,
    };
    const rawMsgs = Array.isArray(c.latestMessages)
      ? c.latestMessages
      : Array.isArray(c.messages)
      ? c.messages
      : [];
    messagesByConv[id] = rawMsgs.map((msg) =>
      mapRawMessage(id, msg as Record<string, unknown>, members, {
        currentUserId: currentUser?.id,
        convKind: kind,
        peerLastReadAt,
      })
    );
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
let activeP2PTransport: P2PRoomTransport | null = null;

function teardownWorkspaceRealtime() {
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

function teardownP2P() {
  if (activeP2PTransport) {
    const t = activeP2PTransport;
    activeP2PTransport = null;
    t.close();
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const connectRealtime = (initialCursor: number) => {
    teardownWorkspaceRealtime();
    let cursor = Math.max(0, Math.trunc(initialCursor || 0));

    const open = () => {
      if (get().authStatus !== "authenticated") return;
      const handle = nativeBridge.connectSocket("/ws/workspace", true, {
        onOpen: () => {
          if (workspaceWsHandle !== handle) return;
          handle.send(JSON.stringify({ type: "hello", version: 1, lastSeq: cursor }));
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
            if (typeof frame.currentSeq === "number" && frame.currentSeq > cursor) {
              cursor = frame.currentSeq;
            }
            set({ connectionStatus: "connected" });
            return;
          }
          if (frame.type === "sync.required") {
            if (typeof frame.currentSeq === "number") cursor = frame.currentSeq;
            void get().bootstrapWorkspace();
            return;
          }
          if (frame.type === "event" && frame.event && typeof frame.event === "object") {
            const evObj = frame.event as Record<string, unknown>;
            const seq = Number(evObj.seq || 0);
            if (seq > cursor) cursor = seq;
            get().applyRealtimeEvent(evObj);
          }
        },
        onClose: () => {
          if (workspaceWsHandle !== handle) return;
          workspaceWsHandle = null;
          if (get().authStatus === "authenticated") {
            set({ connectionStatus: "reconnecting" });
            workspaceReconnectTimer = setTimeout(open, 2000);
          }
        },
      });
      workspaceWsHandle = handle;
    };

    open();
  };

  return {
    authStatus: "checking",
    connectionStatus: "connected",
    statusError: null,
    pendingInviteCode: "",
    currentUser: null,
    quotaUsedBytes: 0,
    quotaLimitBytes: 512 * 1024 * 1024,

    conversations: {},
    conversationOrder: [],
    pinnedConversationIds: [],
    userPreferences: {},
    messagesByConv: {},
    members: {},
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
      const snap = nativeBridge.getSessionSnapshot();
      // Hydrate instant shell cache if native Keystore says authenticated
      if (snap.authenticated && get().authStatus !== "authenticated") {
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
        if (Object.keys(userPreferences).length === 0) {
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

        const prevMessages = get().messagesByConv;
        const mergedMessages: Record<string, V1Message[]> = {};
        for (const cid of Object.keys(parsed.conversations)) {
          const inc = parsed.messagesByConv[cid] || [];
          mergedMessages[cid] = inc.length > 0 ? inc : prevMessages[cid] || [];
        }

        set({
          authStatus: "authenticated",
          connectionStatus: "connected",
          statusError: null,
          currentUser: parsed.currentUser,
          quotaUsedBytes: parsed.quotaUsedBytes,
          quotaLimitBytes: parsed.quotaLimitBytes,
          members: parsed.members,
          conversations: parsed.conversations,
          conversationOrder: parsed.conversationOrder,
          pinnedConversationIds,
          userPreferences,
          messagesByConv: mergedMessages,
        });

        try {
          window.localStorage.setItem(
            SHELL_CACHE_KEY,
            JSON.stringify({
              currentUser: parsed.currentUser,
              members: parsed.members,
              conversations: parsed.conversations,
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
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 401) {
          teardownWorkspaceRealtime();
          window.localStorage.removeItem(SHELL_CACHE_KEY);
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
      teardownWorkspaceRealtime();
      teardownP2P();
      window.localStorage.removeItem(SHELL_CACHE_KEY);
      nativeBridge.logout();
      useNavStore.setState({
        entryLane: "welcome",
        activeTab: "chats",
        activeChatId: null,
        searchOpen: false,
      });
      set({
        authStatus: "unauthenticated",
        currentUser: null,
        conversations: {},
        conversationOrder: [],
        messagesByConv: {},
        members: {},
        p2pRoom: null,
        p2pMessages: [],
      });
    },

    loadConversationMessages: async (conversationId) => {
      try {
        const res = await mobileApi.listMessages(conversationId, 90);
        const rawList = Array.isArray(res.messages) ? res.messages : [];
        const s = get();
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
            [conversationId]: mapped,
          },
        }));
      } catch {
        // keep optimistic or bootstrap messages
      }
    },

    markRead: (conversationId) => {
      const conv = get().conversations[conversationId];
      if (!conv) return;
      if (conv.unreadCount > 0 || conv.mentionCount > 0) {
        set((s) => ({
          conversations: {
            ...s.conversations,
            [conversationId]: { ...conv, unreadCount: 0, mentionCount: 0 },
          },
        }));
      }
      void mobileApi.markConversationRead(conversationId).catch(() => {});
    },

    setDraft: (conversationId, text, replyToMessageId) => {
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
      void get().loadConversationMessages(conversationId);
      setTimeout(() => {
        if (get().highlightedMessageId === messageId) {
          set({ highlightedMessageId: null });
        }
      }, 2500);
    },

    sendWorkspaceMessage: async (conversationId, text, replyToId, attachments) => {
      const user = get().currentUser;
      const trimmed = text.trim();
      const attList = attachments && attachments.length > 0 ? attachments : undefined;
      if (!user || (!trimmed && !attList)) return;

      const convSnap = get().conversations[conversationId];
      const parsedBlocks = trimmed
        ? buildTextAndMentionBlocks(trimmed, convSnap, get().members, user.id)
        : [];
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
      }));
      get().setDraft(conversationId, "", "");

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
                    lastMessageAt: optimistic.createdAt,
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
      } catch {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
              m.id === tempId ? { ...m, status: "failed" } : m
            ),
          },
        }));
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
      } catch {
        set((s) => ({
          messagesByConv: {
            ...s.messagesByConv,
            [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
              m.id === tempId ? { ...m, status: "failed" } : m
            ),
          },
        }));
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
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] || []).map((m) =>
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
      }));
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
      set((s) => ({
        messagesByConv: {
          ...s.messagesByConv,
          [conversationId]: (s.messagesByConv[conversationId] || []).map((m) => {
            if (m.id !== messageId) return m;
            const cur = m.reactions[key];
            const nextReactions = { ...m.reactions };
            if (cur?.reactedByMe) {
              if (cur.count <= 1) delete nextReactions[key];
              else nextReactions[key] = { count: cur.count - 1, reactedByMe: false };
            } else {
              nextReactions[key] = { count: (cur?.count || 0) + 1, reactedByMe: true };
            }
            return { ...m, reactions: nextReactions };
          }),
        },
      }));
      await mobileApi.reactToMessage(messageId, key).catch(() => {});
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
        return {
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
      const updatedCard = res.card as DualLaneCardKitDocument | undefined;
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

      if (evType === "conversation.read") {
        const convId = String(payload.conversationId || eventObj.conversationId || "");
        const readerId = String(payload.userId || eventObj.actorId || "");
        const readAt = String(payload.readAt || payload.lastReadAt || eventObj.createdAt || "");
        const readMs = Date.parse(readAt);
        if (!convId || !readerId || !Number.isFinite(readMs)) return;

        set((s) => {
          if (s.currentUser?.id && readerId === s.currentUser.id) {
            const prev = s.conversations[convId];
            if (!prev) return s;
            return {
              conversations: {
                ...s.conversations,
                [convId]: { ...prev, unreadCount: 0, mentionCount: 0 },
              },
            };
          }
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
        const convId = String(
          rawMsg.conversationId || payload.conversationId || eventObj.conversationId || ""
        );
        if (!convId || !rawMsg.id) return;
        const activeChatId = useNavStore.getState().activeChatId;
        const sSnap = get();
        const snapConv = sSnap.conversations[convId];
        const mapped = mapRawMessage(convId, rawMsg, sSnap.members, {
          currentUserId: sSnap.currentUser?.id,
          convKind: snapConv?.kind,
          peerLastReadAt: snapConv?.peerLastReadAt,
        });
        const isOwn = Boolean(sSnap.currentUser?.id && mapped.senderId === sSnap.currentUser.id);
        const isSys = mapped.kind === "system";

        if (evType === "message.created" && !isOwn && !isSys && convId === activeChatId) {
          void mobileApi.markConversationRead(convId).catch(() => {});
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
                          recalledAt: recalledTs,
                          blocks: [],
                          reactions: {},
                          attachments: undefined,
                          card: undefined,
                        }
                      : {
                          ...item,
                          ...mapped,
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
            Boolean(
              mapped.blocks?.some(
                (b) => b.type === "mention" && b.userId === s.currentUser?.id
              )
            );

          const nextUnread =
            convId === activeChatId
              ? 0
              : evType === "message.created" && matchIdx < 0 && !isOwn && !isSys
              ? (prevConv?.unreadCount || 0) + 1
              : prevConv?.unreadCount || 0;

          const nextMention =
            convId === activeChatId
              ? 0
              : mentionedMe && matchIdx < 0
              ? (prevConv?.mentionCount || 0) + 1
              : prevConv?.mentionCount || 0;

          const summaryText =
            evType === "message.recalled"
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
                    lastMessageText: summaryText,
                    lastMessageAt:
                      evType === "message.created"
                        ? mapped.createdAt
                        : prevConv.lastMessageAt || mapped.createdAt,
                    unreadCount: nextUnread,
                    mentionCount: nextMention,
                    peerLastReadAt: nextPeerLastReadAt,
                  }
                : {
                    id: convId,
                    kind: "group",
                    title: mapped.senderName || "新对话",
                    unreadCount: nextUnread,
                    mentionCount: nextMention,
                    pinnedMessageIds: [],
                    memberIds: [],
                    lastMessageText: summaryText,
                    lastMessageAt: mapped.createdAt,
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
        const updatedCard = (payload.card || payload) as DualLaneCardKitDocument | undefined;
        if (!updatedCard?.cardId) return;
        set((s) => {
          const nextByConv: Record<string, V1Message[]> = {};
          for (const [cid, list] of Object.entries(s.messagesByConv)) {
            nextByConv[cid] = list.map((m) =>
              m.card?.cardId === updatedCard.cardId ? { ...m, card: updatedCard } : m
            );
          }
          return { messagesByConv: nextByConv };
        });
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
          useNavStore.getState().setActiveTab("direct");
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
  };
});
