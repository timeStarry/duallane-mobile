/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

jest.mock('react-native-keyboard-controller', () => {
  return {
    KeyboardProvider: ({ children }: { children: unknown }) => children,
    useKeyboardController: () => ({ setEnabled: jest.fn(), enabled: false }),
    KeyboardController: { setInputMode: jest.fn(), setDefaultMode: jest.fn() },
    AndroidSoftInputModes: { SOFT_INPUT_ADJUST_NOTHING: 48, SOFT_INPUT_ADJUST_PAN: 32, SOFT_INPUT_ADJUST_RESIZE: 16 },
    useKeyboardState: (selector?: (state: { isVisible: boolean; height: number }) => unknown) => {
      const state = { isVisible: false, height: 0 };
      return selector ? selector(state) : state;
    },
  };
});
