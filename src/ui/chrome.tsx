import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot } from 'lucide-react-native';
import type { Conversation, Member } from '../domain/contracts';
import { RemoteImage } from './RemoteImage';
import { formatListTime, stableTone } from './format';
import { useTheme } from './theme';

export function AppHeader({
  title,
  subtitle,
  right,
  includeTopInset = false,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  includeTopInset?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: includeTopInset ? insets.top + t.space.sm : t.space.sm,
        paddingHorizontal: t.space.lg,
        paddingBottom: t.space.sm,
        minHeight: includeTopInset ? insets.top + 56 : 52,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: t.surface,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.line,
        gap: t.space.sm,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ fontSize: t.type.meta, color: t.muted, marginTop: 2 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function Avatar({
  name,
  uri,
  id,
  shape = 'person',
  size = 40,
  emoji,
}: {
  name: string;
  uri?: string | null;
  id: string;
  shape?: 'person' | 'group' | 'bot';
  size?: number;
  emoji?: string | null;
}) {
  const t = useTheme();
  const [imageFailed, setImageFailed] = useState(false);
  const backgroundColor = stableTone(id) === 0 ? t.avatarA : t.avatarB;
  const radius = shape === 'person' ? size / 2 : t.radius.entity;
  const letter = [...name.trim()].find(char => char.trim()) ?? '?';
  const showImage = !!uri && !imageFailed && !emoji;
  return (
    <View
      accessibilityIgnoresInvertColors
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {emoji ? (
        <Text style={{ fontSize: size * 0.52 }}>{emoji}</Text>
      ) : showImage ? (
        <RemoteImage uri={uri} style={{ width: size, height: size }} onError={() => setImageFailed(true)} />
      ) : (
        <Text style={{ color: t.text, fontWeight: '600', fontSize: size * 0.38 }}>{letter}</Text>
      )}
      {shape === 'bot' ? (
        <View
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            backgroundColor: t.surface,
            borderRadius: 8,
            padding: 1,
          }}
        >
          <Bot color={t.shared} size={12} accessibilityLabel="Bot" />
        </View>
      ) : null}
    </View>
  );
}

export function conversationIdentity(conversation: Conversation, selfId?: string, directory: Member[] = []) {
  if (conversation.type === 'group') {
    return { shape: 'group' as const, name: conversation.displayTitle, id: conversation.id, uri: undefined as string | undefined, emoji: conversation.avatarEmoji };
  }
  const other = conversation.members.find(member => member.id !== selfId) ?? directory.find(member => member.displayName === conversation.displayTitle);
  const listed = other?.id ? directory.find(member => member.id === other.id) : undefined;
  return {
    shape: (other?.kind ?? listed?.kind) === 'bot' ? ('bot' as const) : ('person' as const),
    name: other?.displayName ?? listed?.displayName ?? conversation.displayTitle,
    id: other?.id ?? listed?.id ?? conversation.id,
    uri: other?.avatarUrl ?? listed?.avatarUrl,
    emoji: undefined as string | undefined,
  };
}

export function ConversationRow({
  conversation,
  selfId,
  directory,
  onPress,
}: {
  conversation: Conversation;
  selfId?: string;
  directory?: Member[];
  onPress: () => void;
}) {
  const t = useTheme();
  const identity = conversationIdentity(conversation, selfId, directory);
  const unread = conversation.unreadCount;
  const unreadText = unread > 0 ? `${Math.min(unread, 99)}${unread > 99 ? '+' : ''}条未读` : '无未读';
  const muted = conversation.notificationLevel === 'muted';
  const preview = conversation.lastMessagePlainText || '还没有消息';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开${conversation.displayTitle}，${unreadText}${muted ? '，免打扰' : ''}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: 64,
        backgroundColor: t.bg,
        opacity: pressed ? t.pressedOpacity : 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.line,
      })}
    >
      <Avatar name={identity.name} uri={identity.uri} id={identity.id} shape={identity.shape} emoji={identity.emoji} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: t.text }} numberOfLines={1}>
            {conversation.displayTitle}
          </Text>
          <Text style={{ fontSize: t.type.timestamp, color: t.muted }}>{formatListTime(conversation.lastActivityAt)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, marginTop: 2 }}>
          <Text style={{ flex: 1, fontSize: t.type.control, color: t.muted }} numberOfLines={1}>
            {preview}
          </Text>
          {muted ? <Text style={{ fontSize: t.type.timestamp, color: t.muted }}>免打扰</Text> : null}
          {unread > 0 ? (
            <View style={{ backgroundColor: t.shared, borderRadius: 10, minWidth: 20, paddingHorizontal: 6, paddingVertical: 2, alignItems: 'center' }}>
              <Text style={{ color: t.onShared, fontSize: t.type.timestamp, fontWeight: '700' }}>{Math.min(unread, 99)}{unread > 99 ? '+' : ''}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function TopicRow({
  title,
  groupName,
  preview,
  joined,
  closed,
  unreadCount,
  onPress,
}: {
  title: string;
  groupName: string;
  preview: string;
  joined: boolean;
  closed: boolean;
  unreadCount: number;
  onPress: () => void;
}) {
  const t = useTheme();
  const state = closed ? '已关闭' : joined ? '已加入' : '未加入';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开话题${title}，属于${groupName}，${state}`}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: 64,
        backgroundColor: t.bg,
        opacity: pressed ? t.pressedOpacity : 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.line,
        gap: 2,
      })}
    >
      <Text style={{ fontSize: 16, fontWeight: '600', color: t.text }} numberOfLines={1}>{title}</Text>
      <Text style={{ fontSize: t.type.meta, color: t.muted }} numberOfLines={1}>{groupName} · {state}{unreadCount > 0 ? ` · ${unreadCount}条未读` : ''}</Text>
      <Text style={{ fontSize: t.type.control, color: t.muted }} numberOfLines={1}>{preview}</Text>
    </Pressable>
  );
}
