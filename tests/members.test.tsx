import React from 'react';
import { Modal, StyleSheet } from 'react-native';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MembersScreen } from '../src/features/members/screens';
import { Runtime } from '../src/data/runtime';
import { ApiClient, ApiError } from '../src/data/client';
import { memberSchema, type Bootstrap, type Member } from '../src/domain/contracts';
import { useWorkspace } from '../src/domain/store';
import { ThemeProvider } from '../src/ui/theme';

jest.mock('../src/data/runtime', () => ({ Runtime: jest.fn() }));
let mockFocused = true;
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useIsFocused: () => mockFocused }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { environment: 'test', apiOrigin: '', channel: 'internal' } } } }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } };
const person = (id: string, displayName: string, extra: Partial<Member> = {}): Member => memberSchema.parse({
  id, displayName, kind: 'human', nickname: '公开测试昵称', githubLogin: 'synthetic-member',
  roleLabel: '成员', capabilities: { canStartDirectConversation: true }, ...extra,
});
const target = person('u2', '测试成员', { remark: '原备注' });
const self = person('u1', '本人', { capabilities: { canStartDirectConversation: false } });

function seed(members: Member[] = [target], account = 'origin:u1', permissions: Partial<Bootstrap['permissions']> = {}) {
  useWorkspace.getState().applyBootstrap({
    auth: { currentUser: self }, space: { id: 's1', name: '合成空间' }, eventCursor: 0,
    policy: { dailyQuotaBytes: 10, remainingQuotaBytes: 10, messageRetentionCount: 10 },
    permissions: { canReadConversations: true, canCreateDirect: true, canCreateGroup: false, canUpload: false, canDownload: false, ...permissions },
    members, conversations: [], files: [],
  }, account);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  seed();
  const runtime = new Runtime();
  const api = new ApiClient('https://example.invalid', jest.fn(), jest.fn());
  api.json = jest.fn().mockResolvedValue({ members: [] });
  runtime.api = api;
  const open = jest.fn();
  const tree = () => <SafeAreaProvider initialMetrics={metrics}><ThemeProvider mode="light"><MembersScreen runtime={runtime} open={open} /></ThemeProvider></SafeAreaProvider>;
  const view = render(tree());
  return { runtime, api, open, view, tree };
}

function showProfile(view: ReturnType<typeof render>, name = '测试成员') {
  fireEvent.press(view.getByRole('button', { name: `查看 ${name} 的成员资料` }));
  return within(view.getByRole('summary', { name: '成员资料' }));
}

function showRemark(view: ReturnType<typeof render>) {
  fireEvent.press(showProfile(view).getByRole('button', { name: '编辑备注' }));
  return within(view.getByRole('summary', { name: '编辑备注' }));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { cleanup(); useWorkspace.getState().reset(); mockFocused = true; jest.clearAllTimers(); jest.useRealTimers(); });

test('member profile shows only projected public fields and cancel returns without a mutation', () => {
  const { view, api } = setup();
  const profile = showProfile(view);
  expect(profile.getByText('公开测试昵称')).toBeTruthy();
  expect(profile.getByText('@synthetic-member')).toBeTruthy();
  expect(profile.getByText('原备注')).toBeTruthy();
  expect(profile.queryByText('u2')).toBeNull();
  fireEvent.press(profile.getByRole('button', { name: '编辑备注' }));
  const edit = within(view.getByRole('summary', { name: '编辑备注' }));
  fireEvent.changeText(edit.getByLabelText('成员备注'), '未提交输入');
  fireEvent.press(edit.getByRole('button', { name: '取消' }));
  expect(view.getByRole('summary', { name: '成员资料' })).toBeTruthy();
  expect(api.json).not.toHaveBeenCalled();
  fireEvent.press(within(view.getByRole('summary', { name: '成员资料' })).getByRole('button', { name: '关闭资料' }));
  expect(view.queryByRole('summary', { name: '成员资料' })).toBeNull();
});

test('Android dialog back cancels editing just like the explicit cancel button', () => {
  const { view, api } = setup();
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), 'Back取消的草稿');
  const modal = view.UNSAFE_getAllByType(Modal).find(node => node.props.visible);
  expect(modal).toBeDefined();
  fireEvent(modal!, 'requestClose');
  const profile = within(view.getByRole('summary', { name: '成员资料' }));
  fireEvent.press(profile.getByRole('button', { name: '编辑备注' }));
  expect(view.getByLabelText('成员备注').props.value).toBe('原备注');
  expect(api.json).not.toHaveBeenCalled();
});

test('profile entry has 48dp targets and its direct button is a sibling accessibility action', () => {
  const { view } = setup();
  const entry = view.getByRole('button', { name: '查看 测试成员 的成员资料' });
  expect(StyleSheet.flatten(entry.props.style).minHeight).toBeGreaterThanOrEqual(48);
  expect(StyleSheet.flatten(entry.props.style).minWidth).toBeGreaterThanOrEqual(48);
  expect(within(entry).queryByText('发起私聊')).toBeNull();
  expect(view.getByRole('button', { name: '发起私聊' })).toBeTruthy();
});

test('list follows fresh bootstrap members and revalidates a member absent from contacts', async () => {
  const { view } = setup();
  showProfile(view);
  act(() => seed([person('u3', '当前成员')]));
  expect(view.queryByText('测试成员')).toBeNull();
  expect(view.getByText('当前成员')).toBeTruthy();
  expect(view.queryByRole('summary', { name: '成员资料' })).toBeNull();
  await waitFor(() => expect(view.getByText('成员资料暂不可用，请重新选择成员。未提交备注仍保留。')).toBeTruthy());
});

test('ordinary bootstrap updates keep a visible member remark draft and query', () => {
  const { view } = setup();
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '未执行查询');
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), '未提交草稿');
  act(() => seed([{ ...target, nickname: '服务端新昵称' }]));
  expect(view.getByLabelText('成员备注').props.value).toBe('未提交草稿');
  expect(view.getByLabelText('查找可见成员').props.value).toBe('未执行查询');
});

test('discovered member absent from contacts is revalidated after bootstrap without losing edit input', async () => {
  const { view, api } = setup();
  const discovered = person('u4', '可搜索成员');
  jest.mocked(api.json).mockResolvedValueOnce({ members: [discovered] });
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '可搜索');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(view.getByText('可搜索成员')).toBeTruthy());
  fireEvent.press(showProfile(view, '可搜索成员').getByRole('button', { name: '编辑备注' }));
  fireEvent.changeText(view.getByLabelText('成员备注'), '搜索成员草稿');
  const validation = deferred<{ members: Member[] }>();
  jest.mocked(api.json).mockImplementationOnce(() => validation.promise);
  act(() => seed([{ ...target, nickname: '当前昵称' }]));
  expect(view.queryByRole('summary', { name: '编辑备注' })).toBeNull();
  expect(view.getByLabelText('查找可见成员').props.value).toBe('可搜索');
  await act(async () => validation.resolve({ members: [{ ...discovered, nickname: '确认后的昵称' }] }));
  expect(view.getByLabelText('成员备注').props.value).toBe('搜索成员草稿');
  expect(useWorkspace.getState().bootstrap?.members.map(member => member.id)).toEqual(['u2']);
});

test('failed selected validation keeps a private draft that reselecting the same member restores', async () => {
  const { view, api } = setup();
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), '保留到再次验证');
  jest.mocked(api.json).mockRejectedValueOnce(new ApiError('request.network', 0));
  act(() => seed([]));
  await waitFor(() => expect(view.getByText(/无法确认成员资料。未提交备注仍保留。/)).toBeTruthy());
  expect(view.queryByRole('summary', { name: '编辑备注' })).toBeNull();
  jest.mocked(api.json).mockResolvedValueOnce({ members: [target] });
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '合成');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(view.getByRole('summary', { name: '编辑备注' })).toBeTruthy());
  expect(view.getByLabelText('成员备注').props.value).toBe('保留到再次验证');
});

test('bootstrap refresh does not enable duplicate mutations while old remark request is pending', async () => {
  const { view, api } = setup();
  const request = deferred<{ member: Member }>();
  jest.mocked(api.json).mockImplementationOnce(() => request.promise);
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), '刷新时草稿');
  fireEvent.press(edit.getByRole('button', { name: '保存备注' }));
  act(() => seed([{ ...target, nickname: '已刷新' }]));
  fireEvent.press(within(view.getByRole('summary', { name: '编辑备注' })).getByRole('button', { name: '保存备注' }));
  expect(api.json).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve({ member: { ...target, remark: '旧快照返回' } }));
  expect(view.getByLabelText('成员备注').props.value).toBe('刷新时草稿');
  expect(view.getByText('成员范围已更新，请重试此操作。未提交备注仍保留。')).toBeTruthy();
  expect(useWorkspace.getState().bootstrap?.members[0]?.remark).toBe('原备注');
});

test('search ignores a slower older query and query edits invalidate its response', async () => {
  const { api, view } = setup();
  const first = deferred<{ members: Member[] }>();
  const second = deferred<{ members: Member[] }>();
  jest.mocked(api.json).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '第一');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '第二');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  await act(async () => second.resolve({ members: [person('u3', '第二结果')] }));
  await act(async () => first.resolve({ members: [person('u4', '旧结果')] }));
  expect(view.getByText('第二结果')).toBeTruthy();
  expect(view.queryByText('旧结果')).toBeNull();
  expect(api.json).toHaveBeenNthCalledWith(2, '/api/workspace/members?q=%E7%AC%AC%E4%BA%8C', expect.anything());
});

test('editing query without a second request still rejects the old result and its error', async () => {
  const { api, view } = setup();
  const request = deferred<{ members: Member[] }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '旧查询');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '新的输入');
  await act(async () => request.reject(new ApiError('permission.denied', 403)));
  expect(view.queryByText('你当前不能执行此操作')).toBeNull();
  expect(view.getByLabelText('查找可见成员').props.value).toBe('新的输入');
});

test('new bootstrap reissues the same query and rejects the old snapshot result', async () => {
  const { api, view } = setup();
  const old = deferred<{ members: Member[] }>();
  const fresh = deferred<{ members: Member[] }>();
  jest.mocked(api.json).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '当前范围');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  act(() => seed([{ ...target, nickname: '刷新后的联系人' }]));
  await act(async () => old.resolve({ members: [person('u4', '旧范围成员')] }));
  expect(view.queryByText('旧范围成员')).toBeNull();
  await act(async () => fresh.resolve({ members: [person('u3', '当前搜索成员')] }));
  expect(view.getByText('当前搜索成员')).toBeTruthy();
  expect(view.getByLabelText('查找可见成员').props.value).toBe('当前范围');
});

test.each(['account', 'api', 'permission', 'unmount'] as const)('search cannot publish after %s changes', async change => {
  const { api, runtime, view, tree } = setup();
  const request = deferred<{ members: Member[] }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '合成');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  if (change === 'account') act(() => seed([person('u3', '新账号成员')], 'origin:u9'));
  if (change === 'api') { runtime.api = new ApiClient('https://other.invalid', jest.fn(), jest.fn()); view.rerender(tree()); }
  if (change === 'permission') act(() => seed([], 'origin:u1', { canReadConversations: false, canCreateDirect: false }));
  if (change === 'unmount') view.unmount();
  await act(async () => request.resolve({ members: [person('u4', '迟到成员')] }));
  if (change !== 'unmount') expect(view.queryByText('迟到成员')).toBeNull();
  else expect(useWorkspace.getState().bootstrap?.members).toEqual([target]);
});

test('saving remark uses canonical response, then clearing removes the canonical remark', async () => {
  const { api, view } = setup();
  jest.mocked(api.json).mockResolvedValueOnce({ member: { ...target, displayName: '服务端备注', remark: '服务端备注' } });
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), '  输入备注  ');
  fireEvent.press(edit.getByRole('button', { name: '保存备注' }));
  await waitFor(() => expect(view.getByRole('summary', { name: '成员资料' })).toBeTruthy());
  expect(api.json).toHaveBeenCalledWith('/api/workspace/members/u2/remark', expect.anything(), { remark: '输入备注' }, 'PUT');
  expect(within(view.getByRole('summary', { name: '成员资料' })).getAllByText('服务端备注').length).toBeGreaterThan(0);
  expect(useWorkspace.getState().bootstrap?.members[0]?.remark).toBe('服务端备注');
  expect(view.queryByText('成员范围已更新，请重试此操作。未提交备注仍保留。')).toBeNull();
  jest.mocked(api.json).mockResolvedValueOnce({ member: { ...target, displayName: '公开测试昵称', remark: null } });
  fireEvent.press(within(view.getByRole('summary', { name: '成员资料' })).getByRole('button', { name: '编辑备注' }));
  fireEvent.press(within(view.getByRole('summary', { name: '编辑备注' })).getByRole('button', { name: '清除备注' }));
  await waitFor(() => expect(view.getByRole('summary', { name: '成员资料' })).toBeTruthy());
  expect(api.json).toHaveBeenLastCalledWith('/api/workspace/members/u2/remark', expect.anything(), undefined, 'DELETE');
  expect(useWorkspace.getState().bootstrap?.members[0]?.remark).toBeNull();
});

test.each(['保存备注', '清除备注'])('%s failure stays in the editor with input and local feedback', async title => {
  const { api, view } = setup();
  jest.mocked(api.json).mockRejectedValue(new ApiError('permission.denied', 403));
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), '保留的合成输入');
  fireEvent.press(edit.getByRole('button', { name: title }));
  await waitFor(() => expect(edit.getByText('你当前不能执行此操作')).toBeTruthy());
  expect(edit.getByLabelText('成员备注').props.value).toBe('保留的合成输入');
  expect(view.queryByRole('summary', { name: '成员资料' })).toBeNull();
});

test('pending remark blocks duplicate save/clear and account switch discards the response', async () => {
  const { api, view } = setup();
  const request = deferred<{ member: Member }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  const edit = showRemark(view);
  fireEvent.press(edit.getByRole('button', { name: '保存备注' }));
  fireEvent.press(edit.getByRole('button', { name: '清除备注' }));
  expect(api.json).toHaveBeenCalledTimes(1);
  act(() => seed([person('u3', '新账号成员')], 'origin:u9'));
  await act(async () => request.resolve({ member: { ...target, displayName: '旧账号备注', remark: '旧账号备注' } }));
  expect(view.queryByText('旧账号备注')).toBeNull();
  expect(view.queryByRole('summary', { name: '编辑备注' })).toBeNull();
  expect(useWorkspace.getState().bootstrap?.members.map(member => member.id)).toEqual(['u3']);
});

test.each(['api', 'permission', 'unmount'] as const)('remark response is isolated after %s change', async change => {
  const { api, runtime, view, tree } = setup();
  const request = deferred<{ member: Member }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  fireEvent.press(showRemark(view).getByRole('button', { name: '保存备注' }));
  if (change === 'api') { runtime.api = new ApiClient('https://other.invalid', jest.fn(), jest.fn()); view.rerender(tree()); }
  if (change === 'permission') act(() => seed([], 'origin:u1', { canReadConversations: false, canCreateDirect: false }));
  if (change === 'unmount') view.unmount();
  await act(async () => request.resolve({ member: { ...target, remark: '不应回填', displayName: '不应回填' } }));
  expect(useWorkspace.getState().bootstrap?.members.some(member => member.remark === '不应回填')).toBe(false);
  if (change !== 'unmount') expect(view.queryByText('不应回填')).toBeNull();
});

test('wrong-member remark response keeps input and shows a safe local error', async () => {
  const { view, api } = setup();
  jest.mocked(api.json).mockResolvedValue({ member: person('other', '其他资料') });
  const edit = showRemark(view);
  fireEvent.changeText(edit.getByLabelText('成员备注'), '原输入');
  fireEvent.press(edit.getByRole('button', { name: '保存备注' }));
  await waitFor(() => expect(edit.getByText('服务器返回了无法识别的数据（response.invalid）')).toBeTruthy());
  expect(edit.getByLabelText('成员备注').props.value).toBe('原输入');
  expect(useWorkspace.getState().bootstrap?.members).toEqual([target]);
});

test('self and bots do not offer remark editing; direct needs both server capabilities', () => {
  const { view } = setup();
  act(() => seed([self, person('bot', 'Echo', { kind: 'bot', nickname: null, githubLogin: null })]));
  const profile = showProfile(view, '本人');
  expect(profile.queryByRole('button', { name: '编辑备注' })).toBeNull();
  expect(profile.queryByRole('button', { name: '发起私聊' })).toBeNull();
  fireEvent.press(profile.getByRole('button', { name: '关闭资料' }));
  const bot = showProfile(view, 'Echo');
  expect(bot.queryByRole('button', { name: '编辑备注' })).toBeNull();
  fireEvent.press(bot.getByRole('button', { name: '关闭资料' }));
  act(() => seed([target], 'origin:u1', { canCreateDirect: false }));
  expect(showProfile(view).queryByRole('button', { name: '发起私聊' })).toBeNull();
});

const directConversation = {
  id: 'same-direct', type: 'direct', displayTitle: '测试私聊', lastActivityAt: '2026-10-06T00:00:00.000Z',
  notificationLevel: 'all', members: [self, target],
};

test('profile starts the server-returned same direct conversation once and closes the profile', async () => {
  const { api, view, open } = setup();
  const request = deferred<{ conversation: typeof directConversation }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  const profile = showProfile(view);
  fireEvent.press(profile.getByRole('button', { name: '发起私聊' }));
  fireEvent.press(profile.getByRole('button', { name: '发起私聊' }));
  expect(api.json).toHaveBeenCalledTimes(1);
  await act(async () => request.resolve({ conversation: directConversation }));
  expect(api.json).toHaveBeenCalledWith('/api/workspace/conversations', expect.anything(), { type: 'direct', memberIds: ['u2'] }, 'POST');
  expect(open).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenCalledWith('same-direct');
  expect(view.queryByRole('summary', { name: '成员资料' })).toBeNull();
});

test('late direct response cannot navigate or populate conversations after permission revocation', async () => {
  const { api, view, open } = setup();
  const request = deferred<{ conversation: typeof directConversation }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  fireEvent.press(showProfile(view).getByRole('button', { name: '发起私聊' }));
  act(() => seed([target], 'origin:u1', { canCreateDirect: false }));
  await act(async () => request.resolve({ conversation: directConversation }));
  expect(open).not.toHaveBeenCalled();
  expect(useWorkspace.getState().conversations).toEqual({});
});

test.each(['account', 'api', 'unmount'] as const)('direct response cannot navigate after %s change', async change => {
  const { api, runtime, view, tree, open } = setup();
  const request = deferred<{ conversation: typeof directConversation }>();
  jest.mocked(api.json).mockImplementation(() => request.promise);
  fireEvent.press(showProfile(view).getByRole('button', { name: '发起私聊' }));
  if (change === 'account') act(() => seed([target], 'origin:u9'));
  if (change === 'api') { runtime.api = new ApiClient('https://other.invalid', jest.fn(), jest.fn()); view.rerender(tree()); }
  if (change === 'unmount') view.unmount();
  await act(async () => request.resolve({ conversation: directConversation }));
  expect(open).not.toHaveBeenCalled();
  expect(useWorkspace.getState().conversations).toEqual({});
});

test('direct failure remains in the profile, then retry opens the same server conversation', async () => {
  const { api, view, open } = setup();
  jest.mocked(api.json).mockRejectedValueOnce(new ApiError('permission.denied', 403)).mockResolvedValueOnce({ conversation: directConversation });
  const profile = showProfile(view);
  fireEvent.press(profile.getByRole('button', { name: '发起私聊' }));
  await waitFor(() => expect(profile.getByText('你当前不能执行此操作')).toBeTruthy());
  fireEvent.press(profile.getByRole('button', { name: '发起私聊' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith('same-direct'));
  expect(Object.keys(useWorkspace.getState().conversations)).toEqual(['same-direct']);
});

test('blur invalidates a retained-tab direct request and preserves the directory query', async () => {
  const { api, view, tree, open } = setup();
  const request = deferred<{ conversation: typeof directConversation }>();
  jest.mocked(api.json).mockImplementationOnce(() => request.promise);
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '返回时保留');
  fireEvent.press(view.getByRole('button', { name: '发起私聊' }));
  mockFocused = false;
  view.rerender(tree());
  mockFocused = true;
  view.rerender(tree());
  await act(async () => request.resolve({ conversation: directConversation }));
  expect(open).not.toHaveBeenCalled();
  expect(useWorkspace.getState().conversations).toEqual({});
  expect(view.getByLabelText('查找可见成员').props.value).toBe('返回时保留');
});

test('blur invalidates the old query response even if the tab is focused again', async () => {
  const { api, view, tree } = setup();
  const old = deferred<{ members: Member[] }>();
  const fresh = deferred<{ members: Member[] }>();
  jest.mocked(api.json).mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
  fireEvent.changeText(view.getByLabelText('查找可见成员'), '当前查询');
  fireEvent.press(view.getByRole('button', { name: '搜索' }));
  mockFocused = false;
  view.rerender(tree());
  mockFocused = true;
  view.rerender(tree());
  await act(async () => old.resolve({ members: [person('u3', '离开前的迟到结果')] }));
  expect(view.queryByText('离开前的迟到结果')).toBeNull();
  await act(async () => fresh.resolve({ members: [person('u4', '重新确认的结果')] }));
  expect(view.getByText('重新确认的结果')).toBeTruthy();
});
