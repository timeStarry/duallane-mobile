import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MapPin, Megaphone } from 'lucide-react-native';
import type { Block } from '../domain/contracts';
import { echoKindLabel, echoReleaseView, type EchoReleaseView } from '../domain/echo-release';
import type { Runtime } from '../data/runtime';
import { ApiError, errorText } from '../data/client';
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
  requirement?: { stateLabel: string; fields: { label: string; text: string }[] };
  payload: Record<string, unknown>;
};
type CardBlock = Extract<Block, { type: 'card' }>;
type CardResolution = Awaited<ReturnType<Runtime['resolveCard']>>;
type ResolvedCard = { block: CardBlock; runtime: Runtime; model: CardModel };

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
  if (status !== 'active') return [];
  const allowed = cardType === 'echo.solicitation' ? ['vote']
    : cardType === 'echo.request' || cardType === 'echo.request-status' ? ['collect', 'start', 'implement']
      : cardType === 'workspace.topic-created' || cardType === 'workspace.topic-message-synced' ? ['open_topic', 'join_topic']
        : [];
  return actions.filter(action => allowed.includes(action));
}

export function WorkspaceCard({
  block,
  runtime,
  onOpenTopic,
}: {
  block: CardBlock;
  runtime?: Runtime;
  onOpenTopic?: (topicId: string) => void;
}) {
  const t = useTheme();
  const { cardId, cardType, schemaVersion, fallbackText } = block;
  const [resolved, setResolved] = useState<ResolvedCard>();
  const model = resolved && resolved.runtime === runtime &&
    resolved.block.cardId === block.cardId && resolved.block.cardType === block.cardType &&
    resolved.block.schemaVersion === block.schemaVersion && resolved.block.fallbackText === block.fallbackText
    ? resolved.model : fallbackModel(block);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const invocation = useRef(0);
  const busyRef = useRef('');
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  useEffect(() => {
    const generation = invocation;
    const currentInvocation = ++generation.current;
    setResolved(undefined);
    setError('');
    setBusy('');
    busyRef.current = '';
    setSelectedOptionIds([]);
    if (!runtime) return;
    const requestedBlock: CardBlock = { type: 'card', cardId, cardType, schemaVersion, fallbackText };
    void runtime.resolveCard(cardId).then(card => {
      if (generation.current !== currentInvocation) return;
      const next = projectCardModel(card, requestedBlock);
      setSelectedOptionIds(stringArray(next.payload.selectedOptionIds));
      setResolved({ block: requestedBlock, runtime, model: next });
    }).catch(caught => { if (generation.current === currentInvocation) setError(errorText(caught)); });
    return () => { ++generation.current; };
  }, [cardId, cardType, schemaVersion, fallbackText, runtime]);
  if (model.release) return <EchoReleaseCard view={model.release} status={model.status} error={error} />;
  const kind = echoKindLabel(model.cardType);
  const open = model.topicId && model.actions.includes('open_topic') ? () => onOpenTopic?.(model.topicId) : undefined;
  const options = model.cardType === 'echo.solicitation' ? voteOptions(model.payload.options) : [];
  const multiple = model.payload.choiceMode === 'multiple';
  const state = stringValue(model.payload.status) || stringValue(model.payload.state);
  const requirementAction = state === 'pending_review' ? 'collect' : state === 'planned' ? 'start' : state === 'in_progress' ? 'implement' : '';
  const actionTitle: Record<string, string> = { join_topic: '加入话题', collect: '转为正式需求', start: '开始处理', implement: '标记已交付' };
  const execute = (action: string, input: Record<string, unknown> = {}) => {
    if (!runtime || busyRef.current) return;
    const currentInvocation = invocation.current;
    busyRef.current = action;
    setError('');
    setBusy(action);
    void runtime.cardAction(block.cardId, action, model.actions, model.revision, input).then(() => {
      if (invocation.current !== currentInvocation) return;
      return runtime.resolveCard(block.cardId);
    }).then(card => {
      if (!card || invocation.current !== currentInvocation) return;
      if (action === 'join_topic' && model.topicId) onOpenTopic?.(model.topicId);
      const next = projectCardModel(card, block);
      setResolved({ block, runtime, model: next });
      setSelectedOptionIds(stringArray(next.payload.selectedOptionIds));
    }).catch(caught => {
      if (invocation.current !== currentInvocation) return;
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) setResolved(undefined);
      setError(errorText(caught));
    }).finally(() => {
      if (invocation.current !== currentInvocation) return;
      busyRef.current = '';
      setBusy('');
    });
  };
  return (
    <View style={{ gap: 8, padding: 8, borderRadius: t.radius.control, backgroundColor: t.soft }}>
      {kind ? <Label muted>{kind}</Label> : null}
      <Text style={{ color: t.text, fontWeight: '600' }}>{model.title}</Text>
      {model.summary ? <Text style={{ color: t.text, fontSize: t.type.body }}>{model.summary}</Text> : null}
      {model.requirement ? (
        <View style={{ gap: 8 }}>
          <Label muted>{model.requirement.stateLabel}</Label>
          {model.requirement.fields.map(field => (
            <View key={field.label} style={{ gap: 4 }}>
              <Label muted>{field.label}</Label>
              <Text style={{ color: t.text, fontSize: t.type.body }}>{field.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
  return version === 1 && (
    type === 'workspace.topic-created' || type === 'workspace.topic-message-synced' ||
    type === 'echo.solicitation' || type === 'echo.request' || type === 'echo.request-status' ||
    type === 'echo.request-list' || type === 'echo.release'
  );
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function fallbackModel(block: CardBlock, status = ''): CardModel {
  return { cardType: block.cardType, title: block.fallbackText, summary: '', status, topicId: '', actions: [], payload: {} };
}

function projectCardModel(card: CardResolution, block: CardBlock): CardModel {
  const cardType = card.block.cardType || block.cardType;
  if (card.type === 'card_fallback' || !isSupported(cardType, card.block.schemaVersion)) {
    return { ...fallbackModel(block, '此卡片暂不支持交互'), cardType, title: card.fallbackText || block.fallbackText };
  }
  // Only the active actor-authorized projection can contribute business content.
  if (card.status !== 'active') {
    const status = card.status === 'expired' ? '卡片已过期' : card.status === 'invalidated' ? '卡片已失效' : '此卡片暂不可用';
    return { ...fallbackModel(block, status), cardType };
  }
  const payload = card.payload ?? {};
  const isRequirement = cardType === 'echo.request' || cardType === 'echo.request-status';
  const title = boundedText(payload.title, isRequirement ? 120 : 500) || card.fallbackText || block.fallbackText;
  const fieldSpec = [
    { key: 'detail', label: '需求详情', limit: 4_000 },
    { key: 'scenario', label: '使用场景', limit: 2_000 },
    { key: 'expectedResult', label: '期望结果', limit: 2_000 },
    { key: 'response', label: '处理说明', limit: 2_000 },
  ];
  return {
    cardType, title,
    summary: boundedText(payload.summary, 2_000) || boundedText(payload.description, 2_000) || boundedText(payload.descriptionPreview, 2_000) || boundedText(payload.messagePreview, 2_000),
    status: '',
    topicId: stringValue(payload.topicId),
    actions: registeredCardActions(cardType, card.actions, card.status),
    revision: typeof card.revision === 'number' ? card.revision : undefined,
    release: cardType === 'echo.release' ? echoReleaseView(payload, title) : undefined,
    requirement: isRequirement ? {
      stateLabel: requirementStateLabel(payload),
      fields: fieldSpec.flatMap(field => {
        const text = boundedText(payload[field.key], field.limit);
        return text ? [{ label: field.label, text }] : [];
      }),
    } : undefined,
    payload,
  };
}

function requirementStateLabel(payload: Record<string, unknown>) {
  const state = stringValue(payload.status) || stringValue(payload.state) || stringValue(payload.phase);
  const labels: Record<string, string> = {
    pending_review: '待处理', planned: '已计划', in_progress: '进行中', delivered: '已交付', archived: '已归档',
    submitted: '待处理', collected: '已计划', implemented: '已交付', rejected: '已归档',
  };
  return (Object.prototype.hasOwnProperty.call(labels, state) ? labels[state] : undefined) ?? '状态已更新';
}

function boundedText(value: unknown, limit: number) {
  if (typeof value !== 'string') return '';
  let text = '';
  let count = 0;
  for (const point of value.trim()) {
    if (count >= limit) return `${text}…`;
    text += point;
    count += 1;
  }
  return text;
}
