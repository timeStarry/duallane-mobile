import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bot } from 'lucide-react-native';
import type { Conversation, Member } from '../domain/contracts';
import { RemoteImage } from './RemoteImage';
import { formatListTime, stableTone } from './format';
import { UnreadBadge } from './primitives';
import { useTheme } from './theme';

export function AppHeader({
  title,
  subtitle,
  leading,
  trailing,
  right,
  includeTopInset = false,
  banner,
  identity,
}: {
  title: string;
  subtitle?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  right?: React.ReactNode;
  includeTopInset?: boolean;
  banner?: React.ReactNode;
  identity?: { name: string; id: string; uri?: string | null; shape?: 'person' | 'group' | 'bot'; emoji?: string | null };
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View>
      <View
        style={{
          paddingTop: includeTopInset ? insets.top + t.space.sm : t.space.sm,
          paddingHorizontal: t.space.lg,
          paddingBottom: t.space.sm,
          minHeight: includeTopInset ? insets.top + 56 : 52,
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: t.surface,
          borderBottomWidth: banner ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: t.line,
          gap: t.space.sm,
        }}
      >
        {leading}
        {identity ? <Avatar name={identity.name} uri={identity.uri} id={identity.id} shape={identity.shape} emoji={identity.emoji} size={t.list.chatAvatar} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text }} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={{ fontSize: t.type.meta, color: t.muted, marginTop: 2 }} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {trailing ?? right}
      </View>
      {banner}
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
  const pressedId = useRef<string | null>(null);
  const identity = conversationIdentity(conversation, selfId, directory);
  const unread = conversation.unreadCount;
  const unreadText = unread > 0 ? `${Math.min(unread, 99)}${unread > 99 ? '+' : ''}条未读` : '无未读';
  const muted = conversation.notificationLevel === 'muted';
  const preview = conversation.lastMessagePlainText || '还没有消息';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开${conversation.displayTitle}，${unreadText}${muted ? '，免打扰' : ''}`}
      onPressIn={() => { pressedId.current = conversation.id; }}
      onPress={() => { if (pressedId.current === conversation.id) onPress(); }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: t.list.rowMin,
        backgroundColor: t.bg,
        opacity: pressed ? t.pressedOpacity : 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.line,
      })}
    >
      <Avatar name={identity.name} uri={identity.uri} id={identity.id} shape={identity.shape} emoji={identity.emoji} size={t.list.avatar} />
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
          <UnreadBadge count={unread} />
        </View>
      </View>
    </Pressable>
  );
}

export function TopicRow({
  id,
  title,
  groupName,
  preview,
  joined,
  closed,
  unreadCount,
  groupEmoji,
  onPress,
}: {
  id: string;
  title: string;
  groupName: string;
  preview: string;
  joined: boolean;
  closed: boolean;
  unreadCount: number;
  groupEmoji?: string | null;
  onPress: () => void;
}) {
  const t = useTheme();
  const pressedId = useRef<string | null>(null);
  const state = closed ? '已关闭' : joined ? '已加入' : '未加入';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`打开话题${title}，属于${groupName}，${state}`}
      onPressIn={() => { pressedId.current = id; }}
      onPress={() => { if (pressedId.current === id) onPress(); }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: t.list.rowMin,
        backgroundColor: t.bg,
        opacity: pressed ? t.pressedOpacity : 1,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.line,
      })}
    >
      <Avatar name={groupName} id={id} shape="group" emoji={groupEmoji} size={t.list.avatar} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: t.text }} numberOfLines={1}>{title}</Text>
        <Text style={{ fontSize: t.type.meta, color: t.muted }} numberOfLines={1}>{groupName} · {state}{unreadCount > 0 ? ` · ${unreadCount}条未读` : ''}</Text>
        <Text style={{ fontSize: t.type.control, color: t.muted }} numberOfLines={1}>{preview}</Text>
      </View>
      <UnreadBadge count={unreadCount} />
    </Pressable>
  );
}
