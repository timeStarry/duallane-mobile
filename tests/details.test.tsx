import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DetailsScreen } from '../src/features/chat/screens';
import { conversationSchema, type Topic } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import type { Runtime } from '../src/data/runtime';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.0', nativeBuildVersion: '2' } }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

const file = { id: 'f1', fileName: 'sample.png', mimeType: 'image/png', byteSize: 12, status: 'available', capabilities: { canDownload: true } };
const topic: Topic = {
  id: 't1', conversationId: 'g1', title: '测试话题', description: null, descriptionPreview: null,
  status: 'open', joined: true, canJoin: false, allowSyncToGroup: false, participantCount: 2,
  unreadCount: 0, lastReadMessageId: null, notificationLevel: 'all', revision: 1,
};

test('group details expose authorized pins, topics, and conversation files with distinct actions', async () => {
  const group = conversationSchema.parse({ id: 'g1', displayTitle: '内测群', type: 'group', lastActivityAt: '2026-09-26T00:00:00Z' });
  useWorkspace.setState({ conversations: { g1: group }, topics: {}, bootstrap: null });
  const api = { json: jest.fn(async (path: string) => {
    if (path.includes('/pins')) return { pins: [{ message: { id: 'm1', conversationId: 'g1', authorName: 'Test', kind: 'user', createdAt: '2026-09-26T00:00:00Z', plainText: 'Synthetic pin', content: { format: 'duallane.message+json;v=1', blocks: [{ type: 'text', text: 'Synthetic pin' }] }, attachments: [] } }] };
    if (path.includes('/files?')) return { files: [file] };
    throw new Error('Unexpected request');
  }) };
  const runtime = { api, listTopics: jest.fn(async () => { useWorkspace.getState().upsertTopic(topic); return [topic]; }) } as unknown as Runtime;
  const onOpenTopic = jest.fn();
  const onOpenPinnedMessage = jest.fn();
  const onOpenFile = jest.fn();
  const onDownloadFile = jest.fn();
  const view = render(<DetailsScreen id="g1" runtime={runtime} onOpenTopic={onOpenTopic} onOpenPinnedMessage={onOpenPinnedMessage} onOpenFile={onOpenFile} onDownloadFile={onDownloadFile} />);

  await waitFor(() => expect(view.getByText('Synthetic pin')).toBeTruthy());
  expect(view.getByText('测试话题')).toBeTruthy();
  expect(view.getByText('sample.png')).toBeTruthy();
  fireEvent.press(view.getByText('Synthetic pin'));
  expect(onOpenPinnedMessage).toHaveBeenCalledWith('m1');
  fireEvent.press(view.getByText('测试话题'));
  expect(onOpenTopic).toHaveBeenCalledWith(topic);
  fireEvent.press(view.getByRole('button', { name: '预览图片' }));
  expect(onOpenFile).toHaveBeenCalledWith(file);
  fireEvent.press(view.getByRole('button', { name: '下载并保存' }));
  expect(onDownloadFile).toHaveBeenCalledWith(file);
  expect(api.json).toHaveBeenCalledWith('/api/workspace/groups/g1/pins', expect.anything());
  expect(api.json).toHaveBeenCalledWith('/api/workspace/files?scope=conversation&conversationId=g1&limit=50', expect.anything());
});
