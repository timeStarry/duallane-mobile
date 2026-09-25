import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { errorText } from '../data/client';
import type { EmoteShare, Runtime } from '../data/runtime';
import type { Block } from '../domain/contracts';
import { useWorkspace } from '../domain/store';
import { Button } from './primitives';
import { RemoteImage } from './RemoteImage';
import { useTheme } from './theme';

type ShareSummary = Extract<Block, { type: 'emote_collection' }>['share'];

/** The summary is message content; the detail always comes from an authorized GET. */
export function EmoteCollectionShare({ shareId, summary, runtime }: {
  shareId: string;
  summary?: ShareSummary;
  runtime?: Runtime;
}) {
  const t = useTheme();
  const accountKey = useWorkspace(state => state.accountKey);
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<EmoteShare | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [subscribed, setSubscribed] = useState(false);
  const [imported, setImported] = useState(false);
  const [importing, setImporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setOpen(false);
    setShare(null);
    setImported(false);
    setSubscribed(false);
  }, [accountKey, shareId]);
  useEffect(() => {
    if (!open || !runtime) return;
    let current = true;
    setLoading(true);
    setError('');
    setShare(null);
    void runtime.emoteShare(shareId).then(value => {
      if (current) setShare(value);
    }).catch(cause => {
      if (current) setError(errorText(cause));
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [open, runtime, shareId, accountKey, retry]);

  const unavailable = !!summary?.revokedAt;
  const displayName = summary?.name?.trim() || '表情合集';
  const cellSize = Math.min(88, Math.max(64, Math.floor((width - 32 - 3 * 8) / 4)));

  async function importShare() {
    if (!runtime || !share || share.revokedAt || importing || imported || inFlight.current) return;
    inFlight.current = true;
    setImporting(true);
    setError('');
    try {
      await runtime.importEmoteShare(share.id, subscribed && share.canSubscribeToSourceChanges);
      if (alive.current) setImported(true);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setImporting(false);
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
      <Modal visible={open} animationType={t.reduceMotion ? 'none' : 'slide'} onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
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
        </View>
      </Modal>
    </>
  );
}
