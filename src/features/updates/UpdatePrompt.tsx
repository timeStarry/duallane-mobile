import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { Text } from '../../ui/Text';
import { z } from 'zod';
import { Runtime } from '../../data/runtime';
import { useWorkspace } from '../../domain/store';
import { updateDecision, updateTarget } from '../../domain/updates';
import { installed } from '../../platform/config';
import { cache } from '../../platform/storage';
import { Button, Label } from '../../ui/components';
import { useTheme } from '../../ui/theme';

export function UpdatePrompt({ runtime }: { runtime: Runtime }) {
  const policy = useWorkspace(s => s.policy);
  const release = useWorkspace(s => s.release);
  const checking = useWorkspace(s => s.releaseCheck.status === 'checking');
  const [deferred, setDeferred] = useState('');
  const t = useTheme();
  const decision = updateDecision(policy, installed, release);
  const target = updateTarget(policy, release, installed);
  if (!target) return null;
  const dismissed = z.number().catch(0).parse(cache.get(`defer:${target.releaseId}`) ?? 0);
  if (decision === 'none' || (decision !== 'forced' && (deferred === target.releaseId || dismissed > Date.now()))) return null;
  return (
    <View accessibilityViewIsModal={decision === 'forced'} style={{ padding: t.space.lg, gap: t.space.md, backgroundColor: t.elevated, borderTopWidth: 1, borderTopColor: t.line }}>
      <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text }}>
        {decision === 'forced' ? '请更新后继续使用' : decision === 'strong' ? '建议尽快更新' : '发现新版本'}
      </Text>
      <Label>{`可用版本 ${target.appVersion}`}</Label>
      {target.releaseNotes.length ? <Text numberOfLines={3} style={{color:t.muted,fontSize:15,lineHeight:22}}>{target.releaseNotes.join('\n')}</Text> : null}
      {target.apkUrl ? <Button title="下载更新" onPress={() => void Linking.openURL(target.apkUrl!)} /> : <Label muted>安装包暂未发布，请联系空间维护者。</Label>}
      <Button title={checking ? '正在检查更新' : '重新检查'} disabled={checking} secondary onPress={() => void runtime.checkUpdates()} />
      {decision !== 'forced' && (
        <Button
          title="稍后提醒"
          secondary
          onPress={() => {
            cache.set(`defer:${target.releaseId}`, Date.now() + 86400000);
            setDeferred(target.releaseId);
          }}
        />
      )}
    </View>
  );
}
