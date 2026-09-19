import React, { createContext, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo, StatusBar, useColorScheme } from 'react-native';
import { resolveTheme, type ColorMode, type Theme } from './tokens';

export type AppearanceMode = 'system' | ColorMode;
const Theme = createContext<Theme>(resolveTheme('light'));

export function ThemeProvider({ mode, children }: { mode: AppearanceMode; children: React.ReactNode }) {
  const system = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const resolved: ColorMode = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; sub.remove(); };
  }, []);
  const theme = resolveTheme(resolved, reduceMotion);
  return (
    <Theme.Provider value={theme}>
      <StatusBar barStyle={resolved === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />
      {children}
    </Theme.Provider>
  );
}

export const useTheme = () => useContext(Theme);
