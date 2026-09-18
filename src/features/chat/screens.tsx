import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWorkspace } from '../../domain/store';
import { targetKey, type ChatTarget, type Draft, type Emote, type Message, type Topic } from '../../domain/contracts';
import { activeMentionQuery, mentionCandidates } from '../../domain/compose';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { rememberEmotes } from '../../data/media';
import { Transfers } from '../../data/transfers';
import { conversationIdentity } from '../../ui/chrome';
import { groupHiddenWorkspaceMessages } from '../../domain/hidden-messages';
import { formatMessageDayLabel, getMessageDayKey, getMessageGroupPositions, workspaceUnreadIndex } from '../../domain/message-grouping';
import { catalogPacks } from '../../domain/emote-catalog';
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
import { ChevronLeft, Info, Search } from 'lucide-react-native';

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
  const ime = useChatIme(insets.bottom);
  const [emotePack, setEmotePack] = useState('custom');
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
  const [syncToGroup, setSyncToGroup] = useState(false);
  const list = useRef<FlatList>(null);
  const nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const mentionQuery = activeMentionQuery(draft.text);
  const suggestions = mentionQuery !== null ? mentionCandidates(mentionQuery, members) : [];
  const setImePanel = ime.setPanel;
  useEffect(() => {
    if (suggestions.length > 0) setImePanel('mention');
  }, [setImePanel, suggestions.length]);
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
  const selfId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const identity = conversation ? conversationIdentity(conversation, selfId, members) : undefined;
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
    const latest = existing ? draft : useWorkspace.getState().drafts[key] ?? draft;
    const pending = existing ? undefined : latest.pendingAttachment;
    const task = pending ? transfers.tasks(useWorkspace.getState().accountKey).find(item => item.id === pending.taskId) : undefined;
    void runtime.send(target.kind === 'conversation' ? target.id : target.conversationId, existing?.plainText ?? latest.text, existing, existing?.attachments[0]?.id, {
      topicId: target.kind === 'topic' ? target.id : undefined,
      replyToMessageId: existing?.replyToMessageId ?? latest.replyToMessageId,
      mentionIds: latest.mentionIds,
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
  const unreadIndex = workspaceUnreadIndex(messages, unreadId);
  const groupPositions = getMessageGroupPositions(messages, unreadIndex);
  const displayItems = groupHiddenWorkspaceMessages(messages);
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
          ref={list}
          data={displayItems}
          keyExtractor={item => item.kind === 'hidden' ? `hidden:${item.sourceIndex}` : item.message.id}
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
                  const at = displayItems.findIndex(entry => entry.kind === 'message' && entry.message.id === id);
                  if (at >= 0) list.current?.scrollToIndex({ index: at, animated: true });
                }}
                download={file => {
                  const api = runtime.api;
                  if (api) void transfers.download(api, useWorkspace.getState().accountKey, file).catch(e => setError(errorText(e)));
                }}
              />
            );
          }}
        />
      )}
      {newMessages && <Button title="回到最新" secondary onPress={() => { nearBottom.current = true; setNewMessages(false); list.current?.scrollToEnd(); }} />}
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
            reply={reply ? { author: reply.authorName, preview: reply.recalledAt || reply.hiddenByCurrentUser ? '原消息不可用' : reply.plainText } : undefined}
            onClearReply={() => runtime.patchDraft(key, { replyToMessageId: undefined })}
            attachmentName={draft.pendingAttachment?.fileName}
            onClearAttachment={() => runtime.patchDraft(key, { pendingAttachment: undefined })}
            onEmote={() => ime.openPanel('emoji')}
            onAttach={() => ime.openPanel('attach')}
          />
          <View style={{ height: ime.dock.panelHeight, overflow: 'hidden', backgroundColor: t.elevated }}>
            {ime.panel === 'emoji' ? (
              <CatalogEmoteGrid
                packs={[{ id: 'custom', label: '自定义', items: emotes.map(emote => ({ kind: emote.kind, id: emote.id, label: emote.label, token: emote.token, src: emote.src })) }, ...catalogPacks()]}
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
                    void transfers.choose(account, target.kind === 'conversation' ? target.id : undefined).then(task => {
                      if (!task) return;
                      runtime.patchDraft(key, { pendingAttachment: { taskId: task.id, fileName: task.fileName, mimeType: task.mimeType, byteSize: task.byteSize } });
                      ime.closePanel();
                    }).catch(e => setError(errorText(e)));
                  }}
                />
              </View>
            ) : null}
            {ime.panel === 'mention' ? suggestions.map(member => (
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
            )) : null}
          </View>
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
              { value: 'all', label: '所有消息' },
              { value: 'mentions', label: '仅提到我' },
              { value: 'muted', label: '免打扰' },
            ]}
            onChange={next => void (kind === 'topic' ? runtime.topicNotification(id, next) : runtime.notification(id, next)).catch(e => setError(errorText(e)))}
          />
        </View>
      </SettingGroup>
      <InlineFeedback text={error} tone="danger" />
      {kind === 'conversation' && conversation?.type === 'group' ? (
        <SettingGroup title="话题">
          <View style={{ padding: 16, gap: 12 }}>
            <Input accessibilityLabel="话题标题" placeholder="话题标题" value={title} onChangeText={setTitle} />
            <Button title="创建话题" disabled={!title.trim()} onPress={() => void runtime.createTopic(id, title.trim()).then(topic => { setTitle(''); onCreateTopic?.(topic); }).catch(e => setError(errorText(e)))} />
            <Button title="刷新本群话题" secondary onPress={() => void runtime.listTopics(id).catch(e => setError(errorText(e)))} />
          </View>
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
