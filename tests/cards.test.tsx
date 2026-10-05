import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { WorkspaceCard } from '../src/ui/cards';
import type { Runtime } from '../src/data/runtime';
import { ApiError } from '../src/data/client';

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

test('unknown Echo card types cannot inherit topic or voting actions', async () => {
  const runtime = {
    resolveCard: jest.fn().mockResolvedValue({
      block: { cardType: 'echo.future', schemaVersion: 1, fallbackText: '尚未支持' },
      status: 'active', revision: 1, actions: ['open_topic', 'join_topic', 'vote'],
      payload: { title: '未来卡片', topicId: 'topic-1', options: [{ id: 'opt-1', label: '选项' }] },
    }),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={{ ...block, cardType: 'echo.future' }} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('此卡片暂不支持交互')).toBeTruthy());
  expect(view.queryByRole('button', { name: '打开话题' })).toBeNull();
  expect(view.queryByRole('button', { name: '加入话题' })).toBeNull();
  expect(view.queryByRole('button', { name: '提交投票' })).toBeNull();
});

const requirementBlock = { ...block, cardType: 'echo.request-status', fallbackText: '回声需求 REQ-2026-0001' };
const requirementPayload = {
  publicId: 'REQ-2026-0001', type: 'requirement', title: '合成移动端需求',
  detail: '合成需求详情', scenario: '合成使用场景', expectedResult: '合成期望结果',
  state: 'implemented', phase: 'formal', status: 'delivered', revision: 4,
  response: '合成处理说明',
};

function requirementCard(payload: Record<string, unknown> = requirementPayload, status = 'active') {
  return { block: requirementBlock, status, revision: 4, actions: [], payload };
}

test('canonical Go requirement status cards show member-readable state and response without summary fields', async () => {
  const runtime = { resolveCard: jest.fn().mockResolvedValue(requirementCard()) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('合成移动端需求')).toBeTruthy());
  expect(view.getByText('已交付')).toBeTruthy();
  expect(view.getByText('合成处理说明')).toBeTruthy();
  expect(view.queryByText('delivered')).toBeNull();
});

test('canonical requirement cards show submitted detail, scenario and expected result as separate plain text', async () => {
  const requestBlock = { ...requirementBlock, cardType: 'echo.request' };
  const runtime = { resolveCard: jest.fn().mockResolvedValue({ ...requirementCard(), block: requestBlock }) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requestBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('合成移动端需求')).toBeTruthy());
  expect(view.getByText('合成需求详情')).toBeTruthy();
  expect(view.getByText('合成使用场景')).toBeTruthy();
  expect(view.getByText('合成期望结果')).toBeTruthy();
  expect(view.getByText('合成处理说明')).toBeTruthy();
});

test.each(['expired', 'invalidated'])('unavailable %s requirements do not expose retained business payload', async status => {
  const runtime = {
    resolveCard: jest.fn().mockResolvedValue({ ...requirementCard(requirementPayload, status), actions: ['collect'] }),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText(status === 'expired' ? '卡片已过期' : '卡片已失效')).toBeTruthy());
  expect(view.getByText(requirementBlock.fallbackText)).toBeTruthy();
  for (const body of ['合成移动端需求', '合成需求详情', '合成使用场景', '合成期望结果', '合成处理说明']) {
    expect(view.queryByText(body)).toBeNull();
  }
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
});

test.each([
  ['pending_review', '待处理'], ['planned', '已计划'], ['in_progress', '进行中'], ['delivered', '已交付'], ['archived', '已归档'],
])('requirements translate the canonical %s status into %s', async (status, label) => {
  const runtime = { resolveCard: jest.fn().mockResolvedValue(requirementCard({ title: '合成状态', status, response: null })) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText(label)).toBeTruthy());
  expect(view.queryByText(status)).toBeNull();
  expect(view.queryByText('处理说明')).toBeNull();
});

test.each([
  { title: '合成可选字段' },
  { title: '合成可选字段', status: 'future_state', response: null },
  { title: '合成可选字段', status: '__proto__' },
  { title: '合成可选字段', status: 'toString' },
  { title: '合成可选字段', status: { nested: 'planned' }, detail: ['不能显示'], response: { html: '<script>不能显示</script>' } },
])('missing, unknown or malformed optional requirement fields degrade safely', async payload => {
  const runtime = { resolveCard: jest.fn().mockResolvedValue(requirementCard(payload)) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('状态已更新')).toBeTruthy());
  expect(view.getByText('合成可选字段')).toBeTruthy();
  expect(view.queryByText('future_state')).toBeNull();
  expect(view.queryByText('处理说明')).toBeNull();
  expect(view.queryByText('不能显示')).toBeNull();
});

test('legacy requirement state remains readable when the canonical status is absent', async () => {
  const runtime = { resolveCard: jest.fn().mockResolvedValue(requirementCard({ title: '合成旧状态', state: 'implemented', response: '合成旧处理说明' })) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('已交付')).toBeTruthy());
  expect(view.getByText('合成旧处理说明')).toBeTruthy();
});

test('requirement content has bounded Unicode text fields and does not interpret markup', async () => {
  const payload = { ...requirementPayload, detail: '😀'.repeat(4_001), scenario: '景'.repeat(2_001), expectedResult: '果'.repeat(2_001), response: '<script>合成纯文本</script>' };
  const runtime = { resolveCard: jest.fn().mockResolvedValue(requirementCard(payload)) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('😀'.repeat(4_000) + '…')).toBeTruthy());
  expect(view.getByText('景'.repeat(2_000) + '…')).toBeTruthy();
  expect(view.getByText('果'.repeat(2_000) + '…')).toBeTruthy();
  expect(view.getByText('<script>合成纯文本</script>')).toBeTruthy();
  expect(view.queryByText(payload.detail)).toBeNull();
});

test.each([
  [{ type: 'card_fallback', reason: 'permission_denied' }, '此卡片暂不支持交互'],
  [{ status: undefined }, '此卡片暂不可用'],
  [{ block: { ...requirementBlock, schemaVersion: 2 } }, '此卡片暂不支持交互'],
  [{ block: { ...requirementBlock, cardType: 'echo.future' } }, '此卡片暂不支持交互'],
])('restricted and unsupported projections never contribute their payload', async (overrides, label) => {
  const runtime = { resolveCard: jest.fn().mockResolvedValue({ ...requirementCard(), ...overrides, actions: ['collect'] }) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText(label)).toBeTruthy());
  expect(view.queryByText('合成移动端需求')).toBeNull();
  expect(view.queryByText('合成处理说明')).toBeNull();
  expect(view.queryByText('已交付')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
});

test('switching to a denied card clears the old authorized requirement immediately', async () => {
  const runtime = {
    resolveCard: jest.fn().mockResolvedValueOnce(requirementCard()).mockRejectedValueOnce(new ApiError('permission.denied', 403)),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('合成处理说明')).toBeTruthy());
  view.rerender(<WorkspaceCard block={{ ...requirementBlock, cardId: 'card-denied', fallbackText: '合成受限卡片' }} runtime={runtime} />);
  expect(view.queryByText('合成处理说明')).toBeNull();
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  expect(view.queryByText('合成需求详情')).toBeNull();
});

test('late responses cannot restore the body of a previous card', async () => {
  let resolveOld: (value: ReturnType<typeof requirementCard>) => void = () => undefined;
  const pending = new Promise<ReturnType<typeof requirementCard>>(resolve => { resolveOld = resolve; });
  const runtime = { resolveCard: jest.fn().mockReturnValueOnce(pending).mockRejectedValueOnce(new ApiError('permission.denied', 403)) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  view.rerender(<WorkspaceCard block={{ ...requirementBlock, cardId: 'card-denied' }} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  await act(async () => resolveOld(requirementCard()));
  expect(view.queryByText('合成处理说明')).toBeNull();
});

test('an authorized requirement action refreshes state and response from the latest canonical projection', async () => {
  const initial = { ...requirementCard({ title: '合成流转', status: 'pending_review' }), actions: ['collect'] };
  const updated = requirementCard({ title: '合成流转', status: 'planned', response: '合成最新处理说明' });
  const runtime = { resolveCard: jest.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(updated), cardAction: jest.fn().mockResolvedValue({}) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByRole('button', { name: '转为正式需求' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '转为正式需求' }));
  await waitFor(() => expect(view.getByText('已计划')).toBeTruthy());
  expect(view.getByText('合成最新处理说明')).toBeTruthy();
  expect(view.queryByText('待处理')).toBeNull();
});

test('long processing responses are bounded without discarding their readable beginning', async () => {
  const response = '合成处理说明' + '😀'.repeat(2_000);
  const runtime = { resolveCard: jest.fn().mockResolvedValue(requirementCard({ title: '合成长回复', status: 'delivered', response })) } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('合成处理说明' + '😀'.repeat(1_994) + '…')).toBeTruthy());
  expect(view.queryByText(response)).toBeNull();
});

test('denied actions clear the previously authorized body while ordinary transport failure keeps a retryable card', async () => {
  const initial = { ...requirementCard({ ...requirementPayload, status: 'pending_review' }), actions: ['collect'] };
  const runtime = {
    resolveCard: jest.fn().mockResolvedValue(initial),
    cardAction: jest.fn().mockRejectedValueOnce(new ApiError('request.network', 0, 'net.reset')).mockRejectedValueOnce(new ApiError('permission.denied', 403)),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByRole('button', { name: '转为正式需求' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '转为正式需求' }));
  await waitFor(() => expect(view.getByText('无法连接到服务器，请检查网络后重试（net.reset）')).toBeTruthy());
  expect(view.getByText('合成处理说明')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '转为正式需求' }));
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  expect(view.queryByText('合成处理说明')).toBeNull();
  expect(view.queryByRole('button', { name: '转为正式需求' })).toBeNull();
});

test('a late action from another card cannot request or restore its old body', async () => {
  let finishAction: (value: object) => void = () => undefined;
  const action = new Promise<object>(resolve => { finishAction = resolve; });
  const initial = { ...requirementCard({ ...requirementPayload, status: 'pending_review' }), actions: ['collect'] };
  const runtime = {
    resolveCard: jest.fn().mockResolvedValueOnce(initial).mockRejectedValueOnce(new ApiError('permission.denied', 403)),
    cardAction: jest.fn().mockReturnValue(action),
  } as unknown as Runtime;
  const view = render(<WorkspaceCard block={requirementBlock} runtime={runtime} />);
  await waitFor(() => expect(view.getByRole('button', { name: '转为正式需求' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '转为正式需求' }));
  view.rerender(<WorkspaceCard block={{ ...requirementBlock, cardId: 'card-denied' }} runtime={runtime} />);
  await waitFor(() => expect(view.getByText('你当前不能执行此操作')).toBeTruthy());
  await act(async () => finishAction({}));
  expect(runtime.resolveCard).toHaveBeenCalledTimes(2);
  expect(view.queryByText('合成处理说明')).toBeNull();
});
