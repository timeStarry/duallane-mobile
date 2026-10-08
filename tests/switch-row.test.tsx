import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Switch } from 'react-native';
import { SwitchRow } from '../src/ui/controls';

test('the complete labelled row toggles once and follows its controlled value', () => {
  const onValueChange = jest.fn();
  const props = { title: '允许搜索', detail: '其他成员可以找到我', onValueChange };
  const view = render(<SwitchRow {...props} value={false} />);

  const row = view.getByRole('switch', { name: props.title, checked: false });
  expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(view.UNSAFE_getByType(Switch).props.value).toBe(false);
  expect(view.UNSAFE_getByType(Switch).props.disabled).toBe(false);
  fireEvent.press(view.getByText(props.title, { includeHiddenElements: true }));
  expect(onValueChange).toHaveBeenCalledTimes(1);
  expect(onValueChange).toHaveBeenLastCalledWith(true);
  expect(view.getByRole('switch', { name: props.title, checked: false })).toBeTruthy();

  view.rerender(<SwitchRow {...props} value />);
  expect(view.getByRole('switch', { name: props.title, checked: true })).toBeTruthy();
  expect(view.UNSAFE_getByType(Switch).props.value).toBe(true);
  fireEvent.press(view.getByRole('switch', { name: props.title }));
  expect(onValueChange).toHaveBeenCalledTimes(2);
  expect(onValueChange).toHaveBeenLastCalledWith(false);
});

test('a disabled row and native switch retain their state without calling the change handler', () => {
  const onValueChange = jest.fn();
  const view = render(<SwitchRow title="允许搜索" value disabled onValueChange={onValueChange} />);

  const row = view.getByRole('switch', { name: '允许搜索', checked: true, disabled: true });
  fireEvent.press(row);
  fireEvent.press(view.getByText('允许搜索', { includeHiddenElements: true }));
  expect(onValueChange).not.toHaveBeenCalled();
  expect(view.UNSAFE_getByType(Switch).props).toMatchObject({ value: true, disabled: true });
});

test('only the row is accessible and its visual content cannot handle a second touch', () => {
  const view = render(
    <SwitchRow title="允许搜索" detail="其他成员可以找到我" value={false} onValueChange={jest.fn()} />,
  );

  expect(view.getAllByRole('switch')).toHaveLength(1);
  expect(view.getAllByLabelText('允许搜索')).toHaveLength(1);
  const nativeSwitch = view.UNSAFE_getByType(Switch);
  expect(nativeSwitch.props.onValueChange).toBeUndefined();
  expect(nativeSwitch.parent?.props).toMatchObject({
    pointerEvents: 'none',
    accessible: false,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
  });
});
