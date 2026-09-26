import { bubble, list, motion, originalTheme, reservedDirect, resolveTheme, space, hit } from '../src/ui/tokens';
import { formatListTime, stableTone } from '../src/ui/format';

test('original light and dark colors match the web original theme baseline', () => {
  expect(originalTheme.light).toMatchObject({
    bg: '#f5f7f8',
    surface: '#ffffff',
    shared: '#256b78',
    sharedSoft: '#e7f2f4',
    elevated: '#ffffff',
    focus: '#286b9d',
    success: '#24714a',
    dangerSoft: '#ffedf1',
  });
  expect(originalTheme.dark).toMatchObject({
    bg: '#151b20',
    shared: '#9bd4df',
    elevated: '#29353d',
    focus: '#9bcbf5',
    success: '#9cddb5',
  });
});

test('workspace theme omits P2P direct colors and uses 48dp hit targets', () => {
  const theme = resolveTheme('light');
  expect('direct' in theme).toBe(false);
  expect(theme.hit).toBe(48);
  expect(hit).toBe(48);
  expect(space.lg).toBe(16);
  expect(reservedDirect.light.direct).toBe('#a7482c');
  expect(theme.shared).toBe('#256b78');
});

test('motion list and bubble tokens match DualLane durations and flat group edges', () => {
  expect(motion.press).toBe(120);
  expect(motion.content).toBe(180);
  expect(motion.detail).toBe(200);
  expect(motion.switch).toBe(160);
  expect(list.rowMin).toBe(72);
  expect(list.avatar).toBe(48);
  expect(bubble.outer).toBe(16);
  expect(bubble.inner).toBe(0);
  expect(bubble.maxWidthPercent).toBe(0.8);
  const reduced = resolveTheme('light', true);
  expect(reduced.motionMs('press')).toBe(0);
  expect(reduced.motionMs('detail')).toBe(0);
  expect(resolveTheme('light').motionMs('press')).toBe(120);
});

test('list time stays stable for today, yesterday and older dates', () => {
  const now = new Date('2026-09-17T15:00:00');
  expect(formatListTime('2026-09-17T04:20:00.000Z', now).length).toBeGreaterThan(0);
  expect(formatListTime('2026-09-16T12:00:00.000Z', now)).toBe('昨天');
  expect(formatListTime('2026-09-15T08:00:00.000Z', now)).toBe('9/15');
  expect(stableTone('user-a')).toBe(stableTone('user-a'));
});
