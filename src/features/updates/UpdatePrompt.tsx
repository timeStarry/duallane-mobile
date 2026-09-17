import React, { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { z } from 'zod';
import { Runtime } from '../../data/runtime';
import { useWorkspace } from '../../domain/store';
import { updateDecision } from '../../domain/updates';
import { installed } from '../../platform/config';
import { cache } from '../../platform/storage';
import { Button, Label } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function UpdatePrompt({ runtime }: { runtime: Runtime }) {
  const policy = useWorkspace(s => s.policy);
  const [deferred, setDeferred] = useState('');
  const t = useTheme();
  if (!policy) return null;
  const decision = updateDecision(policy, installed);
  const dismissed = z.number().catch(0).parse(cache.get(`defer:${policy.latest.releaseId}`) ?? 0);
  if (decision === 'none' || (decision !== 'forced' && (deferred === policy.latest.releaseId || dismissed > Date.now()))) return null;
  return (
    <View accessibilityViewIsModal={decision === 'forced'} style={{ padding: t.space.lg, gap: t.space.md, backgroundColor: t.elevated, borderTopWidth: 1, borderTopColor: t.line }}>
      <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text }}>
        {decision === 'forced' ? '请更新后继续使用' : decision === 'strong' ? '建议尽快更新' : '发现新版本'}
      </Text>
      <Label>{policy.latest.releaseNotes.join('\n') || `可用版本 ${policy.latest.appVersion}`}</Label>
      {policy.apkUrl ? <Button title="下载更新" onPress={() => void Linking.openURL(policy.apkUrl!)} /> : <Label muted>安装包暂未发布，请联系空间维护者。</Label>}
      <Button title="重新检查" secondary onPress={() => void runtime.checkPolicy()} />
      {decision !== 'forced' && (
        <Button
          title="稍后提醒"
          secondary
          onPress={() => {
            cache.set(`defer:${policy.latest.releaseId}`, Date.now() + 86400000);
            setDeferred(policy.latest.releaseId);
          }}
        />
      )}
    </View>
  );
}
