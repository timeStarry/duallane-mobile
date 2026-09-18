import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Attachment, Message } from '../domain/contracts';
import type { MessageGroupPosition } from '../domain/message-grouping';
import { useWorkspace } from '../domain/store';
import { copyText } from '../platform/clipboard';
import type { Runtime } from '../data/runtime';
import { Avatar } from './chrome';
import { Button, InlineFeedback, Label, ObjectActionSheet } from './primitives';
import { MessageContent, ReactionGlyph } from './MessageContent';
import { useTheme } from './theme';

export function messageActions(message: Message, flags: { own: boolean; group: boolean; canSend: boolean }): { id: string; title: string; danger?: boolean }[] {
  if (message.status === 'failed') return [{ id: 'copy', title: '复制' }];
  if (message.recalledAt || message.deletedAt) return [{ id: 'copy', title: '复制' }];
  const actions: { id: string; title: string; danger?: boolean }[] = [{ id: 'copy', title: '复制' }];
  if (flags.canSend && message.kind !== 'system') actions.push({ id: 'reply', title: '回复' });
  if (message.kind !== 'system') actions.push({ id: 'hide', title: message.hiddenByCurrentUser ? '恢复显示' : '仅自己隐藏' });
  if (flags.own && message.kind === 'user') actions.push({ id: 'recall', title: '撤回', danger: true });
  if (flags.group && message.kind === 'user' && !message.topicId) actions.push({ id: 'pin', title: message.pin ? '取消常驻' : '常驻' });
  return actions;
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
  locate?: (id: string) => void;
}) {
  const t = useTheme();
  const userId = useWorkspace(s => s.bootstrap?.auth.currentUser.id);
  const conversation = useWorkspace(s => s.conversations[message.conversationId]);
  const own = message.authorId === userId;
  const [sheet, setSheet] = useState(false);
  const grouped = groupPosition ? groupPosition === 'middle' || groupPosition === 'end' : previous && previous.authorId === message.authorId && previous.kind === message.kind && !message.replyToMessageId && !previous.recalledAt && Math.abs(Date.parse(message.createdAt) - Date.parse(previous.createdAt)) < 300000;
  const position = groupPosition ?? (grouped ? 'end' : 'single');
  const system = message.kind === 'system' || message.authorKind === 'system';
  const outer = t.bubble.outer;
  const inner = t.bubble.inner;
  const top = position === 'middle' || position === 'end' ? inner : outer;
  const bottom = position === 'middle' || position === 'start' ? inner : outer;
  const radiusStyle = own
    ? { borderTopLeftRadius: outer, borderTopRightRadius: top, borderBottomLeftRadius: outer, borderBottomRightRadius: bottom }
    : { borderTopLeftRadius: top, borderTopRightRadius: outer, borderBottomLeftRadius: bottom, borderBottomRightRadius: outer };
  const reply = message.replyToMessageId ? useWorkspace.getState().messages[message.topicId ? `topic:${message.topicId}` : message.conversationId]?.find(item => item.id === message.replyToMessageId) : undefined;
  const actions = messageActions(message, { own, group: conversation?.type === 'group', canSend: !!conversation?.capabilities.canSendMessage || !!message.topicId });
  return (
    <View>
      {dayLabel ? <Text style={{ textAlign: 'center', color: t.muted, fontSize: t.type.meta, paddingVertical: 8 }}>{dayLabel}</Text> : null}
      {showUnread ? <Text style={{ textAlign: 'center', color: t.shared, fontSize: t.type.meta, paddingVertical: 8 }}>以下为未读消息</Text> : null}
      <Pressable
        accessibilityLabel={`${message.authorName}，${message.plainText}`}
        onLongPress={() => { if (!system) setSheet(true); }}
        delayLongPress={450}
        style={{ paddingHorizontal: 16, paddingVertical: grouped ? 2 : 6, alignItems: system ? 'center' : own ? 'flex-end' : 'flex-start' }}
      >
        {system ? (
          <Text style={{ color: t.muted, fontSize: t.type.meta, textAlign: 'center' }}>{message.plainText}</Text>
        ) : (
          <View style={{ flexDirection: 'row', maxWidth: '80%', alignItems: 'flex-end', gap: 8 }}>
            {own ? null : grouped ? <View style={{ width: t.list.chatAvatar }} /> : <Avatar name={message.authorName} uri={message.authorAvatarUrl || conversation?.members.find(member => member.id === message.authorId)?.avatarUrl} id={message.authorId ?? message.authorName} shape={message.authorKind === 'bot' || message.kind === 'bot' ? 'bot' : 'person'} size={t.list.chatAvatar} />}
            <View style={{ flex: 1 }}>
              {grouped ? null : (
                <Text style={{ color: t.muted, fontSize: t.type.timestamp, marginBottom: 4, alignSelf: own ? 'flex-end' : 'flex-start' }}>{message.authorKind === 'bot' || message.kind === 'bot' ? `${message.authorName} · Bot` : message.authorName} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
              )}
              <View style={{ maxWidth: '100%', padding: 12, backgroundColor: own ? t.sharedSoft : t.surface, alignSelf: own ? 'flex-end' : 'flex-start', ...radiusStyle }}>
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
          </View>
        )}
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
