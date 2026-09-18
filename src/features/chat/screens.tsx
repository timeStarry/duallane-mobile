import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWorkspace } from '../../domain/store';
import { targetKey, type Attachment, type ChatTarget, type Draft, type Emote, type Message, type Topic } from '../../domain/contracts';
import { activeMentionQuery, mentionCandidates } from '../../domain/compose';
import { copyText } from '../../platform/clipboard';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { rememberEmotes } from '../../data/media';
import { RemoteImage } from '../../ui/RemoteImage';
import { Transfers } from '../../data/transfers';
import {
  AppHeader,
  Avatar,
  Button,
  Composer,
  ConversationRow,
  Dialog,
  EmptyState,
  InlineFeedback,
  Input,
  Label,
  Loading,
  MemberRow,
  MessageContent,
  ObjectActionSheet,
  PageState,
  SegmentedControl,
  TopicRow,
  styles,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';

const emptyMessages: Message[] = [];
const emptyDraft: Draft = { text: '', mentionIds: [] };

export function ConversationsScreen({ runtime, open, openTopic }: { runtime: Runtime; open: (id: string) => void; openTopic: (topic: Topic) => void }) {
  const conversations = useWorkspace(s => s.conversations);
  const topics = useWorkspace(s => s.topics);
  const connection = useWorkspace(s => s.connection);
  const selfId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const directory = useWorkspace(s => s.bootstrap?.members);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<'conversations' | 'topics'>('conversations');
  const [error, setError] = useState('');
  const t = useTheme();
  useEffect(() => { if (list === 'topics') void runtime.listTopics().catch(e => setError(errorText(e))); }, [list, runtime]);
  const items = Object.values(conversations).filter(c => c.displayTitle.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  const topicItems = Object.values(topics).filter(topic => topic.title.includes(query) || (topic.descriptionPreview ?? '').includes(query));
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <AppHeader title="聊天" subtitle={connection === '已连接' ? undefined : connection} includeTopInset />
      <View style={styles.content}>
        <SegmentedControl
          accessibilityLabel="会话与话题"
          value={list}
          options={[{ value: 'conversations', label: '会话' }, { value: 'topics', label: '话题' }]}
          onChange={setList}
        />
        <Input accessibilityLabel={list === 'topics' ? '筛选已加载的话题' : '筛选已加载的会话'} placeholder={list === 'topics' ? '筛选已加载的话题' : '筛选已加载的会话'} value={query} onChangeText={setQuery} />
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
                title={item.title}
                groupName={conversations[item.conversationId]?.displayTitle ?? '群聊'}
                preview={item.descriptionPreview || item.description || (item.joined ? '已加入' : '未加入')}
                joined={item.joined}
                closed={item.status !== 'open'}
                unreadCount={item.unreadCount}
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

export function MessageRow({
  message,
  retry,
  download,
  previous,
  showUnread,
  runtime,
  onReply,
  onOpenTopic,
  locate,
}: {
  message: Message;
  retry: () => void;
  download: (file: Attachment) => void;
  previous?: Message;
  showUnread?: boolean;
  runtime?: Runtime;
  onReply?: (message: Message) => void;
  onOpenTopic?: (topicId: string) => void;
  locate?: (id: string) => void;
}) {
  const t = useTheme();
  const userId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const conversation = useWorkspace(s => s.conversations[message.conversationId]);
  const own = message.authorId === userId;
  const [sheet, setSheet] = useState(false);
  const grouped = previous && previous.authorId === message.authorId && previous.kind === message.kind && !message.replyToMessageId && !previous.recalledAt && Math.abs(Date.parse(message.createdAt) - Date.parse(previous.createdAt)) < 300000;
  const reply = message.replyToMessageId ? useWorkspace.getState().messages[message.topicId ? `topic:${message.topicId}` : message.conversationId]?.find(item => item.id === message.replyToMessageId) : undefined;
  const actions = messageActions(message, { own, group: conversation?.type === 'group', canSend: !!conversation?.capabilities.canSendMessage || !!message.topicId });
  return (
    <View>
      {showUnread ? <Text style={{ textAlign: 'center', color: t.shared, fontSize: t.type.meta, paddingVertical: 8 }}>未读</Text> : null}
      <Pressable
        accessibilityLabel={`${message.authorName}，${message.plainText}`}
        onLongPress={() => setSheet(true)}
        delayLongPress={450}
        style={{ paddingHorizontal: 16, paddingVertical: grouped ? 2 : 6, alignItems: own ? 'flex-end' : 'flex-start' }}
      >
        {grouped ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, alignSelf: own ? 'flex-end' : 'flex-start' }}>
            {own ? null : <Avatar name={message.authorName} uri={message.authorAvatarUrl || conversation?.members.find(member => member.id === message.authorId)?.avatarUrl} id={message.authorId ?? message.authorName} shape={message.authorKind === 'bot' || message.kind === 'bot' ? 'bot' : 'person'} size={28} />}
            <Text style={{ color: t.muted, fontSize: t.type.timestamp }}>{message.authorKind === 'bot' || message.kind === 'bot' ? `${message.authorName} · Bot` : message.authorName} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
          </View>
        )}
        <View style={{ maxWidth: '80%', padding: 12, borderRadius: t.radius.bubble, backgroundColor: message.kind === 'system' ? t.soft : own ? t.sharedSoft : t.surface }}>
          {message.replyToMessageId ? (
            <Pressable accessibilityRole="button" accessibilityLabel="定位原消息" onPress={() => locate?.(message.replyToMessageId!)}>
              <Label muted>{reply && !reply.recalledAt && !reply.hiddenByCurrentUser ? `${reply.authorName}: ${reply.plainText}` : '原消息不可用'}</Label>
            </Pressable>
          ) : null}
          <MessageContent message={message} download={download} onOpenTopic={onOpenTopic} runtime={runtime} />
          {message.reactions?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {message.reactions.map(reaction => (
                <Pressable
                  key={reaction.emoteKey}
                  accessibilityRole="button"
                  accessibilityLabel={`${reaction.emoteKey} ${reaction.count}${reaction.reactedByCurrentUser ? '，已选择' : ''}`}
                  onPress={() => runtime && void runtime.react(message.id, reaction.emoteKey, reaction.reactedByCurrentUser)}
                  style={{ paddingHorizontal: 8, minHeight: 32, borderRadius: 16, backgroundColor: reaction.reactedByCurrentUser ? t.sharedSoft : t.soft, justifyContent: 'center' }}
                >
                  <Text style={{ color: t.text, fontSize: t.type.meta }}>{reaction.emoteKey} {reaction.count}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {message.pin ? <Label muted>常驻</Label> : null}
          {message.status === 'sending' && <Label muted>发送中…</Label>}
          {message.status === 'failed' && (
            <>
              <InlineFeedback text={message.error ?? '发送失败'} tone="danger" />
              <Button title="重试发送" secondary onPress={retry} />
            </>
          )}
        </View>
      </Pressable>
      <ObjectActionSheet
        visible={sheet}
        title={`${message.authorName}的消息`}
        detail={message.plainText.slice(0, 80)}
        onRequestClose={() => setSheet(false)}
        actions={actions.map(action => ({
          id: action.id,
          title: action.title,
          danger: action.danger,
          onPress: () => {
            if (action.id === 'copy') void copyText(message.plainText);
            if (action.id === 'reply') onReply?.(message);
            if (action.id === 'recall' && runtime) void runtime.recall(message.id);
            if (action.id === 'hide' && runtime) void runtime.hide(message.id, !message.hiddenByCurrentUser);
            if (action.id === 'pin' && runtime) void runtime.pin(message.conversationId, message.id, !!message.pin);
          },
        }))}
      />
    </View>
  );
}

function messageActions(message: Message, flags: { own: boolean; group: boolean; canSend: boolean }): { id: string; title: string; danger?: boolean }[] {
  if (message.status === 'failed') return [{ id: 'copy', title: '复制' }];
  if (message.recalledAt || message.deletedAt) return [{ id: 'copy', title: '复制' }];
  const actions: { id: string; title: string; danger?: boolean }[] = [{ id: 'copy', title: '复制' }];
  if (flags.canSend && message.kind !== 'system') actions.push({ id: 'reply', title: '回复' });
  if (message.kind !== 'system') actions.push({ id: 'hide', title: message.hiddenByCurrentUser ? '恢复显示' : '仅自己隐藏' });
  if (flags.own && message.kind === 'user') actions.push({ id: 'recall', title: '撤回', danger: true });
  if (flags.group && message.kind === 'user' && !message.topicId) actions.push({ id: 'pin', title: message.pin ? '取消常驻' : '常驻' });
  return actions;
}

export function ChatScreen({
  target,
  runtime,
  transfers,
  details,
  onOpenTopic,
}: {
  target: ChatTarget;
  runtime: Runtime;
  transfers: Transfers;
  details: () => void;
  onOpenTopic?: (topicId: string) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const key = targetKey(target);
  const conversation = useWorkspace(s => s.conversations[target.kind === 'conversation' ? target.id : target.conversationId]);
  const topic = useWorkspace(s => target.kind === 'topic' ? s.topics[target.id] : undefined);
  const messages = useWorkspace(s => s.messages[key] ?? emptyMessages);
  const draft = useWorkspace(s => s.drafts[key] ?? emptyDraft);
  const connection = useWorkspace(s => s.connection);
  const bootstrapMembers = useWorkspace(s => s.bootstrap?.members ?? []);
  const members = conversation?.members.length ? conversation.members : bootstrapMembers;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(true);
  const [progress, setProgress] = useState('');
  const [emotes, setEmotes] = useState<Emote[]>([]);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [syncToGroup, setSyncToGroup] = useState(false);
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const mentionQuery = activeMentionQuery(draft.text);
  const suggestions = mentionQuery !== null ? mentionCandidates(mentionQuery, members) : [];
  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (target.kind === 'topic') await runtime.openTopic(target.id);
      else await runtime.open(target.id);
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [runtime, target]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void runtime.emotes().then(result => {
      rememberEmotes(result.items);
      setEmotes(result.items);
    }).catch(() => undefined);
  }, [runtime]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: topic?.title ?? conversation?.displayTitle ?? '会话',
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="会话详情" onPress={details} style={{ minWidth: t.hit, minHeight: t.hit, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text style={{ color: t.shared, fontWeight: '600' }}>详情</Text>
        </Pressable>
      ),
    });
  }, [conversation?.displayTitle, details, navigation, t.hit, t.shared, topic?.title]);
  useEffect(() => {
    if (nearBottom.current) list.current?.scrollToEnd({ animated: false });
    else setNewMessages(true);
    const last = messages.at(-1);
    if (last && !last.status && nearBottom.current && AppState.currentState === 'active') {
      void runtime.markRead(target.id, last.id, target.kind === 'topic').catch(() => undefined);
    }
  }, [messages, runtime, target]);
  const reply = draft.replyToMessageId ? messages.find(item => item.id === draft.replyToMessageId) : undefined;
  const canSend = target.kind === 'topic' ? !!topic?.joined && topic.status === 'open' : !!conversation?.capabilities.canSendMessage;
  const send = (existing?: Message) => {
    setError('');
    nearBottom.current = true;
    const pending = existing ? undefined : draft.pendingAttachment;
    const task = pending ? transfers.tasks(useWorkspace.getState().accountKey).find(item => item.id === pending.taskId) : undefined;
    void runtime.send(target.kind === 'conversation' ? target.id : target.conversationId, existing?.plainText ?? draft.text, existing, existing?.attachments[0]?.id, {
      topicId: target.kind === 'topic' ? target.id : undefined,
      replyToMessageId: existing?.replyToMessageId ?? draft.replyToMessageId,
      mentionIds: draft.mentionIds,
      syncToGroup: target.kind === 'topic' && syncToGroup,
      upload: task ? () => {
        const api = runtime.api;
        const account = useWorkspace.getState().accountKey;
        if (!api) return Promise.resolve(null);
        setProgress('上传中');
        return transfers.run(api, account, task, n => setProgress(`上传 ${Math.round(n * 100)}%`)).finally(() => setProgress(''));
      } : undefined,
    }).catch(e => setError(errorText(e)));
  };
  const unreadId = target.kind === 'topic' ? topic?.lastReadMessageId : conversation?.lastReadMessageId;
  const unreadIndex = unreadId ? messages.findIndex(item => item.id === unreadId) : -1;
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      {connection !== '已连接' && <InlineFeedback text={connection} tone="warning" />}
      {target.kind === 'topic' && topic ? <Label muted>{topic.joined ? `话题 · ${conversation?.displayTitle ?? ''}` : '未加入，只能查看摘要'}{topic.status !== 'open' ? ' · 已关闭' : ''}</Label> : null}
      <InlineFeedback text={error || progress} tone={error ? 'danger' : 'info'} />
      {loading && <Loading />}
      {target.kind === 'topic' && topic && !topic.joined ? (
        <View>
          <EmptyState title="尚未加入该话题" detail={topic.descriptionPreview || '加入后才能阅读和发送。'} />
          {topic.canJoin ? <Button title="加入讨论" onPress={() => void runtime.joinTopic(topic.id).then(() => runtime.openTopic(topic.id)).catch(e => setError(errorText(e)))} /> : null}
        </View>
      ) : (
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={m => m.id}
          keyboardShouldPersistTaps="handled"
          onScroll={e => {
            const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
            nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
            if (nearBottom.current) setNewMessages(false);
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => { if (nearBottom.current) list.current?.scrollToEnd({ animated: false }); }}
          ListHeaderComponent={hasOlder && messages.length > 0 ? <Button title="加载更早消息" secondary onPress={() => { const first = messages[0]?.id; void (target.kind === 'topic' ? runtime.topicMessages(target.id, first) : runtime.messages(target.id, first)).then(count => setHasOlder(count === 50)).catch(e => setError(errorText(e))); }} /> : null}
          ListEmptyComponent={!loading ? <EmptyState title="还没有消息" /> : null}
          renderItem={({ item, index }) => (
            <MessageRow
              message={item}
              previous={messages[index - 1]}
              showUnread={unreadIndex >= 0 && index === unreadIndex + 1}
              runtime={runtime}
              retry={() => send(item)}
              onReply={item => runtime.patchDraft(key, { replyToMessageId: item.id, mentionIds: conversation && useWorkspace.getState().chatSettings?.replyAutoMention && item.authorId ? Array.from(new Set([...draft.mentionIds, item.authorId])) : draft.mentionIds, text: conversation && useWorkspace.getState().chatSettings?.replyAutoMention && item.authorName && !draft.text.includes(`@${item.authorName}`) ? `${draft.text}${draft.text ? ' ' : ''}@${item.authorName} ` : draft.text })}
              onOpenTopic={onOpenTopic}
              locate={id => {
                const at = messages.findIndex(row => row.id === id);
                if (at >= 0) list.current?.scrollToIndex({ index: at, animated: true });
              }}
              download={file => {
                const api = runtime.api;
                if (api) void transfers.download(api, useWorkspace.getState().accountKey, file).catch(e => setError(errorText(e)));
              }}
            />
          )}
        />
      )}
      {newMessages && <Button title="回到最新" secondary onPress={() => { nearBottom.current = true; setNewMessages(false); list.current?.scrollToEnd(); }} />}
      {suggestions.length > 0 && (
        <View style={{ backgroundColor: t.elevated, borderTopWidth: 1, borderTopColor: t.line }}>
          {suggestions.map(member => (
            <Pressable
              key={member.id}
              accessibilityRole="button"
              accessibilityLabel={`提及${member.displayName}`}
              onPress={() => {
                const prefix = draft.text.replace(/@([^\s@]*)$/, '');
                runtime.patchDraft(key, { text: `${prefix}@${member.displayName} `, mentionIds: Array.from(new Set([...draft.mentionIds, member.id])) });
              }}
              style={{ minHeight: t.hit, paddingHorizontal: 16, justifyContent: 'center' }}
            >
              <Text style={{ color: t.text }}>{member.displayName}{member.kind === 'bot' ? ' · Bot' : ''}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {emoteOpen && (
        <ScrollView style={{ maxHeight: 220, backgroundColor: t.elevated }} contentContainerStyle={{ padding: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {emotes.length ? emotes.map(emote => (
            <Pressable
              key={emote.id}
              accessibilityRole="button"
              accessibilityLabel={emote.label}
              onPress={() => {
                if (useWorkspace.getState().chatSettings?.clickImageEmoteToSend) {
                  runtime.patchDraft(key, { text: draft.text ? `${draft.text}:${emote.token}:` : `:${emote.token}:`, mentionIds: draft.mentionIds });
                  send();
                } else runtime.patchDraft(key, { text: `${draft.text}:${emote.token}:` });
                setEmoteOpen(false);
              }}
              style={{ width: 56, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}
            >
              {emote.src ? <RemoteImage uri={emote.src} style={{ width: 40, height: 40 }} /> : <Text style={{ fontSize: 28 }}>{emote.label}</Text>}
            </Pressable>
          )) : <Label muted>正在加载表情…</Label>}
        </ScrollView>
      )}
      {canSend ? (
        <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
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
            reply={reply ? { author: reply.authorName, preview: reply.recalledAt || reply.hiddenByCurrentUser ? '原消息不可用' : reply.plainText } : undefined}
            onClearReply={() => runtime.patchDraft(key, { replyToMessageId: undefined })}
            attachmentName={draft.pendingAttachment?.fileName}
            onClearAttachment={() => runtime.patchDraft(key, { pendingAttachment: undefined })}
            onEmote={() => {
              setEmoteOpen(open => !open);
              if (!emotes.length) void runtime.emotes().then(result => setEmotes(result.items)).catch(e => setError(errorText(e)));
            }}
            onAttach={() => {
              const account = useWorkspace.getState().accountKey;
              void transfers.choose(account, target.kind === 'conversation' ? target.id : undefined).then(task => {
                if (!task) return;
                runtime.patchDraft(key, { pendingAttachment: { taskId: task.id, fileName: task.fileName, mimeType: task.mimeType, byteSize: task.byteSize } });
              }).catch(e => setError(errorText(e)));
            }}
          />
        </View>
      ) : <EmptyState title={target.kind === 'topic' ? '当前话题不可发送' : '当前会话不可发送消息'} />}
    </View>
  );
}

export function DetailsScreen({ id, runtime, kind = 'conversation', onCreateTopic }: { id: string; runtime: Runtime; kind?: 'conversation' | 'topic'; onCreateTopic?: (topic: Topic) => void; onOpenTopic?: (topic: Topic) => void }) {
  const conversation = useWorkspace(s => s.conversations[id]);
  const topic = useWorkspace(s => s.topics[id]);
  const t = useTheme();
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [leave, setLeave] = useState(false);
  const level = (kind === 'topic' ? topic?.notificationLevel : conversation?.notificationLevel) ?? 'muted';
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.section, { color: t.text }]}>{kind === 'topic' ? topic?.title : conversation?.displayTitle}</Text>
      {kind === 'topic' ? <Label muted>{topic?.joined ? '已加入' : '未加入'} · {topic?.status === 'open' ? '进行中' : '已关闭'}</Label> : <Label>{conversation?.retentionText}</Label>}
      <Label muted>共享空间会保存聊天和文件。</Label>
      <Label>消息提醒</Label>
      <SegmentedControl
        accessibilityLabel="消息提醒"
        value={level}
        options={[
          { value: 'all', label: '所有消息' },
          { value: 'mentions', label: '仅提到我' },
          { value: 'muted', label: '免打扰' },
        ]}
        onChange={next => void (kind === 'topic' ? runtime.topicNotification(id, next) : runtime.notification(id, next)).catch(e => setError(errorText(e)))}
      />
      <InlineFeedback text={error} tone="danger" />
      {kind === 'conversation' && conversation?.type === 'group' ? (
        <>
          <Label>新建话题</Label>
          <Input accessibilityLabel="话题标题" placeholder="话题标题" value={title} onChangeText={setTitle} />
          <Button title="创建话题" disabled={!title.trim()} onPress={() => void runtime.createTopic(id, title.trim()).then(topic => { setTitle(''); onCreateTopic?.(topic); }).catch(e => setError(errorText(e)))} />
          <Button title="刷新本群话题" secondary onPress={() => void runtime.listTopics(id).catch(e => setError(errorText(e)))} />
        </>
      ) : null}
      {kind === 'topic' && topic?.joined ? <Button title="退出话题" variant="danger" onPress={() => setLeave(true)} /> : null}
      <Label>会话成员</Label>
      {(kind === 'topic' ? [] : conversation?.members ?? []).map(member => <MemberRow key={member.id} member={member} />)}
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
