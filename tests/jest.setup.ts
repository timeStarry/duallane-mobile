/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock('react-native-worklets', () => ({}));
jest.mock('react-native-reanimated', () => ({
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
}));
jest.mock('react-native-gesture-handler', () => {
  const { View } = require('react-native');
  return {
    GestureHandlerRootView: View,
    GestureDetector: ({ children }: { children: unknown }) => children,
    Gesture: {
      LongPress: () => ({
        minDuration() { return this; },
        maxDistance() { return this; },
        onStart() { return this; },
      }),
    },
  };
});

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
