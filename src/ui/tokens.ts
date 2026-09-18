// Original theme values copied from duallane@9b5956a7 apps/web/src/ui/theme/tokens.ts.
// Workspace UI must not use the reserved P2P `direct*` colors.

export type ColorMode = 'light' | 'dark';

export type SemanticColors = {
  bg: string;
  surface: string;
  soft: string;
  elevated: string;
  text: string;
  muted: string;
  line: string;
  control: string;
  focus: string;
  shared: string;
  sharedSoft: string;
  onShared: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  avatarA: string;
  avatarB: string;
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { tag: 6, control: 10, input: 16, dialog: 20, entity: 11, bubble: 16 } as const;
export const type = { body: 16, bodyLine: 24, control: 15, title: 22, section: 20, meta: 12, timestamp: 11 } as const;
export const hit = 48;
export const pressedOpacity = 0.72;
export const disabledOpacity = 0.4;

export const motion = {
  press: 120,
  content: 180,
  detail: 200,
  switch: 160,
  ease: [0.2, 0.75, 0.25, 1] as const,
} as const;

export type MotionKind = 'press' | 'content' | 'detail' | 'switch';

export const list = {
  rowMin: 72,
  avatar: 48,
  chatAvatar: 32,
  unreadBadge: 18,
} as const;

/** Android messenger bubbles. Inner 0 = DESIGN_SYSTEM flat group edges. */
export const bubble = {
  maxWidthPercent: 0.8,
  outer: 16,
  inner: 0,
} as const;

export const originalTheme: Record<ColorMode, SemanticColors> = {
  light: {
    bg: '#f5f7f8',
    surface: '#ffffff',
    soft: '#eef2f4',
    elevated: '#ffffff',
    text: '#202c32',
    muted: '#586a74',
    line: '#e0e7ea',
    control: '#81919a',
    focus: '#286b9d',
    shared: '#256b78',
    sharedSoft: '#e7f2f4',
    onShared: '#ffffff',
    success: '#24714a',
    successSoft: '#e8f5ed',
    warning: '#825500',
    warningSoft: '#fff5df',
    danger: '#b52e49',
    dangerSoft: '#ffedf1',
    avatarA: '#e5ebf5',
    avatarB: '#eee8f1',
  },
  dark: {
    bg: '#151b20',
    surface: '#20292f',
    soft: '#2a363e',
    elevated: '#29353d',
    text: '#eaf1f5',
    muted: '#a8bbc6',
    line: '#35464f',
    control: '#8198a5',
    focus: '#9bcbf5',
    shared: '#9bd4df',
    sharedSoft: '#25414c',
    onShared: '#142c33',
    success: '#9cddb5',
    successSoft: '#203e2f',
    warning: '#efcd87',
    warningSoft: '#423822',
    danger: '#ffb0c0',
    dangerSoft: '#4b2b37',
    avatarA: '#324457',
    avatarB: '#463c50',
  },
};

/** P2P channel colors from the same source. Not part of Workspace Theme. */
export const reservedDirect = {
  light: { direct: '#a7482c', directSoft: '#fceee7', onDirect: '#ffffff' },
  dark: { direct: '#f3ad8f', directSoft: '#44302a', onDirect: '#342319' },
} as const;

export type Theme = SemanticColors & {
  mode: ColorMode;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  hit: typeof hit;
  pressedOpacity: typeof pressedOpacity;
  disabledOpacity: typeof disabledOpacity;
  motion: typeof motion;
  list: typeof list;
  bubble: typeof bubble;
  reduceMotion: boolean;
  motionMs: (kind: MotionKind) => number;
};

export function resolveTheme(mode: ColorMode, reduceMotion = false): Theme {
  return {
    ...originalTheme[mode],
    mode,
    space,
    radius,
    type,
    hit,
    pressedOpacity,
    disabledOpacity,
    motion,
    list,
    bubble,
    reduceMotion,
    motionMs: kind => (reduceMotion ? 0 : motion[kind]),
  };
}
