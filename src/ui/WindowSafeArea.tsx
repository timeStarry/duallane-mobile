import React, { createContext, useContext, useMemo } from 'react';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context';

const WindowMetrics = createContext<Metrics | null>(null);

/** Keep full-window metrics above navigation frames shortened by inline feedback. */
export function WindowMetricsProvider({ children }: { children: React.ReactNode }) {
  const frame = useSafeAreaFrame(), insets = useSafeAreaInsets();
  const metrics = useMemo(() => ({ frame, insets }), [frame, insets]);
  return <WindowMetrics.Provider value={metrics}>{children}</WindowMetrics.Provider>;
}

export function useWindowMetrics(): Metrics {
  const window = useContext(WindowMetrics);
  const frame = useSafeAreaFrame(), insets = useSafeAreaInsets();
  return useMemo(() => window ?? { frame, insets }, [window, frame, insets]);
}

/** Native full-screen windows need their own live provider and full-window initial metrics. */
export function WindowSafeArea({ children }: { children: React.ReactNode }) {
  const metrics = useWindowMetrics();
  return <SafeAreaProvider initialMetrics={metrics} style={{ flex: 1 }}>{children}</SafeAreaProvider>;
}
