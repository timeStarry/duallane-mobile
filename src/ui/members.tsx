import React from 'react';
import { Text, View } from 'react-native';
import type { Member } from '../domain/contracts';
import { Avatar } from './chrome';
import { Button } from './primitives';
import { useTheme } from './theme';

export function MemberRow({
  member,
  onDirect,
}: {
  member: Member;
  onDirect?: () => void;
}) {
  const t = useTheme();
  const bot = member.kind === 'bot';
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: t.space.md,
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: 64,
        borderBottomWidth: 1,
        borderBottomColor: t.line,
      }}
    >
      <Avatar name={member.displayName} uri={member.avatarUrl} id={member.id} shape={bot ? 'bot' : 'person'} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: t.type.body, fontWeight: '600', color: t.text }} numberOfLines={1}>
          {member.displayName}
        </Text>
        <Text style={{ fontSize: t.type.meta, color: t.muted }}>{bot ? 'Bot' : member.roleLabel || '成员'}</Text>
      </View>
      {onDirect ? <Button title="发起私聊" secondary onPress={onDirect} /> : null}
    </View>
  );
}
