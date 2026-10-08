import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Text } from './Text';
import type { CatalogPack, CatalogPackItem } from '../domain/emote-catalog';
import { catalogImage } from '../domain/emote-catalog';
import { EmoteImage } from './MessageContent';
import { useTheme } from './theme';

export function CatalogEmoteGrid({
  packs,
  selectedPackId,
  selectedItemKeys,
  onSelectPack,
  onPick,
}: {
  packs: CatalogPack[];
  selectedPackId: string;
  selectedItemKeys?: string[];
  onSelectPack: (id: string) => void;
  onPick: (item: CatalogPackItem, packId: string) => void;
}) {
  const t = useTheme();
  const pack = packs.find(entry => entry.id === selectedPackId) ?? packs[0];
  return (
    <View style={{ gap: t.space.sm }}>
      <ScrollView horizontal accessibilityRole="tablist" accessibilityLabel="表情分组" showsHorizontalScrollIndicator={false}>
        {packs.map(entry => {
          const selected = entry.id === pack?.id;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={entry.label}
              onPress={() => onSelectPack(entry.id)}
              style={{ minHeight: t.hit, paddingHorizontal: t.space.md, justifyContent: 'center' }}
            >
              <Text style={{ color: selected ? t.shared : t.muted, fontWeight: selected ? '600' : '500', fontSize: t.type.control }}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: t.space.sm }}>
        {(pack?.items ?? []).map(item => {
          const selected = selectedItemKeys?.includes(`${pack?.id}:${item.id}`) ?? false;
          const src = item.src ?? catalogImage(item.token ?? `${pack?.id}:${item.id}`)?.src;
          const token = item.token ?? (item.kind === 'unicode' ? item.value ?? item.id : `[${pack?.id}:${item.id}]`);
          return (
            <Pressable
              key={`${pack?.id}:${item.id}`}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={selectedItemKeys ? { selected } : undefined}
              onPress={() => onPick(item, pack?.id ?? selectedPackId)}
              style={{ width: 48, height: 48, borderRadius: t.radius.control, backgroundColor: selected ? t.sharedSoft : undefined, alignItems: 'center', justifyContent: 'center' }}
            >
              {src ? <EmoteImage uri={src} token={token} size={32} /> : <Text style={{ fontSize: 24 }}>{item.value ?? item.label}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
