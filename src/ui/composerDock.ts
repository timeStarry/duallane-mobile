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
  if (input.keyboardVisible) return { panelHeight: 0, dockBottom: input.imeBottom };
  if (input.panel !== 'none') return { panelHeight: input.lastImeHeight, dockBottom: 0 };
  return { panelHeight: 0, dockBottom: input.navBarInset };
}

export function applyMentionSuggestions(input: {
  suggestionCount: number;
  current: ComposerPanel;
  mentionDismissed: boolean;
}): { dismissKeyboard: boolean; nextPanel: ComposerPanel } {
  if (input.suggestionCount > 0) {
    if (input.mentionDismissed) {
      return { dismissKeyboard: false, nextPanel: input.current === 'mention' ? 'none' : input.current };
    }
    return { dismissKeyboard: true, nextPanel: 'mention' };
  }
  if (input.current === 'mention') return { dismissKeyboard: false, nextPanel: 'none' };
  return { dismissKeyboard: false, nextPanel: input.current };
}
