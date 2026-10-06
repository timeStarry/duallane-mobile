import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, ScrollView, View, useWindowDimensions } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { z } from 'zod';
import { useWorkspace } from '../../domain/store';
import { conversationSchema, memberSchema, type Bootstrap, type Member } from '../../domain/contracts';
import { Runtime } from '../../data/runtime';
import { ApiError, errorText } from '../../data/client';
import { AppHeader, Button, Dialog, InlineFeedback, Input, Label, MemberRow, PageState, styles } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { MemberProfile } from '../../ui/members';

type Activity = {
  api: Runtime['api']; accountKey: string; userId: string | undefined; spaceId: string | undefined;
  canRead: boolean; canDirect: boolean;
  live: boolean; searchInvocation: number; actionInvocation: number; busy: boolean;
};
type ViewModel = {
  activity: Activity; authority: Bootstrap | null; query: string; resultQuery?: string; results?: Member[]; selected?: Member;
  selectedVerified: boolean; drafts: Record<string, string>;
  editing: boolean; remark: string; searching: boolean; pending: boolean; error: string; success: string;
};
const initialView = (activity: Activity, authority: Bootstrap | null): ViewModel => ({
  activity, authority, query: '', selectedVerified: false, drafts: {}, editing: false, remark: '', searching: false, pending: false, error: '', success: '',
});
const membersResponse = z.object({ members: z.array(memberSchema) });
const remarkResponse = z.object({ member: memberSchema });
const directResponse = z.object({ conversation: conversationSchema });

export function MembersScreen({ runtime, open }: { runtime: Runtime; open: (id: string) => void }) {
  const focused = useIsFocused();
  const focus = useRef(focused);
  focus.current = focused;
  const bootstrap = useWorkspace(s => s.bootstrap);
  const accountKey = useWorkspace(s => s.accountKey);
  const activity = useMemo<Activity>(() => ({
    api: runtime.api, accountKey, userId: bootstrap?.auth.currentUser.id, spaceId: bootstrap?.space.id,
    canRead: !!bootstrap?.permissions.canReadConversations, canDirect: !!bootstrap?.permissions.canCreateDirect,
    live: false, searchInvocation: 0, actionInvocation: 0, busy: false,
  }), [runtime.api, accountKey, bootstrap?.auth.currentUser.id, bootstrap?.space.id,
    bootstrap?.permissions.canReadConversations, bootstrap?.permissions.canCreateDirect]);
  const active = useRef(activity);
  active.current = activity;
  const [snapshot, setSnapshot] = useState(() => initialView(activity, bootstrap));
  const model = snapshot.activity === activity ? snapshot : initialView(activity, bootstrap);
  const latestModel = useRef(model);
  latestModel.current = model;
  const items = model.authority === bootstrap && model.results ? model.results : bootstrap?.members ?? [];
  const selected = !focused ? undefined : model.authority === bootstrap ? (model.selectedVerified ? model.selected : undefined) : bootstrap?.members.find(member => member.id === model.selected?.id);
  const t = useTheme();
  const { height } = useWindowDimensions();

  const current = useCallback(() => {
    const state = useWorkspace.getState();
    return activity.live && focus.current && active.current === activity && !!activity.api && runtime.api === activity.api
      && state.accountKey === activity.accountKey && !!state.bootstrap
      && state.bootstrap.space.id === activity.spaceId && state.bootstrap.auth.currentUser.id === activity.userId
      && state.bootstrap.permissions.canReadConversations === activity.canRead && state.bootstrap.permissions.canCreateDirect === activity.canDirect;
  }, [activity, runtime]);
  const publish = useCallback((update: (view: ViewModel) => ViewModel) => {
    if (current()) setSnapshot(previous => current() ? update(previous.activity === activity ? previous : initialView(activity, useWorkspace.getState().bootstrap)) : previous);
  }, [activity, current]);

  useEffect(() => {
    activity.live = true;
    setSnapshot(initialView(activity, useWorkspace.getState().bootstrap));
    return () => { activity.live = false; activity.searchInvocation++; activity.actionInvocation++; };
  }, [activity]);
  useEffect(() => {
    if (focused) return;
    activity.searchInvocation++;
    activity.actionInvocation++;
    activity.busy = false;
    setSnapshot(previous => previous.activity === activity ? { ...previous, selected: undefined, selectedVerified: false,
      editing: false, results: undefined, searching: false, pending: false, error: '', success: '' } : previous);
  }, [activity, focused]);
  useEffect(() => {
    // Contacts are a subset: preserve local input while fresh server search revalidates discovery.
    const previous = latestModel.current;
    const invocation = ++activity.searchInvocation;
    publish(previous => {
      const member = bootstrap?.members.find(item => item.id === previous.selected?.id);
      return { ...previous, authority: bootstrap, results: undefined, selected: member ?? previous.selected,
        selectedVerified: !!member, searching: false, pending: activity.busy, error: '', success: member ? previous.success : '' };
    });
    const contact = bootstrap?.members.find(member => member.id === previous.selected?.id);
    if (!current() || (previous.resultQuery === undefined && (!previous.selected || contact))) return;
    const query = previous.resultQuery ?? (previous.selected?.githubLogin || previous.selected?.nickname || previous.selected?.displayName || '');
    const valid = () => current() && activity.searchInvocation === invocation && useWorkspace.getState().bootstrap === bootstrap;
    publish(view => ({ ...view, searching: true }));
    void activity.api!.json(`/api/workspace/members?q=${encodeURIComponent(query)}`, membersResponse).then(result => {
      if (!valid()) return;
      publish(view => {
        const member = bootstrap?.members.find(item => item.id === view.selected?.id) ?? result.members.find(item => item.id === view.selected?.id);
        return { ...view, results: previous.resultQuery !== undefined ? result.members : undefined,
          selected: member ?? view.selected, selectedVerified: !!member,
          error: view.selected && !member ? '成员资料暂不可用，请重新选择成员。未提交备注仍保留。' : '' };
      });
    }).catch(error => {
      if (valid()) publish(view => ({ ...view, error: `${view.selected && !contact ? '无法确认成员资料。未提交备注仍保留。' : ''}${errorText(error)}` }));
    }).finally(() => {
      if (valid()) publish(view => ({ ...view, searching: false }));
    });
  }, [activity, bootstrap, current, focused, publish]);

  function changeQuery(query: string) {
    activity.searchInvocation++;
    publish(previous => ({ ...previous, query, resultQuery: undefined, results: undefined, searching: false, error: '' }));
  }
  async function search() {
    if (!current()) return;
    const authority = useWorkspace.getState().bootstrap, invocation = ++activity.searchInvocation;
    const valid = () => current() && activity.searchInvocation === invocation && useWorkspace.getState().bootstrap === authority;
    publish(previous => ({ ...previous, resultQuery: model.query, searching: true, error: '' }));
    try {
      const result = await activity.api!.json(`/api/workspace/members?q=${encodeURIComponent(model.query)}`, membersResponse);
      if (valid()) publish(previous => {
        const member = previous.selectedVerified ? previous.selected : result.members.find(item => item.id === previous.selected?.id);
        return { ...previous, authority, results: result.members, selected: member ?? previous.selected, selectedVerified: !!member };
      });
    } catch (error) {
      if (valid()) publish(previous => ({ ...previous, error: errorText(error) }));
    } finally {
      if (valid()) publish(previous => ({ ...previous, searching: false }));
    }
  }
  function select(member: Member) {
    if (!current() || activity.busy || useWorkspace.getState().bootstrap !== bootstrap) return;
    activity.actionInvocation++;
    publish(previous => ({ ...previous, authority: bootstrap, selected: member, selectedVerified: true, editing: false,
      remark: previous.drafts[member.id] ?? member.remark ?? '', error: '', success: '' }));
  }
  function close() {
    if (activity.busy) return;
    activity.actionInvocation++;
    publish(previous => ({ ...previous, selected: undefined, selectedVerified: false, editing: false, error: '', success: '' }));
  }
  function cancelEdit() {
    if (activity.busy) return;
    publish(previous => ({ ...previous, editing: false, error: '',
      drafts: Object.fromEntries(Object.entries(previous.drafts).filter(([id]) => id !== selected?.id)) }));
  }
  const canRemark = !!selected && selected.kind === 'human' && selected.id !== activity.userId;
  const canDirect = !!selected && selected.id !== activity.userId && !!bootstrap?.permissions.canCreateDirect && selected.capabilities.canStartDirectConversation;

  async function saveRemark(clear = false) {
    if (!current() || !canRemark || !selected || activity.busy || useWorkspace.getState().bootstrap !== bootstrap) return;
    const member = selected, authority = useWorkspace.getState().bootstrap, invocation = ++activity.actionInvocation;
    const valid = () => current() && activity.actionInvocation === invocation && useWorkspace.getState().bootstrap === authority;
    let applied = false;
    activity.busy = true;
    publish(previous => ({ ...previous, pending: true, error: '', success: '' }));
    try {
      const result = await activity.api!.json(`/api/workspace/members/${encodeURIComponent(member.id)}/remark`, remarkResponse,
        clear ? undefined : { remark: model.remark.trim() }, clear ? 'DELETE' : 'PUT');
      if (!valid()) return;
      if (result.member.id !== member.id) throw new ApiError('response.invalid', 200);
      applied = true;
      publish(previous => ({ ...previous, selected: result.member, selectedVerified: true, editing: false, remark: result.member.remark ?? '',
        drafts: Object.fromEntries(Object.entries(previous.drafts).filter(([id]) => id !== member.id)),
        results: previous.results?.map(item => item.id === member.id ? result.member : item),
        success: clear ? '成员备注已清除' : '成员备注已保存' }));
      // Only replace an already visible contact; a discovery result does not enlarge the directory.
      if (authority?.members.some(item => item.id === member.id)) useWorkspace.setState({
        bootstrap: { ...authority, members: authority.members.map(item => item.id === member.id ? result.member : item) },
      });
    } catch (error) {
      if (valid()) publish(previous => ({ ...previous, error: errorText(error) }));
    } finally {
      if (current() && activity.actionInvocation === invocation) {
        activity.busy = false;
        publish(previous => ({ ...previous, pending: false,
          error: !applied && useWorkspace.getState().bootstrap !== authority ? '成员范围已更新，请重试此操作。未提交备注仍保留。' : previous.error }));
      }
    }
  }
  async function startDirect(member: Member) {
    if (!current() || activity.busy || useWorkspace.getState().bootstrap !== bootstrap || member.id === activity.userId || !bootstrap?.permissions.canCreateDirect || !member.capabilities.canStartDirectConversation) return;
    const authority = useWorkspace.getState().bootstrap, invocation = ++activity.actionInvocation;
    const valid = () => current() && activity.actionInvocation === invocation && useWorkspace.getState().bootstrap === authority;
    activity.busy = true;
    publish(previous => ({ ...previous, pending: true, error: '', success: '' }));
    try {
      const result = await activity.api!.json('/api/workspace/conversations', directResponse, { type: 'direct', memberIds: [member.id] }, 'POST');
      if (!valid()) return;
      if (result.conversation.type !== 'direct' || !result.conversation.members.some(item => item.id === member.id)
        || !result.conversation.members.some(item => item.id === activity.userId)) throw new ApiError('response.invalid', 200);
      useWorkspace.setState(state => ({ conversations: { ...state.conversations, [result.conversation.id]: result.conversation } }));
      publish(previous => ({ ...previous, selected: undefined, selectedVerified: false, editing: false }));
      open(result.conversation.id);
    } catch (error) {
      if (valid()) publish(previous => ({ ...previous, error: errorText(error) }));
    } finally {
      if (current() && activity.actionInvocation === invocation) {
        activity.busy = false;
        publish(previous => ({ ...previous, pending: false,
          error: useWorkspace.getState().bootstrap !== authority ? '成员范围已更新，请重试此操作。' : previous.error }));
      }
    }
  }
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader title="成员" subtitle="可见联系人范围由服务端决定" includeTopInset />
      <View style={styles.content}>
        <Input accessibilityLabel="查找可见成员" placeholder="查找可见成员" value={model.query} onChangeText={changeQuery} />
        <Button title={model.searching ? '搜索中' : '搜索'} secondary disabled={model.searching || model.pending || !activity.api} onPress={() => void search()} />
        {!selected ? <InlineFeedback text={model.error} tone="danger" /> : null}
      </View>
      <PageState status={items.length ? 'ready' : 'empty'} emptyTitle="当前范围内没有匹配成员" emptyDetail="不会从全群成员推断通讯录。">
        <FlatList style={{ flex: 1 }} data={items} keyExtractor={member => member.id} renderItem={({ item }) => (
          <MemberRow member={item} disabled={model.pending} onPress={() => select(item)}
            onDirect={item.id !== activity.userId && bootstrap?.permissions.canCreateDirect && item.capabilities.canStartDirectConversation ? () => void startDirect(item) : undefined} />
        )} />
      </PageState>
      <Dialog visible={!!selected && !model.editing} title="成员资料" onRequestClose={close} actions={[]}>
        <ScrollView style={{ maxHeight: height * 0.65 }} contentContainerStyle={{ gap: t.space.md }} keyboardShouldPersistTaps="handled">
          {selected ? <MemberProfile member={selected} /> : null}
          <InlineFeedback text={model.error} tone="danger" />
          <InlineFeedback text={model.success} tone="success" />
          <InlineFeedback text={model.pending ? '正在处理，请稍候。' : ''} tone="info" />
          {canRemark ? <Button title="编辑备注" secondary disabled={model.pending} onPress={() => publish(previous => ({ ...previous, editing: true, remark: selected ? previous.drafts[selected.id] ?? selected.remark ?? '' : '', error: '', success: '' }))} /> : null}
          {canDirect ? <Button title="发起私聊" disabled={model.pending} onPress={() => selected && void startDirect(selected)} /> : null}
          <Button title="关闭资料" secondary disabled={model.pending} onPress={close} />
        </ScrollView>
      </Dialog>
      <Dialog visible={!!selected && model.editing} title="编辑备注" onRequestClose={cancelEdit} actions={[]}>
        <ScrollView style={{ maxHeight: height * 0.65 }} contentContainerStyle={{ gap: t.space.md }} keyboardShouldPersistTaps="handled">
          <Label muted>备注只对你可见。</Label>
          <Input accessibilityLabel="成员备注" value={model.remark} editable={!model.pending} onChangeText={remark => publish(previous => ({ ...previous, remark,
            drafts: selected ? { ...previous.drafts, [selected.id]: remark } : previous.drafts }))} />
          <InlineFeedback text={model.error} tone="danger" />
          <InlineFeedback text={model.pending ? '正在处理，请稍候。' : ''} tone="info" />
          <Button title="保存备注" disabled={model.pending || !model.remark.trim()} onPress={() => void saveRemark()} />
          <Button title="清除备注" variant="danger" disabled={model.pending || !selected?.remark} onPress={() => void saveRemark(true)} />
          <Button title="取消" secondary disabled={model.pending} onPress={cancelEdit} />
        </ScrollView>
      </Dialog>
    </View>
  );
}
