import { composerInputHeights, minimumComposerHeight } from '../src/ui/compactComposerLayout';

test('the measured three-line 2x draft has its full text viewport plus padding and border', () => {
  const height = composerInputHeights(2, false);
  expect(height).toEqual({ minHeight: 66, maxHeight: 162 });
  expect((height.maxHeight - 18) * 2.625).toBe(378);
});

test.each([0.85, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.5, 3.75, 7])(
  'ordinary height at font scale %s reserves whole lines within the text budget, or one readable line', fontScale => {
    const { minHeight, maxHeight } = composerInputHeights(fontScale, false);
    const scaledLine = Math.ceil(24 * fontScale);
    const textViewport = maxHeight - 18;
    expect(textViewport % scaledLine).toBe(0);
    expect(textViewport).toBeGreaterThanOrEqual(scaledLine);
    expect(textViewport).toBeLessThanOrEqual(Math.max(144, scaledLine));
    expect(minHeight).toBeGreaterThanOrEqual(48);
    expect(minHeight - 18).toBeGreaterThanOrEqual(scaledLine);
    expect(maxHeight).toBeGreaterThanOrEqual(minHeight);
  },
);

test.each([1, 1.3, 2, 3.75])('compact height at font scale %s preserves the single-row IME budget', fontScale => {
  const height = minimumComposerHeight(fontScale);
  expect(composerInputHeights(fontScale, true)).toEqual({ minHeight: height, maxHeight: height });
});
