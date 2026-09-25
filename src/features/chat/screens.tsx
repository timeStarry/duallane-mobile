import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import { useWorkspace } from '../../domain/store';
import { attachmentSchema, parseMessage, targetKey, type Attachment, type ChatTarget, type Draft, type Emote, type EmoteLibrary, type Message, type Topic } from '../../domain/contracts';
import { activeMentionQuery, mentionCandidates } from '../../domain/compose';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { rememberEmotes } from '../../data/media';
import { Transfers } from '../../data/transfers';
import { conversationIdentity } from '../../ui/chrome';
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
  const bootstrapMembers = useWorkspace(s => s.bootstrap?.members ?? []);
  const members = conversation?.members.length ? conversation.members : bootstrapMembers;
  const mentionQuery = activeMentionQuery(draft.text);
  const suggestions = mentionQuery !== null ? mentionCandidates(mentionQuery, members) : [];
  const focused = useIsFocused();
  const ime = useChatIme(insets.bottom, suggestions.length, mentionQuery ?? '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(() => hasOlderMessages(useWorkspace.getState().messages[key]?.length ?? 0));
  const [progress, setProgress] = useState('');
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const [library, setLibrary] = useState<EmoteLibrary | null>(null);
  const chatSettings = useWorkspace(s => s.chatSettings);
  const [syncToGroup, setSyncToGroup] = useState(false);
  const list = useRef<FlatList>(null);
  const pinToLatest = useRef(true);
  const draggingTranscript = useRef(false);
  const historyReady = useRef(false);
  const [newMessages, setNewMessages] = useState(false);
  const [resolvedFocusId, setResolvedFocusId] = useState<string>();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const count = target.kind === 'topic' ? await runtime.openTopic(target.id) : await runtime.open(target.id);
      setHasOlder(hasOlderMessages(count ?? 0));
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [runtime, target]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    pinToLatest.current = true;
    draggingTranscript.current = false;
    historyReady.current = false;
    setNewMessages(false);
    setHasOlder(hasOlderMessages(useWorkspace.getState().messages[key]?.length ?? 0));
  }, [key]);
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
  const mode = transcriptMode(hasOlder);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const scrollToLatest = useCallback((animated: boolean) => {
    pinToLatest.current = true;
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
    if (pinToLatest.current && focused && AppState.currentState === 'active') {
      const last = useWorkspace.getState().messages[key]?.at(-1);
      if (last && !last.status) void runtime.markRead(target.id, last.id, target.kind === 'topic').catch(() => undefined);
    }
  }, [focused, key, lastId, runtime, target.id, target.kind]);
  const reply = draft.replyToMessageId ? messages.find(item => item.id === draft.replyToMessageId) : undefined;
  const canSend = target.kind === 'topic' ? !!topic?.joined && topic.status === 'open' : !!conversation?.capabilities.canSendMessage;
  const send = (existing?: Message) => {
    const latest = existing ? draft : useWorkspace.getState().drafts[key] ?? draft;
    if (!existing && !latest.text.trim() && !latest.pendingAttachment) return;
    setError('');
    pinToLatest.current = true;
    setNewMessages(false);
    const uploadTaskId = existing?.pendingUploadTaskId ?? latest.pendingAttachment?.taskId;
    const task = uploadTaskId ? transfers.tasks(useWorkspace.getState().accountKey).find(item => item.id === uploadTaskId) : undefined;
    const needsUpload = !!uploadTaskId && !existing?.attachments[0];
    void runtime.send(target.kind === 'conversation' ? target.id : target.conversationId, existing?.plainText ?? latest.text, existing, existing?.attachments[0]?.id, {
      topicId: target.kind === 'topic' ? target.id : undefined,
      replyToMessageId: existing?.replyToMessageId ?? latest.replyToMessageId,
      mentionIds: latest.mentionIds,
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
  useEffect(() => {
    if (!focusMessageId || loading) return;
    let cancelled = false;
    const locate = async () => {
      if (!useWorkspace.getState().messages[key]?.some(message => message.id === focusMessageId)) {
        const api = runtime.api;
        if (!api) return;
        const path = target.kind === 'topic'
          ? `/api/workspace/topics/${encodeURIComponent(target.id)}/messages?around=${encodeURIComponent(focusMessageId)}&limit=50`
          : `/api/workspace/conversations/${encodeURIComponent(target.id)}/messages?around=${encodeURIComponent(focusMessageId)}&limit=50`;
        const response = await api.json(path, z.object({ messages: z.array(z.unknown()) }));
        if (cancelled) return;
        const found = response.messages.map(parseMessage).filter((message): message is Message => !!message && (target.kind === 'topic' ? message.topicId === target.id : message.conversationId === target.id && !message.topicId));
        useWorkspace.getState().setMessages(key, found, true);
      }
      if (!cancelled) setResolvedFocusId(focusMessageId);
    };
    void locate().catch(error => { if (!cancelled) setError(errorText(error)); });
    return () => { cancelled = true; };
  }, [focusMessageId, key, loading, runtime, target.id, target.kind]);
  useEffect(() => {
    if (!resolvedFocusId) return;
    const index = listItems.findIndex(entry => entry.kind === 'message' && entry.message.id === resolvedFocusId);
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      pinToLatest.current = false;
      list.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      setResolvedFocusId(undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [listItems, resolvedFocusId]);
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
      <InlineFeedback text={error || progress} tone={error ? 'danger' : 'info'} />
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
                onReply={targetMessage => runtime.patchDraft(key, { replyToMessageId: targetMessage.id, mentionIds: conversation && useWorkspace.getState().chatSettings?.replyAutoMention && targetMessage.authorId ? Array.from(new Set([...draft.mentionIds, targetMessage.authorId])) : draft.mentionIds, text: conversation && useWorkspace.getState().chatSettings?.replyAutoMention && targetMessage.authorName && !draft.text.includes(`@${targetMessage.authorName}`) ? `${draft.text}${draft.text ? ' ' : ''}@${targetMessage.authorName} ` : draft.text })}
                onOpenTopic={onOpenTopic}
                locate={id => {
                  const at = listItems.findIndex(entry => entry.kind === 'message' && entry.message.id === id);
                  if (at >= 0) list.current?.scrollToIndex({ index: at, animated: true });
                }}
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
          {target.kind === 'topic' && topic?.allowSyncToGroup ? (
            <Pressable accessibilityRole="button" onPress={() => setSyncToGroup(value => !value)} style={{ paddingHorizontal: 16, minHeight: 40, justifyContent: 'center' }}>
              <Label muted>{syncToGroup ? '将同步到群聊' : '默认只发到话题，点按改为同步到群'}</Label>
            </Pressable>
          ) : null}
          <Composer
            value={draft.text}
            onChangeText={text => runtime.patchDraft(key, { text })}
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
                    runtime.patchDraft(key, { text: token, mentionIds: draft.mentionIds });
                    send();
                    ime.closePanel();
                    return;
                  }
                  const next = `${useWorkspace.getState().drafts[key]?.text ?? draft.text}${token}`;
                  runtime.patchDraft(key, { text: next, mentionIds: draft.mentionIds });
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
                  const prefix = draft.text.replace(/@([^\s@]*)$/, '');
                  runtime.patchDraft(key, { text: `${prefix}@${member.displayName} `, mentionIds: Array.from(new Set([...draft.mentionIds, member.id])) });
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
