import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Files, MessageCircle, UserRound, Users } from 'lucide-react-native';
import { useTheme } from './theme';

const ICONS = { 聊天: MessageCircle, 文件: Files, 成员: Users, 我的: UserRound } as const;

export function DualLaneTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: t.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.line,
        paddingBottom: insets.bottom,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const options = descriptors[route.key]?.options;
        const label = options?.tabBarLabel ?? options?.title ?? route.name;
        const Icon = ICONS[route.name as keyof typeof ICONS] ?? MessageCircle;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={typeof label === 'string' ? label : route.name}
            onPress={() => navigation.navigate(route.name)}
            style={{
              flex: 1,
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 8,
              paddingTop: t.space.sm,
            }}
          >
            <Icon color={focused ? t.shared : t.muted} size={22} />
            <Text style={{ color: focused ? t.text : t.muted, fontSize: t.type.meta, marginTop: 2 }}>
              {typeof label === 'string' ? label : route.name}
            </Text>
            <View style={{ height: 7, width: '100%', justifyContent: 'flex-end' }}>
              <View style={{ height: 2, marginHorizontal: 8, backgroundColor: focused ? t.shared : 'transparent' }} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
