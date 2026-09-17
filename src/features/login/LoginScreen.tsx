import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Runtime } from '../../data/runtime';
import { errorText } from '../../data/client';
import { config, loginTarget } from '../../platform/config';
import { Button, InlineFeedback, Input, Label, styles } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function LoginScreen({ runtime }: { runtime: Runtime }) {
  const [destination, setDestination] = useState('');
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
    <ScrollView contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: 'center', backgroundColor: t.bg }]} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: t.type.title, fontWeight: '700', color: t.text }}>DualLane</Text>
      <Label>共享空间 · 聊天和文件会保存到空间</Label>
      <Input
        accessibilityLabel={configured ? '空间邀请链接（可选）' : '服务地址或邀请链接'}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={configured ? '空间邀请链接（已有账号可直接登录）' : 'HTTPS 服务地址或空间邀请链接'}
        value={destination}
        onChangeText={setDestination}
      />
      <Label muted>已有账号可直接登录。邀请仅用于加入当前服务的空间。</Label>
      <Button title={busy ? '正在登录…' : '使用 GitHub 登录'} disabled={busy || (!configured && !destination.trim())} onPress={() => void login()} />
      <InlineFeedback text={error} tone="danger" />
    </ScrollView>
  );
}
