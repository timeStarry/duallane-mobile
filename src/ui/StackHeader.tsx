import React from 'react';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { ChevronLeft } from 'lucide-react-native';
import { AppHeader } from './chrome';
import { IconButton } from './primitives';
import { useTheme } from './theme';

export function StackHeader({ options, route, back, navigation }: NativeStackHeaderProps) {
  const t = useTheme();
  return (
    <AppHeader
      title={options.title ?? route.name}
      includeTopInset
      leading={back ? (
        <IconButton label="返回" onPress={() => navigation.goBack()}>
          <ChevronLeft color={t.text} size={24} />
        </IconButton>
      ) : undefined}
    />
  );
}
