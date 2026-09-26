import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { ActivityIndicator, Image } from 'react-native';
import { RemoteImage } from '../src/ui/RemoteImage';
import { localMediaUri } from '../src/data/media';

jest.mock('../src/data/media', () => ({
  localMediaText: jest.fn(),
  localMediaUri: jest.fn(),
}));

test('failed received media stops showing a loading indicator', async () => {
  jest.mocked(localMediaUri).mockRejectedValueOnce(new Error('media unavailable'));
  const onError = jest.fn();
  const view = render(<RemoteImage uri="https://duallane.tsio.top/assets/missing.png" style={{ width: 32, height: 32 }} onError={onError} />);
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeTruthy();
  await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
});

test('avatar media can load without a visible spinner', () => {
  jest.mocked(localMediaUri).mockImplementationOnce(() => new Promise<string>(() => undefined));
  const view = render(<RemoteImage uri="https://duallane.tsio.top/api/workspace/avatars/member/1" showLoadingIndicator={false} />);
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
});

test('native image decode failure also clears its failed image state', () => {
  const onError = jest.fn();
  const view = render(<RemoteImage uri="file:///cached-image.png" onError={onError} />);
  act(() => { view.UNSAFE_getByType(Image).props.onError(); });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(view.UNSAFE_queryByType(Image)).toBeNull();
  expect(view.UNSAFE_queryByType(ActivityIndicator)).toBeNull();
});
