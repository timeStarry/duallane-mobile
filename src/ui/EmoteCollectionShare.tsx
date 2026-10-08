import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, View, useWindowDimensions } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText } from '../data/client';
import type { EmoteShare, Runtime } from '../data/runtime';
import type { Block } from '../domain/contracts';
import { useWorkspace } from '../domain/store';
import { Button } from './primitives';
import { RemoteImage } from './RemoteImage';
import { useTheme } from './theme';
import { WindowSafeArea } from './WindowSafeArea';

type ShareSummary = Extract<Block, { type: 'emote_collection' }>['share'];

/** The summary is message content; the detail always comes from an authorized GET. */
export function EmoteCollectionShare({ shareId, summary, runtime }: {
  shareId: string;
  summary?: ShareSummary;
  runtime?: Runtime;
}) {
  const t = useTheme();
  const accountKey = useWorkspace(state => state.accountKey);
  const userId = useWorkspace(state => state.bootstrap?.auth.currentUser.id);
  const api = runtime?.api;
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<EmoteShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [imported, setImported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const interactionIdentity = useRef({ accountKey, userId, shareId, runtime, api });
  interactionIdentity.current = { accountKey, userId, shareId, runtime, api };
  const inFlight = useRef<object | null>(null);
  const alive = useRef(true);
  const { width } = useWindowDimensions();
  const identityCurrent = (started: typeof interactionIdentity.current) => {
    const latest = interactionIdentity.current;
    const state = useWorkspace.getState();
    return alive.current && latest.accountKey === started.accountKey && latest.userId === started.userId
      && latest.shareId === started.shareId && latest.runtime === started.runtime && latest.api === started.api
      && state.accountKey === started.accountKey && state.bootstrap?.auth.currentUser.id === started.userId
      && started.runtime?.api === started.api;
  };

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setOpen(false);
    setShare(null);
    setImported(false);
    setSubscribed(false);
    setLoading(false);
    setImporting(false);
    setError('');
    inFlight.current = null;
  }, [accountKey, userId, shareId, runtime, api]);
  useEffect(() => {
    if (!open || !runtime) return;
    let current = true;
    const started = { accountKey, userId, shareId, runtime, api };
    setLoading(true);
    setError('');
    setShare(null);
    void runtime.emoteShare(shareId).then(value => {
      if (current && identityCurrent(started)) setShare(value);
    }).catch(cause => {
      if (current && identityCurrent(started)) setError(errorText(cause));
    }).finally(() => {
      if (current && identityCurrent(started)) setLoading(false);
    });
    return () => { current = false; };
  }, [open, runtime, shareId, accountKey, userId, api, retry]);

  const unavailable = !!summary?.revokedAt;
  const displayName = summary?.name?.trim() || '表情合集';
  const cellSize = Math.min(88, Math.max(64, Math.floor((width - 32 - 3 * 8) / 4)));

  async function importShare() {
    if (!runtime || !share || share.id !== shareId || share.revokedAt || importing || imported || inFlight.current) return;
    const started = { ...interactionIdentity.current };
    if (!identityCurrent(started)) return;
    const invocation = {};
    inFlight.current = invocation;
    const current = () => inFlight.current === invocation && identityCurrent(started);
    setImporting(true);
    setError('');
    try {
      await runtime.importEmoteShare(share.id, subscribed && share.canSubscribeToSourceChanges);
      if (current()) setImported(true);
    } catch (cause) {
      if (current()) setError(errorText(cause));
    } finally {
      if (current()) setImporting(false);
      if (inFlight.current === invocation) inFlight.current = null;
    }
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={unavailable ? '表情合集已停止分享' : `打开表情合集 ${displayName}`}
        accessibilityState={{ disabled: unavailable || !runtime }}
        disabled={unavailable || !runtime}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 72, padding: t.space.md, borderWidth: 1, borderColor: t.line,
          borderRadius: t.radius.entity, backgroundColor: t.surface,
          opacity: unavailable || !runtime ? t.disabledOpacity : pressed ? t.pressedOpacity : 1,
        })}
      >
        <Text style={{ color: t.shared, fontWeight: '700', fontSize: t.type.control }}>
          {unavailable ? '合集已停止分享' : displayName}
        </Text>
        <Text style={{ color: t.muted, fontSize: t.type.meta, marginTop: 4 }}>
          {unavailable ? '历史消息仍保留，无法预览或导入' : `${summary?.itemCount ?? '多'} 张表情 · 点按预览`}
        </Text>
      </Pressable>
      <Modal visible={open} statusBarTranslucent navigationBarTranslucent animationType={t.reduceMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(false)}>
        <WindowSafeArea>
        <CollectionPreviewSurface>
          <View style={{ paddingHorizontal: t.space.lg, paddingVertical: t.space.sm, flexDirection: 'row', alignItems: 'center', gap: t.space.sm }}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={{ color: t.text, fontSize: t.type.section, fontWeight: '700' }} numberOfLines={2}>
                {share?.name ?? displayName}
              </Text>
              <Text style={{ color: t.muted, fontSize: t.type.meta }}>表情合集</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="关闭表情合集预览" onPress={() => setOpen(false)} style={{ minWidth: t.hit, minHeight: t.hit, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: t.shared, fontSize: t.type.control }}>关闭</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}>
            {loading ? <View accessibilityLabel="正在读取表情合集" style={{ padding: t.space.xl }}><ActivityIndicator color={t.shared} /></View> : null}
            {!loading && !share && error ? (
              <View style={{ gap: t.space.md }}>
                <Text accessibilityLiveRegion="polite" style={{ color: t.muted, fontSize: t.type.body }}>{error}</Text>
                <Button title="重试读取" secondary onPress={() => setRetry(value => value + 1)} />
              </View>
            ) : null}
            {share?.revokedAt ? <Text style={{ color: t.muted, fontSize: t.type.body }}>合集已停止分享，无法预览或导入。</Text> : null}
            {share && !share.revokedAt ? (
              <>
                <Text style={{ color: t.muted, fontSize: t.type.meta }}>
                  {share.itemCount} 张 · {share.originalCreator.displayName} 创建 · {share.sharedBy.displayName} 分享
                </Text>
                {share.canSubscribeToSourceChanges ? (
                  <View style={{ backgroundColor: t.surface, borderRadius: t.radius.control, paddingHorizontal: t.space.md, flexDirection: 'row', alignItems: 'center', minHeight: 64 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: t.text, fontSize: t.type.control }}>订阅原作者更新</Text>
                      <Text style={{ color: t.muted, fontSize: t.type.meta }}>导入后自动同步合集内容</Text>
                    </View>
                    <Switch accessibilityLabel="订阅原作者更新" disabled={importing || imported} value={subscribed} onValueChange={setSubscribed} trackColor={{ false: t.line, true: t.shared }} thumbColor={t.surface} />
                  </View>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {share.items.map(item => (
                    <View key={item.id} accessible accessibilityRole="image" accessibilityLabel={`表情 ${item.label}`} style={{ width: cellSize, minHeight: cellSize + 22, alignItems: 'center' }}>
                      {item.src ? <RemoteImage uri={item.src} resizeMode="contain" style={{ width: cellSize - 8, height: cellSize - 8 }} /> : null}
                      <Text numberOfLines={1} style={{ color: t.muted, fontSize: t.type.meta, maxWidth: cellSize }}>{item.label}</Text>
                    </View>
                  ))}
                </View>
                {error ? <Text accessibilityLiveRegion="polite" style={{ color: t.danger, fontSize: t.type.meta }}>{error}</Text> : null}
                {imported ? <Text accessibilityLiveRegion="polite" style={{ color: t.success, fontSize: t.type.body }}>已添加到我的表情</Text> : null}
                <Button title={importing ? '正在添加…' : imported ? '已添加' : '添加整套'} disabled={importing || imported} onPress={() => void importShare()} />
              </>
            ) : null}
          </ScrollView>
        </CollectionPreviewSurface>
        </WindowSafeArea>
      </Modal>
    </>
  );
}

function CollectionPreviewSurface({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return <View testID="emote-share-window" style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>{children}</View>;
}
