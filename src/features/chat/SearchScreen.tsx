import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Pressable, View, type ScrollViewProps } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { AndroidSoftInputModes, KeyboardAwareScrollView, KeyboardController, useKeyboardController, useKeyboardState, useWindowDimensions as useKeyboardWindowDimensions } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, X } from 'lucide-react-native';
import type { Runtime } from '../../data/runtime';
import { clearSearchHistory, deleteSearchHistory, readSearchHistory, recordSearchHistory } from '../../data/search-history';
import type { Conversation, Topic } from '../../domain/contracts';
import { normalizeSearchTerm, SEARCH_SCOPE_TEXT, SEARCH_TERM_LIMIT, searchLoadedWorkspace } from '../../domain/search';
import { useWorkspace } from '../../domain/store';
import { AppHeader, ConversationRow, TopicRow } from '../../ui/chrome';
import { Button, EmptyState, IconButton, InlineFeedback, Input, Label } from '../../ui/primitives';
import { Text } from '../../ui/Text';
import { useTheme } from '../../ui/theme';
import { useFontScale } from '../../platform/font-scale';

type Result = { kind: 'conversation'; conversation: Conversation } | { kind: 'topic'; topic: Topic };

export function SearchScreen({ runtime, open, openTopic, onBack }: {
  runtime: Runtime; open: (id: string) => void; openTopic: (topic: Topic) => void; onBack: () => void;
}) {
  const accountKey = useWorkspace(state => state.accountKey);
  const bootstrap = useWorkspace(state => state.bootstrap);
  const conversations = useWorkspace(state => state.conversations);
  const topics = useWorkspace(state => state.topics);
  const focused = useIsFocused();
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { setEnabled } = useKeyboardController();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const keyboardHeight = useKeyboardState(state => state.height);
  const { width, height } = useKeyboardWindowDimensions();
  const fontScale = useFontScale();
  const list = useRef<FlatList<Result>>(null);
  const inputFocused = useRef(false);
  useFocusEffect(useCallback(() => {
    // The aware scroll surface owns the IME spacer; native pan must not also
    // shift the page. Restore the process default when another route takes over.
    setEnabled(true);
    KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_NOTHING);
    return () => { setEnabled(false); KeyboardController.setDefaultMode(); };
  }, [setEnabled]));
  const renderScrollComponent = useCallback((props: ScrollViewProps) => (
    <KeyboardAwareScrollView {...props} enabled={focused} bottomOffset={t.space.sm} />
  ), [focused, t.space.sm]);
  const spaceId = bootstrap?.space.id ?? '';
  const userId = bootstrap?.auth.currentUser.id ?? '';
  const canRead = bootstrap?.permissions.canReadConversations === true;
  const api = runtime.api;
  const validAccount = !!spaceId && !!userId && accountKey.endsWith(`:${userId}`) && (!api || accountKey === `${api.origin}:${userId}`);
  const context = useMemo(() => ({ runtime, api, accountKey, spaceId, userId }), [runtime, api, accountKey, spaceId, userId]);
  const activity = useMemo(() => ({ context, focused, live: false }), [context, focused]);
  const active = useRef(activity);
  active.current = activity;
  const mounted = useRef(false);
  const autoFocus = useRef(focused && validAccount);
  const refreshed = useRef<typeof context | undefined>(undefined);
  const refreshing = useRef<{ context: typeof context } | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<{ context: typeof context; query: string; history: string[]; error: string }>();
  const [topicFailure, setTopicFailure] = useState<{ context: typeof context; text: string }>();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const currentScope = useCallback(() => {
    const state = useWorkspace.getState();
    return mounted.current && active.current.context === context
      && validAccount && runtime.api === api
      && state.accountKey === accountKey && state.bootstrap?.space.id === spaceId && state.bootstrap.auth.currentUser.id === userId;
  }, [context, accountKey, spaceId, userId, runtime, api, validAccount]);
  const current = useCallback(() => currentScope() && active.current === activity && activity.live && activity.focused, [activity, currentScope]);
  const assureInputVisible = useCallback(() => {
    if (!current() || !inputFocused.current) return;
    // VirtualizedList owns the scroll-component ref. Its public host accessor
    // exposes the aware surface, which refreshes native input bounds first.
    const scroll = list.current?.getNativeScrollRef();
    if (scroll && 'assureFocusedInputVisible' in scroll && typeof scroll.assureFocusedInputVisible === 'function') scroll.assureFocusedInputVisible();
  }, [current]);

  const publishHistory = useCallback((history: string[], query?: string, error = '') => {
    setSnapshot(previous => current() ? {
      context, history, error, query: query ?? (previous?.context === context ? previous.query : ''),
    } : previous);
  }, [context, current]);

  const refreshTopics = useCallback(async () => {
    if (!current() || !api || !useWorkspace.getState().bootstrap?.permissions.canReadConversations || refreshing.current?.context === context) return;
    const attempt = { context };
    refreshing.current = attempt;
    setTopicFailure(undefined);
    try { await runtime.listTopics(); }
    catch {
      // Preserve a same-scope failure while Chat covers this page, so returning
      // can offer an explicit retry without restarting successful requests.
      if (currentScope() && useWorkspace.getState().bootstrap?.permissions.canReadConversations) setTopicFailure({ context, text: '话题暂时无法更新，仍可搜索已加载的内容。' });
    } finally {
      if (refreshing.current === attempt) refreshing.current = undefined;
    }
  }, [api, context, current, currentScope, runtime]);

  useEffect(() => {
    activity.live = true;
    if (current()) {
      try { publishHistory(readSearchHistory(context, current)); }
      catch { publishHistory([], undefined, '本机搜索历史暂时无法读取，仍可筛选已加载的内容。'); }
      if (api && useWorkspace.getState().bootstrap?.permissions.canReadConversations && refreshed.current !== context) {
        refreshed.current = context;
        void refreshTopics();
      }
    }
    return () => { activity.live = false; };
  }, [activity, api, canRead, context, current, publishHistory, refreshTopics]);

  useEffect(() => {
    // A still-focused input need not emit a new focus event after rotation or
    // a font change. Re-read its layout using the same native window metrics
    // as KeyboardAwareScrollView; its spacer remains the only IME offset.
    if (keyboardVisible) assureInputVisible();
  }, [assureInputVisible, keyboardVisible, keyboardHeight, width, height, fontScale]);

  const visible = snapshot?.context === context ? snapshot : undefined;
  const query = visible?.query ?? '';
  const history = visible?.history ?? [];
  const term = normalizeSearchTerm(query);
  const matches = useMemo(() => searchLoadedWorkspace({ accountKey: validAccount ? accountKey : '', bootstrap, conversations, topics }, query), [validAccount, accountKey, bootstrap, conversations, topics, query]);
  const results: Result[] = [...matches.conversations.map(conversation => ({ kind: 'conversation' as const, conversation })), ...matches.topics.map(topic => ({ kind: 'topic' as const, topic }))];
  const remember = (value: string) => {
    if (!current()) return;
    try { publishHistory(recordSearchHistory(context, value, current), normalizeSearchTerm(value)); }
    catch { publishHistory(history, normalizeSearchTerm(value), '本机搜索历史未保存，仍可打开搜索结果。'); }
  };
  const submit = () => {
    if (!current() || !term) return;
    remember(query);
    if (current()) Keyboard.dismiss();
  };
  const openResult = (item: Result) => {
    if (!current()) return;
    const state = useWorkspace.getState();
    if (!state.bootstrap?.permissions.canReadConversations) return;
    if (item.kind === 'conversation') {
      if (!state.conversations[item.conversation.id]) return;
      remember(query);
      if (current()) { Keyboard.dismiss(); open(item.conversation.id); }
    } else {
      const topic = state.topics[item.topic.id];
      if (!topic || topic.conversationId !== item.topic.conversationId || state.conversations[topic.conversationId]?.type !== 'group') return;
      remember(query);
      if (current()) { Keyboard.dismiss(); openTopic(topic); }
    }
  };

  return (
    <View testID="search-page" style={{ flex: 1, paddingTop: insets.top, backgroundColor: t.bg }}>
      <FlatList ref={list} data={results} keyExtractor={item => item.kind === 'conversation' ? `conversation:${item.conversation.id}` : `topic:${item.topic.id}`}
        onLayout={assureInputVisible}
        renderScrollComponent={renderScrollComponent} removeClippedSubviews={false}
        style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: (focused && keyboardVisible ? 0 : insets.bottom) + t.space.lg }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
        ListHeaderComponent={<View>
      <AppHeader title="搜索" includeTopInset={false} leading={<IconButton label="返回" onPress={() => {
        const state = useWorkspace.getState();
        if (active.current === activity && activity.live && activity.focused && state.accountKey === accountKey && runtime.api === api) { Keyboard.dismiss(); onBack(); }
      }}><ChevronLeft size={24} color={t.text} /></IconButton>} />
      <View style={{ padding: t.space.lg, gap: t.space.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Input accessibilityLabel="搜索会话和话题" placeholder="搜索会话和话题" autoFocus={autoFocus.current} style={{ flex: 1 }}
            editable={validAccount} disableFullscreenUI maxLength={SEARCH_TERM_LIMIT} returnKeyType="search" value={query}
            onFocus={() => { inputFocused.current = true; assureInputVisible(); }} onBlur={() => { inputFocused.current = false; }} onLayout={assureInputVisible}
            onChangeText={value => { if (current()) setSnapshot(previous => current() ? { context, query: value, history: previous?.context === context ? previous.history : [], error: '' } : previous); }}
            onSubmitEditing={submit} />
          {query ? <IconButton label="清空搜索关键词" onPress={() => { if (current()) setSnapshot(previous => previous?.context === context ? { ...previous, query: '', error: '' } : previous); }}><X size={20} color={t.muted} /></IconButton> : null}
        </View>
        <Button title="搜索" onPress={submit} disabled={!term || !validAccount} />
        <Label muted>{SEARCH_SCOPE_TEXT}</Label>
        <InlineFeedback text={visible?.error ?? ''} tone="warning" />
        <InlineFeedback text={topicFailure?.context === context ? topicFailure.text : ''} tone="warning" />
        {topicFailure?.context === context && bootstrap?.permissions.canReadConversations ? <Button title="重试加载话题" variant="ghost" onPress={() => { void refreshTopics(); }} /> : null}
      </View>
        {!term ? <View style={{ paddingHorizontal: t.space.lg, gap: t.space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.space.sm }}>
            <Label>本机搜索历史</Label>
            {history.length ? <Button title="清空历史" variant="ghost" onPress={() => {
              if (!current()) return;
              try { clearSearchHistory(context, current); publishHistory([]); }
              catch { publishHistory(history, undefined, '搜索历史未清空，请重试。'); }
            }} /> : null}
          </View>
          {history.map(value => <View key={value.toLowerCase()} style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`搜索历史：${value}`} onPress={() => { remember(value); if (current()) Keyboard.dismiss(); }}
              style={({ pressed }) => ({ flex: 1, minHeight: t.hit, justifyContent: 'center', paddingVertical: t.space.sm, opacity: pressed ? t.pressedOpacity : 1 })}>
              <Text style={{ color: t.text, fontSize: t.type.body }}>{value}</Text>
            </Pressable>
            <IconButton label={`删除搜索历史：${value}`} onPress={() => {
              if (!current()) return;
              try { publishHistory(deleteSearchHistory(context, value, current)); }
              catch { publishHistory(history, undefined, '搜索历史未删除，请重试。'); }
            }}><X size={20} color={t.muted} /></IconButton>
          </View>)}
        </View> : null}
        </View>}
        ListEmptyComponent={<EmptyState title={!validAccount ? '登录后可搜索' : term ? '没有匹配的已加载内容' : history.length ? '输入关键词筛选' : '还没有搜索历史'}
          detail={term ? '试试会话名称、私聊对方姓名或 GitHub 用户名、话题标题或简介；这里只搜索当前可见的已加载内容，不搜索消息正文。' : '提交搜索或打开结果后，关键词仅保存在本机。'} />}
        renderItem={({ item, index }) => <View>
          {(index === 0 || (item.kind === 'topic' && results[index - 1]?.kind !== 'topic')) ? <View style={{ paddingHorizontal: t.space.lg, paddingVertical: t.space.sm }}><Label>{item.kind === 'conversation' ? '会话' : '话题'}</Label></View> : null}
          {item.kind === 'conversation' ? <ConversationRow conversation={item.conversation} selfId={userId} directory={bootstrap?.members} onPress={() => openResult(item)} /> :
            <TopicRow id={item.topic.id} title={item.topic.title} groupName={conversations[item.topic.conversationId]?.displayTitle ?? '群聊'}
              preview={item.topic.descriptionPreview || item.topic.description || (item.topic.joined ? '已加入' : '未加入')}
              joined={item.topic.joined} closed={item.topic.status !== 'open'} unreadCount={item.topic.unreadCount}
              groupEmoji={conversations[item.topic.conversationId]?.avatarEmoji} onPress={() => openResult(item)} />}
        </View>} />
    </View>
  );
}
