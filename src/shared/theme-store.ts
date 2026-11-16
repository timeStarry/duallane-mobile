import { create } from "zustand";
import { nativeBridge } from "@/native/bridge";
import {
  DESIGN_TOKENS,
  isAccentId,
  type AccentId,
  type ThemeMode,
  type ThemePreference,
  type TransparencyMode,
} from "./tokens";

interface ThemeState {
  preference: ThemePreference;
  resolvedMode: ThemeMode;
  accent: AccentId;
  transparency: TransparencyMode;
  reducedMotion: boolean;
  setPreference: (preference: ThemePreference) => void;
  setAccent: (accent: AccentId) => void;
  setTransparency: (transparency: TransparencyMode) => void;
  setReducedMotion: (reduced: boolean) => void;
}

const STORAGE_KEY = "duallane-v1-appearance";

export function resolveSystemMode(): ThemeMode {
  if (nativeBridge.isNativeAndroid()) {
    const sys = nativeBridge.getSessionSnapshot().systemTheme;
    if (sys === "light" || sys === "dark") {
      return sys;
    }
  }
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readPersisted(): Partial<
  Pick<ThemeState, "preference" | "accent" | "transparency" | "reducedMotion">
> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      preference:
        parsed.preference === "light" || parsed.preference === "dark" || parsed.preference === "system"
          ? (parsed.preference as ThemePreference)
          : undefined,
      accent: isAccentId(parsed.accent) ? parsed.accent : undefined,
      transparency:
        parsed.transparency === "solid"
          ? ("solid" as const)
          : parsed.transparency === "glass"
          ? ("glass" as const)
          : undefined,
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : undefined,
    };
  } catch {
    return {};
  }
}

function persist(state: Pick<ThemeState, "preference" | "accent" | "transparency" | "reducedMotion">) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function applyMobileThemeTokens(
  mode: ThemeMode,
  accent: AccentId,
  transparency: TransparencyMode,
  reducedMotion: boolean
) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const palette = DESIGN_TOKENS.modes[mode];
  const accentPalette = DESIGN_TOKENS.accents[accent];

  root.dataset.themeMode = mode;
  root.dataset.accent = accent;
  root.dataset.transparency = transparency;
  root.dataset.motion = reducedMotion ? "reduced" : "normal";
  root.style.colorScheme = mode;

  const activeAccent = mode === "dark" ? accentPalette.dark : accentPalette.light;
  const activeAccentSoft = mode === "dark" ? accentPalette.darkSoft : accentPalette.lightSoft;
  const activeOnAccent = mode === "dark" ? accentPalette.onDark : accentPalette.onLight;

  const vars: Record<string, string> = {
    "--dl-bg": palette.bg,
    "--dl-canvas-from": palette.canvasFrom,
    "--dl-canvas-to": palette.canvasTo,
    "--dl-surface": palette.surface,
    "--dl-soft": palette.soft,
    "--dl-glass-chrome": palette.glassChrome,
    "--dl-glass-elevated": palette.glassElevated,
    "--dl-glass-pill": palette.glassPill,
    "--dl-glass-highlight": palette.glassHighlight,
    "--dl-line": palette.line,
    "--dl-line-strong": palette.lineStrong,
    "--dl-text": palette.text,
    "--dl-muted": palette.muted,
    "--dl-control": palette.control,
    "--dl-backdrop": palette.backdrop,
    "--dl-direct": palette.direct,
    "--dl-direct-soft": palette.directSoft,
    "--dl-on-direct": palette.onDirect,
    "--dl-shared": activeAccent,
    "--dl-shared-soft": activeAccentSoft,
    "--dl-on-shared": activeOnAccent,
    "--dl-accent": activeAccent,
    "--dl-accent-soft": activeAccentSoft,
    "--dl-on-accent": activeOnAccent,
    "--dl-border": palette.line,
    "--dl-card": palette.soft,
    "--dl-text-muted": palette.muted,
    "--dl-bubble-own": mode === "dark" ? accentPalette.light : activeAccent,
    "--dl-bubble-own-text": "#ffffff",
    "--dl-bubble-peer": palette.surface,
    "--dl-success": palette.success,
    "--dl-success-soft": palette.successSoft,
    "--dl-warning": palette.warning,
    "--dl-warning-soft": palette.warningSoft,
    "--dl-danger": palette.danger,
    "--dl-danger-soft": palette.dangerSoft,
  };

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  nativeBridge.syncSystemBars(mode, palette.surface);
}

const initial = readPersisted();
const initialPreference: ThemePreference = initial.preference ?? "system";
const initialResolvedMode: ThemeMode =
  initialPreference === "system" ? resolveSystemMode() : initialPreference;
const initialAccent: AccentId = initial.accent ?? "azure";
const initialTransparency: TransparencyMode = initial.transparency ?? "glass";
const initialReducedMotion = initial.reducedMotion ?? false;

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: initialPreference,
  resolvedMode: initialResolvedMode,
  accent: initialAccent,
  transparency: initialTransparency,
  reducedMotion: initialReducedMotion,
  setPreference: (preference) => {
    const resolvedMode = preference === "system" ? resolveSystemMode() : preference;
    const { accent, transparency, reducedMotion } = get();
    applyMobileThemeTokens(resolvedMode, accent, transparency, reducedMotion);
    persist({ preference, accent, transparency, reducedMotion });
    set({ preference, resolvedMode });
  },
  setAccent: (accent) => {
    const { preference, resolvedMode, transparency, reducedMotion } = get();
    applyMobileThemeTokens(resolvedMode, accent, transparency, reducedMotion);
    persist({ preference, accent, transparency, reducedMotion });
    set({ accent });
  },
  setTransparency: (transparency) => {
    const { preference, resolvedMode, accent, reducedMotion } = get();
    applyMobileThemeTokens(resolvedMode, accent, transparency, reducedMotion);
    persist({ preference, accent, transparency, reducedMotion });
    set({ transparency });
  },
  setReducedMotion: (reducedMotion) => {
    const { preference, resolvedMode, accent, transparency } = get();
    applyMobileThemeTokens(resolvedMode, accent, transparency, reducedMotion);
    persist({ preference, accent, transparency, reducedMotion });
    set({ reducedMotion });
  },
}));

let themeListenersInstalled = false;

export function initializeMobileTheme() {
  const s = useThemeStore.getState();
  const effectiveMode = s.preference === "system" ? resolveSystemMode() : s.preference;
  if (effectiveMode !== s.resolvedMode) {
    useThemeStore.setState({ resolvedMode: effectiveMode });
  }
  applyMobileThemeTokens(effectiveMode, s.accent, s.transparency, s.reducedMotion);

  if (themeListenersInstalled) return;
  themeListenersInstalled = true;

  nativeBridge.onSystemThemeChange((nextMode) => {
    const cur = useThemeStore.getState();
    if (cur.preference === "system") {
      applyMobileThemeTokens(nextMode, cur.accent, cur.transparency, cur.reducedMotion);
      useThemeStore.setState({ resolvedMode: nextMode });
    }
  });

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", () => {
      const cur = useThemeStore.getState();
      if (cur.preference === "system") {
        const nextMode = resolveSystemMode();
        applyMobileThemeTokens(nextMode, cur.accent, cur.transparency, cur.reducedMotion);
        useThemeStore.setState({ resolvedMode: nextMode });
      }
    });
  }
}
