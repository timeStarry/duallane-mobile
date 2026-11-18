import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StickerDrawer } from "@/components/StickerDrawer";
import { nativeBridge } from "@/native/bridge";
import { mobileApi, type CustomEmoteDTO, type EmoteLibraryDTO } from "@/shared/api";
import { useEmoteStore } from "@/store/emote-store";
import { useWorkspaceStore } from "@/store/workspace-store";

const cacheKey = "duallane:mobile:emote-library:v1";
const createdAt = "2026-11-18T00:00:00Z";
const builtin: CustomEmoteDTO = {
  id: "11db8cdd-859e-48ab-8d10-0d0d32b874a1",
  kind: "builtin",
  label: "已收藏的旧 QQ 表情",
  token: "[qq:smile]",
  src: "/emotes/qq/smile.gif",
  emoteKey: "qq:smile",
  animated: false,
  createdAt,
};

function custom(id: string, label: string): CustomEmoteDTO {
  return {
    id,
    kind: "custom",
    sourceType: "upload",
    label,
    token: `[custom:${id}]`,
    src: `/api/workspace/emotes/${id}/content`,
    animated: false,
    createdAt,
  };
}

const packOnly = custom("f532bad7-9644-478d-afcd-3c28877d17dd", "仅在表情包内");
const dual = custom("34595c15-67c0-45fc-b5f5-d603cd8df672", "同时在收藏和表情包内");
const library: EmoteLibraryDTO = {
  entries: [
    { id: "favorite-builtin", type: "emote", emote: builtin },
    { id: "pack-entry", type: "collection" },
    { id: "favorite-dual", type: "emote", emote: dual },
  ],
  emotes: [packOnly, dual, builtin],
  collections: [
    {
      id: "pack",
      name: "测试表情包",
      originalCreatorUserId: "me",
      originalCreator: { id: "me", displayName: "我" },
      revision: 1,
      createdAt,
      updatedAt: createdAt,
      sourceSubscription: { eligible: false, enabled: false, status: "off", readOnly: false },
      items: [packOnly, dual],
      itemCount: 2,
    },
  ],
  usage: { itemCount: 3, totalBytes: 0 },
  limits: { maxTotalBytes: 1024, maxInputBytes: 1024, maxCollectionItems: 10, maxBatchItems: 5 },
};

afterEach(() => {
  cleanup();
  useEmoteStore.setState(useEmoteStore.getInitialState());
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState());
  window.localStorage.removeItem(cacheKey);
  vi.restoreAllMocks();
});

describe("individual sticker favorites", () => {
  it("uses ordered favorites and sends both Go builtin and custom DTOs through their message paths", async () => {
    vi.spyOn(mobileApi, "getEmoteLibrary").mockResolvedValue(library);
    vi.spyOn(nativeBridge, "prefetchMedia").mockImplementation(() => {});
    const sendMessage = vi.spyOn(mobileApi, "sendMessage").mockResolvedValue({});
    useWorkspaceStore.setState({ currentUser: { id: "me", displayName: "我", role: "member" } });
    await useEmoteStore.getState().refreshLibrary(false);

    render(
      <StickerDrawer
        open
        conversationId="chat"
        onInsertToken={vi.fn()}
        onSendBuiltInSticker={(token) => void useWorkspaceStore.getState().sendWorkspaceMessage("chat", token)}
      />
    );
    expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
      builtin.label,
      dual.label,
    ]);
    expect(useEmoteStore.getState().customSrcMap[packOnly.id]).toBe(packOnly.src);
    expect(JSON.parse(window.localStorage.getItem(cacheKey) || "{}").favoriteEmotes).toEqual([builtin, dual]);

    fireEvent.click(screen.getByRole("button", { name: builtin.label }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(sendMessage.mock.calls[0].slice(0, 2)).toEqual(["chat", "[qq:smile]"]);
    expect(sendMessage.mock.calls[0][2]?.blocks).toEqual([{ type: "text", text: "[qq:smile]" }]);

    fireEvent.click(screen.getByRole("button", { name: dual.label }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(sendMessage.mock.calls[1][2]?.blocks).toEqual([{ type: "emoji", shortcode: `custom:${dual.id}` }]);

    fireEvent.click(screen.getByRole("button", { name: "测试表情包" }));
    expect(screen.getByAltText(packOnly.label)).toBeInTheDocument();
    expect(screen.getByAltText(dual.label)).toBeInTheDocument();
  });

  it("keeps the asset index from an older cache without inferring favorites", async () => {
    window.localStorage.setItem(cacheKey, JSON.stringify({ emotes: library.emotes, collections: library.collections }));
    vi.resetModules();
    const { useEmoteStore: rehydrated } = await import("@/store/emote-store");
    expect(rehydrated.getState().favoriteEmotes).toEqual([]);
    expect(rehydrated.getState().customSrcMap[packOnly.id]).toBe(packOnly.src);
    expect(rehydrated.getState().collections[0].items).toEqual([packOnly, dual]);
  });
});
