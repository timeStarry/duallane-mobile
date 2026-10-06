import { hit, space, type } from './tokens';

export function minimumComposerHeight(fontScale: number): number {
  // Preserve a full scaled text line, its padding and border; never shrink the
  // system font or the independent 48dp actions to fit an opaque keyboard.
  return Math.max(hit, Math.ceil(type.bodyLine * fontScale) + space.xs * 2 + 2);
}

export function compactComposerLayout(input: {
  screenHeight: number;
  topInset: number;
  dockBottom: number;
  panelHeight: number;
  fontScale: number;
}) {
  const minimumHeight = minimumComposerHeight(input.fontScale);
  const aboveDock = Math.max(0, input.screenHeight - input.topInset - input.dockBottom);
  const panelBudget = Math.max(0, aboveDock - minimumHeight);
  // A partially clipped suggestion is not a 48dp target. Keep its state so it
  // becomes available again when the keyboard closes or the window grows.
  const panelHeight = panelBudget >= hit ? Math.min(input.panelHeight, panelBudget) : 0;
  const availableContentHeight = aboveDock - panelHeight;
  const regularHeaderHeight = hit + space.sm * 2;
  const regularComposerHeight = minimumHeight + space.md * 2;
  return {
    compact: availableContentHeight < regularHeaderHeight + regularComposerHeight + hit,
    availableContentHeight,
    minimumComposerHeight: minimumHeight,
    insufficientSpace: availableContentHeight < minimumHeight,
    panelHeight,
  };
}
