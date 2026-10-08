import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AccountNavigator } from '../src/features/account/screens';
import { Runtime } from '../src/data/runtime';
import { AppHeader } from '../src/ui/chrome';
import { StackHeader } from '../src/ui/StackHeader';
import { ThemeProvider } from '../src/ui/theme';
import { resolveTheme } from '../src/ui/tokens';
import { useWorkspace } from '../src/domain/store';

jest.mock('../src/data/runtime', () => ({ Runtime: jest.fn() }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../src/data/transfers', () => ({ Transfers: jest.fn() }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.2', nativeBuildVersion: '10' },
}));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications: jest.fn() }));
jest.mock('expo-updates', () => ({ isEnabled: false, checkForUpdateAsync: jest.fn(), fetchUpdateAsync: jest.fn(), reloadAsync: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 32, left: 0, right: 0, bottom: 24 } };
const Stack = createNativeStackNavigator();

function headerRows(view: ReturnType<typeof render>, title: string) {
  const header = view.UNSAFE_getAllByType(AppHeader).find(item => item.props.title === title);
  if (!header) throw new Error('Expected the shared header');
  const rows: { props: { style?: StyleProp<ViewStyle> } }[] = header.findAllByType(View);
  return rows.map(item => StyleSheet.flatten(item.props.style))
    .filter((style): style is ViewStyle => style?.paddingTop !== undefined);
}

afterEach(() => useWorkspace.getState().reset());

test('account navigation renders its About header through the shared safe-area AppHeader', async () => {
  const runtime = new Runtime();
  const view = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider mode="light">
        <NavigationContainer>
          <AccountNavigator runtime={runtime} mode="light" setMode={jest.fn()} />
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  fireEvent.press(view.getByText('关于与更新'));
  await waitFor(() => {
    const header = view.UNSAFE_getAllByType(AppHeader).find(item => item.props.title === '关于与更新');
    expect(header).toBeDefined();
    expect(header?.props.includeTopInset).toBe(true);
  });
  const row = headerRows(view, '关于与更新');
  expect(row).toHaveLength(1);
  expect(row[0]?.paddingTop).toBe(metrics.insets.top + resolveTheme('light').space.sm);
  const backStyle = StyleSheet.flatten(view.getByRole('button', { name: '返回' }).props.style);
  expect(backStyle.minHeight).toBeGreaterThanOrEqual(48);
  expect(backStyle.minWidth).toBeGreaterThanOrEqual(48);
  fireEvent.press(view.getByRole('button', { name: '返回' }));
  expect(view.getByText('我的')).toBeTruthy();
  expect(view.queryByRole('button', { name: '返回' })).toBeNull();
});

test('a root header uses the route fallback, adds its top inset once, and updates with the theme', () => {
  const screen = (mode: 'light' | 'dark') => (
    <SafeAreaProvider initialMetrics={metrics}>
      <ThemeProvider mode={mode}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ header: props => <StackHeader {...props} /> }}>
            <Stack.Screen name="Root fallback">{() => <Text>Screen content</Text>}</Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>
    </SafeAreaProvider>
  );
  const view = render(screen('light'));
  expect(view.queryByRole('button', { name: '返回' })).toBeNull();
  const lightRows = headerRows(view, 'Root fallback');
  expect(lightRows).toHaveLength(1);
  expect(lightRows[0]).toMatchObject({
    paddingTop: metrics.insets.top + resolveTheme('light').space.sm,
    backgroundColor: resolveTheme('light').surface,
  });
  view.rerender(screen('dark'));
  const darkRows = headerRows(view, 'Root fallback');
  expect(darkRows).toHaveLength(1);
  expect(darkRows[0]).toMatchObject({
    paddingTop: metrics.insets.top + resolveTheme('dark').space.sm,
    backgroundColor: resolveTheme('dark').surface,
  });
  expect(StyleSheet.flatten(view.getByText('Root fallback').props.style).color).toBe(resolveTheme('dark').text);
});
