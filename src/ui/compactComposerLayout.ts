import { hit, space, type } from './tokens';

export function minimumComposerHeight(fontScale: number): number {
  // Preserve a full scaled text line, its padding and border; never shrink the
  // system font or the independent 48dp actions to fit an opaque keyboard.
  return Math.max(hit, Math.ceil(type.bodyLine * fontScale) + space.xs * 2 + 2);
}

export function composerInputHeights(fontScale: number, compact: boolean) {
  if (compact) {
    const height = minimumComposerHeight(fontScale);
    return { minHeight: height, maxHeight: height };
  }
  const lineHeight = Math.ceil(type.bodyLine * fontScale);
  const visibleLines = Math.max(1, Math.floor(type.bodyLine * 6 / lineHeight));
  // maxHeight is a border-box: reserve the actual padding and borders outside
  // the bounded, whole-line text viewport, including at larger system fonts.
  const verticalInsets = space.sm * 2 + 2;
  return {
    minHeight: Math.max(hit, lineHeight + verticalInsets),
    maxHeight: visibleLines * lineHeight + verticalInsets,
  };
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
