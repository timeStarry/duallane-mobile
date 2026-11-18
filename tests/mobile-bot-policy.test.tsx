import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  botPolicyApi, buildBotPairingPrompt, parseBotAccessPolicy,
  privateAssistantGroupPolicy, validateBotAccessPolicy, withBotAccessPolicy,
} from "@/shared/bot-policy";
import { BotAccessPolicyEditor, StickerAndBotSheets } from "@/screens/StickerAndBotSheets";
import { BotGroupRequests } from "@/components/BotGroupRequests";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type MobileBotConversationItem } from "@/shared/api";
import { isMobileWritePending } from "@/shared/activity";
import { useNavStore } from "@/store/nav-store";
import { useWorkspaceStore } from "@/store/workspace-store";

const json = (value: unknown, status = 200) => ({
  status, ok: status >= 200 && status < 300, bodyText: JSON.stringify(value),
});
const groupPolicy = (status = "pending") => ({
  conversationId: "group-1", status, allowTrigger: true, allowContext: false,
  maxContextMessages: null, contextMaxMessages: null,
});
const initialBootstrap = useWorkspaceStore.getState().bootstrapWorkspace;
function prepareBotPanel(conversations: MobileBotConversationItem[] = []) {
  vi.spyOn(mobileApi, "listBots").mockResolvedValue([{ id: "bot-1", name: "测试助手", status: "active", botUserId: "bot-user-1" }]);
  vi.spyOn(mobileApi, "listBotTokens").mockResolvedValue({ tokens: [] });
  vi.spyOn(mobileApi, "getBotConnection").mockResolvedValue({ connection: null });
  vi.spyOn(mobileApi, "getBotSettings").mockResolvedValue({ settings: { accessPolicy: privateAssistantGroupPolicy(), allowGroup: true } });
  vi.spyOn(mobileApi, "getBotOverview").mockResolvedValue({ botId: "bot-1", botUserId: "bot-user-1", latestSdkVersion: "1.2.1", conversations });
  useWorkspaceStore.setState({ members: {}, conversations: {} });
  useNavStore.setState({ botManageOpen: true, stickerStudioOpen: false, sharedPackId: null, botSetupSessionId: null });
}
beforeEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  useWorkspaceStore.setState({ bootstrapWorkspace: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => {
  cleanup();
  useWorkspaceStore.setState({ bootstrapWorkspace: initialBootstrap });
  vi.restoreAllMocks();
});

describe("mobile Bot V2 access policy", () => {
  it("keeps legacy absent and rejects unknown policy rather than guessing a new audience", () => {
    expect(parseBotAccessPolicy(null)).toBeNull();
    expect(parseBotAccessPolicy(undefined)).toBeNull();
    expect(() => parseBotAccessPolicy({ version: 9 })).toThrow();
    const unsupported = privateAssistantGroupPolicy();
    expect(() => parseBotAccessPolicy({ ...unsupported, direct: { audience: "everyone" } })).toThrow();
    expect(withBotAccessPolicy({ allowGroup: false }, null)).toEqual({ allowGroup: false });
  });

  it("does not write on view or preview; explicitly enables owner DM/current group members with fixed Bot IDs", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<BotAccessPolicyEditor policy={null} members={[{ id: "human-1", displayName: "群友" }]}
      botSources={[{ id: "configured-bot-B", name: "机器人乙" }]} onSave={save} />);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: "发起私聊" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "设置“仅自己私聊，指定群共享”" }));
    expect(screen.getByRole("combobox", { name: "目录发现" })).toHaveValue("owner_only");
    expect(screen.getByRole("combobox", { name: "发起私聊" })).toHaveValue("owner_only");
    expect(screen.getByRole("combobox", { name: "已批准群内的使用者" })).toHaveValue("current_members");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "允许指定机器人触发" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "机器人乙可触发此机器人" }));
    fireEvent.click(screen.getByRole("button", { name: "启用并保存独立权限" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0]).toEqual({
      ...privateAssistantGroupPolicy(),
      groups: { audience: "current_members", memberIds: [], allowBotTriggers: true, allowedBotIds: ["configured-bot-B"] },
    });
  });

  it("keeps all three member audiences independent and refuses an empty specified-member grant", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<BotAccessPolicyEditor policy={privateAssistantGroupPolicy()}
      members={[{ id: "human-1", displayName: "Alex" }]} botSources={[]} onSave={save} />);
    fireEvent.change(screen.getByRole("combobox", { name: "目录发现" }), { target: { value: "space_members" } });
    fireEvent.change(screen.getByRole("combobox", { name: "发起私聊" }), { target: { value: "specified_members" } });
    fireEvent.click(screen.getByRole("button", { name: "保存独立权限" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("至少勾选一名成员");
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "发起私聊成员：Alex" }));
    fireEvent.click(screen.getByRole("button", { name: "保存独立权限" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const saved = save.mock.calls[0]?.[0];
    expect(saved.discovery).toEqual({ audience: "space_members", memberIds: [] });
    expect(saved.direct).toEqual({ audience: "specified_members", memberIds: ["human-1"] });
    expect(saved.groups).toEqual(privateAssistantGroupPolicy().groups);
  });

  it("keeps an unavailable stored source, but clearing Bot triggers explicitly removes every source", async () => {
    const policy = privateAssistantGroupPolicy();
    policy.groups.allowBotTriggers = true; policy.groups.allowedBotIds = ["previous-config-id"];
    const save = vi.fn().mockResolvedValue(undefined);
    render(<BotAccessPolicyEditor policy={policy} members={[]} botSources={[]} onSave={save} />);
    expect(screen.getByText(/另有已保存的来源/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "允许指定机器人触发" }));
    fireEvent.click(screen.getByRole("button", { name: "保存独立权限" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]?.[0].groups).toMatchObject({ allowBotTriggers: false, allowedBotIds: [] });
    expect(() => validateBotAccessPolicy({ ...policy, groups: { ...policy.groups, allowBotTriggers: false } })).toThrow();
  });

  it("shows a server permission denial without reporting saved", async () => {
    render(<BotAccessPolicyEditor policy={privateAssistantGroupPolicy()} members={[]} botSources={[]}
      onSave={async () => { throw new Error("权限已撤销"); }} />);
    fireEvent.click(screen.getByRole("button", { name: "保存独立权限" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("权限已撤销");
    expect(screen.queryByText("独立权限已保存")).not.toBeInTheDocument();
  });

  it("includes the authoritative V2 policy when the real settings panel changes adjacent group admission", async () => {
    const policy = privateAssistantGroupPolicy();
    vi.spyOn(mobileApi, "listBots").mockResolvedValue([{ id: "bot-1", name: "测试助手", status: "active", botUserId: "bot-user-1" }]);
    vi.spyOn(mobileApi, "listBotTokens").mockResolvedValue({ tokens: [] });
    vi.spyOn(mobileApi, "getBotConnection").mockResolvedValue({ connection: null });
    vi.spyOn(mobileApi, "getBotSettings").mockResolvedValue({ settings: { accessPolicy: policy, allowGroup: true, groupInviterPolicy: "owner" } });
    vi.spyOn(mobileApi, "getBotOverview").mockResolvedValue({ botId: "bot-1", botUserId: "bot-user-1", latestSdkVersion: "1.2.1", conversations: [] });
    const update = vi.spyOn(mobileApi, "updateBotSettings").mockResolvedValue({});
    useWorkspaceStore.setState({ members: {}, conversations: {} });
    useNavStore.setState({ botManageOpen: true, stickerStudioOpen: false, sharedPackId: null, botSetupSessionId: null });
    render(<StickerAndBotSheets />);
    fireEvent.click(await screen.findByRole("button", { name: /测试助手.*运行中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /权限与群聊准入/ }));
    await screen.findByRole("combobox", { name: "发起私聊" });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "禁止加入群聊" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("bot-1", {
      allowGroup: false, groupInviterPolicy: "owner", requireOwnerApproval: true, accessPolicy: policy,
    }));
    expect(screen.queryByRole("button", { name: "全空间成员可用" })).not.toBeInTheDocument();
    useNavStore.setState({ botManageOpen: false });
  });
});

describe("mobile Bot setup and group approvals", () => {
  it("opens an existing revoked Bot DM without writing a trigger or history grant", async () => {
    prepareBotPanel([{ id: "dm-revoked", type: "direct", title: "已关闭唤醒",
      allowSend: true, allowTrigger: false, allowContext: false, maxMessages: 7, updatedAt: "2026-11-18T00:00:00Z" }]);
    vi.spyOn(mobileApi, "createDirectConversation").mockResolvedValue({ conversation: { id: "dm-revoked" } });
    const grant = vi.spyOn(mobileApi, "updateBotContextGrant").mockResolvedValue({});
    const settings = vi.spyOn(mobileApi, "updateBotSettings").mockResolvedValue({});
    render(<StickerAndBotSheets />);
    fireEvent.click(await screen.findByRole("button", { name: /测试助手.*运行中/ }));
    fireEvent.click(await screen.findByRole("button", { name: "发起私聊" }));
    await waitFor(() => expect(useNavStore.getState().activeChatId).toBe("dm-revoked"));
    expect(grant).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
  });

  it("approves only the shown pairing scopes and does not silently enable history on the resulting DM", async () => {
    prepareBotPanel();
    const session = { id: "setup-test", bot: { id: "bot-1", name: "测试助手", botUserId: "bot-user-1" },
      status: "awaiting_user", requestedScopes: ["messages:read_trigger", "messages:send"],
      approvedScopes: [], requestedConversations: [], approvedConversations: [], expiresAt: "2026-11-19T00:00:00Z", createdAt: "2026-11-18T00:00:00Z" };
    vi.spyOn(mobileApi, "getBotSetupSession").mockResolvedValue({ session });
    const approve = vi.spyOn(mobileApi, "approveBotSetupSession").mockResolvedValue({ session: { ...session, status: "approved" } });
    vi.spyOn(mobileApi, "createDirectConversation").mockResolvedValue({ conversation: { id: "dm-revoked" } });
    const grant = vi.spyOn(mobileApi, "updateBotContextGrant").mockResolvedValue({});
    useNavStore.setState({ botManageOpen: false, botSetupSessionId: session.id });
    render(<StickerAndBotSheets />);
    fireEvent.click(await screen.findByRole("button", { name: "确认授权" }));
    await waitFor(() => expect(approve).toHaveBeenCalledWith(session.id, session.requestedScopes));
    await waitFor(() => expect(mobileApi.createDirectConversation).toHaveBeenCalled());
    expect(grant).not.toHaveBeenCalled();
  });

  it("changes direct history without restoring a revoked trigger or overwriting its existing history limit", async () => {
    prepareBotPanel([{ id: "dm-revoked", type: "direct", title: "已关闭唤醒",
      allowSend: true, allowTrigger: false, allowContext: false, maxMessages: 7, updatedAt: "2026-11-18T00:00:00Z" }]);
    vi.spyOn(botPolicyApi, "listGroups").mockResolvedValue([]);
    const grant = vi.spyOn(mobileApi, "updateBotContextGrant").mockResolvedValue({});
    render(<StickerAndBotSheets />);
    fireEvent.click(await screen.findByRole("button", { name: /测试助手.*运行中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /已接入会话与上下文/ }));
    fireEvent.click(await screen.findByRole("button", { name: "开启上下文（最多7条）" }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith("bot-1", "dm-revoked", { allowContext: true }));
    expect(grant.mock.calls[0]?.[2]).not.toHaveProperty("allowTrigger");
  });

  it("cannot approve unshown fallback scopes when the pairing request contains no explicit scopes", async () => {
    prepareBotPanel();
    const session = { id: "setup-empty", bot: { id: "bot-1", name: "测试助手", botUserId: "bot-user-1" },
      status: "awaiting_user", requestedScopes: [], approvedScopes: [], requestedConversations: [],
      approvedConversations: [], expiresAt: "2026-11-19T00:00:00Z", createdAt: "2026-11-18T00:00:00Z" };
    vi.spyOn(mobileApi, "getBotSetupSession").mockResolvedValue({ session });
    const approve = vi.spyOn(mobileApi, "approveBotSetupSession").mockResolvedValue({ session });
    useNavStore.setState({ botManageOpen: false, botSetupSessionId: session.id });
    render(<StickerAndBotSheets />);
    fireEvent.click(await screen.findByRole("button", { name: "确认授权" }));
    await waitFor(() => expect(useNavStore.getState().toast?.message).toContain("未收到明确的权限申请"));
    expect(approve).not.toHaveBeenCalled();
  });

  it("never uses a generic group history toggle to reactivate a trigger, while explicit revocation stays available", async () => {
    prepareBotPanel([{ id: "group-1", type: "group", title: "群聊", allowSend: true,
      allowTrigger: false, allowContext: false, maxMessages: 7, groupPolicyStatus: "active", updatedAt: "2026-11-18T00:00:00Z" }]);
    vi.spyOn(botPolicyApi, "listGroups").mockResolvedValue([{ conversationId: "group-1", status: "active", allowTrigger: false, allowContext: false, maxMessages: 7 }]);
    const patch = vi.spyOn(botPolicyApi, "updateGroup").mockResolvedValue({ conversationId: "group-1", status: "removed", allowTrigger: false, allowContext: false, maxMessages: 7 });
    const grant = vi.spyOn(mobileApi, "updateBotContextGrant").mockResolvedValue({});
    render(<StickerAndBotSheets />);
    fireEvent.click(await screen.findByRole("button", { name: /测试助手.*运行中/ }));
    fireEvent.click(await screen.findByRole("button", { name: /已接入会话与上下文/ }));
    const history = await screen.findByRole("button", { name: "历史范围请在上方重新申请" });
    expect(history).toBeDisabled();
    fireEvent.click(history);
    expect(patch).not.toHaveBeenCalled();
    expect(grant).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "撤销群内授权" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith("bot-1", "group-1", { status: "removed" }));
  });

  it.each(["resolve", "reject"])("keeps a policy mutation pending for OTA until it %s", async (outcome) => {
    let resolve!: (value: Awaited<ReturnType<typeof nativeBridge.request>>) => void;
    let reject!: (reason: Error) => void;
    vi.spyOn(nativeBridge, "request").mockImplementation(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
    const pending = botPolicyApi.updateGroup("bot-1", "group-1", { status: "removed" });
    expect(isMobileWritePending()).toBe(true);
    if (outcome === "resolve") {
      resolve(json({ policy: groupPolicy("removed") }));
      await expect(pending).resolves.toMatchObject({ status: "removed" });
    } else {
      reject(new Error("network failure"));
      await expect(pending).rejects.toThrow("network failure");
    }
    expect(isMobileWritePending()).toBe(false);
  });

  it("copies version/hash/Skill and explicit bridge guidance without obsolete auto-agent setup", () => {
    const text = buildBotPairingPrompt("测试助手", "https://chat.example", "setup-only-once");
    expect(text).toContain("https://chat.example/integrations/duallane-agent.manifest.json");
    expect(text).toContain("/integrations/duallane-agent/SKILL.md");
    expect(text).toContain("SHA-256");
    expect(text).toContain("--cmd <经确认的可信桥接命令>");
    expect(text).toContain("复用已有私有 profile");
    expect(text).not.toContain("--agent auto");
    expect(text).not.toContain("curl -fsSL");
    expect(() => buildBotPairingPrompt("助手", "https://user:secret@chat.example", "setup")).toThrow();
  });

  it("sends an owner request, trusts the pending result, and does not claim approval", async () => {
    const calls = vi.spyOn(nativeBridge, "request").mockImplementation(async (method) =>
      method === "GET" ? json({ policies: [] }) : json({ policy: groupPolicy("pending") }));
    render(<BotGroupRequests botId="bot-owned" conversations={[{ id: "group-1", title: "测试群" }]} />);
    await screen.findByText("尚未请求加入群聊");
    fireEvent.change(screen.getByRole("combobox", { name: "目标群聊" }), { target: { value: "group-1" } });
    fireEvent.click(screen.getByRole("button", { name: "发起入群请求" }));
    expect(await screen.findByText("等待群管理员批准")).toBeInTheDocument();
    const patch = calls.mock.calls.find(([method]) => method === "PATCH");
    expect(patch?.[1]).toBe("/api/workspace/bots/bot-owned/group-policies/group-1");
    expect(JSON.parse(patch?.[2]?.body || "{}")).toEqual({ status: "active", allowTrigger: true, allowContext: false });
    expect(screen.queryByText("已批准入群")).not.toBeInTheDocument();
  });

  it("only presents manager actions when the server grants management and does not expand owner context", async () => {
    const calls = vi.spyOn(nativeBridge, "request").mockImplementation(async (method) =>
      method === "GET" ? json({ canManage: true, hasMore: false, requests: [
        { botId: "bot-1", name: "请求助手", status: "pending", allowContext: false, maxMessages: null },
      ] }) : json({ policy: groupPolicy("active") }));
    render(<BotGroupRequests conversationId="group-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "批准" }));
    await waitFor(() => expect(calls.mock.calls.some(([method]) => method === "PATCH")).toBe(true));
    const patch = calls.mock.calls.find(([method]) => method === "PATCH");
    expect(JSON.parse(patch?.[2]?.body || "{}")).toEqual({ status: "active" });
    expect(await screen.findByText("已批准入群")).toBeInTheDocument();
  });

  it("hides actions for non-managers and never sends a mutation", async () => {
    const request = vi.spyOn(nativeBridge, "request").mockResolvedValue(json({ canManage: false, hasMore: false, requests: [] }));
    render(<BotGroupRequests conversationId="group-1" />);
    await waitFor(() => expect(screen.queryByText("正在加载入群授权…")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not show an old group's deferred requests after switching groups", async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof nativeBridge.request>>) => void;
    vi.spyOn(nativeBridge, "request").mockImplementation((_method, path) => path.includes("old-group")
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Promise.resolve(json({ canManage: true, hasMore: false, requests: [] })));
    const view = render(<BotGroupRequests conversationId="old-group" />);
    view.rerender(<BotGroupRequests conversationId="new-group" />);
    await screen.findByText("暂无待处理请求");
    await act(async () => { resolveOld(json({ canManage: true, requests: [
      { botId: "old", name: "不应出现的旧请求", status: "pending", allowContext: true, maxMessages: 50 },
    ], hasMore: false })); });
    expect(screen.queryByText("不应出现的旧请求")).not.toBeInTheDocument();
  });

  it("reports lost management authorization without claiming a successful decision", async () => {
    vi.spyOn(nativeBridge, "request").mockImplementation(async (method) => method === "GET"
      ? json({ canManage: true, hasMore: false, requests: [
        { botId: "bot-1", name: "请求助手", status: "pending", allowContext: false },
      ] }) : json({ error: { code: "bot.forbidden", message: "管理权限已失效" } }, 403));
    render(<BotGroupRequests conversationId="group-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "拒绝" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("管理权限已失效");
    expect(screen.queryByText("已拒绝")).not.toBeInTheDocument();
  });

  it("validates group policy response shapes and URL-encodes scoped identifiers", async () => {
    const request = vi.spyOn(nativeBridge, "request").mockResolvedValue(json({ policy: groupPolicy("unexpected") }));
    await expect(botPolicyApi.updateGroup("bot/a", "group?x", { status: "active" })).rejects.toThrow("响应无效");
    expect(request.mock.calls[0]?.[1]).toBe("/api/workspace/bots/bot%2Fa/group-policies/group%3Fx");
  });
});
