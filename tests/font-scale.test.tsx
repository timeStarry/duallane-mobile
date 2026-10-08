import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Dimensions, NativeModules, Platform, Text as NativeText, TextInput, View } from 'react-native';
import { useFontScale } from '../src/platform/font-scale';
import { Text } from '../src/ui/Text';

const mockCallbacks = new Set<(snapshot: unknown) => void>();
const mockOldCallbacks: Array<(snapshot: unknown) => void> = [];
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({ __esModule: true, default: class {
  constructor(private mockNative: { addListener: (event: string) => void; removeListeners: (count: number) => void } | null) {}
  addListener(event: string, callback: (snapshot: unknown) => void) {
    if (event !== 'DualLaneFontScaleChanged') return { remove: () => {} };
    this.mockNative?.addListener(event);
    mockCallbacks.add(callback);
    mockOldCallbacks.push(callback);
    return { remove: () => { if (mockCallbacks.delete(callback)) this.mockNative?.removeListeners(1); } };
  }
} }));

const dimensions = { width: 390, height: 844, scale: 2.625, fontScale: 1 };
const Stack = createNativeStackNavigator<{ Chat: undefined }>();
function deferred() {
  let resolve!: (snapshot: unknown) => void;
  const promise = new Promise<unknown>(done => { resolve = done; });
  return { promise, resolve };
}
function moduleWith(getFontScale: () => Promise<unknown> = jest.fn(() => Promise.resolve({ fontScale: 1, revision: 0 }))) {
  const native = { getFontScale, addListener: jest.fn(), removeListeners: jest.fn() };
  NativeModules.DualLaneFontScale = native;
  return native;
}
function resize(fontScale: number) {
  act(() => Dimensions.set({ window: { ...dimensions, fontScale }, screen: { ...dimensions, fontScale } }));
}
function emit(snapshot: unknown) { act(() => mockCallbacks.forEach(callback => callback(snapshot))); }
function Probe({ id = 'scale' }: { id?: string }) {
  return <NativeText testID={id}>{useFontScale()}</NativeText>;
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resize(1);
  mockCallbacks.clear();
  mockOldCallbacks.length = 0;
  delete NativeModules.DualLaneFontScale;
});
afterEach(() => { cleanup(); delete NativeModules.DualLaneFontScale; jest.restoreAllMocks(); });

test('native configuration events update the scale while RN Dimensions remains cached at 1', async () => {
  const native = moduleWith();
  const view = render(<Probe />);
  await act(async () => {});
  emit({ fontScale: 2, revision: 1 });
  expect(Dimensions.get('window').fontScale).toBe(1);
  expect(view.getByTestId('scale').props.children).toBe(2);
  emit({ fontScale: 1, revision: 2 });
  expect(view.getByTestId('scale').props.children).toBe(1);
  expect(native.addListener).toHaveBeenCalledWith('DualLaneFontScaleChanged');
});

test('subscribe precedes the current snapshot, whose late result cannot overwrite a newer event', async () => {
  const pending = deferred();
  const get = jest.fn(() => {
    expect(mockCallbacks.size).toBe(1);
    mockCallbacks.forEach(callback => callback({ fontScale: 2, revision: 2 }));
    return pending.promise;
  });
  moduleWith(get);
  const view = render(<Probe />);
  expect(view.getByTestId('scale').props.children).toBe(2);
  await act(async () => pending.resolve({ fontScale: 1, revision: 1 }));
  expect(view.getByTestId('scale').props.children).toBe(2);
});

test('all consumers share one subscription and old subscription callbacks cannot reach a new mount', async () => {
  const old = deferred(), fresh = deferred();
  const native = moduleWith(jest.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise));
  const first = render(<Probe id="first" />);
  const second = render(<Probe id="second" />);
  expect(native.addListener).toHaveBeenCalledTimes(1);
  const lateEvent = mockOldCallbacks[0]!;
  first.unmount();
  expect(native.removeListeners).not.toHaveBeenCalled();
  second.unmount();
  expect(native.removeListeners).toHaveBeenCalledTimes(1);
  expect(mockCallbacks.size).toBe(0);
  const next = render(<Probe />);
  await act(async () => fresh.resolve({ fontScale: 2, revision: 2 }));
  await act(async () => old.resolve({ fontScale: 3, revision: 99 }));
  act(() => lateEvent({ fontScale: 4, revision: 100 }));
  expect(next.getByTestId('scale').props.children).toBe(2);
  next.unmount();
  expect(native.removeListeners).toHaveBeenCalledTimes(2);
});

test('only finite positive canonical scales and strictly newer safe revisions are accepted', async () => {
  moduleWith();
  const view = render(<Probe />);
  await act(async () => {});
  emit({ fontScale: 3.75, revision: 1 });
  for (const snapshot of [null, {}, { fontScale: 0, revision: 2 }, { fontScale: -1, revision: 2 },
    { fontScale: Infinity, revision: 2 }, { fontScale: NaN, revision: 2 }, { fontScale: '2', revision: 2 },
    { fontScale: 2, revision: -1 }, { fontScale: 2, revision: 1.5 }, { fontScale: 2, revision: Number.MAX_SAFE_INTEGER + 1 },
    { fontScale: 2, revision: 0 }, { fontScale: 2, revision: 1 }]) emit(snapshot);
  expect(view.getByTestId('scale').props.children).toBe(3.75);
});

test('missing Android module and non-Android hosts preserve Dimensions fallback', () => {
  const fallback = render(<Probe />);
  resize(2);
  expect(fallback.getByTestId('scale').props.children).toBe(2);
  fallback.unmount();
  jest.replaceProperty(Platform, 'OS', 'ios');
  const native = moduleWith();
  const ios = render(<Probe />);
  resize(1.5);
  expect(ios.getByTestId('scale').props.children).toBe(1.5);
  expect(native.addListener).not.toHaveBeenCalled();
});

test('a rejected snapshot retains event delivery without an unhandled rejection', async () => {
  moduleWith(jest.fn().mockRejectedValue(new Error('unavailable')));
  const view = render(<Probe />);
  await act(async () => {});
  emit({ fontScale: 2, revision: 1 });
  expect(view.getByTestId('scale').props.children).toBe(2);
});

test('real shared Text consumes native events without remounting its route, input or edited draft', async () => {
  moduleWith();
  const navigation = createNavigationContainerRef<{ Chat: undefined }>();
  const mount = jest.fn(), unmount = jest.fn(), onFocus = jest.fn();
  function Chat() {
    const [draft, setDraft] = useState('合成草稿');
    useEffect(() => { mount(); return unmount; }, []);
    return <View testID="route"><Text testID="message">合成文字</Text>
      <TextInput accessibilityLabel="合成输入" multiline value={draft} onChangeText={setDraft} onFocus={onFocus} />
    </View>;
  }
  const view = render(<NavigationContainer ref={navigation}><Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="Chat" component={Chat} />
  </Stack.Navigator></NavigationContainer>);
  await act(async () => {});
  const route = navigation.getCurrentRoute(), routeView = view.getByTestId('route');
  const input = view.getByLabelText('合成输入'), inputInstance = view.UNSAFE_getByType(TextInput).instance;
  fireEvent(input, 'focus');
  fireEvent.changeText(input, '第一行\n第二行草稿');
  let host = view.getByTestId('message');
  for (const [fontScale, revision] of [[2, 1], [1, 2]]) {
    emit({ fontScale, revision });
    expect(Dimensions.get('window').fontScale).toBe(1);
    expect(view.getByTestId('message')).not.toBe(host);
    host = view.getByTestId('message');
    expect(view.getByTestId('route')).toBe(routeView);
    expect(navigation.getCurrentRoute()).toEqual(route);
    expect(view.getByLabelText('合成输入')).toBe(input);
    expect(view.UNSAFE_getByType(TextInput).instance).toBe(inputInstance);
    expect(input.props.value).toBe('第一行\n第二行草稿');
  }
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
  expect(onFocus).toHaveBeenCalledTimes(1);
});
