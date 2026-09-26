import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Copy, Ellipsis, EyeOff, MessageSquare, Pin, Smile, SmilePlus, Undo2 } from 'lucide-react-native';
import type { Attachment, Message } from '../domain/contracts';
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
import { catalogUnicodeGlyph } from '../domain/emote-catalog';
import { useTheme } from './theme';

const quickReactions = ['emoji:thumbs-up', 'emoji:heart', 'emoji:smile'];

function actionIcon(id: string, color: string) {
  if (id === 'reply') return <MessageSquare size={18} color={color} />;
  if (id === 'copy') return <Copy size={18} color={color} />;
  if (id === 'hide') return <EyeOff size={18} color={color} />;
  if (id === 'recall') return <Undo2 size={18} color={color} />;
  if (id === 'pin') return <Pin size={18} color={color} />;
  if (id === 'favorite_emote') return <SmilePlus size={18} color={color} />;
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
}) {
  const t = useTheme();
  const userId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const conversation = useWorkspace(s => s.conversations[message.conversationId]);
  const directory = useWorkspace(s => s.bootstrap?.members);
  const authorName = visibleAuthorName(
    message,
    conversation?.members.length ? conversation.members : directory ?? emptyMembers,
    conversation?.type === 'direct' && (message.kind === 'bot' || message.authorKind === 'bot') ? conversation.displayTitle : '',
  );
  const own = message.authorId === userId;
  const system = message.kind === 'system' || message.authorKind === 'system';
  const [sheet, setSheet] = useState(false);
  const [cluster, setCluster] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [confirmRecall, setConfirmRecall] = useState(false);
  const [actionError, setActionError] = useState('');
  const react = (emoteKey: string, remove: boolean) => {
    if (!runtime) return;
    setActionError('');
    void runtime.react(message.id, emoteKey, remove).catch(error => setActionError(errorText(error)));
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
  const actions = messageActions(message, { own, group: conversation?.type === 'group', canSend: !!conversation?.capabilities.canSendMessage || !!message.topicId });
  const favoriteAttachment = message.status !== 'sending' && message.status !== 'failed' && !message.recalledAt && !message.deletedAt
    ? message.attachments.find(file => file.status === 'available' && file.mimeType.startsWith('image/') && file.capabilities.canDownload)
    : undefined;
  if (runtime && favoriteAttachment) actions.push({ id: 'favorite_emote', title: '收藏为表情' });
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
              <View style={{ maxWidth: '100%', padding: 12, backgroundColor: own ? t.sharedSoft : t.surface, alignSelf: own ? 'flex-end' : 'flex-start', ...radiusStyle }}>
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
                  onPress={() => react(reaction.emoteKey, reaction.reactedByCurrentUser)}
                  style={{ paddingHorizontal: 8, minHeight: 32, borderRadius: 16, backgroundColor: reaction.reactedByCurrentUser ? t.sharedSoft : t.soft, justifyContent: 'center' }}
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
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`消息操作，${messageAccessibilityLabel(message, authorName)}`}
              onPress={() => { setCluster(open => !open); setReactOpen(false); }}
              style={({ pressed }) => ({ minWidth: t.hit, minHeight: t.hit, borderRadius: t.radius.control, alignItems: 'center', justifyContent: 'center', opacity: pressed ? t.pressedOpacity : 1 })}
            >
              <Ellipsis size={18} color={t.muted} />
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
                  if (action.id === 'copy') void copyText(message.plainText);
                  if (action.id === 'reply') onReply?.(message);
                  setCluster(false);
                }}
                style={{ minWidth: t.hit, minHeight: t.hit, borderRadius: 24, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}
              >
                {actionIcon(action.id, t.text)}
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="反应" onPress={() => setReactOpen(open => !open)} style={{ minWidth: t.hit, minHeight: t.hit, borderRadius: 24, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Smile size={18} color={t.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="更多" onPress={() => { setCluster(false); setSheet(true); }} style={{ minWidth: t.hit, minHeight: t.hit, borderRadius: 24, backgroundColor: t.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Ellipsis size={18} color={t.text} />
            </Pressable>
          </View>
        ) : null}
        {reactOpen && runtime ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            {quickReactions.map(emoteKey => (
              <Pressable
                key={emoteKey}
                accessibilityRole="button"
                accessibilityLabel={`反应 ${catalogUnicodeGlyph(emoteKey) ?? emoteKey}`}
                onPress={() => { react(emoteKey, false); setReactOpen(false); setCluster(false); }}
                style={{ minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' }}
              >
                <ReactionGlyph emoteKey={emoteKey} />
              </Pressable>
            ))}
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
          icon: actionIcon(action.id, action.danger ? t.danger : t.text),
          onPress: () => {
            if (action.id === 'copy') void copyText(message.plainText);
            if (action.id === 'reply') onReply?.(message);
            if (action.id === 'recall') setConfirmRecall(true);
            if (action.id === 'hide' && runtime) void runtime.hide(message.id, !message.hiddenByCurrentUser);
            if (action.id === 'pin' && runtime) void runtime.pin(message.conversationId, message.id, !!message.pin);
            if (action.id === 'favorite_emote' && runtime && favoriteAttachment) {
              setActionError('');
              void runtime.favoriteMessageEmote(message.id, favoriteAttachment.id).catch(error => setActionError(errorText(error)));
            }
          },
        }))}
      />
      <Dialog
        visible={confirmRecall}
        title="撤回这条消息？"
        onRequestClose={() => setConfirmRecall(false)}
        actions={[
          { title: '取消', onPress: () => setConfirmRecall(false), variant: 'secondary' },
          { title: '撤回', variant: 'danger', onPress: () => { setConfirmRecall(false); if (runtime) void runtime.recall(message.id); } },
        ]}
      >
        <Label>撤回后所有人看到的是撤回说明，不能恢复原文。</Label>
      </Dialog>
    </View>
  );
}
