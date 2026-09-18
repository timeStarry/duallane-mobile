import React, { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { config, loginTarget } from '../../platform/config';
import { Button, InlineFeedback, Input, Label, styles } from '../../ui/components';
import { useTheme } from '../../ui/theme';
import brandIcon from '../../../assets/icon.png';

export function LoginScreen({ runtime }: { runtime: Runtime }) {
  const [destination, setDestination] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = useTheme();
  const configured = Boolean(config.apiOrigin);
  const login = async () => {
    setError('');
    let target: ReturnType<typeof loginTarget>;
    try { target = loginTarget(destination, config.apiOrigin); }
    catch { setError(configured ? '请使用当前服务的有效空间邀请链接' : '请输入有效的 HTTPS 服务地址或空间邀请链接'); return; }
    setBusy(true);
    try { await runtime.login(target.origin, target.inviteCode); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <ScrollView contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: 'center', backgroundColor: t.bg, paddingHorizontal: t.space.xl }]} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', gap: t.space.md, marginBottom: t.space.xl }}>
        <Image
          accessible
          accessibilityIgnoresInvertColors
          accessibilityLabel="DualLane"
          source={brandIcon}
          style={{ width: 88, height: 88, borderRadius: 20 }}
        />
        <Text style={{ fontSize: t.type.title, fontWeight: '700', color: t.text }}>DualLane</Text>
        <Label muted>共享空间 · 聊天和文件会保存到空间</Label>
      </View>
      {configured ? null : (
        <Input
          accessibilityLabel="服务地址或邀请链接"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="HTTPS 服务地址或空间邀请链接"
          value={destination}
          onChangeText={setDestination}
        />
      )}
      <Button title={busy ? '正在登录…' : '使用 GitHub 登录'} disabled={busy || (!configured && !destination.trim())} onPress={() => void login()} />
      {configured ? (
        inviteOpen ? (
          <View style={{ gap: t.space.sm }}>
            <Input
              accessibilityLabel="空间邀请链接（可选）"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="粘贴当前服务的空间邀请链接"
              value={destination}
              onChangeText={setDestination}
            />
            <Label muted>邀请仅用于加入当前服务的空间。已有账号可直接登录。</Label>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="还没有账号？"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={() => setInviteOpen(true)}
            style={{ minHeight: t.hit, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: t.muted, fontSize: 14, lineHeight: 20 }}>还没有账号？</Text>
          </Pressable>
        )
      ) : <Label muted>已有账号可直接登录。邀请仅用于加入当前服务的空间。</Label>}
      <InlineFeedback text={error} tone="danger" />
    </ScrollView>
  );
}
