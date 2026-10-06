import React, { useState } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Composer } from '../src/ui/composer';
import { IconButton } from '../src/ui/primitives';

let mockDimensions = { width: 978, height: 418, scale: 2.625, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions }));
const mockFontCallbacks = new Set<(snapshot: unknown) => void>();
jest.mock('react-native/Libraries/EventEmitter/NativeEventEmitter', () => ({ __esModule: true, default: class {
  addListener(event: string, callback: (snapshot: unknown) => void) {
    if (event !== 'DualLaneFontScaleChanged') return { remove: () => {} };
    mockFontCallbacks.add(callback);
    return { remove: () => { mockFontCallbacks.delete(callback); } };
  }
} }));

const metrics = { frame: { x: 0, y: 0, width: 978, height: 418 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };
const draft = '第一行\n第二行未发送';

function composer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return <SafeAreaProvider initialMetrics={metrics}><Composer value={draft} onChangeText={jest.fn()} onSend={jest.fn()} compact {...props} /></SafeAreaProvider>;
}

beforeEach(() => {
  mockDimensions = { width: 978, height: 418, scale: 2.625, fontScale: 1 };
  mockFontCallbacks.clear();
  delete ReactNative.NativeModules.DualLaneFontScale;
});
afterEach(() => { cleanup(); delete ReactNative.NativeModules.DualLaneFontScale; jest.restoreAllMocks(); });

test('compact wide composer keeps navigation, 48dp actions and a scrollable multiline draft in one row', () => {
  const onSend = jest.fn();
  const onChangeText = jest.fn();
  const onBack = jest.fn();
  const onDetails = jest.fn();
  const view = render(composer({ onSend, onChangeText, onAttach: jest.fn(), onEmote: jest.fn(),
    leading: <IconButton label="返回会话列表" onPress={onBack}><ReactNative.Text>返回</ReactNative.Text></IconButton>,
    trailing: <IconButton label="会话详情" onPress={onDetails}><ReactNative.Text>详情</ReactNative.Text></IconButton>,
  }));
  const input = view.getByLabelText('消息');
  const inputStyle = ReactNative.StyleSheet.flatten(input.props.style);
  expect(inputStyle.maxHeight).toBe(48);
  expect(inputStyle.minHeight).toBe(48);
  expect(input.props.value).toBe(draft);
  expect(input.props.multiline).toBe(true);
  expect(input.props.scrollEnabled).toBe(true);
  expect(input.props.disableFullscreenUI).toBe(true);
  fireEvent(input, 'submitEditing');
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.changeText(input, `${draft}\n第三行`);
  expect(onChangeText).toHaveBeenCalledWith(`${draft}\n第三行`);
  for (const label of ['返回会话列表', '会话详情', '发送', '添加', '表情']) {
    const style = ReactNative.StyleSheet.flatten(view.getByRole('button', { name: label }).props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.minWidth).toBeGreaterThanOrEqual(48);
  }
  fireEvent.press(view.getByRole('button', { name: '返回会话列表' }));
  fireEvent.press(view.getByRole('button', { name: '会话详情' }));
  fireEvent.press(view.getByRole('button', { name: '发送' }));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onDetails).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledTimes(1);
});

test('compact reply and attachment remain independently cancellable without changing the draft', () => {
  const onClearReply = jest.fn();
  const onClearAttachment = jest.fn();
  const onChangeText = jest.fn();
  const view = render(composer({ onChangeText, reply: { author: '测试成员', preview: '原消息' }, onClearReply, attachmentName: '测试.txt', onClearAttachment }));
  expect(view.queryByText('原消息')).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '取消回复 测试成员：原消息' }));
  expect(onClearReply).toHaveBeenCalledTimes(1);
  expect(onClearAttachment).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '移除 测试.txt' }));
  expect(onClearAttachment).toHaveBeenCalledTimes(1);
  expect(onChangeText).not.toHaveBeenCalled();
  expect(view.getByLabelText('消息').props.value).toBe(draft);
});

test('narrow compact actions remain available with disabled upload and preserved reply/file context', () => {
  mockDimensions = { width: 390, height: 418, scale: 2.625, fontScale: 1 };
  const dismiss = jest.spyOn(ReactNative.Keyboard, 'dismiss').mockImplementation(() => undefined);
  const onAttach = jest.fn();
  const onClearReply = jest.fn();
  const view = render(composer({ onAttach, onEmote: jest.fn(), attachDisabled: true, reply: { author: '测试成员', preview: '原消息' }, onClearReply, attachmentName: '测试.txt', onClearAttachment: jest.fn() }));
  fireEvent.press(view.getByRole('button', { name: '输入选项，回复 测试成员，附件 测试.txt' }));
  expect(dismiss).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '添加' }));
  expect(onAttach).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '取消回复' }));
  expect(onClearReply).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('消息').props.value).toBe(draft);
});

test('compact row grows for readable system fonts and ordinary mode restores full previews', () => {
  mockDimensions = { width: 978, height: 418, scale: 2.625, fontScale: 2 };
  const props = { reply: { author: '测试成员', preview: '原消息' }, attachmentName: '测试.txt' };
  const view = render(composer(props));
  expect(ReactNative.StyleSheet.flatten(view.getByLabelText('消息').props.style).maxHeight).toBeGreaterThanOrEqual(58);
  view.rerender(composer({ ...props, compact: false }));
  expect(view.getByText('原消息')).toBeTruthy();
  expect(view.getByText('测试.txt')).toBeTruthy();
  expect(view.getByLabelText('消息').props.value).toBe(draft);
});

test('ordinary composer fits the measured three 2x lines without spending their height on padding and borders', () => {
  mockDimensions = { width: 417.52, height: 975.24, scale: 2.625, fontScale: 2 };
  const view = render(composer({ compact: false, value: 'DLAccept 第一行\n第二行草稿\n第三行未发送' }));
  const style = ReactNative.StyleSheet.flatten(view.getByLabelText('消息').props.style);
  // Formal26's three scaled lines require 378 physical pixels. Its 144dp
  // border-box left only 330.75px after the real 16dp padding + 2dp border.
  const availableTextPixels = (style.maxHeight - style.paddingVertical * 2 - style.borderWidth * 2) * mockDimensions.scale;
  expect(availableTextPixels).toBeGreaterThanOrEqual(378);
});

test('native font cycles resize the existing input without resetting its edited draft or focus', async () => {
  jest.replaceProperty(ReactNative.Platform, 'OS', 'android');
  jest.spyOn(ReactNative.Dimensions, 'get').mockReturnValue(mockDimensions);
  ReactNative.NativeModules.DualLaneFontScale = {
    getFontScale: jest.fn(() => Promise.resolve({ fontScale: 1, revision: 0 })),
    addListener: jest.fn(), removeListeners: jest.fn(),
  };
  const onFocus = jest.fn(), onSend = jest.fn();
  function EditableComposer() {
    const [value, setValue] = useState(draft);
    return composer({ compact: false, value, onChangeText: setValue, onFocus, onSend });
  }
  const view = render(<EditableComposer />);
  await act(async () => {});
  const input = view.getByLabelText('消息');
  const instance = view.UNSAFE_getByType(ReactNative.TextInput).instance;
  const edited = `${draft}\n第三行保留光标，不发送`;
  fireEvent(input, 'focus');
  fireEvent.changeText(input, edited);
  for (const [index, fontScale] of [2, 1, 2, 1, 2, 1].entries()) {
    act(() => mockFontCallbacks.forEach(callback => callback({ fontScale, revision: index + 1 })));
    expect(ReactNative.Dimensions.get('window').fontScale).toBe(1);
    expect(view.getByLabelText('消息')).toBe(input);
    expect(view.UNSAFE_getByType(ReactNative.TextInput).instance).toBe(instance);
    expect(input.props.value).toBe(edited);
    expect(input.props.selection).toBeUndefined();
    expect(input.props.multiline).toBe(true);
    expect(input.props.scrollEnabled).toBe(true);
    expect(input.props.blurOnSubmit).toBe(false);
    expect(input.props.disableFullscreenUI).toBe(true);
    expect(ReactNative.StyleSheet.flatten(input.props.style).minHeight).toBe(fontScale === 2 ? 66 : 48);
    expect(ReactNative.StyleSheet.flatten(input.props.style).maxHeight).toBe(162);
  }
  fireEvent(input, 'submitEditing');
  expect(onSend).not.toHaveBeenCalled();
  expect(onFocus).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mockFontCallbacks.size).toBe(0);
});

test('a long ordinary draft stays bounded and scrollable while submit keeps its multiline semantics', () => {
  mockDimensions = { ...mockDimensions, fontScale: 2 };
  const onSend = jest.fn(), onChangeText = jest.fn();
  const value = Array.from({ length: 20 }, (_, index) => `合成草稿第${index + 1}行`).join('\n');
  const view = render(composer({ compact: false, value, onSend, onChangeText }));
  const input = view.getByLabelText('消息');
  const style = ReactNative.StyleSheet.flatten(input.props.style);
  expect(style.maxHeight).toBeLessThan(value.split('\n').length * 48);
  expect(input.props.scrollEnabled).toBe(true);
  expect(input.props.value).toBe(value);
  expect(ReactNative.StyleSheet.flatten(view.getByRole('button', { name: '发送' }).props.style).minHeight).toBeGreaterThanOrEqual(48);
  fireEvent(input, 'submitEditing');
  expect(onSend).not.toHaveBeenCalled();
  expect(onChangeText).not.toHaveBeenCalled();
});

test('measured navigation width moves optional actions into a menu before they crowd the input', () => {
  mockDimensions = { width: 600, height: 418, scale: 2.625, fontScale: 1 };
  const view = render(composer({ onAttach: jest.fn(), onEmote: jest.fn(),
    reply: { author: '测试成员', preview: '原消息' }, onClearReply: jest.fn(), attachmentName: '测试.txt', onClearAttachment: jest.fn(),
    leading: <ReactNative.Text>会话标题</ReactNative.Text>, trailing: <ReactNative.Text>详情</ReactNative.Text>,
  }));
  expect(view.getByRole('button', { name: '添加' })).toBeTruthy();
  fireEvent(view.getByTestId('composer-leading'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 240, height: 48 } } });
  expect(view.getByRole('button', { name: '输入选项，回复 测试成员，附件 测试.txt' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '添加' })).toBeNull();
  expect(view.getByLabelText('消息').props.value).toBe(draft);
});

test('compact send remains disabled and resizing never sends or discards the draft', () => {
  const onSend = jest.fn();
  const onChangeText = jest.fn();
  const view = render(composer({ onSend, onChangeText, sendDisabled: true }));
  fireEvent.press(view.getByRole('button', { name: '发送' }));
  view.rerender(composer({ onSend, onChangeText, sendDisabled: true, compact: false }));
  expect(onSend).not.toHaveBeenCalled();
  expect(onChangeText).not.toHaveBeenCalled();
  expect(view.getByLabelText('消息').props.value).toBe(draft);
});
