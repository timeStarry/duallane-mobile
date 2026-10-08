import { act, renderHook } from '@testing-library/react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useChatIme } from '../src/ui/useChatIme';

let mockDimensions = { width: 978, height: 418, scale: 2.625, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockDimensions }));

let mockKeyboard = { isVisible: true, height: 310 };
const mockSetEnabled = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = jest.requireActual<typeof import('react')>('react');
    React.useEffect(effect, [effect]);
  },
}));
jest.mock('react-native-keyboard-controller', () => ({
  useKeyboardController: () => ({ setEnabled: mockSetEnabled }),
  KeyboardController: { setInputMode: jest.fn(), setDefaultMode: jest.fn() },
  AndroidSoftInputModes: { SOFT_INPUT_ADJUST_NOTHING: 48 },
  useKeyboardState: (selector: (state: typeof mockKeyboard) => unknown) => selector(mockKeyboard),
}));

beforeEach(() => {
  mockKeyboard = { isVisible: true, height: 310 };
  mockDimensions = { width: 978, height: 418, scale: 2.625, fontScale: 1 };
});
afterEach(() => jest.restoreAllMocks());

test('real keyboard space triggers compact mode without stacking the nav inset', () => {
  const hook = renderHook(() => useChatIme(24, 0, '', 24));
  expect(hook.result.current.compact).toBe(true);
  expect(hook.result.current.availableContentHeight).toBe(84);
  expect(hook.result.current.minimumComposerHeight).toBe(48);
  expect(hook.result.current.insufficientSpace).toBe(false);
  expect(hook.result.current.dock.dockBottom).toBe(310);
  hook.unmount();
  expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  expect(KeyboardController.setDefaultMode).toHaveBeenCalled();
});

test('height rather than orientation decides compact mode and preserves panels on resize', () => {
  const hook = renderHook(() => useChatIme(24, 0, '', 24));
  mockDimensions = { width: 320, height: 418, scale: 2.625, fontScale: 1 };
  hook.rerender(undefined);
  expect(hook.result.current.compact).toBe(true);
  mockDimensions = { width: 978, height: 900, scale: 2.625, fontScale: 1 };
  hook.rerender(undefined);
  expect(hook.result.current.compact).toBe(false);
  act(() => hook.result.current.setPanel('attach'));
  expect(hook.result.current.panel).toBe('attach');
  mockKeyboard = { isVisible: false, height: 0 };
  hook.rerender(undefined);
  expect(hook.result.current.panel).toBe('attach');
  expect(hook.result.current.dock.panelHeight).toBeGreaterThan(0);
});

test('mention suggestions cannot cover the minimum composer row in a short keyboard viewport', () => {
  const hook = renderHook(() => useChatIme(24, 2, '@', 24));
  expect(hook.result.current.panel).toBe('mention');
  expect(hook.result.current.dock.panelHeight).toBe(0);
  expect(hook.result.current.availableContentHeight).toBe(84);
  expect(hook.result.current.insufficientSpace).toBe(false);
});

test('no 48dp space is reported honestly instead of shrinking touch targets or scaled text', () => {
  mockKeyboard = { isVisible: true, height: 370 };
  const hook = renderHook(() => useChatIme(24, 0, '', 24));
  expect(hook.result.current.availableContentHeight).toBe(24);
  expect(hook.result.current.insufficientSpace).toBe(true);
  expect(hook.result.current.minimumComposerHeight).toBe(48);
  mockKeyboard = { isVisible: true, height: 340 };
  mockDimensions = { width: 978, height: 418, scale: 2.625, fontScale: 2 };
  hook.rerender(undefined);
  expect(hook.result.current.minimumComposerHeight).toBe(58);
  expect(hook.result.current.insufficientSpace).toBe(true);
});
