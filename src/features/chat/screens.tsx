import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import { useWorkspace } from '../../domain/store';
import { attachmentSchema, parseMessage, targetKey, type Attachment, type ChatTarget, type Draft, type Emote, type EmoteLibrary, type Message, type Topic } from '../../domain/contracts';
import { activeMentionQuery, appendDraftMention, editDraftText, insertDraftMention, mentionCandidates } from '../../domain/compose';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { rememberEmotes } from '../../data/media';
import { Transfers } from '../../data/transfers';
import { conversationIdentity } from '../../ui/chrome';
import { connectionCategory } from '../../ui/connection';
import { groupHiddenWorkspaceMessages } from '../../domain/hidden-messages';
import { formatMessageDayLabel, getMessageDayKey, getMessageGroupPositions, workspaceUnreadIndex } from '../../domain/message-grouping';
import { composerEmotePacks } from '../../domain/emote-catalog';
import { hasOlderMessages, isPinnedToLatest, newestFirstTranscript, shouldLoadOlderHistory, transcriptMode } from '../../domain/transcript-scroll';
import { shouldDirectSendWorkspaceEmote } from '../../domain/emote-send';
import { CatalogEmoteGrid } from '../../ui/CatalogEmoteGrid';
import { useChatIme } from '../../ui/useChatIme';
import {
  AppHeader,
  Button,
  Composer,
  ConnectionBanner,
  ConversationRow,
  Dialog,
  EmptyState,
  FileRow,
  IconButton,
  SettingGroup,
  SettingRow,
  InlineFeedback,
  Input,
  Label,
  Loading,
  MemberRow,
  MessageRow,
  PageState,
  SegmentedControl,
  TopicRow,
  styles,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';
import { useTopicProjections } from './useTopicProjections';
import { recognizeEchoCommand } from '../../domain/echo-workflows';
import { useEchoWorkflow } from '../echo/useEchoWorkflow';
import { EchoWorkflowDialog } from '../echo/EchoWorkflowDialog';
import { AtSign, Bell, BellOff, ChevronLeft, Info, Search } from 'lucide-react-native';

const emptyMessages: Message[] = [];
const emptyDraft: Draft = { text: '', mentionIds: [] };

export function ConversationsScreen({ runtime, open, openTopic }: { runtime: Runtime; open: (id: string) => void; openTopic: (topic: Topic) => void }) {
  const conversations = useWorkspace(s => s.conversations);
  const topics = useWorkspace(s => s.topics);
  const connection = useWorkspace(s => s.connection);
  const selfId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const directory = useWorkspace(s => s.bootstrap?.members);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [list, setList] = useState<'conversations' | 'topics'>('conversations');
  const [error, setError] = useState('');
  const t = useTheme();
  useEffect(() => { if (list === 'topics') void runtime.listTopics().catch(e => setError(errorText(e))); }, [list, runtime]);
  const items = Object.values(conversations).filter(c => c.displayTitle.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const topicItems = Object.values(topics).filter(topic => topic.title.includes(query) || (topic.descriptionPreview ?? '').includes(query));
  const filterLabel = list === 'topics' ? '筛选已加载的话题' : '筛选已加载的会话';
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader
        title="聊天"
        includeTopInset
        trailing={<IconButton label="搜索" onPress={() => setSearchOpen(open => !open)}><Search color={t.muted} size={22} /></IconButton>}
        banner={<ConnectionBanner connection={connection} />}
      />
      <View style={styles.content}>
        <SegmentedControl
          accessibilityLabel="会话与话题"
          value={list}
          options={[{ value: 'conversations', label: '会话' }, { value: 'topics', label: '话题' }]}
          onChange={setList}
        />
        {searchOpen ? <Input accessibilityLabel={filterLabel} placeholder={filterLabel} value={query} onChangeText={setQuery} /> : null}
        <InlineFeedback text={error} tone="danger" />
      </View>
      {list === 'topics' ? (
        <PageState status={topicItems.length ? 'ready' : 'empty'} emptyTitle="还没有话题" emptyDetail="从群详情可以创建话题。未加入的话题不会出现可发送的空列表。">
          <FlatList
            style={{ flex: 1 }}
            data={topicItems}
            keyExtractor={topic => topic.id}
            renderItem={({ item }) => (
              <TopicRow
                id={item.id}
                title={item.title}
                groupName={conversations[item.conversationId]?.displayTitle ?? '群聊'}
                preview={item.descriptionPreview || item.description || (item.joined ? '已加入' : '未加入')}
                joined={item.joined}
                closed={item.status !== 'open'}
                unreadCount={item.unreadCount}
                groupEmoji={conversations[item.conversationId]?.avatarEmoji}
                onPress={() => openTopic(item)}
              />
            )}
          />
        </PageState>
      ) : (
        <PageState status={items.length ? 'ready' : 'empty'} emptyTitle="还没有会话" emptyDetail="可以从成员列表发起私聊。">
          <FlatList style={{ flex: 1 }} data={items} keyExtractor={c => c.id} renderItem={({ item }) => <ConversationRow conversation={item} selfId={selfId} directory={directory} onPress={() => open(item.id)} />} />
        </PageState>
      )}
    </View>
  );
}

export function ChatScreen({
  target,
  runtime,
  transfers,
  details,
  onOpenTopic,
  onPreview,
  focusMessageId,
}: {
  target: ChatTarget;
  runtime: Runtime;
  transfers: Transfers;
  details: () => void;
  onOpenTopic?: (topicId: string) => void;
  onPreview?: (file: import('../../domain/contracts').Attachment) => void;
  focusMessageId?: string;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [emotePack, setEmotePack] = useState('custom');
  const key = targetKey(target);
  const conversation = useWorkspace(s => s.conversations[target.kind === 'conversation' ? target.id : target.conversationId]);
  const topic = useWorkspace(s => target.kind === 'topic' ? s.topics[target.id] : undefined);
  const messages = useWorkspace(s => s.messages[key] ?? emptyMessages);
  const draft = useWorkspace(s => s.drafts[key] ?? emptyDraft);
  const connection = useWorkspace(s => s.connection);
  const accountKey = useWorkspace(s => s.accountKey);
  const bootstrapMembers = useWorkspace(s => s.bootstrap?.members ?? []);
  const members = conversation?.members.length ? conversation.members : bootstrapMembers;
  const mentionQuery = activeMentionQuery(draft.text);
  const suggestions = mentionQuery !== null ? mentionCandidates(mentionQuery, members) : [];
  const focused = useIsFocused();
  const ime = useChatIme(insets.bottom, suggestions.length, mentionQuery ?? '');
  const projections = useTopicProjections(runtime, target, focused);
  const echo = useEchoWorkflow(runtime, target.kind === 'conversation' ? target.id : undefined, focused);
  const echoRoute = useRef({ key, accountKey, focused });
  echoRoute.current = { key, accountKey, focused };
  const [loading, setLoading] = useState(() => useWorkspace.getState().messages[key] === undefined);
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(() => hasOlderMessages(useWorkspace.getState().messages[key]?.length ?? 0));
  const [progress, setProgress] = useState('');
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const [library, setLibrary] = useState<EmoteLibrary | null>(null);
  const chatSettings = useWorkspace(s => s.chatSettings);
  const [syncToGroup, setSyncToGroup] = useState(false);
  const list = useRef<FlatList>(null);
  const pinToLatest = useRef(!focusMessageId);
  const [pinnedToLatest, setPinnedToLatest] = useState(!focusMessageId);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const readQueue = useRef(Promise.resolve());
  const readMarker = useRef<{ accountKey: string; key: string; messageId: string } | undefined>(undefined);
  const draggingTranscript = useRef(false);
  const historyReady = useRef(false);
  const [newMessages, setNewMessages] = useState(false);
  const focusInvocation = useRef(0);
  const [focusRequest, setFocusRequest] = useState<{ key: string; accountKey: string; messageId: string; invocation: number }>();
  const [resolvedFocus, setResolvedFocus] = useState<typeof focusRequest>();
  const targetId = target.id;
  const targetKind = target.kind;
  const targetConversationId = target.kind === 'topic' ? target.conversationId : target.id;
  useEffect(() => {
    let active = true;
    setLoading(useWorkspace.getState().messages[key] === undefined);
    void (async () => {
      try {
        const count = targetKind === 'topic' ? await runtime.openTopic(targetId) : await runtime.open(targetId);
        if (active) setHasOlder(hasOlderMessages(count ?? 0));
      } catch (e) { if (active) setError(errorText(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [runtime, targetId, targetKind, key]);
  useEffect(() => {
    pinToLatest.current = !focusMessageId;
    setPinnedToLatest(!focusMessageId);
    draggingTranscript.current = false;
    historyReady.current = false;
    setNewMessages(!!focusMessageId);
    setResolvedFocus(undefined);
    const invocation = ++focusInvocation.current;
    setFocusRequest(focusMessageId ? { key, accountKey, messageId: focusMessageId, invocation } : undefined);
    setHasOlder(hasOlderMessages(useWorkspace.getState().messages[key]?.length ?? 0));
  }, [accountKey, focusMessageId, key]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => listener.remove();
  }, []);
  useEffect(() => {
    void Promise.all([runtime.emotes(), runtime.emoteLibrary()]).then(([list, nextLibrary]) => {
      const collected = [...list.items, ...nextLibrary.emotes, ...nextLibrary.collections.flatMap(collection => collection.items)];
      rememberEmotes(collected);
      setEmotes(list.items);
      setLibrary(nextLibrary);
    }).catch(() => {
      void runtime.emotes().then(result => {
        rememberEmotes(result.items);
        setEmotes(result.items);
      }).catch(() => undefined);
    });
  }, [runtime]);
  const selfId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const identity = conversation ? conversationIdentity(conversation, selfId, members) : undefined;
  const lastId = messages.at(-1)?.id;
  const lastStatus = messages.at(-1)?.status;
  const mode = transcriptMode(hasOlder);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const scrollToLatest = useCallback((animated: boolean) => {
    focusInvocation.current += 1;
    setFocusRequest(undefined);
    setResolvedFocus(undefined);
    pinToLatest.current = true;
    setPinnedToLatest(true);
    setNewMessages(false);
    if (modeRef.current === 'history') list.current?.scrollToOffset({ offset: 0, animated });
    else list.current?.scrollToEnd({ animated });
  }, []);
  const applyUserOffset = (event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const pinned = isPinnedToLatest({
      mode: modeRef.current,
      offsetY: contentOffset.y,
      contentHeight: contentSize.height,
      layoutHeight: layoutMeasurement.height,
    });
    pinToLatest.current = pinned;
    setPinnedToLatest(pinned);
    setNewMessages(show => {
      const next = !pinned;
      return show === next ? show : next;
    });
  };
  const pinIfNeeded = () => {
    if (!pinToLatest.current) return;
    if (modeRef.current === 'history') list.current?.scrollToOffset({ offset: 0, animated: false });
    else list.current?.scrollToEnd({ animated: false });
  };
  useEffect(() => {
    if (!lastId) return;
    if (pinToLatest.current) pinIfNeeded();
    else setNewMessages(true);
  }, [key, lastId]);
  const canRead = !!conversation && (target.kind !== 'topic' || !!topic?.joined);
  const online = ['connected', 'http_sync'].includes(connectionCategory(connection) ?? '');
  useEffect(() => {
    if (!lastId || lastStatus || !canRead || !focused || !foreground || !online || !pinnedToLatest || !pinToLatest.current) return;
    let cancelled = false;
    // Serialize markers so an older response cannot overwrite a newer read cursor.
    readQueue.current = readQueue.current.then(async () => {
      const state = useWorkspace.getState();
      if (cancelled || !pinToLatest.current || AppState.currentState !== 'active' || state.accountKey !== accountKey || state.messages[key]?.at(-1)?.id !== lastId) return;
      const previous = readMarker.current;
      if (previous?.accountKey === accountKey && previous.key === key && previous.messageId === lastId) return;
      const marker = { accountKey, key, messageId: lastId };
      readMarker.current = marker;
      try { await runtime.markRead(target.id, lastId, target.kind === 'topic'); }
      catch { if (readMarker.current === marker) readMarker.current = undefined; }
    });
    return () => { cancelled = true; };
  }, [accountKey, canRead, focused, foreground, key, lastId, lastStatus, online, pinnedToLatest, runtime, target.id, target.kind]);
  const reply = draft.replyToMessageId ? messages.find(item => item.id === draft.replyToMessageId) : undefined;
  const canSend = target.kind === 'topic' ? !!topic?.joined && topic.status === 'open' : !!conversation?.capabilities.canSendMessage;
  const send = (existing?: Message) => {
    const latest = existing ? draft : useWorkspace.getState().drafts[key] ?? draft;
    if (!existing && !latest.text.trim() && !latest.pendingAttachment) return;
    setError('');
    const echoCommand = !existing && target.kind === 'conversation' ? recognizeEchoCommand(conversation, latest.text) : null;
    if (echoCommand) {
      if (latest.pendingAttachment) { setError('Echo 命令不支持附件，请先移除附件。'); return; }
      if (!echo.available) { setError('Echo 交互当前不可用，请稍后重试。'); return; }
      const api = runtime.api;
      void echo.start(echoCommand).then(accepted => {
        const state = useWorkspace.getState();
        const route = echoRoute.current;
        if (accepted && route.key === key && route.accountKey === accountKey && route.focused && runtime.api === api && state.accountKey === accountKey && state.bootstrap?.permissions.canReadConversations && state.conversations[key]?.capabilities.canSendMessage && state.drafts[key] === latest) runtime.patchDraft(key, { text: '', mentionIds: [], mentionSpans: [], replyToMessageId: undefined });
      });
      return;
    }
    focusInvocation.current += 1;
    setFocusRequest(undefined);
    setResolvedFocus(undefined);
    pinToLatest.current = true;
    setPinnedToLatest(true);
    setNewMessages(false);
    const uploadTaskId = existing?.pendingUploadTaskId ?? latest.pendingAttachment?.taskId;
    const task = uploadTaskId ? transfers.tasks(useWorkspace.getState().accountKey).find(item => item.id === uploadTaskId) : undefined;
    const needsUpload = !!uploadTaskId && !existing?.attachments[0];
    void runtime.send(target.kind === 'conversation' ? target.id : target.conversationId, existing?.plainText ?? latest.text, existing, existing?.attachments[0]?.id, {
      topicId: target.kind === 'topic' ? target.id : undefined,
      replyToMessageId: existing?.replyToMessageId ?? latest.replyToMessageId,
      mentionIds: latest.mentionIds,
      mentionSpans: latest.mentionSpans,
      syncToGroup: target.kind === 'topic' && (existing?.pendingSyncToGroup ?? syncToGroup),
      uploadTaskId,
      upload: needsUpload ? () => {
        const api = runtime.api;
        const account = useWorkspace.getState().accountKey;
        if (!api || !task) return Promise.reject(new Error('Upload unavailable'));
        setProgress('上传中');
        return transfers.run(api, account, task, n => setProgress(`上传 ${Math.round(n * 100)}%`)).finally(() => setProgress(''));
      } : undefined,
    }).catch(e => setError(errorText(e)));
  };
  const unreadId = target.kind === 'topic' ? topic?.lastReadMessageId : conversation?.lastReadMessageId;
  const unreadCount = target.kind === 'topic' ? topic?.unreadCount ?? 0 : conversation?.unreadCount ?? 0;
  const unreadIndex = workspaceUnreadIndex(messages, unreadId, unreadCount);
  const groupPositions = getMessageGroupPositions(messages, unreadIndex);
  const displayItems = useMemo(() => groupHiddenWorkspaceMessages(messages), [messages]);
  const transcriptItems = useMemo(() => newestFirstTranscript(displayItems), [displayItems]);
  const listItems = mode === 'history' ? transcriptItems : displayItems;
  const replyToMessage = (message: Message) => {
    const current = useWorkspace.getState().drafts[key] ?? draft;
    const next = { ...current, replyToMessageId: message.id };
    runtime.patchDraft(key, conversation && useWorkspace.getState().chatSettings?.replyAutoMention && message.authorId && message.authorName
      ? appendDraftMention(next, { id: message.authorId, displayName: message.authorName })
      : next);
  };
  const locateMessage = (messageId: string) => {
    pinToLatest.current = false;
    setPinnedToLatest(false);
    setNewMessages(true);
    setError('');
    setResolvedFocus(undefined);
    setFocusRequest({ key, accountKey, messageId, invocation: ++focusInvocation.current });
  };
  useEffect(() => {
    if (!focusRequest || focusRequest.key !== key || focusRequest.accountKey !== accountKey || loading) return;
    let cancelled = false;
    const { messageId, invocation } = focusRequest;
    const current = () => !cancelled && invocation === focusInvocation.current && useWorkspace.getState().accountKey === accountKey;
    const locate = async () => {
      if (!useWorkspace.getState().messages[key]?.some(message => message.id === messageId)) {
        const api = runtime.api;
        if (!api) { if (current()) setError('原消息不可用'); return; }
        const path = target.kind === 'topic'
          ? `/api/workspace/topics/${encodeURIComponent(target.id)}/messages?around=${encodeURIComponent(messageId)}&limit=50`
          : `/api/workspace/conversations/${encodeURIComponent(target.id)}/messages?around=${encodeURIComponent(messageId)}&limit=50`;
        let loaded = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const previous = useWorkspace.getState().messages[key];
          const response = await api.json(path, z.object({ messages: z.array(z.unknown()) }));
          const state = useWorkspace.getState();
          if (!current() || runtime.api !== api || !state.bootstrap?.permissions.canReadConversations || !state.conversations[targetConversationId] || (target.kind === 'topic' && !state.topics[target.id]?.joined)) return;
          // A delayed history page must not restore content changed by a canonical event.
          if (state.messages[key] !== previous) {
            if (state.messages[key]?.some(message => message.id === messageId)) { loaded = true; break; }
            continue;
          }
          const found = response.messages.map(parseMessage).filter((message): message is Message => !!message && message.conversationId === targetConversationId && (target.kind === 'topic' ? message.topicId === target.id : !message.topicId));
          if (!found.some(message => message.id === messageId)) { setError('原消息不可用'); return; }
          useWorkspace.getState().setMessages(key, found, true);
          loaded = true;
          break;
        }
        if (!loaded) { setError('消息正在同步，请重试定位。'); return; }
      }
      if (!current()) return;
      const message = useWorkspace.getState().messages[key]?.find(item => item.id === messageId);
      if (!message || message.hiddenByCurrentUser) { setError(message ? '原消息已隐藏，请先恢复后再定位。' : '原消息不可用'); return; }
      setResolvedFocus(focusRequest);
    };
    void locate().catch(() => { if (current()) setError('原消息不可用'); });
    return () => { cancelled = true; };
  }, [accountKey, focusRequest, key, loading, runtime, target.id, target.kind, targetConversationId]);
  useEffect(() => {
    if (!resolvedFocus || resolvedFocus.key !== key || resolvedFocus.invocation !== focusInvocation.current) return;
    const index = listItems.findIndex(entry => entry.kind === 'message' && entry.message.id === resolvedFocus.messageId);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      if (resolvedFocus.invocation !== focusInvocation.current) return;
      list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      setResolvedFocus(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, listItems, resolvedFocus]);
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader
        includeTopInset
        title={topic?.title ?? conversation?.displayTitle ?? '会话'}
        subtitle={target.kind === 'topic' ? (topic?.joined ? `话题 · ${conversation?.displayTitle ?? ''}` : '未加入，只能查看摘要') : conversation?.type === 'group' ? `${conversation.members.length} 位成员` : undefined}
        identity={identity}
        leading={(
          <IconButton label="返回" onPress={() => navigation.goBack()}>
            <ChevronLeft color={t.text} size={24} />
          </IconButton>
        )}
        trailing={(
          <IconButton label="会话详情" onPress={details}>
            <Info color={t.shared} size={22} />
          </IconButton>
        )}
        banner={<ConnectionBanner connection={connection} />}
      />
      <InlineFeedback text={error || progress || projections.feedback.text} tone={error ? 'danger' : progress ? 'info' : projections.feedback.tone} />
      {loading && <Loading />}
      {target.kind === 'topic' && topic && !topic.joined ? (
        <View>
          <EmptyState title="尚未加入该话题" detail={topic.descriptionPreview || '加入后才能阅读和发送。'} />
          {topic.canJoin ? <Button title="加入讨论" onPress={() => void runtime.joinTopic(topic.id).then(() => runtime.openTopic(topic.id)).catch(e => setError(errorText(e)))} /> : null}
        </View>
      ) : (
        <FlatList
          key={`${key}:${mode}`}
          ref={list}
          inverted={mode === 'history'}
          data={listItems}
          keyExtractor={item => item.kind === 'hidden' ? `hidden:${item.sourceIndex}` : item.message.id}
          keyboardShouldPersistTaps="handled"
          onScrollBeginDrag={() => {
            focusInvocation.current += 1;
            setFocusRequest(undefined);
            setResolvedFocus(undefined);
            draggingTranscript.current = true;
            historyReady.current = true;
          }}
          onScrollEndDrag={e => {
            draggingTranscript.current = false;
            applyUserOffset(e);
          }}
          onMomentumScrollEnd={e => {
            draggingTranscript.current = false;
            applyUserOffset(e);
          }}
          onScroll={e => {
            if (!draggingTranscript.current) return;
            applyUserOffset(e);
          }}
          scrollEventThrottle={100}
          onLayout={pinIfNeeded}
          onContentSizeChange={pinIfNeeded}
          onEndReached={() => {
            if (!shouldLoadOlderHistory({ historyReady: historyReady.current, hasOlder, messageCount: messages.length })) return;
            const first = messages[0]?.id;
            void (target.kind === 'topic' ? runtime.topicMessages(target.id, first) : runtime.messages(target.id, first)).then(count => setHasOlder(hasOlderMessages(count))).catch(e => setError(errorText(e)));
          }}
          onEndReachedThreshold={0.2}
          onScrollToIndexFailed={event => list.current?.scrollToOffset({ offset: Math.max(0, event.averageItemLength * event.index), animated: false })}
          ListFooterComponent={mode === 'history' && messages.length > 0 ? <Button title="加载更早消息" secondary onPress={() => { const first = messages[0]?.id; void (target.kind === 'topic' ? runtime.topicMessages(target.id, first) : runtime.messages(target.id, first)).then(count => setHasOlder(hasOlderMessages(count))).catch(e => setError(errorText(e))); }} /> : null}
          ListEmptyComponent={!loading ? <EmptyState title="还没有消息" /> : null}
          renderItem={({ item }) => {
            if (item.kind === 'hidden') {
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`恢复${item.messages.length}条已隐藏消息`}
                  onPress={() => {
                    void Promise.all(item.messages.map((hidden: Message) => runtime.hide(hidden.id, false))).catch(error => setError(errorText(error)));
                  }}
                  style={{ paddingVertical: 12, alignItems: 'center' }}
                >
                  <Text style={{ color: t.muted, fontSize: t.type.meta }}>{item.messages.length} 条已隐藏，点按恢复</Text>
                </Pressable>
              );
            }
            const sourceIndex = item.sourceIndex;
            const previousDay = sourceIndex > 0 ? getMessageDayKey(messages[sourceIndex - 1]?.createdAt) : '';
            const dayKey = getMessageDayKey(item.message.createdAt);
            return (
              <MessageRow
                message={item.message}
                groupPosition={groupPositions[sourceIndex]}
                showUnread={unreadIndex >= 0 && sourceIndex === unreadIndex}
                dayLabel={dayKey && dayKey !== previousDay ? formatMessageDayLabel(item.message.createdAt) : undefined}
                runtime={runtime}
                retry={() => send(item.message)}
                onReply={replyToMessage}
                onOpenTopic={onOpenTopic}
                locate={locateMessage}
                onToggleProjection={projections.canToggle(item.message) ? () => { setError(''); void projections.toggle(item.message.id); } : undefined}
                isProjected={projections.isProjected(item.message.id)}
                projectionBusy={projections.isBusy(item.message.id)}
                onPreview={onPreview}
                download={file => {
                  const api = runtime.api;
                  if (api) void transfers.download(api, useWorkspace.getState().accountKey, file).catch(e => setError(errorText(e)));
                }}
              />
            );
          }}
        />
      )}
      {newMessages && <Button title="回到最新" secondary onPress={() => scrollToLatest(true)} />}
      {canSend ? (
        <View style={{ paddingBottom: ime.dock.dockBottom }}>
          {echo.available ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space.sm, paddingHorizontal: 16, paddingTop: t.space.sm }}>
            <Button title="提交需求" secondary disabled={echo.busy} onPress={() => { void echo.start('/need'); }} />
            <Button title="反馈问题" secondary disabled={echo.busy} onPress={() => { void echo.start('/feedback'); }} />
            {echo.canResume ? <Button title="继续 Echo 流程" secondary disabled={echo.busy} onPress={() => { void echo.resume(); }} /> : null}
          </View> : null}
          {draft.mentionSpans === undefined && draft.mentionIds.length > 0 ? (
            <View style={{ paddingHorizontal: 16 }}><Label muted>旧草稿中的提及请重新选择成员</Label></View>
          ) : null}
          {target.kind === 'topic' && topic?.allowSyncToGroup ? (
            <Pressable accessibilityRole="button" onPress={() => setSyncToGroup(value => !value)} style={{ paddingHorizontal: 16, minHeight: 40, justifyContent: 'center' }}>
              <Label muted>{syncToGroup ? '将同步到群聊' : '默认只发到话题，点按改为同步到群'}</Label>
            </Pressable>
          ) : null}
          <Composer
            value={draft.text}
            onChangeText={text => runtime.patchDraft(key, editDraftText(useWorkspace.getState().drafts[key] ?? draft, text))}
            onSend={() => send()}
            sendDisabled={!draft.text.trim() && !draft.pendingAttachment}
            attachDisabled={!conversation?.capabilities.canUploadFile || !!progress}
            reply={reply ? { author: reply.authorName, preview: reply.hiddenByCurrentUser ? '已隐藏的消息' : reply.recalledAt ? '已撤回的消息' : reply.plainText } : undefined}
            onClearReply={() => runtime.patchDraft(key, { replyToMessageId: undefined })}
            attachmentName={draft.pendingAttachment?.fileName}
            onClearAttachment={() => {
              const attachment = useWorkspace.getState().drafts[key]?.pendingAttachment;
              runtime.patchDraft(key, { pendingAttachment: undefined });
              const task = attachment && transfers.tasks(useWorkspace.getState().accountKey).find(item => item.id === attachment.taskId);
              if (task && runtime.api) void transfers.cancel(runtime.api, useWorkspace.getState().accountKey, task).catch(e => setError(errorText(e)));
            }}
            onEmote={() => ime.openPanel('emoji')}
            onAttach={() => ime.openPanel('attach')}
          />
          <View style={{ height: ime.dock.panelHeight, overflow: 'hidden', backgroundColor: t.elevated }}>
            {ime.panel === 'emoji' ? (
              <CatalogEmoteGrid
                packs={composerEmotePacks(library ?? { emotes, collections: [], entries: emotes.map(emote => ({ id: emote.id, type: 'emote', emote })) }, chatSettings?.enabledPackIds)}
                selectedPackId={emotePack}
                onSelectPack={setEmotePack}
                onPick={(item, packId) => {
                  const token = item.token ?? item.value ?? `[${packId}:${item.id}]`;
                  const enabled = useWorkspace.getState().chatSettings?.clickImageEmoteToSend ?? false;
                  if (shouldDirectSendWorkspaceEmote(item, packId, enabled)) {
                    runtime.patchDraft(key, editDraftText(useWorkspace.getState().drafts[key] ?? draft, token));
                    send();
                    ime.closePanel();
                    return;
                  }
                  const current = useWorkspace.getState().drafts[key] ?? draft;
                  runtime.patchDraft(key, editDraftText(current, `${current.text}${token}`));
                }}
              />
            ) : null}
            {ime.panel === 'attach' ? (
              <View style={{ padding: 16 }}>
                <Button
                  title="选择文件"
                  secondary
                  disabled={!conversation?.capabilities.canUploadFile || !!progress}
                  onPress={() => {
                    const account = useWorkspace.getState().accountKey;
                    void transfers.choose(account, target.kind === 'topic' ? undefined : conversation?.id, target.kind === 'topic' ? 'private_staging' : undefined).then(task => {
                      if (!task) return;
                      const previous = useWorkspace.getState().drafts[key]?.pendingAttachment;
                      const previousTask = previous && transfers.tasks(account).find(item => item.id === previous.taskId);
                      if (previousTask && runtime.api) void transfers.cancel(runtime.api, account, previousTask).catch(e => setError(errorText(e)));
                      runtime.patchDraft(key, { pendingAttachment: { taskId: task.id, fileName: task.fileName, mimeType: task.mimeType, byteSize: task.byteSize } });
                      ime.closePanel();
                    }).catch(e => setError(errorText(e)));
                  }}
                />
              </View>
            ) : null}
            {ime.panel === 'mention' ? (
            <ScrollView keyboardShouldPersistTaps="handled">
            {suggestions.map(member => (
              <Pressable
                key={member.id}
                accessibilityRole="button"
                accessibilityLabel={`提及${member.displayName}`}
                onPress={() => {
                  runtime.patchDraft(key, insertDraftMention(useWorkspace.getState().drafts[key] ?? draft, member));
                  ime.closePanel();
                }}
                style={{ minHeight: t.hit, paddingHorizontal: 16, justifyContent: 'center' }}
              >
                <Text style={{ color: t.text }}>{member.displayName}{member.kind === 'bot' ? ' · Bot' : ''}</Text>
              </Pressable>
            ))}
            </ScrollView>
            ) : null}
          </View>
        </View>
      ) : <EmptyState title={target.kind === 'topic' ? '当前话题不可发送' : '当前会话不可发送消息'} />}
      <EchoWorkflowDialog controller={echo} />
    </View>
  );
}

export function DetailsScreen({ id, runtime, kind = 'conversation', onCreateTopic, onOpenTopic, onOpenPinnedMessage, onOpenFile, onDownloadFile }: { id: string; runtime: Runtime; kind?: 'conversation' | 'topic'; onCreateTopic?: (topic: Topic) => void; onOpenTopic?: (topic: Topic) => void; onOpenPinnedMessage?: (messageId: string) => void; onOpenFile?: (file: Attachment) => void; onDownloadFile?: (file: Attachment) => void }) {
  const conversation = useWorkspace(s => s.conversations[id]);
  const topic = useWorkspace(s => s.topics[id]);
  const topics = useWorkspace(s => s.topics);
  const focused = useIsFocused();
  const t = useTheme();
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [leave, setLeave] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [files, setFiles] = useState<Attachment[]>([]);
  useEffect(() => {
    if (!focused || kind !== 'conversation' || conversation?.type !== 'group') return;
    let cancelled = false;
    const load = async () => {
      const api = runtime.api;
      if (!api) return;
      const results = await Promise.allSettled([
        api.json(`/api/workspace/groups/${encodeURIComponent(id)}/pins`, z.object({ pins: z.array(z.object({ message: z.unknown() })) })),
        runtime.listTopics(id),
      ]);
      if (cancelled) return;
      if (results[0].status === 'fulfilled') setPins(results[0].value.pins.map(pin => parseMessage(pin.message)).filter((message): message is Message => !!message && message.conversationId === id));
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') setError(errorText(failed.reason));
    };
    void load();
    return () => { cancelled = true; };
  }, [conversation?.type, focused, id, kind, runtime]);
  useEffect(() => {
    if (!focused || kind !== 'conversation' || !conversation?.id) return;
    let cancelled = false;
    const api = runtime.api;
    if (api) void api.json(`/api/workspace/files?scope=conversation&conversationId=${encodeURIComponent(id)}&limit=50`, z.object({ files: z.array(attachmentSchema) }))
      .then(result => { if (!cancelled) setFiles(result.files); })
      .catch(error => { if (!cancelled) setError(errorText(error)); });
    return () => { cancelled = true; };
  }, [conversation?.id, focused, id, kind, runtime]);
  const level = (kind === 'topic' ? topic?.notificationLevel : conversation?.notificationLevel) ?? 'muted';
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={{ paddingVertical: 16, gap: 20 }}>
      <View style={styles.content}>
        <Text style={[styles.section, { color: t.text }]}>{kind === 'topic' ? topic?.title : conversation?.displayTitle}</Text>
        {kind === 'topic' ? <Label muted>{topic?.joined ? '已加入' : '未加入'} · {topic?.status === 'open' ? '进行中' : '已关闭'}</Label> : <Label>{conversation?.retentionText}</Label>}
        <Label muted>共享空间会保存聊天和文件。</Label>
      </View>
      <SettingGroup title="提醒">
        <View style={{ padding: 16, gap: 12 }}>
          <SegmentedControl
            accessibilityLabel="消息提醒"
            value={level}
            options={[
              { value: 'all', label: '全部', icon: <Bell size={18} color={t.text} /> },
              { value: 'mentions', label: '提及', icon: <AtSign size={18} color={t.text} /> },
              { value: 'muted', label: '免打扰', icon: <BellOff size={18} color={t.text} /> },
            ]}
            onChange={next => void (kind === 'topic' ? runtime.topicNotification(id, next) : runtime.notification(id, next)).catch(e => setError(errorText(e)))}
          />
        </View>
      </SettingGroup>
      <InlineFeedback text={error} tone="danger" />
      {kind === 'conversation' && conversation?.type === 'group' ? (
        <SettingGroup title="话题">
          <View style={{ padding: 16, gap: 12 }}>
            {Object.values(topics).filter(item => item.conversationId === id).map(item => (
              <SettingRow key={item.id} title={item.title} detail={`${item.joined ? '已加入' : '未加入'} · ${item.status === 'open' ? '进行中' : '已关闭'}`} onPress={() => onOpenTopic?.(item)} />
            ))}
            <Input accessibilityLabel="话题标题" placeholder="话题标题" value={title} onChangeText={setTitle} />
            <Button title="创建话题" disabled={!title.trim()} onPress={() => void runtime.createTopic(id, title.trim()).then(topic => { setTitle(''); onCreateTopic?.(topic); }).catch(e => setError(errorText(e)))} />
            <Button title="刷新本群话题" secondary onPress={() => void runtime.listTopics(id).catch(e => setError(errorText(e)))} />
          </View>
        </SettingGroup>
      ) : null}
      {kind === 'conversation' && conversation?.type === 'group' ? (
        <SettingGroup title="常驻消息">
          {pins.length ? pins.map(message => (
            <SettingRow key={message.id} title={message.recalledAt ? '已撤回的消息' : message.plainText || '附件消息'} detail={`${message.authorName} · ${new Date(message.createdAt).toLocaleString()}`} onPress={() => onOpenPinnedMessage?.(message.id)} />
          )) : <View style={{ padding: 16 }}><Label muted>暂无常驻消息</Label></View>}
        </SettingGroup>
      ) : null}
      {kind === 'conversation' && conversation ? (
        <SettingGroup title="会话文件">
          {files.length ? files.map(file => <View key={file.id}>
            <FileRow file={file} download={() => onDownloadFile?.(file)} />
            {file.status === 'available' && file.capabilities.canDownload && file.mimeType.startsWith('image/') ? <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}><Button title="预览图片" secondary onPress={() => onOpenFile?.(file)} /></View> : null}
          </View>) : <View style={{ padding: 16 }}><Label muted>暂无会话文件</Label></View>}
        </SettingGroup>
      ) : null}
      {kind === 'topic' && topic?.joined ? (
        <SettingGroup title="危险" danger>
          <SettingRow title="退出话题" danger onPress={() => setLeave(true)} />
        </SettingGroup>
      ) : null}
      {kind === 'conversation' ? (
        <SettingGroup title="成员">
          {(conversation?.members ?? []).map(member => <MemberRow key={member.id} member={member} />)}
        </SettingGroup>
      ) : null}
      <Dialog
        visible={leave}
        title="退出话题？"
        onRequestClose={() => setLeave(false)}
        actions={[
          { title: '退出', variant: 'danger', onPress: () => { setLeave(false); void runtime.leaveTopic(id).catch(e => setError(errorText(e))); } },
          { title: '取消', variant: 'secondary', onPress: () => setLeave(false) },
        ]}
      >
        <Label>退出后不能再发送或上传。取消不会写入。</Label>
      </Dialog>
    </ScrollView>
  );
}
