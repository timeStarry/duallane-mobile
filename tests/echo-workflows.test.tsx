import React from 'react';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react-native';
import type { Runtime } from '../src/data/runtime';
import { ApiError } from '../src/data/client';
import { bootstrapSchema, conversationSchema } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { echoStepInput, echoWorkflowSchema, isOfficialEchoConversation, recognizeEchoCommand, restoredEchoDraft, type EchoWorkflow } from '../src/domain/echo-workflows';
import { useEchoWorkflow } from '../src/features/echo/useEchoWorkflow';
import { EchoWorkflowDialog } from '../src/features/echo/EchoWorkflowDialog';
import { cache } from '../src/platform/storage';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'invocation-1') }));
jest.mock('../src/platform/config', () => ({ installed: { appVersion: '0.2.3', versionCode: 4 } }));
jest.mock('../src/platform/storage', () => ({ cache: { get: jest.fn(), set: jest.fn(), remove: jest.fn() } }));

const localCache = new Map<string, unknown>();
const echoMember = { id: 'usr_system_echo', kind: 'bot', displayName: 'Echo' };
const command = { command: { ok: true, result: { type: 'workflow.start', workflowType: 'echo.requirement', version: 1, input: { type: 'requirement' } } } };
function workflow(extra: Partial<EchoWorkflow> = {}): EchoWorkflow {
  return echoWorkflowSchema.parse({ id: 'wf-1', conversationId: 'echo-1', botUserId: 'usr_system_echo', type: 'echo.requirement', version: 1, status: 'active', revision: 1, expiresAt: '2026-10-07T00:00:00Z', state: { step: 'title', fields: { type: 'requirement' } }, ...extra });
}
function seed(account = 'test:self') {
  useWorkspace.getState().applyBootstrap(bootstrapSchema.parse({
    auth: { currentUser: { id: 'self', displayName: 'Self' } }, space: { id: 's1', name: 'Synthetic' }, eventCursor: 0,
    permissions: { canReadConversations: true }, policy: { dailyQuotaBytes: 100, remainingQuotaBytes: 100, messageRetentionCount: 50 }, members: [], files: [],
    conversations: ['echo-1', 'echo-2'].map(id => ({ id, type: 'direct', displayTitle: 'Echo', members: [echoMember], lastActivityAt: '2026-10-06T00:00:00Z', capabilities: { canSendMessage: true } })),
  }), account);
}
function api() {
  const json = jest.fn().mockResolvedValueOnce(command).mockResolvedValue({ workflow: workflow() });
  return { api: { json } as unknown as NonNullable<Runtime['api']>, json };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  localCache.clear();
  jest.mocked(cache.get).mockImplementation(key => localCache.get(key));
  jest.mocked(cache.set).mockImplementation((key, value) => { localCache.set(key, value); return undefined as never; });
  jest.mocked(cache.remove).mockImplementation(key => { localCache.delete(key); return undefined as never; });
  useWorkspace.getState().reset();
  seed();
});
afterEach(() => { useWorkspace.getState().reset(); });

test('only the actual official bot in a direct conversation intercepts the two supported slash commands', () => {
  const official = useWorkspace.getState().conversations['echo-1']!;
  expect(isOfficialEchoConversation(official)).toBe(true);
  expect(recognizeEchoCommand(official, ' /need feedback ')).toBe('/need feedback');
  expect(recognizeEchoCommand(official, '/feedback')).toBe('/feedback');
  for (const text of ['/needs', '/publish', 'hello /need', '/needless']) expect(recognizeEchoCommand(official, text)).toBeNull();
  const human = conversationSchema.parse({ ...official, members: [{ ...echoMember, kind: 'human' }] });
  const spoof = conversationSchema.parse({ ...official, members: [{ ...echoMember, id: 'ordinary-peer' }] });
  const group = conversationSchema.parse({ ...official, type: 'group' });
  for (const conversation of [human, spoof, group]) {
    expect(isOfficialEchoConversation(conversation)).toBe(false);
    expect(recognizeEchoCommand(conversation, '/need')).toBeNull();
  }
});

test('restoring projected fields never invents or posts redacted originals', () => {
  const saved = workflow({ state: { step: 'confirm', fields: { type: 'problem', title: 'Synthetic title', detail: 'd…', scenario: 's…', expectedResult: 'e…' } } });
  expect(restoredEchoDraft(saved, {})).toEqual({ type: 'problem', title: 'Synthetic title' });
  expect(restoredEchoDraft(saved, { detail: 'Synthetic original' }).detail).toBe('Synthetic original');
  expect(echoStepInput(saved, restoredEchoDraft(saved, {}), true)).toEqual({ confirm: true, idempotencyKey: 'workflow-wf-1-1' });
  expect(() => echoStepInput(saved, {}, false)).toThrow('请点击确认提交');
  expect(() => echoStepInput(workflow(), { title: 'Title' }, true)).toThrow('请先完成当前步骤');
});

test('step input sends only that field, supports type and optional HTTP links, and cannot confirm early', () => {
  expect(echoStepInput(workflow(), { type: 'problem', title: ' Title ', detail: 'Private detail' })).toEqual({ title: 'Title', type: 'problem' });
  const final = workflow({ state: { step: 'expectedResult', fields: {} } });
  expect(echoStepInput(final, { expectedResult: 'Result', relatedLink: 'https://synthetic.example' })).toEqual({ expectedResult: 'Result', relatedLink: 'https://synthetic.example' });
  expect(() => echoStepInput(final, { expectedResult: 'Result', relatedLink: 'javascript:alert(1)' })).toThrow('有效的相关链接');
  expect(() => echoStepInput(workflow(), {})).toThrow('填写当前步骤');
  expect(() => echoStepInput(workflow({ status: 'cancelled' }), { title: 'Title' })).toThrow('已经结束');
});

test.each(['/need', '/feedback'])('$0 starts a server-defined workflow without sending a message or confirming it', async source => {
  const runtime = api();
  if (source === '/feedback') runtime.json.mockReset().mockResolvedValueOnce({ command: { ...command.command, result: { ...command.command.result, input: { type: 'problem' } } } }).mockResolvedValue({ workflow: workflow({ state: { step: 'title', fields: { type: 'problem' } } }) });
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { expect(await hook.result.current.start(source)).toBe(true); });
  expect(runtime.json.mock.calls[0]).toEqual(['/api/workspace/interactions/commands', expect.anything(), { conversationId: 'echo-1', botUserId: 'usr_system_echo', source, clientInvocationId: 'invocation-1' }, 'POST']);
  expect(runtime.json.mock.calls[1]?.[2]).toEqual({ conversationId: 'echo-1', botUserId: 'usr_system_echo', type: 'echo.requirement', version: 1, input: { type: source === '/feedback' ? 'problem' : 'requirement' }, clientInvocationId: 'invocation-1:workflow' });
  expect(runtime.json).toHaveBeenCalledTimes(2);
  expect(hook.result.current.workflow?.state.step).toBe('title');
  expect(hook.result.current.visible).toBe(true);
});

test('each step preserves its local original, and only explicit final confirmation submits with expected revision', async () => {
  const runtime = api();
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/need'); });
  const fields: Record<string, string> = { type: 'requirement' };
  const steps = ['title', 'detail', 'scenario', 'expectedResult'] as const;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    act(() => hook.result.current.edit(step, `Synthetic ${step}`));
    fields[step] = step === 'title' ? 'Synthetic title' : 'S…';
    const nextStep = steps[i + 1] ?? 'confirm';
    runtime.json.mockResolvedValueOnce({ workflow: workflow({ revision: i + 2, state: { step: nextStep, fields } }) });
    await act(async () => { expect(await hook.result.current.advance()).toBe(true); });
    const body = runtime.json.mock.calls.at(-1)?.[2];
    expect(body).toMatchObject({ expectedRevision: i + 1, input: { [step]: `Synthetic ${step}` } });
    expect(body.input.confirm).toBeUndefined();
  }
  expect(hook.result.current.draft.detail).toBe('Synthetic detail');
  const beforeConfirm = runtime.json.mock.calls.length;
  await act(async () => { expect(await hook.result.current.advance()).toBe(false); });
  expect(runtime.json).toHaveBeenCalledTimes(beforeConfirm);
  runtime.json.mockResolvedValueOnce({ workflow: workflow({ status: 'completed', revision: 6, state: { step: 'complete', fields } }), result: { type: 'requirement-submitted', publicId: 'REQ-SYNTHETIC' } });
  await act(async () => { expect(await hook.result.current.advance(true)).toBe(true); });
  expect(runtime.json.mock.calls.at(-1)?.[2]).toEqual({ expectedRevision: 5, input: { confirm: true, idempotencyKey: 'workflow-wf-1-5' } });
  expect(hook.result.current.publicId).toBe('REQ-SYNTHETIC');
  expect(hook.result.current.canResume).toBe(false);
  expect([...localCache.keys()].some(key => key.includes(':draft:'))).toBe(false);
});

test('network command failures remain explicit and a retry reuses the command and workflow invocation IDs', async () => {
  const runtime = api();
  runtime.json.mockReset().mockRejectedValueOnce(new ApiError('request.network', 0, 'net.timeout')).mockResolvedValueOnce(command).mockResolvedValue({ workflow: workflow() });
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { expect(await hook.result.current.start('/need')).toBe(false); });
  expect(hook.result.current.feedback.text).toContain('net.timeout');
  expect(hook.result.current.canResume).toBe(true);
  await act(async () => { await hook.result.current.resume(); });
  expect(runtime.json.mock.calls[0]?.[2]).toEqual(runtime.json.mock.calls[1]?.[2]);
  expect(JSON.stringify([...localCache.values()])).not.toMatch(/net.timeout|request.network/);
});

test('an unavailable command does not fall through and active conflict safely recovers the authorized workflow', async () => {
  const runtime = api();
  runtime.json.mockReset().mockRejectedValueOnce(new ApiError('interaction.unavailable', 503));
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/feedback'); });
  expect(hook.result.current.feedback.text).toBe('Echo 交互暂时不可用，请稍后重试。');
  expect(runtime.json).toHaveBeenCalledTimes(1);
  runtime.json.mockRejectedValueOnce(new ApiError('workflow.active_conflict', 409, undefined, { activeWorkflowId: 'wf-1' })).mockResolvedValueOnce({ workflow: workflow() });
  await act(async () => { expect(await hook.result.current.resume()).toBe(true); });
  expect(runtime.json.mock.calls.at(-1)?.[0]).toBe('/api/workspace/workflows/wf-1');
  expect(hook.result.current.feedback.text).toContain('已恢复');
});

test('a slow start cannot create a workflow after account, route, focus, API, or permission changes', async () => {
  for (const change of ['account', 'route', 'focus', 'api', 'read', 'write', 'bot', 'removed'] as const) {
    seed();
    const pending = deferred<typeof command>();
    const runtime = api(); runtime.json.mockReset().mockReturnValue(pending.promise);
    const hook = renderHook(({ id, focused }: { id: string; focused: boolean }) => useEchoWorkflow(runtime, id, focused), { initialProps: { id: 'echo-1', focused: true } });
    let operation!: Promise<boolean>;
    act(() => { operation = hook.result.current.start('/need'); });
    const writes = jest.mocked(cache.set).mock.calls.length;
    act(() => {
      if (change === 'account') seed('test:other');
      if (change === 'route') hook.rerender({ id: 'echo-2', focused: true });
      if (change === 'focus') hook.rerender({ id: 'echo-1', focused: false });
      if (change === 'api') runtime.api = {} as NonNullable<Runtime['api']>;
      if (change === 'read') useWorkspace.setState({ bootstrap: { ...useWorkspace.getState().bootstrap!, permissions: { ...useWorkspace.getState().bootstrap!.permissions, canReadConversations: false } } });
      if (['write', 'bot', 'removed'].includes(change)) {
        const conversation = useWorkspace.getState().conversations['echo-1']!;
        useWorkspace.setState({ conversations: change === 'removed' ? {} : { 'echo-1': { ...conversation, ...(change === 'write' ? { capabilities: { ...conversation.capabilities, canSendMessage: false } } : { members: [] }) } } });
      }
    });
    await act(async () => { pending.resolve(command); expect(await operation).toBe(false); });
    expect(runtime.json).toHaveBeenCalledTimes(1);
    expect(jest.mocked(cache.set)).toHaveBeenCalledTimes(writes);
    expect(hook.result.current.workflow).toBeUndefined();
    hook.unmount();
  }
});

test('duplicate start and continue clicks are bounded to one in-flight operation', async () => {
  const pending = deferred<typeof command>();
  const runtime = api(); runtime.json.mockReset().mockReturnValueOnce(pending.promise).mockResolvedValue({ workflow: workflow() });
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  let start!: Promise<boolean>;
  act(() => { start = hook.result.current.start('/need'); });
  await act(async () => { expect(await hook.result.current.start('/feedback')).toBe(false); });
  expect(runtime.json).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve(command); await start; });
  act(() => hook.result.current.edit('title', 'Synthetic title'));
  const continuing = deferred<{ workflow: EchoWorkflow }>();
  runtime.json.mockReturnValueOnce(continuing.promise);
  let next!: Promise<boolean>;
  act(() => { next = hook.result.current.advance(); });
  await act(async () => { expect(await hook.result.current.advance()).toBe(false); });
  expect(runtime.json).toHaveBeenCalledTimes(3);
  await act(async () => { continuing.resolve({ workflow: workflow({ revision: 2, state: { step: 'detail', fields: { title: 'Synthetic title' } } }) }); await next; });
});

test('closing during a request leaves it hidden, and re-entry restores only this account/conversation/workflow draft', async () => {
  const runtime = api();
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/need'); });
  act(() => hook.result.current.edit('title', 'Synthetic local title'));
  act(() => hook.result.current.close());
  expect(hook.result.current.visible).toBe(false);
  hook.unmount();
  const reentry = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await reentry.result.current.resume(); });
  expect(reentry.result.current.draft.title).toBe('Synthetic local title');
  const otherConversation = renderHook(() => useEchoWorkflow(runtime, 'echo-2', true));
  expect(otherConversation.result.current.canResume).toBe(false);
  act(() => seed('test:other'));
  expect(reentry.result.current.canResume).toBe(false);
  expect(reentry.result.current.draft).toEqual({});
});

test('closing a pending workflow response never reopens the dialog', async () => {
  const pending = deferred<{ workflow: EchoWorkflow }>();
  const runtime = api(); runtime.json.mockReset().mockResolvedValueOnce(command).mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  let operation!: Promise<boolean>;
  act(() => { operation = hook.result.current.start('/need'); });
  await waitFor(() => expect(runtime.json).toHaveBeenCalledTimes(2));
  act(() => hook.result.current.close());
  await act(async () => { pending.resolve({ workflow: workflow() }); await operation; });
  expect(hook.result.current.visible).toBe(false);
  expect(hook.result.current.canResume).toBe(true);
});

test.each(['account', 'route', 'revoke'] as const)('a late continue response cannot restore data after %s changes', async change => {
  const runtime = api();
  const hook = renderHook(({ id }: { id: string }) => useEchoWorkflow(runtime, id, true), { initialProps: { id: 'echo-1' } });
  await act(async () => { await hook.result.current.start('/need'); });
  act(() => hook.result.current.edit('title', 'Synthetic title'));
  const pending = deferred<{ workflow: EchoWorkflow }>(); runtime.json.mockReturnValueOnce(pending.promise);
  let operation!: Promise<boolean>;
  act(() => { operation = hook.result.current.advance(); });
  const writes = jest.mocked(cache.set).mock.calls.length;
  act(() => { if (change === 'account') seed('test:other'); else if (change === 'route') hook.rerender({ id: 'echo-2' }); else useWorkspace.setState({ conversations: {} }); });
  await act(async () => { pending.resolve({ workflow: workflow({ revision: 2, state: { step: 'detail', fields: { title: 'Synthetic title' } } }) }); expect(await operation).toBe(false); });
  expect(jest.mocked(cache.set)).toHaveBeenCalledTimes(writes);
  expect(hook.result.current.workflow).toBeUndefined();
});

test('a foreign workflow response is rejected without becoming resumable or exposing the raw error', async () => {
  const runtime = api(); runtime.json.mockReset().mockResolvedValueOnce(command).mockResolvedValue({ workflow: workflow({ conversationId: 'echo-2' }) });
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { expect(await hook.result.current.start('/need')).toBe(false); });
  expect(hook.result.current.workflow).toBeUndefined();
  expect(hook.result.current.feedback.text).toBe('Echo 流程操作失败，请稍后重试。');
  expect(JSON.stringify([...localCache.values()])).not.toContain('wf-1');
});

test('a final confirmation conflict reloads the revision and never resubmits automatically', async () => {
  const runtime = api(); runtime.json.mockReset().mockResolvedValueOnce(command).mockResolvedValue({ workflow: workflow({ revision: 5, state: { step: 'confirm', fields: { title: 'Synthetic title', detail: 'd…' } } }) });
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/need'); });
  runtime.json.mockRejectedValueOnce(new ApiError('workflow.stale_revision', 409)).mockResolvedValueOnce({ workflow: workflow({ revision: 6, state: { step: 'confirm', fields: { title: 'Updated title' } } }) });
  await act(async () => { expect(await hook.result.current.advance(true)).toBe(false); });
  expect(runtime.json.mock.calls.filter(call => String(call[0]).endsWith('/continue'))).toHaveLength(1);
  expect(runtime.json.mock.calls.at(-1)?.[0]).toBe('/api/workspace/workflows/wf-1');
  expect(hook.result.current.workflow?.revision).toBe(6);
  expect(hook.result.current.feedback.text).toContain('重新载入');
});

test('a newer server revision discards old local originals instead of showing them as the current confirmation', async () => {
  const runtime = api();
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/need'); });
  act(() => { hook.result.current.edit('detail', 'Synthetic outdated original'); });
  hook.unmount();
  runtime.json.mockResolvedValueOnce({ workflow: workflow({ revision: 5, state: { step: 'confirm', fields: { title: 'Updated server title', detail: 'u…' } } }) });
  const restored = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await restored.result.current.resume(); });
  expect(restored.result.current.draft.detail).toBeUndefined();
  expect(restored.result.current.draft.title).toBe('Updated server title');
});

test('cancellation clears this workflow draft and does not submit a requirement', async () => {
  const runtime = api();
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/need'); });
  act(() => hook.result.current.edit('title', 'Synthetic draft'));
  runtime.json.mockResolvedValueOnce({ workflow: workflow({ status: 'cancelled', revision: 2 }) });
  await act(async () => { await hook.result.current.cancel(); });
  expect(runtime.json.mock.calls.at(-1)).toEqual(['/api/workspace/workflows/wf-1/cancel', expect.anything(), undefined, 'POST']);
  expect(runtime.json.mock.calls.some(call => String(call[0]).endsWith('/continue'))).toBe(false);
  expect(hook.result.current.canResume).toBe(false);
  expect([...localCache.keys()].some(key => key.includes(':draft:'))).toBe(false);
});

test('the confirmation view explains delivery, hides projected originals, and requires clicking the confirmation button', async () => {
  const runtime = api(); runtime.json.mockReset().mockResolvedValueOnce(command).mockResolvedValue({ workflow: workflow({ state: { step: 'confirm', fields: { title: 'Synthetic title', detail: 'd…', scenario: 's…', expectedResult: 'e…' } } }) });
  const hook = renderHook(() => useEchoWorkflow(runtime, 'echo-1', true));
  await act(async () => { await hook.result.current.start('/need'); });
  const view = render(<EchoWorkflowDialog controller={hook.result.current} />);
  expect(view.getByText(/本人和空间所有者/)).toBeTruthy();
  expect(view.queryByText('d…')).toBeNull();
  expect(runtime.json).toHaveBeenCalledTimes(2);
  await act(async () => fireEvent.press(view.getByText('确认提交')));
  expect(runtime.json.mock.calls.at(-1)?.[2]).toEqual({ expectedRevision: 1, input: { confirm: true, idempotencyKey: 'workflow-wf-1-1' } });
});
