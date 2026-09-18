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
  if (input.panel !== 'none') return { panelHeight: input.lastImeHeight, dockBottom: 0 };
  if (input.keyboardVisible) return { panelHeight: 0, dockBottom: input.imeBottom };
  return { panelHeight: 0, dockBottom: input.navBarInset };
}
