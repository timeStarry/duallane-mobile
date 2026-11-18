import { nativeBridge } from "@/native/bridge";
import { ApiClientError } from "@/shared/api";
import { beginMobileWrite } from "@/shared/activity";

export type BotPolicyAudience = "owner_only" | "specified_members" | "space_members";
export type BotGroupAudience = "owner_only" | "specified_members" | "current_members";
export interface BotAccessPolicy {
  version: 2;
  discovery: { audience: BotPolicyAudience; memberIds: string[] };
  direct: { audience: BotPolicyAudience; memberIds: string[] };
  groups: {
    audience: BotGroupAudience;
    memberIds: string[];
    allowBotTriggers: boolean;
    allowedBotIds: string[];
  };
}
export interface BotGroupPolicy {
  conversationId: string;
  status: "pending" | "active" | "rejected" | "removed";
  allowTrigger: boolean;
  allowContext: boolean;
  maxMessages: number | null;
}
export interface BotGroupRequest {
  botId: string;
  name: string;
  status: "pending";
  allowContext: boolean;
  maxMessages: number | null;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("机器人设置响应无效，请刷新重试");
  }
  return value as Record<string, unknown>;
}
function ids(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("机器人权限成员列表无效");
  }
  return [...new Set(value.map((id: string) => id.trim()))];
}

/** Null is the legacy contract. Reading it must never activate a V2 policy. */
export function parseBotAccessPolicy(value: unknown): BotAccessPolicy | null {
  if (value === undefined || value === null) return null;
  const raw = record(value);
  const discovery = record(raw.discovery), direct = record(raw.direct), groups = record(raw.groups);
  const audiences: unknown[] = ["owner_only", "specified_members", "space_members"];
  if (raw.version !== 2 || !audiences.includes(discovery.audience) ||
      !audiences.includes(direct.audience) ||
      !["owner_only", "specified_members", "current_members"].includes(String(groups.audience)) ||
      typeof groups.allowBotTriggers !== "boolean") {
    throw new Error("机器人权限版本或范围不受支持，请更新客户端");
  }
  return {
    version: 2,
    discovery: { audience: discovery.audience as BotPolicyAudience, memberIds: ids(discovery.memberIds) },
    direct: { audience: direct.audience as BotPolicyAudience, memberIds: ids(direct.memberIds) },
    groups: {
      audience: groups.audience as BotGroupAudience, memberIds: ids(groups.memberIds),
      allowBotTriggers: groups.allowBotTriggers, allowedBotIds: ids(groups.allowedBotIds),
    },
  };
}
export function privateAssistantGroupPolicy(): BotAccessPolicy {
  return {
    version: 2,
    discovery: { audience: "owner_only", memberIds: [] },
    direct: { audience: "owner_only", memberIds: [] },
    groups: { audience: "current_members", memberIds: [], allowBotTriggers: false, allowedBotIds: [] },
  };
}
export function validateBotAccessPolicy(policy: BotAccessPolicy): void {
  for (const axis of [policy.discovery, policy.direct, policy.groups]) {
    if (axis.audience === "specified_members" && axis.memberIds.length === 0) {
      throw new Error("选择指定成员时，请至少勾选一名成员");
    }
    if (axis.audience !== "specified_members" && axis.memberIds.length > 0) {
      throw new Error("当前范围不能附带指定成员");
    }
  }
  if (!policy.groups.allowBotTriggers && policy.groups.allowedBotIds.length > 0) {
    throw new Error("关闭机器人触发时不能保留来源机器人");
  }
}
/** Permission-adjacent settings must carry the authoritative, saved V2 policy. */
export function withBotAccessPolicy(
  patch: Record<string, unknown>, policy: BotAccessPolicy | null
): Record<string, unknown> {
  return policy ? { ...patch, accessPolicy: policy } : patch;
}

export function buildBotPairingPrompt(botName: string, origin: string, sessionId: string): string {
  const base = new URL(origin || "https://duallane.tsio.top");
  if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(base.hostname))) {
    throw new Error("接入服务地址无效");
  }
  const root = base.origin;
  return [
    "请接入我的 DualLane 机器人「" + botName + "」：",
    "1. 安装并加载接入 Skill：" + root + "/integrations/duallane-agent/SKILL.md",
    "   同时阅读当前契约：" + root + "/integrations/v2/duallane-channel.md",
    "2. 官方运行包清单：" + root + "/integrations/duallane-agent.manifest.json",
    "   从同一实例获取官方运行包 " + root + "/integrations/duallane-agent.mjs，核验清单版本、SHA-256 和字节数；旧 SDK 必须升级，不能伪造版本头。",
    "3. 优先复用已有私有 profile、凭据、独立 bridge 和策略；更新不能覆盖本地改动、重新配对或启动第二个消费者。",
    "   仅首次接入使用一次性配对地址：" + root + "/workspace?setup=" + encodeURIComponent(sessionId),
    "   发起请求后等待我在 DualLane 确认授权；Token 和私有凭据只留在控制层，不得进入日志或模型提示词。",
    "4. 根据宿主实际能力配置并验证可信命令桥接；不得自动选择 Agent 或把占位命令直接执行。",
    "   在官方 CLI 支持的环境中，先核对 daemon install --help，再使用 daemon install --profile <本次已配对的profile> --cmd <经确认的可信桥接命令>。",
    "5. 用获准的新测试请求核验任务工具、消息、文件和回执。聊天 SDK 不负责模型推理、联网搜图或生成图片，这些由 Agent 自身工具完成；所有写操作保留宿主审批。",
  ].join("\n");
}

async function request(path: string, method = "GET", body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const releaseWrite = method === "GET" ? () => undefined : beginMobileWrite();
  try {
  const response = await nativeBridge.request(method, path, body ? {
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : undefined);
  let raw: Record<string, unknown>;
  try { raw = record(JSON.parse(response.bodyText || "{}")); }
  catch { throw new ApiClientError("response.invalid_json", "机器人服务响应无效", response.status); }
  if (!response.ok) {
    const error = raw.error && typeof raw.error === "object" ? record(raw.error) : {};
    throw new ApiClientError(
      typeof error.code === "string" ? error.code : "request.failed",
      typeof error.message === "string" ? error.message : "机器人操作失败，请刷新重试",
      response.status
    );
  }
  return raw;
  } finally {
    releaseWrite();
  }
}
function groupPolicy(value: unknown): BotGroupPolicy {
  const raw = record(value);
  if (typeof raw.conversationId !== "string" ||
      !["pending", "active", "rejected", "removed"].includes(String(raw.status))) {
    throw new Error("入群授权响应无效，请刷新重试");
  }
  const max = raw.contextMaxMessages ?? raw.maxContextMessages;
  return {
    conversationId: raw.conversationId, status: raw.status as BotGroupPolicy["status"],
    allowTrigger: raw.allowTrigger === true, allowContext: raw.allowContext === true,
    maxMessages: typeof max === "number" ? max : null,
  };
}
export const botPolicyApi = {
  async listGroups(botId: string): Promise<BotGroupPolicy[]> {
    const raw = await request("/api/workspace/bots/" + encodeURIComponent(botId) + "/group-policies");
    if (!Array.isArray(raw.policies)) throw new Error("入群授权列表响应无效");
    return raw.policies.map(groupPolicy);
  },
  async updateGroup(botId: string, conversationId: string, patch: {
    status: "active" | "rejected" | "removed"; allowTrigger?: boolean; allowContext?: boolean; maxMessages?: number;
  }): Promise<BotGroupPolicy> {
    const raw = await request("/api/workspace/bots/" + encodeURIComponent(botId) +
      "/group-policies/" + encodeURIComponent(conversationId), "PATCH", patch);
    return groupPolicy(raw.policy);
  },
  async listRequests(conversationId: string): Promise<{
    canManage: boolean; requests: BotGroupRequest[]; hasMore: boolean;
  }> {
    const raw = await request("/api/v1/conversations/" + encodeURIComponent(conversationId) + "/bot-requests");
    if (typeof raw.canManage !== "boolean" || !Array.isArray(raw.requests)) {
      throw new Error("入群请求列表响应无效");
    }
    return {
      canManage: raw.canManage, hasMore: raw.hasMore === true,
      requests: raw.requests.filter((value) => record(value).status === "pending").map((value) => {
        const item = record(value);
        if (typeof item.botId !== "string" || typeof item.name !== "string") {
          throw new Error("入群请求响应无效");
        }
        return {
          botId: item.botId, name: item.name, status: "pending",
          allowContext: item.allowContext === true,
          maxMessages: typeof item.maxMessages === "number" ? item.maxMessages : null,
        };
      }),
    };
  },
};
