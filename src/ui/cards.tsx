import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
  revision?: number;
  release?: EchoReleaseView;
  payload: Record<string, unknown>;
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function voteOptions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const option = item as Record<string, unknown>;
    return typeof option.id === 'string' && typeof option.label === 'string' ? [{ id: option.id, label: option.label }] : [];
  });
}

function registeredCardActions(cardType: string, actions: string[], status?: string) {
  if (status && status !== 'active') return [];
  const allowed = cardType === 'echo.solicitation' ? ['vote']
    : cardType === 'echo.request' || cardType === 'echo.request-status' ? ['collect', 'start', 'implement']
      : ['open_topic', 'join_topic'];
  return actions.filter(action => allowed.includes(action));
}

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
    payload: {},
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
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
          payload: {},
        });
        return;
      }
      const payload = card.payload ?? {};
      const title = stringValue(payload.title) || card.fallbackText || block.fallbackText;
      setSelectedOptionIds(stringArray(payload.selectedOptionIds));
      setModel({
        cardType,
        title,
        summary: stringValue(payload.summary) || stringValue(payload.description) || stringValue(payload.descriptionPreview) || stringValue(payload.messagePreview),
        status: card.status && card.status !== 'active' ? card.status : '',
        topicId: stringValue(payload.topicId),
        actions: registeredCardActions(cardType, card.actions, card.status),
        revision: typeof card.revision === 'number' ? card.revision : undefined,
        release: cardType === 'echo.release' ? echoReleaseView(payload, title) : undefined,
        payload,
      });
    }).catch(caught => { if (!cancelled) setError(errorText(caught)); });
    return () => { cancelled = true; };
  }, [block.cardId, block.cardType, block.fallbackText, runtime]);
  if (model.release) return <EchoReleaseCard view={model.release} status={model.status} error={error} />;
  const kind = echoKindLabel(model.cardType);
  const open = model.topicId && model.actions.includes('open_topic') ? () => onOpenTopic?.(model.topicId) : undefined;
  const options = model.cardType === 'echo.solicitation' ? voteOptions(model.payload.options) : [];
  const multiple = model.payload.choiceMode === 'multiple';
  const state = stringValue(model.payload.status) || stringValue(model.payload.state);
  const requirementAction = state === 'pending_review' ? 'collect' : state === 'planned' ? 'start' : state === 'in_progress' ? 'implement' : '';
  const actionTitle: Record<string, string> = { join_topic: '加入话题', collect: '转为正式需求', start: '开始处理', implement: '标记已交付' };
  const execute = (action: string, input: Record<string, unknown> = {}) => {
    if (!runtime || busy) return;
    setError('');
    setBusy(action);
    void runtime.cardAction(block.cardId, action, model.actions, model.revision, input).then(() => runtime.resolveCard(block.cardId)).then(card => {
      if (action === 'join_topic' && model.topicId) onOpenTopic?.(model.topicId);
      setModel(current => ({ ...current, actions: registeredCardActions(current.cardType, card.actions, card.status), revision: card.revision, payload: card.payload ?? current.payload, status: card.status && card.status !== 'active' ? card.status : '' }));
      setSelectedOptionIds(stringArray(card.payload?.selectedOptionIds));
    }).catch(caught => setError(errorText(caught))).finally(() => setBusy(''));
  };
  return (
    <View accessible accessibilityLabel={[kind, model.title, model.summary].filter(Boolean).join(' ')} style={{ gap: 8, padding: 8, borderRadius: t.radius.control, backgroundColor: t.soft }}>
      {kind ? <Label muted>{kind}</Label> : null}
      <Text style={{ color: t.text, fontWeight: '600' }}>{model.title}</Text>
      {model.summary ? <Text style={{ color: t.text, fontSize: t.type.body }}>{model.summary}</Text> : null}
      {model.status ? <Label muted>{model.status}</Label> : null}
      {error ? <Label muted>{error}</Label> : null}
      {open ? <Button title="打开话题" secondary onPress={open} /> : null}
      {model.actions.includes('vote') && options.length ? (
        <View style={{ gap: 8 }}>
          <Label muted>{stringValue(model.payload.question) || '选择投票选项'}</Label>
          {options.map(option => {
            const selected = selectedOptionIds.includes(option.id);
            return (
              <Pressable key={option.id} accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityLabel={option.label} accessibilityState={{ checked: selected }} onPress={() => setSelectedOptionIds(current => multiple ? selected ? current.filter(id => id !== option.id) : [...current, option.id] : [option.id])} style={{ minHeight: t.hit, padding: 10, borderRadius: t.radius.control, backgroundColor: selected ? t.sharedSoft : t.surface, justifyContent: 'center' }}>
                <Text style={{ color: t.text }}>{selected ? '✓ ' : ''}{option.label}</Text>
              </Pressable>
            );
          })}
          <Button title="提交投票" secondary disabled={!!busy || !selectedOptionIds.length} onPress={() => execute('vote', { optionIds: selectedOptionIds })} />
        </View>
      ) : null}
      {model.actions.filter(action => action === 'join_topic' || action === requirementAction).map(action => (
        <Button
          key={action}
          title={actionTitle[action] ?? action}
          secondary
          disabled={!!busy}
          onPress={() => execute(action)}
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
