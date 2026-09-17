import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import type { Block } from '../domain/contracts';
import { Runtime } from '../data/runtime';
import { errorText } from '../data/client';
import { Button, Label } from './primitives';
import { useTheme } from './theme';

export function WorkspaceCard({
  block,
  runtime,
  onOpenTopic,
}: {
  block: Extract<Block, { type: 'card' }>;
  runtime?: Runtime;
  onOpenTopic?: (topicId: string) => void;
}) {
  const t = useTheme();
  const [title, setTitle] = useState(block.fallbackText);
  const [status, setStatus] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [topicId, setTopicId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void runtime.resolveCard(block.cardId).then(card => {
      if (cancelled) return;
      if (card.type === 'card_fallback' || (card.block.cardType && !isSupported(card.block.cardType, card.block.schemaVersion))) {
        setTitle(card.fallbackText || block.fallbackText);
        setStatus('此卡片暂不支持交互');
        setActions([]);
        return;
      }
      const payload = card.payload ?? {};
      setTitle(stringValue(payload.title) || card.fallbackText || block.fallbackText);
      setStatus(card.status && card.status !== 'active' ? card.status : '');
      setTopicId(stringValue(payload.topicId));
      setActions(card.actions.filter(action => ['open_topic', 'join_topic'].includes(action) || action.startsWith('workspace.')));
    }).catch(caught => { if (!cancelled) setError(errorText(caught)); });
    return () => { cancelled = true; };
  }, [block.cardId, block.fallbackText, runtime]);
  const open = topicId ? () => onOpenTopic?.(topicId) : undefined;
  return (
    <View style={{ gap: 8, padding: 8, borderRadius: t.radius.control, backgroundColor: t.soft }}>
      <Text style={{ color: t.text, fontWeight: '600' }}>{title}</Text>
      {status ? <Label muted>{status}</Label> : null}
      {error ? <Label muted>{error}</Label> : null}
      {open ? <Button title="打开话题" secondary onPress={open} /> : null}
      {actions.filter(action => action !== 'open_topic').map(action => (
        <Button
          key={action}
          title={action === 'join_topic' ? '加入话题' : action}
          secondary
          disabled={!!busy}
          onPress={() => {
            if (!runtime) return;
            setBusy(action);
            void runtime.cardAction(block.cardId, action, actions).then(() => { if (action === 'join_topic' && topicId) onOpenTopic?.(topicId); }).catch(caught => setError(errorText(caught))).finally(() => setBusy(''));
          }}
        />
      ))}
    </View>
  );
}

function isSupported(type: string, version?: number) {
  const key = `${type}@${version ?? 1}`;
  return key === 'workspace.topic-created@1' || key === 'workspace.topic-message-synced@1' || type.startsWith('echo.');
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}
