import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { WorkspaceCard } from '../src/ui/cards';
import type { Runtime } from '../src/data/runtime';

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.0', nativeBuildVersion: '2' } }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const block = { type: 'card' as const, cardId: 'card-1', cardType: 'echo.solicitation', schemaVersion: 1, fallbackText: '需求投票' };

test('registered Echo vote submits selected option IDs with the authorized card revision', async () => {
  const card = {
    block: { cardType: 'echo.solicitation', schemaVersion: 1, fallbackText: '需求投票' },
    status: 'active',
    revision: 3,
    actions: ['vote', 'unknown_action'],
    payload: { title: '需求投票', status: 'open', choiceMode: 'single', options: [{ id: 'option-1', label: '优化手机端', count: 2 }] },
  };
  const runtime = {
    resolveCard: jest.fn().mockResolvedValue(card),
    cardAction: jest.fn().mockResolvedValue({ action: {} }),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={block} runtime={runtime} />);

  await waitFor(() => expect(view.getByRole('radio', { name: '优化手机端' })).toBeTruthy());
  expect(view.queryByText('unknown_action')).toBeNull();
  fireEvent.press(view.getByRole('radio', { name: '优化手机端' }));
  fireEvent.press(view.getByRole('button', { name: '提交投票' }));
  await waitFor(() => expect(runtime.cardAction).toHaveBeenCalledWith('card-1', 'vote', ['vote'], 3, { optionIds: ['option-1'] }));
});

test('expired cards do not expose their old actions', async () => {
  const runtime = {
    resolveCard: jest.fn().mockResolvedValue({
      block: { cardType: 'echo.solicitation', schemaVersion: 1, fallbackText: '需求投票' },
      status: 'expired', revision: 4, actions: ['vote'],
      payload: { title: '需求投票', status: 'open', options: [{ id: 'option-1', label: '优化手机端' }] },
    }),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={block} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('需求投票')).toBeTruthy());
  expect(view.queryByRole('button', { name: '提交投票' })).toBeNull();
});
