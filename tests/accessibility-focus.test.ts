import { NativeModules, Platform, type View } from 'react-native';
import { captureAccessibilityFocus } from '../src/platform/accessibility-focus';

const node = {} as View;
let previousModule: unknown;
let capture: jest.Mock, restore: jest.Mock, cancel: jest.Mock;

beforeEach(() => {
  previousModule = NativeModules.DualLaneAccessibilityFocus;
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(jest.requireActual<typeof import('react-native')>('react-native'), 'findNodeHandle').mockReturnValue(42);
  capture = jest.fn().mockResolvedValue(true);
  restore = jest.fn().mockResolvedValue(true);
  cancel = jest.fn();
  NativeModules.DualLaneAccessibilityFocus = { captureTarget: capture, restoreFocus: restore, cancelTarget: cancel };
});
afterEach(() => { NativeModules.DualLaneAccessibilityFocus = previousModule; jest.restoreAllMocks(); });

test('one captured target consumes the same opaque ticket once', async () => {
  const target = captureAccessibilityFocus(node)!;
  expect(await target.ready).toBe(true);
  const ticket = capture.mock.calls[0]![1];
  expect(capture).toHaveBeenCalledWith(42, ticket);
  expect(await target.restore()).toBe(true);
  expect(await target.restore()).toBe(false);
  target.cancel();
  expect(restore).toHaveBeenCalledWith(ticket);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
});
test('cancel before native capture resolves permanently closes the target', async () => {
  let resolve!: (value: boolean) => void;
  capture.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
  const target = captureAccessibilityFocus(node)!;
  target.cancel(); target.cancel(); resolve(true);
  expect(await target.ready).toBe(false);
  expect(await target.restore()).toBe(false);
  expect(restore).not.toHaveBeenCalled(); expect(cancel).toHaveBeenCalledTimes(1);
});
test('restore before capture readiness consumes and cancels instead of guessing a target', async () => {
  const target = captureAccessibilityFocus(node)!;
  expect(await target.restore()).toBe(false);
  expect(await target.ready).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled();
});
test('native restore queued but not settled remains cancelable and cannot report success', async () => {
  let resolve!: (value: boolean) => void;
  restore.mockReturnValueOnce(new Promise<boolean>(done => { resolve = done; }));
  const target = captureAccessibilityFocus(node)!;
  await target.ready;
  const pending = target.restore();
  target.cancel(); target.cancel();
  expect(cancel).toHaveBeenCalledWith(capture.mock.calls[0]![1]);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(await target.restore()).toBe(false);
  resolve(true);
  expect(await pending).toBe(false);
  expect(restore).toHaveBeenCalledTimes(1);
});
test.each([false, 'true', undefined, new Error('Synthetic capture')])('capture result %s cannot authorize a native action', async result => {
  if (result instanceof Error) capture.mockRejectedValueOnce(result);
  else capture.mockResolvedValueOnce(result);
  const target = captureAccessibilityFocus(node)!;
  expect(await target.ready).toBe(false); expect(await target.restore()).toBe(false);
  expect(cancel).toHaveBeenCalledTimes(1); expect(restore).not.toHaveBeenCalled();
});
test.each([false, 'true', new Error('Synthetic restore')])('native restore result %s is fail closed without retry', async result => {
  if (result instanceof Error) restore.mockRejectedValueOnce(result);
  else restore.mockResolvedValueOnce(result);
  const target = captureAccessibilityFocus(node)!;
  await target.ready;
  expect(await target.restore()).toBe(false); expect(await target.restore()).toBe(false);
  expect(restore).toHaveBeenCalledTimes(1);
});
test('a missing native bridge never falls back to RN event 8', () => {
  delete NativeModules.DualLaneAccessibilityFocus;
  expect(captureAccessibilityFocus(node)).toBeUndefined(); expect(capture).not.toHaveBeenCalled();
});
test('opaque tickets increase across targets', () => {
  captureAccessibilityFocus(node); captureAccessibilityFocus(node);
  expect(capture.mock.calls[1]![1]).toBeGreaterThan(capture.mock.calls[0]![1]);
});
