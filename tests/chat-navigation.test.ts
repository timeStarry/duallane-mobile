import { describe, expect, it } from "vitest";
import {
  buildSelectedMentionBlocks,
  captureUnreadNavigation,
  chatAutocompleteKeyAction,
  insertComposerMention,
  reconcileComposerMentions,
  revealChatAutocompleteOption,
} from "@/shared/chat-navigation";

describe("chat navigation and selected mention identity", () => {
  it("keeps the selected ID for names shared by a member and a Bot, including surrounding edits", () => {
    const selected = insertComposerMention("请 @同", [], "bot_twin", "同名", true);
    expect(selected.text).toBe("请 @同名 ");
    const prefixed = `先${selected.text}`;
    const moved = reconcileComposerMentions(selected.text, prefixed, selected.mentions);
    const edited = `${prefixed}处理`;
    const mentions = reconcileComposerMentions(prefixed, edited, moved);
    expect(buildSelectedMentionBlocks(edited, mentions)).toEqual([
      { type: "text", text: "先请 " },
      { type: "mention", userId: "bot_twin", label: "同名" },
      { type: "text", text: " 处理" },
    ]);
  });

  it("drops identity when the mention itself changes instead of assigning the old ID to new text", () => {
    const selected = insertComposerMention("@", [], "user_1", "星河", true);
    const next = selected.text.replace("星河", "星海");
    const mentions = reconcileComposerMentions(selected.text, next, selected.mentions);
    expect(mentions).toEqual([]);
    expect(buildSelectedMentionBlocks(next, mentions)).toBeUndefined();
    const joinedName = selected.text.trimEnd() + "外";
    expect(buildSelectedMentionBlocks(joinedName, selected.mentions)).toBeUndefined();
  });

  it("trims the outgoing draft without losing selected mentions containing spaces", () => {
    const selected = insertComposerMention("  @A", [], "user_alex", "Alex Chen", true);
    expect(buildSelectedMentionBlocks(selected.text, selected.mentions)).toEqual([
      { type: "mention", userId: "user_alex", label: "Alex Chen" },
    ]);
    expect(buildSelectedMentionBlocks("@其他人", selected.mentions)).toBeUndefined();
  });

  it("keeps both selected IDs when inserting a second identical visible name", () => {
    const first = insertComposerMention("@", [], "user_1", "同名", true);
    const second = insertComposerMention(`${first.text}@`, first.mentions, "bot_2", "同名", true);
    expect(buildSelectedMentionBlocks(second.text, second.mentions)).toEqual([
      { type: "mention", userId: "user_1", label: "同名" },
      { type: "text", text: " " },
      { type: "mention", userId: "bot_2", label: "同名" },
    ]);
  });

  it("locates unread incoming messages and exposes when only part of the count is loaded", () => {
    const messages = [
      { id: "system", senderId: "system", kind: "system" },
      { id: "old", senderId: "peer" },
      { id: "own", senderId: "me" },
      { id: "new-1", senderId: "peer" },
      { id: "new-2", senderId: "peer" },
    ];
    expect(captureUnreadNavigation(messages, 2, "me")).toEqual({
      count: 2, firstMessageId: "new-1", availableCount: 2,
    });
    expect(captureUnreadNavigation(messages, 20, "me")).toEqual({
      count: 20, firstMessageId: "old", availableCount: 3,
    });
    expect(captureUnreadNavigation(messages, 0, "me")).toBeNull();
    expect(captureUnreadNavigation([], 2, "me")).toBeNull();
  });

  it("reveals a selected option solely through its menu scroll position", () => {
    const viewport = {
      getBoundingClientRect: () => ({ top: 100 }),
      clientTop: 2, clientHeight: 100, scrollHeight: 400, scrollTop: 30,
    };
    revealChatAutocompleteOption(viewport, { getBoundingClientRect: () => ({ top: 210, bottom: 250 }) });
    expect(viewport.scrollTop).toBe(78);
    revealChatAutocompleteOption(viewport, { getBoundingClientRect: () => ({ top: 80, bottom: 100 }) });
    expect(viewport.scrollTop).toBe(56);
    revealChatAutocompleteOption(viewport, { getBoundingClientRect: () => ({ top: 110, bottom: 140 }) });
    expect(viewport.scrollTop).toBe(56);
  });

  it("treats IME confirmation and Shift+Enter as input rather than menu selection", () => {
    expect(chatAutocompleteKeyAction({ key: "Enter", isComposing: true }, 2)).toBeNull();
    expect(chatAutocompleteKeyAction({ key: "Enter", keyCode: 229 }, 2)).toBeNull();
    expect(chatAutocompleteKeyAction({ key: "Enter", shiftKey: true }, 2)).toBeNull();
    expect(chatAutocompleteKeyAction({ key: "Enter" }, 2)).toBe("select");
    expect(chatAutocompleteKeyAction({ key: "ArrowDown" }, 2)).toBe("next");
    expect(chatAutocompleteKeyAction({ key: "ArrowUp" }, 2)).toBe("previous");
    expect(chatAutocompleteKeyAction({ key: "Escape" }, 2)).toBe("dismiss");
    expect(chatAutocompleteKeyAction({ key: "Enter" }, 0)).toBeNull();
  });
});
