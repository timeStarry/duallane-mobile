import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { MapPin, Megaphone } from 'lucide-react-native';
import type { Block } from '../domain/contracts';
import { echoKindLabel, echoReleaseView, type EchoReleaseView } from '../domain/echo-release';
import { useWorkspace } from '../domain/store';
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
type CardContext = { conversationId: string; topicId?: string | null };
type CardScope = {
  accountKey: string; api: Runtime['api'] | undefined; runtime: Runtime | undefined;
  cardId: string; cardType: string; schemaVersion: number; fallbackText: string;
  conversationId: string | undefined; topicId: string | undefined;
  readable: boolean; revision: number; syncVersion: number;
};
type ResolvedCard = { scope: CardScope; model: CardModel };

function sameLayoutScope(previous: CardScope, next: CardScope) {
  return previous.accountKey === next.accountKey && previous.api === next.api && previous.runtime === next.runtime
    && previous.cardId === next.cardId && previous.cardType === next.cardType && previous.schemaVersion === next.schemaVersion
    && previous.fallbackText === next.fallbackText && previous.conversationId === next.conversationId && previous.topicId === next.topicId
    && previous.readable && next.readable && previous.revision === next.revision;
}

function canReadCard(context?: CardContext) {
  const state = useWorkspace.getState();
  return !!state.bootstrap?.permissions.canReadConversations && (!context || !!state.conversations[context.conversationId])
    && (!context?.topicId || (!!state.topics[context.topicId]?.joined && state.topics[context.topicId]?.conversationId === context.conversationId));
}

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
  context,
}: {
  block: CardBlock;
  runtime?: Runtime;
  onOpenTopic?: (topicId: string) => void;
  context?: CardContext;
}) {
  const t = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const { cardId, cardType, schemaVersion, fallbackText } = block;
  const conversationId = context?.conversationId;
  const topicId = context?.topicId ?? undefined;
  const accountKey = useWorkspace(state => state.accountKey);
  const revision = useWorkspace(state => state.cardRevisions[cardId] ?? 0);
  const syncVersion = useWorkspace(state => state.cardSyncVersion);
  const readable = useWorkspace(state => !!state.bootstrap?.permissions.canReadConversations && (!conversationId || !!state.conversations[conversationId])
    && (!topicId || (!!state.topics[topicId]?.joined && state.topics[topicId]?.conversationId === conversationId)));
  const api = runtime?.api;
  const scope = useMemo<CardScope>(() => ({ accountKey, api, runtime, cardId, cardType, schemaVersion, fallbackText, conversationId, topicId, readable, revision, syncVersion }),
    [accountKey, api, runtime, cardId, cardType, schemaVersion, fallbackText, conversationId, topicId, readable, revision, syncVersion]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [resolved, setResolved] = useState<ResolvedCard>();
  const model = readable && resolved?.scope === scope ? resolved.model : fallbackModel(block);
  const [measured, setMeasured] = useState<{ scope: CardScope; width: number; windowWidth: number; height: number }>();
  const [layoutWidth, setLayoutWidth] = useState<number>();
  const [failedScope, setFailedScope] = useState<CardScope>();
  // Revalidation still redacts the old body/actions. Reserving its measured
  // height avoids collapsing every mounted card underneath a history reader.
  const reservedHeight = resolved?.scope !== scope && failedScope !== scope && measured && measured.scope.syncVersion !== scope.syncVersion
    && measured.width === layoutWidth && measured.windowWidth === windowWidth && sameLayoutScope(measured.scope, scope) ? measured.height : undefined;
  const onCardLayout = (event: LayoutChangeEvent) => {
    if (activeScope.current !== scope) return;
    const { width, height } = event.nativeEvent.layout;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    setLayoutWidth(previous => previous === width ? previous : width);
    if (readable && resolved?.scope === scope) setMeasured(previous => previous?.scope === scope && previous.width === width && previous.height === height
      ? previous : { scope, width, windowWidth, height });
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const invocation = useRef(0);
  const busyRef = useRef('');
  const current = useCallback((requestedInvocation: number) => {
    const state = useWorkspace.getState();
    return activeScope.current === scope && invocation.current === requestedInvocation && runtime?.api === api
      && state.accountKey === accountKey && canReadCard(conversationId ? { conversationId, topicId } : undefined)
      && (state.cardRevisions[cardId] ?? 0) === revision && state.cardSyncVersion === syncVersion;
  }, [scope, runtime, api, accountKey, conversationId, topicId, cardId, revision, syncVersion]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  useEffect(() => {
    const generation = invocation;
    const currentInvocation = ++generation.current;
    setResolved(undefined);
    setFailedScope(undefined);
    setError('');
    setBusy('');
    busyRef.current = '';
    setSelectedOptionIds([]);
    if (!runtime || !readable) return;
    const requestedBlock: CardBlock = { type: 'card', cardId, cardType, schemaVersion, fallbackText };
    const request = conversationId ? runtime.resolveCard(cardId, { conversationId, topicId }) : runtime.resolveCard(cardId);
    void request.then(card => {
      if (!current(currentInvocation)) return;
      const next = projectCardModel(card, requestedBlock);
      setSelectedOptionIds(stringArray(next.payload.selectedOptionIds));
      setResolved({ scope, model: next });
    }).catch(caught => {
      if (!current(currentInvocation)) return;
      setFailedScope(scope);
      setError(errorText(caught));
    });
    return () => { ++generation.current; };
  }, [cardId, cardType, schemaVersion, fallbackText, runtime, readable, conversationId, topicId, scope, current]);
  if (model.release) return <View testID="workspace-card" onLayout={onCardLayout} style={{ minHeight: reservedHeight }}><EchoReleaseCard view={model.release} status={model.status} error={error} /></View>;
  const kind = echoKindLabel(model.cardType);
  const open = model.topicId && model.actions.includes('open_topic') ? () => onOpenTopic?.(model.topicId) : undefined;
  const options = model.cardType === 'echo.solicitation' ? voteOptions(model.payload.options) : [];
  const multiple = model.payload.choiceMode === 'multiple';
  const state = stringValue(model.payload.status) || stringValue(model.payload.state);
  const requirementAction = state === 'pending_review' ? 'collect' : state === 'planned' ? 'start' : state === 'in_progress' ? 'implement' : '';
  const actionTitle: Record<string, string> = { join_topic: '加入话题', collect: '转为正式需求', start: '开始处理', implement: '标记已交付' };
  const execute = (action: string, input: Record<string, unknown> = {}) => {
    if (!runtime || busyRef.current || !current(invocation.current)) return;
    const currentInvocation = invocation.current;
    busyRef.current = action;
    setError('');
    setBusy(action);
    void runtime.cardAction(block.cardId, action, model.actions, model.revision, input).then(() => {
      if (!current(currentInvocation)) return;
      return conversationId ? runtime.resolveCard(block.cardId, { conversationId, topicId }) : runtime.resolveCard(block.cardId);
    }).then(card => {
      if (!card || !current(currentInvocation)) return;
      if (action === 'join_topic' && model.topicId) onOpenTopic?.(model.topicId);
      const next = projectCardModel(card, block);
      setResolved({ scope, model: next });
      setSelectedOptionIds(stringArray(next.payload.selectedOptionIds));
    }).catch(caught => {
      if (!current(currentInvocation)) return;
      if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
        setFailedScope(scope);
        setResolved(undefined);
      }
      setError(errorText(caught));
    }).finally(() => {
      if (!current(currentInvocation)) return;
      busyRef.current = '';
      setBusy('');
    });
  };
  return (
    <View testID="workspace-card" onLayout={onCardLayout} style={{ minHeight: reservedHeight, gap: 8, padding: 8, borderRadius: t.radius.control, backgroundColor: t.soft }}>
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
  if (state === 'archived') {
    const outcomes: Record<string, string> = {
      implemented: '已实现', rejected: '已驳回', duplicate: '重复提案', withdrawn: '已撤回', cancelled: '已取消',
    };
    const outcome = stringValue(payload.archiveOutcome);
    return (Object.prototype.hasOwnProperty.call(outcomes, outcome) ? outcomes[outcome] : undefined) ?? '已归档';
  }
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
