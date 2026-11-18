import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCardView } from "@/components/WorkspaceCardView";
import { ApiClientError, mobileApi } from "@/shared/api";
import { projectWorkspaceCard, readWorkspaceCardReferences } from "@/shared/workspace-cards";
import { useWorkspaceStore } from "@/store/workspace-store";

vi.mock("@/shared/api", async () => {
  const actual = await vi.importActual<typeof import("@/shared/api")>("@/shared/api");
  return { ...actual, mobileApi: { ...actual.mobileApi, resolveCard: vi.fn(), invokeCardAction: vi.fn() } };
});

const reference = { cardId: "card_synthetic", cardType: "feishu.adaptive.v1", schemaVersion: 1, fallbackText: "卡片备用文字" };
const projection = (revision = 1, status = "active") => ({ type: "card", id: reference.cardId,
  block: { type: "card", ...reference }, revision, status, actions: ["confirm", "cancel", "submit", "refresh"],
  payload: { format: "duallane.feishu-card.v1", config: { version: "1.0", wideScreen: false },
    header: { title: "接入确认", tone: "shared" }, elements: [
      { type: "text", format: "markdown", text: `**真实卡片正文** v${revision}` },
      { type: "divider" }, { type: "actions", buttons: [
        { type: "button", actionId: "confirm", label: "确认", style: "primary", data: { action: "business", action_id: "business-id" } },
        { type: "button", actionId: "cancel", label: "取消", style: "default", data: null },
      ] },
    ] },
});

beforeEach(() => {
  vi.resetAllMocks();
  useWorkspaceStore.setState({ authStatus: "authenticated", currentUser: { id: "viewer", displayName: "测试成员", role: "member" },
    cardRevisions: {}, messagesByConv: {}, conversations: {} });
  vi.mocked(mobileApi.resolveCard).mockResolvedValue({ card: projection() });
  vi.mocked(mobileApi.invokeCardAction).mockResolvedValue({ action: { ok: true, replayed: false, revision: 1, result: {} } });
});
afterEach(cleanup);

describe("authorized Workspace card references", () => {
  it("preserves canonical message references and rejects unknown executable projections", () => {
    expect(readWorkspaceCardReferences({ blocks: [{ type: "card", ...reference }, { type: "text", text: "hello" }] })).toEqual([reference]);
    expect(readWorkspaceCardReferences({ blocks: [{ type: "card", ...reference, cardId: "" }] })).toEqual([]);
    const unknown = projection();
    unknown.payload.elements.push({ type: "iframe", text: "https://attacker.example" } as never);
    expect(projectWorkspaceCard(reference, unknown)).toBeNull();
    expect(projectWorkspaceCard({ ...reference, schemaVersion: 2 }, projection())).toBeNull();
    expect(projectWorkspaceCard(reference, { ...projection(), id: "other-card" })).toBeNull();
  });

  it("renders server-normalized body and both buttons, while keeping business data out of action input", async () => {
    render(<WorkspaceCardView reference={reference} />);
    expect(await screen.findByText("真实卡片正文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(mobileApi.invokeCardAction).toHaveBeenCalledOnce());
    expect(vi.mocked(mobileApi.invokeCardAction).mock.calls[0]).toEqual([
      reference.cardId, "confirm", {}, 1, expect.stringMatching(/^act_/),
    ]);
    expect(await screen.findByText("操作已提交，等待助手更新")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "取消" })).toBeDisabled();
  });

  it("invalidates on revision-only realtime events and reads a full authorized projection", async () => {
    render(<WorkspaceCardView reference={reference} />);
    await screen.findByRole("button", { name: "确认" });
    vi.mocked(mobileApi.resolveCard).mockResolvedValue({ card: projection(2, "invalidated") });
    act(() => useWorkspaceStore.getState().applyRealtimeEvent({ type: "card.updated", payload: { cardId: reference.cardId, revision: 2, status: "invalidated" } }));
    await waitFor(() => expect(screen.getByText("卡片已失效")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
    expect(mobileApi.invokeCardAction).not.toHaveBeenCalled();
  });

  it("discards prior payload after authorization is revoked instead of retaining active buttons", async () => {
    render(<WorkspaceCardView reference={reference} />);
    await screen.findByRole("button", { name: "确认" });
    vi.mocked(mobileApi.resolveCard).mockRejectedValue(new ApiClientError("card.not_found", "不可读取", 404));
    act(() => useWorkspaceStore.getState().applyRealtimeEvent({ type: "card.updated", payload: { cardId: reference.cardId, revision: 2 } }));
    await screen.findByText("无法显示此卡片，内容或权限可能已变化");
    expect(screen.queryByRole("button", { name: "确认" })).not.toBeInTheDocument();
    expect(screen.queryByText("真实卡片正文")).not.toBeInTheDocument();
  });

  it("never blindly repeats an uncertain action and reuses its key only on explicit retry", async () => {
    vi.mocked(mobileApi.invokeCardAction).mockRejectedValueOnce(new ApiClientError("network.unreachable", "网络中断", 0));
    render(<WorkspaceCardView reference={reference} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    await screen.findByText(/操作结果尚未确认/);
    const original = vi.mocked(mobileApi.invokeCardAction).mock.calls[0];
    expect(mobileApi.invokeCardAction).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试同一操作" }));
    await screen.findByText("操作已提交，等待助手更新");
    expect(vi.mocked(mobileApi.invokeCardAction).mock.calls[1]).toEqual(original);
  });

  it("locks concurrent clicks and refuses unknown fixed actions", async () => {
    let complete!: (value: Record<string, unknown>) => void;
    vi.mocked(mobileApi.invokeCardAction).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<WorkspaceCardView reference={reference} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(mobileApi.invokeCardAction).toHaveBeenCalledOnce();
    await act(async () => complete({ action: { ok: true, revision: 1 } }));
    const bad = projection();
    bad.payload.elements[2].buttons![0].actionId = "open_url";
    expect(projectWorkspaceCard(reference, bad)).toBeNull();
  });

  it("ignores a late card response after the viewer signs out", async () => {
    let complete!: (value: { card: unknown }) => void;
    vi.mocked(mobileApi.resolveCard).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<WorkspaceCardView reference={reference} />);
    act(() => useWorkspaceStore.setState({ authStatus: "unauthenticated", currentUser: null }));
    await act(async () => complete({ card: projection() }));
    expect(screen.queryByRole("button", { name: "确认" })).not.toBeInTheDocument();
    expect(mobileApi.invokeCardAction).not.toHaveBeenCalled();
  });

  it("keeps a committed POST receipt when a realtime invalidation arrives first", async () => {
    let complete!: (value: Record<string, unknown>) => void;
    vi.mocked(mobileApi.invokeCardAction).mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<WorkspaceCardView reference={reference} />);
    fireEvent.click(await screen.findByRole("button", { name: "确认" }));
    vi.mocked(mobileApi.resolveCard).mockResolvedValue({ card: projection(2) });
    act(() => useWorkspaceStore.getState().applyRealtimeEvent({ type: "card.updated", payload: { cardId: reference.cardId, revision: 2 } }));
    await act(async () => complete({ action: { ok: true, revision: 2 } }));
    expect(await screen.findByText("操作已提交，等待助手更新")).toBeInTheDocument();
    expect(mobileApi.invokeCardAction).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "重试同一操作" })).not.toBeInTheDocument();
  });
});
