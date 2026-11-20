import { nativeBridge } from "@/native/bridge";
import { beginMobileWrite } from "./activity";
import type {
  DualLaneCardKitDocument,
  SyncDeltaResponse,
  UserDeviceSummary,
} from "./card-kit";

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function requestJSON<T>(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<T> {
  const release = ["GET", "HEAD", "OPTIONS"].includes((init?.method || "GET").toUpperCase()) ? () => {} : beginMobileWrite();
  try { return await requestJSONImpl<T>(path, init); } finally { release(); }
}

async function requestJSONImpl<T>(
  path: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
): Promise<T> {
  const method = init?.method || "GET";
  const headers: Record<string, string> = { ...(init?.headers || {}) };
  if (init?.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  let response: { status: number; ok: boolean; bodyText: string };
  try {
    response = await nativeBridge.request(method, path, {
      headers,
      body: init?.body,
    });
  } catch {
    throw new ApiClientError("network.unreachable", "无法连接服务，请检查网络或服务地址", 0);
  }

  const text = response.bodyText || "";
  let parsed: Record<string, unknown> = {};
  let jsonValid = true;
  if (text.trim()) {
    try {
      const candidate = JSON.parse(text) as unknown;
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>;
      } else {
        jsonValid = false;
      }
    } catch {
      jsonValid = false;
    }
  }

  if (!response.ok) {
    const errObj = parsed.error as ApiErrorPayload | undefined;
    throw new ApiClientError(
      errObj?.code || (response.status >= 500 ? "server.unavailable" : "request.failed"),
      errObj?.message ||
        (response.status >= 500
          ? `后端服务暂时不可用 (HTTP ${response.status})`
          : `请求失败 (${response.status})`),
      response.status
    );
  }

  if (text.trim() && !jsonValid) {
    throw new ApiClientError("response.invalid_json", "服务返回了非 JSON 响应", 502);
  }

  return parsed as T;
}

export interface SearchMessageHit {
  id: string;
  conversationId: string;
  threadRootId?: string;
  authorId: string;
  authorName: string;
  plainText: string;
  createdAt: string;
}

export interface SearchFileHit {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  conversationId?: string;
  sourceMessageId?: string;
  width?: number;
  height?: number;
  thumbHash?: string;
  createdAt: string;
}

export interface SearchResponse {
  messages: SearchMessageHit[];
  files: SearchFileHit[];
}

export interface ThreadReplyItem {
  id: string;
  conversationId: string;
  threadRootId: string;
  alsoSendToChannel: boolean;
  authorId: string;
  authorName: string;
  plainText: string;
  editedAt?: string;
  createdAt: string;
  card?: DualLaneCardKitDocument;
}

export interface ThreadViewResponse {
  rootMessageId: string;
  threadTitle?: string;
  replyCount: number;
  replies: ThreadReplyItem[];
}

export interface BotCommandSpec {
  command: string;
  description: string;
  scope?: "all" | "direct" | "group";
  botId?: string;
  botName?: string;
}

export interface BotTokenRecord {
  id: string;
  botId?: string;
  scopes: string[];
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt: string;
}

export interface BotConnectionInfo {
  id?: string;
  botId: string;
  status: "connected" | "disconnected" | "paused" | "revoked" | string;
  adapterVersion?: string | null;
  connectedAt?: string | null;
  disconnectedAt?: string | null;
  lastHeartbeatAt?: string | null;
  lastProcessedAt?: string | null;
  lastErrorCode?: string | null;
  lastErrorAt?: string | null;
}

export const DEFAULT_BOT_PAIRING_SCOPES = [
  "messages:read_trigger",
  "messages:read_context",
  "messages:send",
  "cards:write",
  "cards:act",
  "commands:receive",
  "files:read_metadata",
  "files:write",
] as const;

export interface BotSetupSession {
  id: string;
  bot?: {
    id: string;
    botUserId?: string;
    name: string;
    status?: string;
  } | null;
  status: string;
  requestedScopes: string[];
  approvedScopes: string[];
  requestedConversations: string[];
  approvedConversations: string[];
  clientName?: string | null;
  clientVersion?: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CustomEmoteDTO {
  id: string;
  kind: "image" | string;
  label: string;
  token: string;
  src?: string;
  emoteKey?: string;
  animated: boolean;
  byteSize?: number;
  width?: number;
  height?: number;
  sourceType?: string;
  originalFileName?: string;
  createdAt: string;
}

export interface EmoteCollectionSubscriptionDTO {
  eligible: boolean;
  enabled: boolean;
  status: "off" | "synced" | "paused" | "detached" | string;
  sourceCollectionId?: string | null;
  sourceRevision?: number | null;
  lastSyncedAt?: string | null;
  readOnly: boolean;
}

export interface EmoteCollectionDTO {
  id: string;
  name: string;
  sourceCollectionId?: string | null;
  originalCreatorUserId: string;
  originalCreator: { id: string; displayName: string };
  revision: number;
  createdAt: string;
  updatedAt: string;
  sourceSubscription: EmoteCollectionSubscriptionDTO;
  items: CustomEmoteDTO[];
  itemCount: number;
}

export interface EmoteLibraryDTO {
  /** Ordered library entries include the individual favorites and packs. */
  entries: Array<{
    id: string;
    type: "emote" | "collection" | string;
    emote?: CustomEmoteDTO;
    collection?: EmoteCollectionDTO;
  }>;
  /** Effective emote index, including items available only through packs. */
  emotes: CustomEmoteDTO[];
  collections: EmoteCollectionDTO[];
  usage: {
    itemCount: number;
    totalBytes: number;
    subscribedItemCount?: number;
    subscribedTotalBytes?: number;
    totalItemCount?: number;
    allTotalBytes?: number;
    collectionCount?: number;
    subscribedCollectionCount?: number;
    overLimit?: boolean;
  };
  limits: {
    maxItems?: number | null;
    maxTotalBytes: number;
    maxInputBytes: number;
    maxCollections?: number | null;
    maxCollectionItems: number;
    maxBatchItems: number;
  };
}

export interface EmoteSettingsDTO {
  availablePacks: Array<{ id: string; label: string; defaultEnabled: boolean }>;
  enabledPackIds: string[];
  clickImageEmoteToSend: boolean;
  replyAutoMention: boolean;
  minimumEnabled?: number;
}

export interface EmoteCollectionShareCoverDTO {
  id: string;
  label: string;
  src: string;
  animated?: boolean;
}

export interface EmoteCollectionShareSummaryDTO {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  revokedAt?: string | null;
  sharedBy: { id: string; displayName: string };
  originalCreator: { id: string; displayName: string };
  canRevoke: boolean;
  covers?: EmoteCollectionShareCoverDTO[];
  sharePath: string;
}

export interface EmoteCollectionShareDetailDTO extends EmoteCollectionShareSummaryDTO {
  sourceCollectionId: string;
  canSubscribeToSourceChanges: boolean;
  items: CustomEmoteDTO[];
}

export interface MobileBotSummary {
  id: string;
  botUserId?: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  avatarColor?: string;
  status: string;
  connectionStatus?: string;
  createdAt?: string;
}

export interface MobileBotConversationItem {
  id: string;
  type: "direct" | "group" | string;
  title: string;
  isOwnerDirect?: boolean;
  allowSend: boolean;
  allowTrigger: boolean;
  allowContext: boolean;
  maxMessages: number;
  triggerMode?: string;
  groupPolicyStatus?: string;
  blockReason?: string;
  updatedAt: string;
}

export interface MobileBotOverviewResponse {
  botId: string;
  botUserId: string;
  latestSdkVersion: string;
  conversations: MobileBotConversationItem[];
}

export interface SystemAnnouncementDTO {
  id: string;
  enabled: boolean;
  displayMode: "once" | "always";
  badge?: string;
  title: string;
  content: string;
  ctaLabel?: string;
  ctaUrl?: string;
  updatedAt?: string;
  updatedBy?: string;
  shouldShow?: boolean;
}

export interface EmailChallengeSummaryDTO {
  challengeId: string;
  maskedEmail: string;
  expiresAt: string;
  cooldownSec: number;
}

export interface BoundEmailStatusDTO {
  bound: boolean;
  email?: string;
  verifiedAt?: string;
}

export interface MyNotificationSettingsDTO {
  offlineEmailEnabled: boolean;
  fieldKey: string;
}

export const mobileApi = {
  getHealth: () =>
    requestJSON<{ ok?: boolean; workspace?: { enabled?: boolean } }>("/api/health"),

  getBootstrap: async () => {
    try {
      return await requestJSON<Record<string, unknown>>("/api/v1/bootstrap");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        return requestJSON<Record<string, unknown>>("/api/workspace/bootstrap");
      }
      throw err;
    }
  },

  sync: (sinceSeq: number) =>
    requestJSON<SyncDeltaResponse>(`/api/v1/sync?sinceSeq=${sinceSeq}`),

  search: async (q: string, scope: "all" | "messages" | "files" = "all"): Promise<SearchResponse> => {
    const params = new URLSearchParams({ q, scope });
    const raw = await requestJSON<Partial<SearchResponse>>(`/api/v1/search?${params.toString()}`);
    return {
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      files: Array.isArray(raw.files) ? raw.files : [],
    };
  },

  ensureSavedConversation: () =>
    requestJSON<{ conversationId: string }>("/api/v1/conversations/saved", { method: "POST" }),

  listMessages: (
    conversationId: string,
    limitOrOpts:
      | number
      | { limit?: number; before?: string; after?: string; around?: string } = 80
  ) => {
    const opts = typeof limitOrOpts === "number" ? { limit: limitOrOpts } : limitOrOpts;
    const params = new URLSearchParams();
    params.set("limit", String(opts.limit ?? 80));
    if (opts.before) params.set("before", opts.before);
    if (opts.after) params.set("after", opts.after);
    if (opts.around) params.set("around", opts.around);
    return requestJSON<{ messages?: Array<Record<string, unknown>> }>(
      `/api/workspace/conversations/${encodeURIComponent(conversationId)}/messages?${params.toString()}`
    );
  },

  sendMessage: (
    conversationId: string,
    text: string,
    options?: {
      replyToMessageId?: string;
      clientMessageId?: string;
      attachmentIds?: string[];
      blocks?: Array<Record<string, unknown>>;
    }
  ) => {
    const trimmedText = text.trim();
    const attachmentIds = (options?.attachmentIds || []).filter(Boolean);
    const blocks: Array<Record<string, unknown>> = options?.blocks ? [...options.blocks] : [];
    if (!options?.blocks) {
      if (trimmedText) {
        blocks.push({ type: "text", text: trimmedText });
      }
      for (const attachmentId of attachmentIds) {
        blocks.push({ type: "attachment", attachmentId });
      }
    }
    return requestJSON<Record<string, unknown>>("/api/workspace/messages", {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        clientMessageId: options?.clientMessageId || `cli_${crypto.randomUUID()}`,
        replyToMessageId: options?.replyToMessageId || "",
        content: {
          format: "duallane.message+json;v=1",
          plainText: trimmedText || (attachmentIds.length > 0 ? "[文件]" : "[表情]"),
          blocks,
        },
      }),
    });
  },

  editMessage: (messageId: string, plainText: string) =>
    requestJSON<{ ok: boolean }>(`/api/v1/messages/${encodeURIComponent(messageId)}`, {
      method: "PATCH",
      body: JSON.stringify({ plainText }),
    }),

  recallMessage: (messageId: string, reason?: string) =>
    requestJSON<{ message?: Record<string, unknown> }>(
      `/api/workspace/messages/${encodeURIComponent(messageId)}/recall`,
      {
        method: "POST",
        body: JSON.stringify(reason ? { reason } : {}),
      }
    ),

  reactToMessage: (messageId: string, emoteKey: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/messages/${encodeURIComponent(messageId)}/reactions`,
      { method: "POST", body: JSON.stringify({ emoteKey }) }
    ),

  pinMessage: (conversationId: string, messageId: string) =>
    requestJSON<{ pinned: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/pins/${encodeURIComponent(messageId)}`,
      { method: "POST" }
    ),

  unpinMessage: (conversationId: string, messageId: string) =>
    requestJSON<{ pinned: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/pins/${encodeURIComponent(messageId)}`,
      { method: "DELETE" }
    ),

  forwardMessages: (messageIds: string[], targetConversationId: string) =>
    requestJSON<{ createdIds: string[] }>("/api/v1/messages/forward", {
      method: "POST",
      body: JSON.stringify({ messageIds, targetConversationId }),
    }),

  getThread: (messageId: string) =>
    requestJSON<ThreadViewResponse>(`/api/v1/messages/${encodeURIComponent(messageId)}/thread`),

  listConversationThreads: (conversationId: string) =>
    requestJSON<{
      threads: Array<{
        rootMessageId: string;
        conversationId: string;
        threadTitle?: string;
        rootAuthorId: string;
        rootAuthorName: string;
        rootPlainText: string;
        rootCreatedAt: string;
        replyCount: number;
        lastRepliedAt: string;
        lastAuthorName: string;
        lastPlainText: string;
      }>;
    }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/threads`),

  replyThread: (
    messageId: string,
    plainText: string,
    alsoSendToChannel: boolean,
    threadTitle?: string
  ) =>
    requestJSON<ThreadReplyItem>(`/api/v1/messages/${encodeURIComponent(messageId)}/thread`, {
      method: "POST",
      body: JSON.stringify({ plainText, alsoSendToChannel, threadTitle }),
    }),

  resolveCard: (cardId: string) =>
    requestJSON<{ card: unknown }>(`/api/workspace/cards/${encodeURIComponent(cardId)}`),

  invokeCardAction: (
    cardId: string,
    actionId: string,
    input?: Record<string, unknown>,
    expectedRevision = 1,
    clientActionId = `act_${crypto.randomUUID()}`
  ) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/cards/${encodeURIComponent(cardId)}/actions`,
      {
        method: "POST",
        body: JSON.stringify({
          actionId,
          clientActionId,
          expectedRevision,
          input: input || {},
        }),
      }
    ),

  createDirectConversation: (targetUserId: string) =>
    requestJSON<Record<string, unknown>>("/api/workspace/conversations", {
      method: "POST",
      body: JSON.stringify({ type: "direct", targetUserId }),
    }),

  createGroupConversation: (title: string, memberIds: string[], avatar?: string) =>
    requestJSON<Record<string, unknown>>("/api/v1/conversations/groups", {
      method: "POST",
      body: JSON.stringify({
        title,
        memberIds,
        ...(avatar ? { avatar } : {}),
      }),
    }),

  updateGroupConversation: (
    conversationId: string,
    patch: { title?: string; avatar?: string | null }
  ) =>
    requestJSON<{ conversation?: Record<string, unknown> }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      }
    ),

  addGroupMembers: (conversationId: string, userIds: string[]) =>
    requestJSON<{ conversation?: Record<string, unknown> }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/members`,
      {
        method: "POST",
        body: JSON.stringify({ userIds }),
      }
    ),

  removeGroupMember: (conversationId: string, userId: string) =>
    requestJSON<{ ok: boolean; conversationId: string; userId: string }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    ),

  leaveGroupConversation: (conversationId: string) =>
    requestJSON<{ ok: boolean; conversationId: string }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/leave`,
      { method: "POST" }
    ),

  markConversationRead: (conversationId: string, messageId?: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/read`,
      { method: "POST", ...(messageId ? { body: JSON.stringify({ messageId }) } : {}) }
    ),

  updateConversationNotification: (
    conversationId: string,
    level: "all" | "mentions" | "muted"
  ) =>
    requestJSON<{ ok?: boolean; level?: string; notificationLevel?: string }>(
      `/api/workspace/conversations/${encodeURIComponent(conversationId)}/notification`,
      {
        method: "PATCH",
        body: JSON.stringify({ level }),
      }
    ),

  setMemberRemark: (userId: string, remark: string) => {
    const clean = remark.trim();
    const path = `/api/workspace/members/${encodeURIComponent(userId)}/remark`;
    if (!clean) {
      return requestJSON<{ ok?: boolean; member?: Record<string, unknown> }>(path, {
        method: "DELETE",
      });
    }
    return requestJSON<{ ok?: boolean; remark?: string; member?: Record<string, unknown> }>(path, {
      method: "PUT",
      body: JSON.stringify({ remark: clean }),
    });
  },

  getMyNotificationSettings: async (): Promise<MyNotificationSettingsDTO> => {
    const raw = await requestJSON<Record<string, unknown>>("/api/workspace/me/notifications");
    const container =
      raw.notifications && typeof raw.notifications === "object" && !Array.isArray(raw.notifications)
        ? (raw.notifications as Record<string, unknown>)
        : raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
        ? (raw.settings as Record<string, unknown>)
        : raw;
    const candidateKeys = [
      "offlineEmailEnabled",
      "emailEnabled",
      "offlineEmail",
      "emailOfflineEnabled",
      "offlineEmailNotifications",
      "enabled",
    ];
    for (const k of candidateKeys) {
      if (typeof container[k] === "boolean") {
        return { offlineEmailEnabled: container[k] as boolean, fieldKey: k };
      }
    }
    return { offlineEmailEnabled: false, fieldKey: "offlineEmailEnabled" };
  },

  updateMyNotificationSettings: async (
    offlineEmailEnabled: boolean,
    fieldKey = "offlineEmailEnabled"
  ): Promise<MyNotificationSettingsDTO> => {
    const key = fieldKey || "offlineEmailEnabled";
    const raw = await requestJSON<Record<string, unknown>>("/api/workspace/me/notifications", {
      method: "PATCH",
      body: JSON.stringify({ [key]: offlineEmailEnabled }),
    });
    const container =
      raw.notifications && typeof raw.notifications === "object" && !Array.isArray(raw.notifications)
        ? (raw.notifications as Record<string, unknown>)
        : raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings)
        ? (raw.settings as Record<string, unknown>)
        : raw;
    const resolved =
      typeof container[key] === "boolean" ? (container[key] as boolean) : offlineEmailEnabled;
    return { offlineEmailEnabled: resolved, fieldKey: key };
  },

  sendConversationTyping: (conversationId: string, state: "typing" | "thinking" = "typing") =>
    requestJSON<{ ok: boolean }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/typing`,
      {
        method: "POST",
        body: JSON.stringify({ state }),
      }
    ),

  listConversationBotCommands: (conversationId: string) =>
    requestJSON<{ commands: BotCommandSpec[] }>(
      `/api/v1/conversations/${encodeURIComponent(conversationId)}/bot-commands`
    ),

  getPreferences: () =>
    requestJSON<{ preferences?: Record<string, unknown> }>("/api/v1/preferences"),

  savePreferences: (preferences: Record<string, unknown>) =>
    requestJSON<{ saved: boolean }>("/api/v1/preferences", {
      method: "PUT",
      body: JSON.stringify({ preferences }),
    }),

  // Personal Profile & Devices
  updateMyProfile: (patch: { nickname?: string; searchDiscoverable?: boolean }) =>
    requestJSON<{ user: Record<string, unknown> }>("/api/workspace/me/profile", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  uploadMyAvatar: (pickedFileId: string) =>
    nativeBridge.uploadBinaryAvatar("/api/workspace/me/avatar", pickedFileId) as Promise<{
      user?: Record<string, unknown>;
    }>,

  deleteMyAvatar: () =>
    requestJSON<{ user?: Record<string, unknown> }>("/api/workspace/me/avatar", {
      method: "DELETE",
    }),

  listDevices: () => requestJSON<{ devices: UserDeviceSummary[] }>("/api/v1/devices"),

  revokeDevice: (deviceId: string) =>
    requestJSON<{ revoked: boolean }>(`/api/v1/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
    }),

  approveQRLogin: (sessionId: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/v1/auth/qr/${encodeURIComponent(sessionId)}/approve`,
      { method: "POST" }
    ),

  // System Announcement & Bound Login Email
  ackAnnouncement: (id: string) =>
    requestJSON<{ ok: boolean }>("/api/v1/announcement/ack", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),

  sendBindEmailCode: (email: string) =>
    requestJSON<EmailChallengeSummaryDTO>("/api/v1/account/email/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  verifyBindEmail: (challengeId: string, code: string) =>
    requestJSON<BoundEmailStatusDTO>("/api/v1/account/email/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, code }),
    }),

  unbindAccountEmail: () =>
    requestJSON<{ ok: boolean }>("/api/v1/account/email", {
      method: "DELETE",
    }),

  sendLoginEmailCode: (email: string) =>
    requestJSON<EmailChallengeSummaryDTO>("/api/v1/auth/email/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  verifyLoginEmail: (email: string, challengeId: string, code: string) =>
    nativeBridge.loginWithEmailCode(email, challengeId, code),

  // Personal Bot Management (No Space Governance Console)
  listBots: async (): Promise<MobileBotSummary[]> => {
    const raw = await requestJSON<{ bots?: Array<Record<string, unknown>> }>("/api/workspace/bots");
    const list = Array.isArray(raw.bots) ? raw.bots : [];
    return list.map((b) => ({
      id: String(b.id || ""),
      botUserId: b.botUserId ? String(b.botUserId) : undefined,
      name: String(b.name || "未命名机器人"),
      description: b.description ? String(b.description) : undefined,
      avatarUrl: b.avatarUrl ? String(b.avatarUrl) : undefined,
      status: String(b.status || "active"),
      connectionStatus:
        b.connection && typeof b.connection === "object"
          ? String((b.connection as Record<string, unknown>).status || "")
          : b.connectionStatus
          ? String(b.connectionStatus)
          : undefined,
      createdAt: b.createdAt ? String(b.createdAt) : undefined,
    }));
  },

  createBot: (name: string) =>
    requestJSON<Record<string, unknown>>("/api/v1/bots", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  updateBotProfile: (
    botId: string,
    patch: { name?: string; description?: string; color?: string }
  ) =>
    requestJSON<{
      ok?: boolean;
      name?: string;
      description?: string;
      avatarUrl?: string;
      avatarColor?: string;
    }>(`/api/v1/bots/${encodeURIComponent(botId)}/profile`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  uploadBotAvatar: (botId: string, pickedFileId: string) =>
    nativeBridge.uploadBinaryAvatar(
      `/api/v1/bots/${encodeURIComponent(botId)}/avatar`,
      pickedFileId
    ) as Promise<{ avatarUrl?: string }>,

  deleteBotAvatar: (botId: string) =>
    requestJSON<{ ok: boolean }>(`/api/v1/bots/${encodeURIComponent(botId)}/avatar`, {
      method: "DELETE",
    }),

  pauseBot: (botId: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/pause`,
      { method: "POST" }
    ),

  resumeBot: (botId: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/resume`,
      { method: "POST" }
    ),

  listBotTokens: (botId: string) =>
    requestJSON<{ tokens: BotTokenRecord[] }>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/tokens`
    ),

  revokeBotToken: (botId: string, tokenId: string) =>
    requestJSON<{ token?: BotTokenRecord }>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/tokens/${encodeURIComponent(tokenId)}/revoke`,
      { method: "POST" }
    ),

  getBotConnection: (botId: string) =>
    requestJSON<{ connection: BotConnectionInfo | null }>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/connection`
    ),

  getBotSettings: (botId: string) =>
    requestJSON<{ settings: Record<string, unknown> }>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/settings`
    ),

  getBotOverview: (botId: string) =>
    requestJSON<MobileBotOverviewResponse>(
      `/api/v1/bots/${encodeURIComponent(botId)}/overview`
    ),

  requestBotRuntimeUpgrade: (botId: string) =>
    requestJSON<{ requested: boolean; targetVersion: string }>(
      `/api/v1/bots/${encodeURIComponent(botId)}/request-upgrade`,
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    ),

  updateBotSettings: (botId: string, settings: Record<string, unknown>) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/settings`,
      {
        method: "PATCH",
        body: JSON.stringify(settings),
      }
    ),

  updateBotContextGrant: (
    botId: string,
    conversationId: string,
    patch: { allowTrigger?: boolean; allowContext?: boolean; maxMessages?: number }
  ) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/context-grants/${encodeURIComponent(conversationId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      }
    ),

  updateBotGroupPolicy: (
    botId: string,
    conversationId: string,
    patch: {
      status?: string;
      allowTrigger?: boolean;
      allowContext?: boolean;
      maxMessages?: number;
    }
  ) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/group-policies/${encodeURIComponent(conversationId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(patch),
      }
    ),

  beginDeleteBot: (botId: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}`,
      { method: "DELETE" }
    ),

  confirmDeleteBot: (botId: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/delete/confirm`,
      { method: "POST" }
    ),

  createBotSetupSession: (
    botId: string,
    requestedScopes: string[] = [...DEFAULT_BOT_PAIRING_SCOPES]
  ) =>
    requestJSON<{ session: BotSetupSession; setupUrl: string }>(
      `/api/workspace/bots/${encodeURIComponent(botId)}/setup-sessions`,
      {
        method: "POST",
        body: JSON.stringify({ requestedScopes }),
      }
    ),

  getBotSetupSession: (sessionId: string) =>
    requestJSON<{ session: BotSetupSession }>(
      `/api/workspace/bot-setup/${encodeURIComponent(sessionId)}`
    ),

  approveBotSetupSession: (sessionId: string, scopes: string[]) =>
    requestJSON<{ session: BotSetupSession }>(
      `/api/workspace/bot-setup/${encodeURIComponent(sessionId)}/approve`,
      {
        method: "POST",
        body: JSON.stringify({ scopes }),
      }
    ),

  denyBotSetupSession: (sessionId: string) =>
    requestJSON<{ session: BotSetupSession }>(
      `/api/workspace/bot-setup/${encodeURIComponent(sessionId)}/deny`,
      { method: "POST" }
    ),

  // Emotes, Stickers & Collections
  getEmoteSettings: () =>
    requestJSON<{ settings: EmoteSettingsDTO }>("/api/workspace/me/emote-settings"),

  updateEmoteSettings: (patch: {
    enabledPackIds?: string[];
    clickImageEmoteToSend?: boolean;
    replyAutoMention?: boolean;
  }) =>
    requestJSON<{ settings: EmoteSettingsDTO }>("/api/workspace/me/emote-settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  getEmoteLibrary: () => requestJSON<EmoteLibraryDTO>("/api/workspace/me/emote-library"),

  uploadCustomEmote: (pickedFileId: string, collectionId = "", addToLibrary = true) =>
    nativeBridge.uploadCustomEmote(pickedFileId, collectionId, addToLibrary) as unknown as Promise<{
      emote: CustomEmoteDTO;
    }>,

  favoriteMessageEmote: (input: {
    messageId: string;
    customEmoteId?: string;
    attachmentId?: string;
    emoteKey?: string;
  }) =>
    requestJSON<{ emote: CustomEmoteDTO }>("/api/workspace/me/emotes/favorite", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  renameCustomEmote: (emoteId: string, label: string) =>
    requestJSON<{ emote: CustomEmoteDTO }>(
      `/api/workspace/me/emotes/${encodeURIComponent(emoteId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ label }),
      }
    ),

  deleteCustomEmote: (emoteId: string) =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/me/emotes/${encodeURIComponent(emoteId)}`,
      { method: "DELETE" }
    ),

  createEmoteCollection: (name: string, emoteIds?: string[]) =>
    requestJSON<{ collection: EmoteCollectionDTO }>("/api/workspace/me/emote-collections", {
      method: "POST",
      body: JSON.stringify({ name, ...(emoteIds?.length ? { emoteIds } : {}) }),
    }),

  renameEmoteCollection: (collectionId: string, name: string) =>
    requestJSON<{ collection: EmoteCollectionDTO }>(
      `/api/workspace/me/emote-collections/${encodeURIComponent(collectionId)}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }
    ),

  deleteEmoteCollection: (collectionId: string, disposition: "keep" | "remove" = "keep") =>
    requestJSON<Record<string, unknown>>(
      `/api/workspace/me/emote-collections/${encodeURIComponent(collectionId)}?itemDisposition=${disposition}`,
      { method: "DELETE" }
    ),

  addEmotesToCollection: (collectionId: string, emoteIds: string[]) =>
    requestJSON<{ collection: EmoteCollectionDTO }>(
      `/api/workspace/me/emote-collections/${encodeURIComponent(collectionId)}/items`,
      {
        method: "POST",
        body: JSON.stringify({ emoteIds }),
      }
    ),

  removeEmoteFromCollection: (collectionId: string, emoteId: string) =>
    requestJSON<{ collection: EmoteCollectionDTO }>(
      `/api/workspace/me/emote-collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(emoteId)}`,
      { method: "DELETE" }
    ),

  updateEmoteCollectionSubscription: (collectionId: string, enabled: boolean) =>
    requestJSON<{ collection?: EmoteCollectionDTO; library?: EmoteLibraryDTO }>(
      `/api/workspace/me/emote-collections/${encodeURIComponent(collectionId)}/source-subscription`,
      {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      }
    ),

  createEmoteCollectionShare: (collectionId: string) =>
    requestJSON<{ share: EmoteCollectionShareDetailDTO }>(
      `/api/workspace/me/emote-collections/${encodeURIComponent(collectionId)}/shares`,
      { method: "POST" }
    ),

  getEmoteCollectionShare: (shareId: string) =>
    requestJSON<{ share: EmoteCollectionShareDetailDTO }>(
      `/api/workspace/emote-collection-shares/${encodeURIComponent(shareId)}`
    ),

  importEmoteCollectionShare: (
    shareId: string,
    payload: {
      emoteIds?: string[];
      asCollection?: boolean;
      collectionName?: string;
      subscribeToSourceChanges?: boolean;
    }
  ) =>
    requestJSON<{
      importedCount?: number;
      collection?: EmoteCollectionDTO;
      library?: EmoteLibraryDTO;
    }>(`/api/workspace/emote-collection-shares/${encodeURIComponent(shareId)}/import`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
