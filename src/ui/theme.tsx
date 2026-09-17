import React, { createContext, useContext } from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { resolveTheme, type ColorMode, type Theme } from './tokens';

export type AppearanceMode = 'system' | ColorMode;
const Theme = createContext<Theme>(resolveTheme('light'));

export function ThemeProvider({ mode, children }: { mode: AppearanceMode; children: React.ReactNode }) {
  const system = useColorScheme();
  const resolved: ColorMode = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const theme = resolveTheme(resolved);
  return (
    <Theme.Provider value={theme}>
      <StatusBar barStyle={resolved === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={theme.bg} />
      {children}
    </Theme.Provider>
  );
}

export const useTheme = () => useContext(Theme);
