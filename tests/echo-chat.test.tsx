import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Runtime } from '../src/data/runtime';
import type { Transfers } from '../src/data/transfers';
import { ApiError } from '../src/data/client';
import { bootstrapSchema, type Draft } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { ChatScreen } from '../src/features/chat/screens';

jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => true, useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('../src/ui/useChatIme', () => ({ useChatIme: () => ({ panel: 'none', dock: { dockBottom: 0, panelHeight: 0 }, openPanel: jest.fn(), closePanel: jest.fn() }) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'invocation-1') }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } }, nativeAppVersion: '0.2.3', nativeBuildVersion: '4' } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } }));
jest.mock('../src/platform/notifications', () => ({ enableNotifications: jest.fn() }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, right: 0, bottom: 24, left: 0 } };
function seed(bot = true, type = 'direct') {
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Self' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 0, permissions: { canReadConversations: true },
    policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, members: [], files: [],
    conversations: [{ id: 'echo-1', type, displayTitle: 'Echo', members: [{ id: 'usr_system_echo', kind: bot ? 'bot' : 'human', displayName: 'Echo' }], lastActivityAt: '2026-10-06T00:00:00Z', capabilities: { canSendMessage: true } }],
  }), 'test:self');
}
function runtime() {
  return {
    api: { json: jest.fn().mockRejectedValue(new ApiError('interaction.unavailable', 503)) },
    open: jest.fn().mockResolvedValue(0), openTopic: jest.fn().mockResolvedValue(0), markRead: jest.fn(),
    patchDraft: jest.fn((key: string, patch: Partial<Draft>) => useWorkspace.getState().setDraft(key, patch)),
    send: jest.fn().mockResolvedValue(undefined), emotes: jest.fn().mockResolvedValue({ items: [] }), emoteLibrary: jest.fn().mockResolvedValue({ emotes: [], collections: [] }),
    topicProjections: jest.fn().mockResolvedValue([]), setTopicProjection: jest.fn(),
  };
}
function screen(api: ReturnType<typeof runtime>) {
  return <SafeAreaProvider initialMetrics={metrics}><ChatScreen target={{ kind: 'conversation', id: 'echo-1' }} runtime={api as unknown as Runtime} transfers={{} as Transfers} details={jest.fn()} /></SafeAreaProvider>;
}
function pendingStart(api: ReturnType<typeof runtime>) {
  let resolve!: (value: unknown) => void;
  const command = new Promise<unknown>(yes => { resolve = yes; });
  api.api.json.mockReset().mockReturnValueOnce(command).mockResolvedValue({ workflow: {
    id: 'wf-synthetic', conversationId: 'echo-1', botUserId: 'usr_system_echo', type: 'echo.requirement', version: 1,
    status: 'active', revision: 1, expiresAt: '2026-10-07T00:00:00Z', state: { step: 'title', fields: { type: 'requirement' } },
  } });
  return () => resolve({ command: { ok: true, result: { type: 'workflow.start', workflowType: 'echo.requirement', version: 1, input: { type: 'requirement' } } } });
}
beforeEach(() => { useWorkspace.getState().reset(); seed(); });
afterEach(() => useWorkspace.getState().reset());

test.each(['/need', '/feedback'])('an unavailable %s command opens a safe failure and retains the composer instead of sending a normal message', async text => {
  useWorkspace.getState().setDraft('echo-1', text);
  const api = runtime();
  const view = render(screen(api));
  await waitFor(() => expect(api.open).toHaveBeenCalled());
  await act(async () => fireEvent.press(view.getByLabelText('发送')));
  expect(api.send).not.toHaveBeenCalled();
  expect(api.api.json.mock.calls[0]?.[0]).toBe('/api/workspace/interactions/commands');
  expect(view.getByText('Echo 交互暂时不可用，请稍后重试。')).toBeTruthy();
  expect(useWorkspace.getState().drafts['echo-1']?.text).toBe(text);
});

test.each([{ bot: false, type: 'direct' }, { bot: true, type: 'group' }])('a human or group retains ordinary slash-message behavior ($bot/$type)', async ({ bot, type }) => {
  seed(bot, type); useWorkspace.getState().setDraft('echo-1', '/need');
  const api = runtime(); const view = render(screen(api));
  await act(async () => fireEvent.press(view.getByLabelText('发送')));
  expect(api.send).toHaveBeenCalled();
  expect(api.api.json).not.toHaveBeenCalled();
  expect(view.queryByText('提交需求')).toBeNull();
});

test('official Echo entry buttons start interactions and never submit or create chat messages', async () => {
  const api = runtime(); const view = render(screen(api));
  await act(async () => fireEvent.press(view.getByText('反馈问题')));
  expect(api.api.json.mock.calls[0]?.[2]).toMatchObject({ source: '/feedback', conversationId: 'echo-1', botUserId: 'usr_system_echo' });
  expect(api.send).not.toHaveBeenCalled();
  expect(api.api.json).toHaveBeenCalledTimes(1);
});

test('attachments cannot silently ride along with an Echo command', async () => {
  useWorkspace.getState().setDraft('echo-1', { text: '/need', pendingAttachment: { taskId: 'synthetic-upload', fileName: 'synthetic.txt', mimeType: 'text/plain', byteSize: 10 } });
  const api = runtime(); const view = render(screen(api));
  await act(async () => fireEvent.press(view.getByLabelText('发送')));
  expect(api.send).not.toHaveBeenCalled();
  expect(api.api.json).not.toHaveBeenCalled();
  expect(view.getByText('Echo 命令不支持附件，请先移除附件。')).toBeTruthy();
  expect(useWorkspace.getState().drafts['echo-1']?.pendingAttachment?.taskId).toBe('synthetic-upload');
});

test.each([
  { name: 'reply', patch: { replyToMessageId: 'synthetic-reply' } },
  { name: 'attachment', patch: { pendingAttachment: { taskId: 'synthetic-upload', fileName: 'synthetic.txt', mimeType: 'text/plain', byteSize: 10 } } },
  { name: 'mention', patch: { mentionIds: ['synthetic-peer'], mentionSpans: [] } },
])('a late slash start preserves the newer $name metadata and unchanged command text', async ({ patch }) => {
  useWorkspace.getState().setDraft('echo-1', '/need');
  const api = runtime(); const finish = pendingStart(api); const view = render(screen(api));
  await act(async () => fireEvent.press(view.getByLabelText('发送')));
  act(() => fireEvent.press(view.getByText('关闭')));
  act(() => useWorkspace.getState().setDraft('echo-1', patch));
  const newerDraft = useWorkspace.getState().drafts['echo-1'];
  await act(async () => finish());
  await waitFor(() => expect(api.api.json).toHaveBeenCalledTimes(2));
  expect(useWorkspace.getState().drafts['echo-1']).toBe(newerDraft);
  expect(useWorkspace.getState().drafts['echo-1']).toMatchObject({ text: '/need', ...patch });
  expect(api.patchDraft).not.toHaveBeenCalled();
  expect(api.send).not.toHaveBeenCalled();
});

test('a successful slash start clears the unchanged original draft', async () => {
  useWorkspace.getState().setDraft('echo-1', { text: '/need', replyToMessageId: 'original-reply', mentionIds: ['original-mention'] });
  const api = runtime(); const finish = pendingStart(api); const view = render(screen(api));
  await act(async () => fireEvent.press(view.getByLabelText('发送')));
  await act(async () => finish());
  await waitFor(() => expect(useWorkspace.getState().drafts['echo-1']?.text).toBe(''));
  expect(useWorkspace.getState().drafts['echo-1']).toMatchObject({ text: '', replyToMessageId: undefined, mentionIds: [], mentionSpans: [] });
  expect(api.patchDraft).toHaveBeenCalledTimes(1);
  expect(api.send).not.toHaveBeenCalled();
});
