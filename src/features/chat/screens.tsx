import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWorkspace } from '../../domain/store';
import type { Attachment, Message } from '../../domain/contracts';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { Transfers } from '../../data/transfers';
import {
  AppHeader,
  Button,
  Composer,
  ConversationRow,
  EmptyState,
  FileRow,
  InlineFeedback,
  Input,
  Label,
  Loading,
  MemberRow,
  PageState,
  SegmentedControl,
  styles,
} from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function ConversationsScreen({ open }: { open: (id: string) => void }) {
  const conversations = useWorkspace(s => s.conversations);
  const connection = useWorkspace(s => s.connection);
  const selfId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<'conversations' | 'topics'>('conversations');
  const t = useTheme();
  const items = Object.values(conversations).filter(c => c.displayTitle.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
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
        {list === 'conversations' ? <Input accessibilityLabel="筛选已加载的会话" placeholder="筛选已加载的会话" value={query} onChangeText={setQuery} /> : null}
      </View>
      {list === 'topics' ? (
        <EmptyState title="话题列表稍后接入" detail="这一栏承接 Web 的话题入口。当前不会从这里加入、发送或把群草稿带到话题。" />
      ) : (
        <PageState status={items.length ? 'ready' : 'empty'} emptyTitle="还没有会话" emptyDetail="可以从成员列表发起私聊。">
          <FlatList style={{ flex: 1 }} data={items} keyExtractor={c => c.id} renderItem={({ item }) => <ConversationRow conversation={item} selfId={selfId} onPress={() => open(item.id)} />} />
        </PageState>
      )}
    </View>
  );
}

export function MessageRow({ message, retry, download }: { message: Message; retry: () => void; download: (file: Attachment) => void }) {
  const t = useTheme();
  const userId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const own = message.authorId === userId;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 6, alignItems: own ? 'flex-end' : 'flex-start' }}>
      <Text style={{ color: t.muted, fontSize: t.type.timestamp, marginBottom: 4 }}>
        {message.authorName} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <View style={{ maxWidth: '80%', padding: 12, borderRadius: t.radius.bubble, backgroundColor: own ? t.sharedSoft : t.surface }}>
        <Text selectable style={{ fontSize: t.type.body, lineHeight: t.type.bodyLine, color: t.text }}>{message.plainText}</Text>
        {message.fallback && <Label muted>部分内容暂不支持，可在“我的”检查更新。</Label>}
        {message.attachments.map(file => <FileRow key={file.id} file={file} download={() => download(file)} />)}
        {message.status === 'sending' && <Label muted>发送中…</Label>}
        {message.status === 'failed' && (
          <>
            <InlineFeedback text={message.error ?? '发送失败'} tone="danger" />
            <Button title="重试发送" secondary onPress={retry} />
          </>
        )}
      </View>
    </View>
  );
}

const emptyMessages: Message[] = [];

export function ChatScreen({ id, runtime, transfers, details }: { id: string; runtime: Runtime; transfers: Transfers; details: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const conversation = useWorkspace(s => s.conversations[id]);
  const messages = useWorkspace(s => s.messages[id] ?? emptyMessages);
  const draft = useWorkspace(s => s.drafts[id] ?? '');
  const connection = useWorkspace(s => s.connection);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasOlder, setHasOlder] = useState(true);
  const [progress, setProgress] = useState('');
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const [newMessages, setNewMessages] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try { await runtime.open(id); }
    catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }, [id, runtime]);
  useEffect(() => { void load(); }, [load]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: conversation?.displayTitle ?? '会话',
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="会话详情" onPress={details} style={{ minWidth: t.hit, minHeight: t.hit, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}>
          <Text style={{ color: t.shared, fontWeight: '600' }}>详情</Text>
        </Pressable>
      ),
    });
  }, [conversation?.displayTitle, details, navigation, t.hit, t.shared]);
  useEffect(() => {
    if (nearBottom.current) list.current?.scrollToEnd({ animated: false });
    else setNewMessages(true);
    const last = messages.at(-1);
    if (last && !last.status && nearBottom.current && AppState.currentState === 'active') void runtime.markRead(id, last.id).catch(() => undefined);
  }, [messages, id, runtime]);
  const send = (existing?: Message) => {
    setError('');
    nearBottom.current = true;
    void runtime.send(id, draft, existing).catch(e => setError(errorText(e)));
  };
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      {connection !== '已连接' && <InlineFeedback text={connection} tone="warning" />}
      <InlineFeedback text={error || progress} tone={error ? 'danger' : 'info'} />
      {loading && <Loading />}
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
        ListHeaderComponent={hasOlder && messages.length > 0 ? <Button title="加载更早消息" secondary onPress={() => { void runtime.messages(id, messages[0]?.id).then(count => setHasOlder(count === 50)).catch(e => setError(errorText(e))); }} /> : null}
        ListEmptyComponent={!loading ? <EmptyState title="还没有消息" /> : null}
        renderItem={({ item }) => (
          <MessageRow
            message={item}
            retry={() => send(item)}
            download={file => {
              const api = runtime.api;
              if (api) void transfers.download(api, useWorkspace.getState().accountKey, file).catch(e => setError(errorText(e)));
            }}
          />
        )}
      />
      {newMessages && <Button title="回到最新" secondary onPress={() => { nearBottom.current = true; setNewMessages(false); list.current?.scrollToEnd(); }} />}
      {conversation?.capabilities.canSendMessage ? (
        <View style={{ paddingBottom: Math.max(insets.bottom, 8) }}>
          <Composer
            value={draft}
            onChangeText={text => runtime.draft(id, text)}
            onSend={() => send()}
            sendDisabled={!draft.trim()}
            attachDisabled={!conversation.capabilities.canUploadFile || !!progress}
            onAttach={() => {
              const api = runtime.api;
              const key = useWorkspace.getState().accountKey;
              if (!api) return;
              void transfers.choose(key, id).then(async task => {
                if (!task) return;
                setProgress('准备上传…');
                const file = await transfers.run(api, key, task, n => setProgress(`上传 ${Math.round(n * 100)}%`));
                if (file) await runtime.send(id, '', undefined, file.id);
              }).catch(e => setError(errorText(e))).finally(() => setProgress(''));
            }}
          />
        </View>
      ) : <EmptyState title="当前会话不可发送消息" />}
    </View>
  );
}

export function DetailsScreen({ id, runtime }: { id: string; runtime: Runtime }) {
  const conversation = useWorkspace(s => s.conversations[id]);
  const t = useTheme();
  const [error, setError] = useState('');
  const level = conversation?.notificationLevel ?? 'muted';
  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}>
      <Text style={[styles.section, { color: t.text }]}>{conversation?.displayTitle}</Text>
      <Label>{conversation?.retentionText}</Label>
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
        onChange={next => void runtime.notification(id, next).catch(e => setError(errorText(e)))}
      />
      <InlineFeedback text={error} tone="danger" />
      <Label>会话成员</Label>
      {conversation?.members.map(member => <MemberRow key={member.id} member={member} />)}
    </ScrollView>
  );
}
