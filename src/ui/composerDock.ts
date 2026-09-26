export type ComposerPanel = 'none' | 'emoji' | 'attach' | 'mention';

export function clampImeHeight(height: number, screenHeight: number): number {
  const floor = 260;
  const ceiling = Math.max(floor, Math.round(screenHeight * 0.5));
  if (height <= 0) return floor;
  return Math.min(ceiling, Math.max(floor, Math.round(height)));
}

export function composerDock(input: {
  keyboardVisible: boolean;
  panel: ComposerPanel;
  imeBottom: number;
  lastImeHeight: number;
  navBarInset: number;
}): { panelHeight: number; dockBottom: number } {
  if (input.keyboardVisible) {
    // Suggestions stay in the chat layout above the IME. Emoji and attachment
    // panels still replace the IME, so neither may consume space while it is up.
    const panelHeight = input.panel === 'mention'
      ? Math.min(180, Math.max(96, Math.round(input.lastImeHeight * 0.6)))
      : 0;
    return { panelHeight, dockBottom: input.imeBottom };
  }
  if (input.panel !== 'none') return { panelHeight: input.lastImeHeight, dockBottom: 0 };
  return { panelHeight: 0, dockBottom: input.navBarInset };
}

export function applyMentionSuggestions(input: {
  suggestionCount: number;
  current: ComposerPanel;
  mentionDismissed: boolean;
}): { nextPanel: ComposerPanel } {
  if (input.suggestionCount > 0) {
    if (input.mentionDismissed) {
      return { nextPanel: input.current === 'mention' ? 'none' : input.current };
    }
    return { nextPanel: 'mention' };
  }
  if (input.current === 'mention') return { nextPanel: 'none' };
  return { nextPanel: input.current };
}
