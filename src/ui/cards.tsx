import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MapPin, Megaphone } from 'lucide-react-native';
import type { Block } from '../domain/contracts';
import { echoKindLabel, echoReleaseView, type EchoReleaseView } from '../domain/echo-release';
import { Runtime } from '../data/runtime';
import { errorText } from '../data/client';
import { Button, Label } from './primitives';
import { useTheme } from './theme';

type CardModel = {
  cardType: string;
  title: string;
  summary: string;
  status: string;
  topicId: string;
  actions: string[];
  release?: EchoReleaseView;
};

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
  const [model, setModel] = useState<CardModel>({
    cardType: block.cardType,
    title: block.fallbackText,
    summary: '',
    status: '',
    topicId: '',
    actions: [],
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void runtime.resolveCard(block.cardId).then(card => {
      if (cancelled) return;
      const cardType = card.block.cardType || block.cardType;
      if (card.type === 'card_fallback' || (cardType && !isSupported(cardType, card.block.schemaVersion))) {
        setModel({
          cardType,
          title: card.fallbackText || block.fallbackText,
          summary: '',
          status: '此卡片暂不支持交互',
          topicId: '',
          actions: [],
        });
        return;
      }
      const payload = card.payload ?? {};
      const title = stringValue(payload.title) || card.fallbackText || block.fallbackText;
      setModel({
        cardType,
        title,
        summary: stringValue(payload.summary) || stringValue(payload.description) || stringValue(payload.descriptionPreview) || stringValue(payload.messagePreview),
        status: card.status && card.status !== 'active' ? card.status : '',
        topicId: stringValue(payload.topicId),
        actions: card.actions.filter(action => action === 'open_topic' || action === 'join_topic'),
        release: cardType === 'echo.release' ? echoReleaseView(payload, title) : undefined,
      });
    }).catch(caught => { if (!cancelled) setError(errorText(caught)); });
    return () => { cancelled = true; };
  }, [block.cardId, block.cardType, block.fallbackText, runtime]);
  if (model.release) return <EchoReleaseCard view={model.release} status={model.status} error={error} />;
  const kind = echoKindLabel(model.cardType);
  const open = model.topicId ? () => onOpenTopic?.(model.topicId) : undefined;
  return (
    <View accessible accessibilityLabel={[kind, model.title, model.summary].filter(Boolean).join(' ')} style={{ gap: 8, padding: 8, borderRadius: t.radius.control, backgroundColor: t.soft }}>
      {kind ? <Label muted>{kind}</Label> : null}
      <Text style={{ color: t.text, fontWeight: '600' }}>{model.title}</Text>
      {model.summary ? <Text style={{ color: t.text, fontSize: t.type.body }}>{model.summary}</Text> : null}
      {model.status ? <Label muted>{model.status}</Label> : null}
      {error ? <Label muted>{error}</Label> : null}
      {open ? <Button title="打开话题" secondary onPress={open} /> : null}
      {model.actions.filter(action => action !== 'open_topic').map(action => (
        <Button
          key={action}
          title={action === 'join_topic' ? '加入话题' : action}
          secondary
          disabled={!!busy}
          onPress={() => {
            if (!runtime) return;
            setBusy(action);
            void runtime.cardAction(block.cardId, action, model.actions).then(() => { if (action === 'join_topic' && model.topicId) onOpenTopic?.(model.topicId); }).catch(caught => setError(errorText(caught))).finally(() => setBusy(''));
          }}
        />
      ))}
    </View>
  );
}

function EchoReleaseCard({ view, status, error }: { view: EchoReleaseView; status: string; error: string }) {
  const t = useTheme();
  const meta = ['版本更新', view.version ? `v${view.version}` : '', view.releasedAt].filter(Boolean).join(' · ');
  return (
    <View accessible accessibilityLabel={`DualLane ${view.version ? `v${view.version} ` : ''}版本更新 ${view.title}`} style={{ gap: 10, padding: 8, borderRadius: t.radius.control, backgroundColor: t.soft }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Megaphone size={18} color={t.shared} />
        <View style={{ flex: 1, gap: 4 }}>
          <Label muted>{meta}</Label>
          <Text style={{ color: t.text, fontWeight: '600', fontSize: t.type.body }}>{view.title}</Text>
          {view.summary ? <Text style={{ color: t.text, fontSize: t.type.body }}>{view.summary}</Text> : null}
        </View>
      </View>
      {view.sections.map((section, sectionIndex) => (
        <View key={`${section.title}-${sectionIndex}`} style={{ gap: 8 }}>
          {section.title ? <Text style={{ color: t.muted, fontSize: t.type.meta, fontWeight: '600' }}>{section.title}</Text> : null}
          {section.items.map((item, itemIndex) => (
            <View key={`${item.title}-${itemIndex}`} style={{ gap: 4 }}>
              {item.title ? <Text style={{ color: t.text, fontWeight: '600' }}>{item.title}</Text> : null}
              {item.description ? <Text style={{ color: t.text, fontSize: t.type.body }}>{item.description}</Text> : null}
              {item.location ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MapPin size={14} color={t.muted} />
                  <Text style={{ color: t.muted, fontSize: t.type.meta, flex: 1 }}>{item.location}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ))}
      {status ? <Label muted>{status}</Label> : null}
      {error ? <Label muted>{error}</Label> : null}
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
