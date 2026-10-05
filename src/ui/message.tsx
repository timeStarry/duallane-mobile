import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, Text, View } from 'react-native';
import { Copy, EllipsisVertical, EyeOff, MessageSquare, Pin, Smile, SmilePlus, Undo2 } from 'lucide-react-native';
import type { Attachment, EmoteLibrary, Message } from '../domain/contracts';
import { messageActions } from '../domain/message-actions';
import type { MessageGroupPosition } from '../domain/message-grouping';
import { recalledNotice } from '../domain/recall';
import { visibleAuthorName } from '../domain/author-name';
import { useWorkspace } from '../domain/store';
import { copyText } from '../platform/clipboard';
import type { Runtime } from '../data/runtime';
import { errorText } from '../data/client';

const emptyMembers: Array<{ id: string; displayName: string }> = [];
import { Avatar } from './chrome';
import { Button, Dialog, InlineFeedback, Label, ObjectActionSheet } from './primitives';
import { MessageContent, ReactionGlyph } from './MessageContent';
import { CatalogEmoteGrid } from './CatalogEmoteGrid';
import { catalogUnicodeGlyph, composerEmotePacks, type CatalogPackItem } from '../domain/emote-catalog';
import { useTheme } from './theme';

const quickReactions = ['emoji:thumbs-up', 'emoji:heart', 'emoji:smile'];

function reactionKey(item: CatalogPackItem, packId: string): string {
  if (packId === 'custom' || packId.startsWith('collection:')) {
    const tokenKey = /^:?\[([^\]\s]+)\]:?$/.exec(item.token ?? '')?.[1];
    return tokenKey ?? `custom:${item.id}`;
  }
  return `${packId}:${item.id}`;
}

function actionIcon(id: string, color: string) {
  if (id === 'reply') return <MessageSquare size={18} color={color} />;
  if (id === 'copy') return <Copy size={18} color={color} />;
  if (id === 'hide') return <EyeOff size={18} color={color} />;
  if (id === 'recall') return <Undo2 size={18} color={color} />;
  if (id === 'pin') return <Pin size={18} color={color} />;
  if (id === 'favorite_emote') return <SmilePlus size={18} color={color} />;
  if (id === 'react') return <Smile size={18} color={color} />;
  return null;
}

export function messageAccessibilityLabel(message: Message, authorName: string, includeContent = true): string {
  const timestamp = new Date(message.createdAt);
  const parts = [authorName];
  if (!Number.isNaN(timestamp.getTime())) parts.push(timestamp.toLocaleString());
  if (message.status === 'sending') parts.push('发送中');
  if (message.status === 'failed') parts.push('发送失败');
  if (message.attachments.length) parts.push(`${message.attachments.length}个附件`);
  if (message.fallback) parts.push('部分内容暂不支持');
  if (message.pin) parts.push('常驻消息');
  if (includeContent && message.plainText) parts.push(message.plainText.slice(0, 240));
  return parts.join('，');
}

export function MessageRow({
  message,
  retry,
  download,
  previous,
  groupPosition,
  showUnread,
  dayLabel,
  runtime,
  onReply,
  onOpenTopic,
  onPreview,
  locate,
  onToggleProjection,
  isProjected,
  projectionBusy,
}: {
  message: Message;
  retry: () => void;
  download: (file: Attachment) => void;
  previous?: Message;
  groupPosition?: MessageGroupPosition;
  showUnread?: boolean;
  dayLabel?: string;
  runtime?: Runtime;
  onReply?: (message: Message) => void;
  onOpenTopic?: (topicId: string) => void;
  onPreview?: (file: Attachment) => void;
  locate?: (id: string) => void;
  onToggleProjection?: () => void;
  isProjected?: boolean;
  projectionBusy?: boolean;
}) {
  const t = useTheme();
  const userId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const accountKey = useWorkspace(s => s.accountKey);
  const conversation = useWorkspace(s => s.conversations[message.conversationId]);
  const topic = useWorkspace(s => message.topicId ? s.topics[message.topicId] : undefined);
  const chatSettings = useWorkspace(s => s.chatSettings);
  const directory = useWorkspace(s => s.bootstrap?.members);
  const authorName = visibleAuthorName(
    message,
    conversation?.members.length ? conversation.members : directory ?? emptyMembers,
    conversation?.type === 'direct' && (message.kind === 'bot' || message.authorKind === 'bot') ? conversation.displayTitle : '',
  );
  const own = !!userId && message.authorId === userId;
  const system = message.kind === 'system' || message.authorKind === 'system';
  const [sheet, setSheet] = useState(false);
  const [cluster, setCluster] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [reactionPack, setReactionPack] = useState('emoji');
  const [loadedLibrary, setLoadedLibrary] = useState<{ accountKey: string; userId: string; messageId: string; value: EmoteLibrary } | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [confirmRecall, setConfirmRecall] = useState(false);
  const [actionError, setActionError] = useState('');
  const actionInvocation = useRef(0);
  const actionScope = useRef({ active: true });
  const interactionIdentity = useRef({ accountKey, userId });
  const identityMatches = interactionIdentity.current.accountKey === accountKey && interactionIdentity.current.userId === userId;
  useEffect(() => {
    const scope = { active: true };
    actionScope.current = scope;
    setActionError('');
    setLibraryError('');
    setCatalogOpen(false);
    setCluster(false);
    setReactOpen(false);
    return () => { scope.active = false; };
  }, [message.id, runtime, userId, accountKey]);
  const canAccessMessage = identityMatches && (!message.topicId || !!conversation && !!topic?.joined && topic.conversationId === message.conversationId);
  const canWrite = canAccessMessage && !!conversation?.capabilities.canSendMessage && (!message.topicId
    || conversation.type === 'group' && topic?.status === 'open');
  const canReact = identityMatches && !!runtime && !system && !message.status && !message.recalledAt && !message.deletedAt
    && (message.topicId ? canWrite : conversation ? canWrite : true);
  useEffect(() => {
    if (!canReact) { setCatalogOpen(false); setReactOpen(false); }
  }, [canReact]);
  useEffect(() => {
    if (!catalogOpen || !canReact || !runtime || !userId || !accountKey) return;
    let active = true;
    const current = () => {
      const state = useWorkspace.getState();
      return active && state.accountKey === accountKey && state.bootstrap?.auth.currentUser.id === userId;
    };
    setLibraryError('');
    void runtime.emoteLibrary().then(value => {
      if (current()) {
        setLoadedLibrary({ accountKey, userId, messageId: message.id, value });
      }
    }).catch(error => { if (current()) setLibraryError(errorText(error)); });
    return () => { active = false; };
  }, [catalogOpen, canReact, runtime, userId, accountKey, message.id]);
  const runAction = async (operation: () => Promise<unknown>) => {
    const invocation = ++actionInvocation.current;
    const scope = actionScope.current;
    setActionError('');
    try {
      await operation();
    } catch (error) {
      const state = useWorkspace.getState();
      if (scope.active && invocation === actionInvocation.current && state.accountKey === accountKey && state.bootstrap?.auth.currentUser.id === userId) setActionError(errorText(error));
    }
  };
  const react = (emoteKey: string, remove: boolean) => {
    if (!runtime || !canReact) return;
    void runAction(() => runtime.react(message.id, emoteKey, remove));
  };
  const grouped = groupPosition ? groupPosition === 'middle' || groupPosition === 'end' : previous && previous.authorId === message.authorId && previous.kind === message.kind && !message.replyToMessageId && !previous.recalledAt && Math.abs(Date.parse(message.createdAt) - Date.parse(previous.createdAt)) < 300000;
  const position = groupPosition ?? (grouped ? 'end' : 'single');
  const outer = t.bubble.outer;
  const inner = t.bubble.inner;
  const top = position === 'middle' || position === 'end' ? inner : outer;
  const bottom = position === 'middle' || position === 'start' ? inner : outer;
  const radiusStyle = position === 'middle'
    ? { borderTopLeftRadius: inner, borderTopRightRadius: inner, borderBottomLeftRadius: inner, borderBottomRightRadius: inner }
    : own
      ? { borderTopLeftRadius: outer, borderTopRightRadius: top, borderBottomLeftRadius: outer, borderBottomRightRadius: bottom }
      : { borderTopLeftRadius: top, borderTopRightRadius: outer, borderBottomLeftRadius: bottom, borderBottomRightRadius: outer };
  const reply = message.replyToMessageId ? useWorkspace.getState().messages[message.topicId ? `topic:${message.topicId}` : message.conversationId]?.find(item => item.id === message.replyToMessageId) : undefined;
  const actions = !canAccessMessage
    ? [{ id: 'copy', title: '复制' }] : messageActions(message, { own, group: conversation?.type === 'group', canSend: canWrite });
  const replyIndex = !onReply ? actions.findIndex(action => action.id === 'reply') : -1;
  if (replyIndex >= 0) actions.splice(replyIndex, 1);
  if (canReact) actions.push({ id: 'react', title: '添加表情回复' });
  if (onToggleProjection && message.topicId && canWrite && topic?.allowSyncToGroup && !message.status && !message.recalledAt && !message.deletedAt) {
    actions.push({ id: 'projection', title: isProjected ? '取消同步到群聊' : '同步到群聊' });
  }
  const openCluster = () => { Keyboard.dismiss(); setCluster(true); setReactOpen(false); };
  const openSheet = () => { Keyboard.dismiss(); setCluster(false); setReactOpen(false); setSheet(true); };
  const openCatalog = () => { Keyboard.dismiss(); setCatalogOpen(true); setCluster(false); setReactOpen(false); };
  const accessibilityActions = actions.filter(action => action.id === 'copy' || action.id === 'reply')
    .map(action => ({ name: action.id, label: action.title }));
  if (actions.length) accessibilityActions.push({ name: 'more', label: '更多消息操作' });
  const library = loadedLibrary?.accountKey === accountKey && loadedLibrary.userId === userId && loadedLibrary.messageId === message.id
    ? loadedLibrary.value : null;
  const favoriteAttachment = canAccessMessage && message.status !== 'sending' && message.status !== 'failed' && !message.recalledAt && !message.deletedAt
    ? message.attachments.find(file => file.status === 'available' && file.mimeType.startsWith('image/') && file.capabilities.canDownload)
    : undefined;
  if (runtime && favoriteAttachment) actions.push({ id: 'favorite_emote', title: '收藏为表情' });
  const canRecall = actions.some(action => action.id === 'recall');
  const recallText = recalledNotice(message);
  if (recallText) {
    return (
      <View>
        {dayLabel ? <Text style={{ textAlign: 'center', color: t.muted, fontSize: t.type.meta, paddingVertical: 8 }}>{dayLabel}</Text> : null}
        <View accessible accessibilityRole="text" accessibilityLabel={recallText} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Undo2 size={14} color={t.muted} />
          <Text style={{ color: t.muted, fontSize: t.type.meta, flexShrink: 1 }}>{recallText}</Text>
        </View>
      </View>
    );
  }
  return (
    <View>
      {dayLabel ? <Text style={{ textAlign: 'center', color: t.muted, fontSize: t.type.meta, paddingVertical: 8 }}>{dayLabel}</Text> : null}
      {showUnread ? <Text style={{ textAlign: 'center', color: t.shared, fontSize: t.type.meta, paddingVertical: 8 }}>以下为未读消息</Text> : null}
      <View
        style={{ paddingHorizontal: 16, paddingVertical: grouped ? 2 : 6, alignItems: system ? 'center' : own ? 'flex-end' : 'flex-start' }}
      >
        {system ? (
          <Text style={{ color: t.muted, fontSize: t.type.meta, textAlign: 'center' }}>{message.plainText}</Text>
        ) : (
          <View style={{ flexDirection: own ? 'row-reverse' : 'row', maxWidth: '96%', alignItems: 'flex-end', gap: 4 }}>
            {own ? null : grouped ? <View style={{ width: t.list.chatAvatar }} /> : <Avatar name={authorName} uri={message.authorAvatarUrl || conversation?.members.find(member => member.id === message.authorId)?.avatarUrl} id={message.authorId ?? authorName} shape={message.authorKind === 'bot' || message.kind === 'bot' ? 'bot' : 'person'} size={t.list.chatAvatar} />}
            <View style={{ flexShrink: 1, minWidth: 0 }}>
              {grouped ? null : (
                <Text accessibilityLabel={messageAccessibilityLabel(message, authorName, false)} style={{ color: t.muted, fontSize: t.type.timestamp, marginBottom: 4, alignSelf: own ? 'flex-end' : 'flex-start' }}>{message.authorKind === 'bot' || message.kind === 'bot' ? `${authorName} · Bot` : authorName} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              )}
              <Pressable accessible={false} delayLongPress={450} onLongPress={openCluster} style={{ maxWidth: '100%', padding: 12, backgroundColor: own ? t.sharedSoft : t.surface, alignSelf: own ? 'flex-end' : 'flex-start', ...radiusStyle }}>
          {message.replyToMessageId ? (
            <Pressable accessibilityRole="button" accessibilityLabel="定位原消息" onPress={() => locate?.(message.replyToMessageId!)}>
              <Label muted>{reply && !reply.hiddenByCurrentUser ? (reply.recalledAt ? '已撤回的消息' : `${reply.authorName}: ${reply.plainText}`) : '原消息不可用'}</Label>
            </Pressable>
          ) : null}
          <MessageContent message={message} download={download} onPreview={onPreview} onOpenTopic={onOpenTopic} runtime={runtime} />
          {message.reactions?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {message.reactions.map(reaction => (
                <Pressable
                  key={reaction.emoteKey}
                  accessibilityRole="button"
                  accessibilityLabel={`${reaction.emoteKey} ${reaction.count}${reaction.reactedByCurrentUser ? '，已选择' : ''}`}
                  accessibilityState={{ disabled: !canReact }}
                  disabled={!canReact}
                  onPress={() => react(reaction.emoteKey, reaction.reactedByCurrentUser)}
                  style={{ paddingHorizontal: 8, minWidth: t.hit, minHeight: t.hit, borderRadius: 16, backgroundColor: reaction.reactedByCurrentUser ? t.sharedSoft : t.soft, justifyContent: 'center' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <ReactionGlyph emoteKey={reaction.emoteKey} />
                    <Text style={{ color: t.text, fontSize: t.type.meta }}>{reaction.count}</Text>
                  </View>
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
              </Pressable>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`消息操作，${messageAccessibilityLabel(message, authorName)}`}
              accessibilityHint="点按查看更多消息操作"
              accessibilityActions={accessibilityActions}
              onAccessibilityAction={event => {
                const action = event.nativeEvent.actionName;
                if (action === 'copy' && actions.some(item => item.id === 'copy')) void runAction(() => copyText(message.plainText));
                if (action === 'reply' && actions.some(item => item.id === 'reply')) onReply?.(message);
                if (action === 'more' && actions.length) openSheet();
              }}
              onPress={() => {
                if (cluster) { setCluster(false); setReactOpen(false); }
                else openCluster();
              }}
              style={({ pressed }) => ({ minWidth: t.hit, minHeight: t.hit, borderRadius: t.radius.control, alignItems: 'center', justifyContent: 'center', opacity: pressed ? t.pressedOpacity : 1 })}
            >
              <EllipsisVertical size={18} color={t.muted} />
            </Pressable>
          </View>
        )}
        {cluster && !system ? (
          <View style={{ alignSelf: own ? 'flex-end' : 'flex-start', marginLeft: own ? 0 : t.list.chatAvatar + 4, flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingVertical: 4 }}>
            {actions.filter(action => action.id === 'reply' || action.id === 'copy').map(action => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.title}
                onPress={() => {
                  if (action.id === 'copy') void runAction(() => copyText(message.plainText));
                  if (action.id === 'reply') onReply?.(message);
                  setCluster(false);
                }}
                style={{ minWidth: t.hit, minHeight: t.hit, borderRadius: 24, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}
              >
                {actionIcon(action.id, t.text)}
              </Pressable>
            ))}
            {canReact ? <Pressable accessibilityRole="button" accessibilityLabel="反应" onPress={() => setReactOpen(open => !open)} style={{ minWidth: t.hit, minHeight: t.hit, borderRadius: 24, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Smile size={18} color={t.text} />
            </Pressable> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="更多" onPress={openSheet} style={{ minWidth: t.hit, minHeight: t.hit, borderRadius: 24, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
              <EllipsisVertical size={18} color={t.text} />
            </Pressable>
          </View>
        ) : null}
        {reactOpen && canReact ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {quickReactions.map(emoteKey => (
              <Pressable
                key={emoteKey}
                accessibilityRole="button"
                accessibilityLabel={`反应 ${catalogUnicodeGlyph(emoteKey) ?? emoteKey}`}
                onPress={() => { react(emoteKey, false); setReactOpen(false); setCluster(false); }}
                style={{ minWidth: t.hit, minHeight: t.hit, alignItems: 'center', justifyContent: 'center' }}
              >
                <ReactionGlyph emoteKey={emoteKey} />
              </Pressable>
            ))}
            <Button title="更多表情" secondary onPress={openCatalog} />
          </View>
        ) : null}
        <InlineFeedback text={actionError} tone="danger" />
      </View>
      <ObjectActionSheet
        visible={sheet}
        title={`${authorName}的消息`}
        detail={message.plainText.slice(0, 80)}
        onRequestClose={() => setSheet(false)}
        actions={actions.map(action => ({
          id: action.id,
          title: action.title,
          danger: action.danger,
          disabled: action.id === 'projection' && projectionBusy,
          icon: actionIcon(action.id, action.danger ? t.danger : t.text),
          onPress: () => {
            if (action.id === 'copy') void runAction(() => copyText(message.plainText));
            if (action.id === 'reply') onReply?.(message);
            if (action.id === 'recall') setConfirmRecall(true);
            if (action.id === 'react' && canReact) openCatalog();
            if (action.id === 'projection' && !projectionBusy) onToggleProjection?.();
            if (action.id === 'hide' && runtime) void runAction(() => runtime.hide(message.id, !message.hiddenByCurrentUser));
            if (action.id === 'pin' && runtime) void runAction(() => runtime.pin(message.conversationId, message.id, !!message.pin));
            if (action.id === 'favorite_emote' && runtime && favoriteAttachment) {
              void runAction(() => runtime.favoriteMessageEmote(message.id, favoriteAttachment.id));
            }
          },
        }))}
      />
      <Dialog visible={catalogOpen && canReact} title="选择消息表情回复" onRequestClose={() => setCatalogOpen(false)} actions={[{ title: '取消', variant: 'secondary', onPress: () => setCatalogOpen(false) }]}>
        <CatalogEmoteGrid
          packs={composerEmotePacks(library, chatSettings?.enabledPackIds)}
          selectedPackId={reactionPack}
          onSelectPack={setReactionPack}
          onPick={(item, packId) => {
            const emoteKey = reactionKey(item, packId);
            const remove = message.reactions.some(reaction => reaction.emoteKey === emoteKey && reaction.reactedByCurrentUser);
            react(emoteKey, remove);
            setCatalogOpen(false);
          }}
        />
        <InlineFeedback text={libraryError} tone="danger" />
      </Dialog>
      <Dialog
        visible={confirmRecall && canRecall}
        title="撤回这条消息？"
        onRequestClose={() => setConfirmRecall(false)}
        actions={[
          { title: '取消', onPress: () => setConfirmRecall(false), variant: 'secondary' },
          { title: '撤回', variant: 'danger', onPress: () => { setConfirmRecall(false); if (runtime && canRecall) void runAction(() => runtime.recall(message.id)); } },
        ]}
      >
        <Label>撤回后所有人看到的是撤回说明，不能恢复原文。</Label>
      </Dialog>
    </View>
  );
}
