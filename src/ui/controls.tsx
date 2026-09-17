import React, { useState } from 'react';
import { Pressable, Switch, StyleSheet, Text, View } from 'react-native';
import { Button, EmptyState, Loading, ObjectActionSheet } from './primitives';
import { useTheme } from './theme';

export function SwitchRow({
  title,
  detail,
  value,
  onValueChange,
  disabled = false,
}: {
  title: string;
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: t.hit,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: t.line,
        gap: t.space.md,
        opacity: disabled ? t.disabledOpacity : 1,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: t.type.body, color: t.text, fontWeight: '500' }}>{title}</Text>
        {detail ? <Text style={{ fontSize: t.type.meta, color: t.muted, marginTop: 2 }}>{detail}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={title}
        accessibilityState={{ disabled, checked: value }}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: t.line, true: t.shared }}
        thumbColor={t.surface}
      />
    </View>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const current = options.find(option => option.value === value);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}，${current?.label ?? ''}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          paddingHorizontal: t.space.lg,
          paddingVertical: t.space.md,
          minHeight: t.hit,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: t.line,
          opacity: disabled ? t.disabledOpacity : pressed ? t.pressedOpacity : 1,
        })}
      >
        <Text style={{ fontSize: t.type.body, color: t.text, fontWeight: '500' }}>{label}</Text>
        <Text style={{ fontSize: t.type.meta, color: t.muted, marginTop: 2 }}>{current?.label}</Text>
      </Pressable>
      <ObjectActionSheet
        visible={open}
        title={label}
        onRequestClose={() => setOpen(false)}
        actions={options.map(option => ({
          id: option.value,
          title: option.label,
          onPress: () => onChange(option.value),
        }))}
      />
    </>
  );
}

export function PageState({
  status,
  emptyTitle,
  emptyDetail,
  error,
  onRetry,
  children,
}: {
  status: 'loading' | 'ready' | 'empty' | 'error';
  emptyTitle: string;
  emptyDetail?: string;
  error?: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}) {
  if (status === 'loading') return <Loading />;
  if (status === 'error') {
    return (
      <View>
        <EmptyState title="无法加载" detail={error || '请稍后重试'} />
        {onRetry ? <View style={{ paddingHorizontal: 16 }}><Button title="重试" secondary onPress={onRetry} /></View> : null}
      </View>
    );
  }
  if (status === 'empty') return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return <>{children}</>;
}
