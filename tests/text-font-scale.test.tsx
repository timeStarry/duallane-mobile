import React, { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Dimensions, FlatList, Platform, Text as NativeText, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text } from '../src/ui/Text';
import { AppHeader } from '../src/ui/chrome';
import { Composer } from '../src/ui/composer';
import { MessageContent } from '../src/ui/MessageContent';
import { syntheticMessages } from '../src/fixtures/synthetic';
import type { Message } from '../src/domain/contracts';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } } } }));
jest.mock('../src/ui/RemoteImage', () => ({ RemoteImage: () => null }));

const dimensions = { width: 390, height: 844, scale: 2.625, fontScale: 1 };
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
const Stack = createNativeStackNavigator<{ Chat: undefined }>();

function resize(fontScale: number, width = dimensions.width) {
  act(() => Dimensions.set({ window: { ...dimensions, width, fontScale }, screen: { ...dimensions, width, fontScale } }));
}

beforeEach(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
  resize(1);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test('Android font changes replace only the native Text and update its forwarded ref', () => {
  const ref = React.createRef<NativeText>();
  const view = render(<View testID="container"><Text ref={ref} testID="text">合成文字</Text></View>);
  const container = view.getByTestId('container');
  const original = view.getByTestId('text');
  const originalRef = ref.current;
  expect(originalRef).not.toBeNull();
  resize(2);
  expect(view.getByTestId('text')).not.toBe(original);
  expect(ref.current).not.toBe(originalRef);
  expect(view.getByTestId('container')).toBe(container);
  const enlarged = view.getByTestId('text');
  resize(1);
  expect(view.getByTestId('text')).not.toBe(enlarged);
  expect(view.getByText('合成文字')).toBeTruthy();
  view.unmount();
  expect(ref.current).toBeNull();
});

test('resizing without a font change does not remount text, and iOS keeps its native lifecycle', () => {
  const view = render(<Text testID="text">合成文字</Text>);
  const original = view.getByTestId('text');
  resize(1, 844);
  expect(view.getByTestId('text')).toBe(original);
  view.unmount();
  jest.replaceProperty(Platform, 'OS', 'ios');
  const ios = render(<Text testID="text">合成文字</Text>);
  const iosText = ios.getByTestId('text');
  resize(2);
  expect(ios.getByTestId('text')).toBe(iosText);
});

test('nested text, selection, accessibility, style and press behavior pass through without a View', () => {
  const onPress = jest.fn();
  const view = render(<Text testID="outer" selectable accessibilityLabel="合成段落" style={{ fontSize: 16, lineHeight: 22 }}>
    正文<Text testID="inner" accessibilityRole="link" onPress={onPress} style={{ fontWeight: '600' }}>链接</Text>
  </Text>);
  expect(view.UNSAFE_queryAllByType(View)).toHaveLength(0);
  const outer = view.getByTestId('outer');
  expect(outer.props.allowFontScaling).toBeUndefined();
  expect(outer.props.maxFontSizeMultiplier).toBeUndefined();
  expect(outer.props.selectable).toBe(true);
  expect(outer.props.style).toEqual({ fontSize: 16, lineHeight: 22 });
  resize(2);
  expect(view.getByLabelText('合成段落')).toBeTruthy();
  expect(view.getByTestId('outer').findByProps({ testID: 'inner' })).toBeTruthy();
  fireEvent.press(view.getByRole('link'));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test.each([
  { kind: 'emoji', name: '合成群聊', emoji: '🎨', glyph: '🎨' },
  { kind: 'initial', name: 'Taylor', emoji: undefined, glyph: 'T' },
])('decorative avatar $kind keeps its fixed-size glyph while the identity and body follow system font changes', ({ name, emoji, glyph }) => {
  const view = render(<SafeAreaProvider initialMetrics={metrics}>
    <AppHeader title={name} identity={{ name, id: 'synthetic-avatar', emoji }} />
    <Text>合成正文</Text>
  </SafeAreaProvider>);
  for (const fontScale of [1, 2, 1]) {
    resize(fontScale);
    expect(view.getByText(glyph).props.allowFontScaling).toBe(false);
    expect(view.getByText(name).props.allowFontScaling).toBeUndefined();
    expect(view.getByText(name).props.maxFontSizeMultiplier).toBeUndefined();
    expect(view.getByText('合成正文').props.allowFontScaling).toBeUndefined();
    expect(view.getByText('合成正文').props.maxFontSizeMultiplier).toBeUndefined();
  }
});

test('hot font changes refresh header and message text while preserving the route, list, composer host and edited draft', () => {
  const navigation = createNavigationContainerRef<{ Chat: undefined }>();
  const mount = jest.fn();
  const unmount = jest.fn();
  const onFocus = jest.fn();
  const onSend = jest.fn();
  const message: Message = { ...syntheticMessages[0]!, plainText: '合成消息', blocks: [{ type: 'text', text: '合成消息' }] };
  function Chat() {
    const [draft, setDraft] = useState('未发送');
    useEffect(() => { mount(); return unmount; }, []);
    return <View testID="chat-route">
      <AppHeader title="合成会话" identity={{ name: '合成会话', id: 'synthetic-chat', emoji: '🎨', shape: 'group' }} />
      <FlatList data={[message]} keyExtractor={item => item.id} renderItem={({ item }) => <MessageContent message={item} download={jest.fn()} />} />
      <Composer value={draft} onChangeText={setDraft} onSend={onSend} onFocus={onFocus} />
    </View>;
  }
  const view = render(<SafeAreaProvider initialMetrics={metrics}>
    <NavigationContainer ref={navigation}>
      <Stack.Navigator screenOptions={{ headerShown: false }}><Stack.Screen name="Chat" component={Chat} /></Stack.Navigator>
    </NavigationContainer>
  </SafeAreaProvider>);
  const route = navigation.getCurrentRoute();
  const routeView = view.getByTestId('chat-route');
  const input = view.getByLabelText('消息');
  const inputInstance = view.UNSAFE_getByType(TextInput).instance;
  const listInstance = view.UNSAFE_getByType(FlatList).instance;
  const header = view.getByText('合成会话');
  const messageText = view.getByText('合成消息');
  expect(header.props.allowFontScaling).toBeUndefined();
  expect(messageText.props.allowFontScaling).toBeUndefined();
  fireEvent(input, 'focus');
  fireEvent.changeText(input, '第一行草稿\n第二行');
  resize(2);
  expect(view.getByText('合成会话') === header).toBe(false);
  expect(view.getByText('合成消息') === messageText).toBe(false);
  expect(view.getByText('合成会话').props.allowFontScaling).toBeUndefined();
  expect(view.getByText('合成消息').props.allowFontScaling).toBeUndefined();
  expect(view.UNSAFE_getByType(FlatList).instance).toBe(listInstance);
  expect(view.getByLabelText('消息')).toBe(input);
  expect(view.UNSAFE_getByType(TextInput).instance).toBe(inputInstance);
  expect(view.getByLabelText('消息').props.value).toBe('第一行草稿\n第二行');
  expect(view.getByTestId('chat-route')).toBe(routeView);
  expect(navigation.getCurrentRoute()).toEqual(route);
  resize(1);
  expect(view.getByLabelText('消息')).toBe(input);
  expect(view.UNSAFE_getByType(FlatList).instance).toBe(listInstance);
  expect(view.getByLabelText('消息').props.value).toBe('第一行草稿\n第二行');
  expect(mount).toHaveBeenCalledTimes(1);
  expect(unmount).not.toHaveBeenCalled();
  expect(onFocus).toHaveBeenCalledTimes(1);
  expect(onSend).not.toHaveBeenCalled();
});
