import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import type { Member } from '../domain/contracts';
import { Avatar } from './chrome';
import { Button } from './primitives';
import { useTheme } from './theme';

export function MemberRow({
  member,
  onDirect,
  onPress,
  disabled = false,
}: {
  member: Member;
  onDirect?: () => void;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const bot = member.kind === 'bot';
  const identity = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        minHeight: t.hit,
      }}
    >
      <Avatar name={member.displayName} uri={member.avatarUrl} id={member.id} shape={bot ? 'bot' : 'person'} size={t.list.avatar} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: t.type.body, fontWeight: '600', color: t.text }} numberOfLines={1}>
          {member.displayName}
        </Text>
        <Text style={{ fontSize: t.type.meta, color: t.muted }}>{bot ? 'Bot' : member.roleLabel || '成员'}</Text>
      </View>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md, paddingHorizontal: t.space.lg,
      paddingVertical: t.space.md, minHeight: t.list.rowMin, borderBottomWidth: 1, borderBottomColor: t.line }}>
      {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`查看 ${member.displayName} 的成员资料`}
        accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
        style={({ pressed }) => ({ flex: 1, minWidth: t.hit, minHeight: t.hit, opacity: disabled ? t.disabledOpacity : pressed ? t.pressedOpacity : 1 })}>
        {identity}
      </Pressable> : <View style={{ flex: 1, minWidth: 0 }}>{identity}</View>}
      {onDirect ? <Button title="发起私聊" secondary disabled={disabled} onPress={onDirect} /> : null}
    </View>
  );
}

export function MemberProfile({ member }: { member: Member }) {
  const t = useTheme();
  const human = member.kind === 'human';
  return (
    <View style={{ gap: t.space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.md }}>
        <Avatar name={member.displayName} uri={member.avatarUrl} id={member.id} shape={member.kind === 'bot' ? 'bot' : 'person'} size={t.list.avatar} />
        <Text style={{ flex: 1, fontSize: t.type.section, fontWeight: '600', color: t.text }}>{member.displayName}</Text>
      </View>
      {member.remark ? <ProfileField label="我的备注" value={member.remark} /> : null}
      {human ? <ProfileField label="公开昵称" value={member.nickname || '未设置'} /> : null}
      {human && member.githubLogin ? <ProfileField label="GitHub 账号" value={`@${member.githubLogin}`} /> : null}
      <ProfileField label="空间身份" value={member.roleLabel || (member.kind === 'bot' ? 'Bot' : '成员')} />
    </View>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return <View style={{ gap: t.space.xs }}>
    <Text style={{ fontSize: t.type.meta, color: t.muted }}>{label}</Text>
    <Text style={{ fontSize: t.type.body, color: t.text }}>{value}</Text>
  </View>;
}
