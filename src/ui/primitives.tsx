import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useTheme } from './theme';

export function Label({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  const t = useTheme();
  return <Text style={{ fontSize: t.type.body, lineHeight: t.type.bodyLine, color: muted ? t.muted : t.text }}>{children}</Text>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  variant,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  variant?: ButtonVariant;
}) {
  const t = useTheme();
  const resolved: ButtonVariant = variant ?? (secondary ? 'secondary' : 'primary');
  const palette = {
    primary: { backgroundColor: t.shared, color: t.onShared },
    secondary: { backgroundColor: t.soft, color: t.text },
    danger: { backgroundColor: t.dangerSoft, color: t.danger },
    ghost: { backgroundColor: 'transparent', color: t.shared },
  }[resolved];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: t.space.lg,
        paddingVertical: t.space.md,
        minHeight: t.hit,
        borderRadius: t.radius.control,
        backgroundColor: palette.backgroundColor,
        opacity: disabled ? t.disabledOpacity : pressed ? t.pressedOpacity : 1,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Text style={{ color: palette.color, fontWeight: '600', fontSize: t.type.control }}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({
  label,
  onPress,
  children,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        minWidth: t.hit,
        minHeight: t.hit,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? t.disabledOpacity : pressed ? t.pressedOpacity : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

export function Input(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={t.muted}
      style={[
        {
          minHeight: t.hit,
          padding: t.space.md,
          borderRadius: t.radius.input,
          borderWidth: 1,
          borderColor: t.line,
          color: t.text,
          backgroundColor: t.surface,
          fontSize: t.type.body,
        },
        props.style,
      ]}
    />
  );
}

export function Notice({ text }: { text: string }) {
  const t = useTheme();
  return text ? (
    <Text accessibilityLiveRegion="polite" style={{ color: t.warning, padding: t.space.md, fontSize: 14, lineHeight: 20 }}>
      {text}
    </Text>
  ) : null;
}

export function InlineFeedback({
  text,
  tone = 'warning',
}: {
  text: string;
  tone?: 'warning' | 'success' | 'danger' | 'info';
}) {
  const t = useTheme();
  const colors = {
    warning: { backgroundColor: t.warningSoft, color: t.warning },
    success: { backgroundColor: t.successSoft, color: t.success },
    danger: { backgroundColor: t.dangerSoft, color: t.danger },
    info: { backgroundColor: t.sharedSoft, color: t.shared },
  }[tone];
  if (!text) return null;
  return (
    <View style={{ backgroundColor: colors.backgroundColor, padding: t.space.md, borderRadius: t.radius.control }}>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.color, fontSize: t.type.control, lineHeight: 22 }}>
        {text}
      </Text>
    </View>
  );
}

export function Loading({ label = '正在加载' }: { label?: string }) {
  return <ActivityIndicator accessibilityLabel={label} style={{ padding: 24 }} />;
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={{ padding: 32 }}>
      <Label muted>{text}</Label>
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  const t = useTheme();
  return (
    <View style={{ padding: t.space.xxl, gap: t.space.sm, alignItems: 'center' }}>
      <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text, textAlign: 'center' }}>{title}</Text>
      {detail ? <Text style={{ fontSize: t.type.control, lineHeight: 22, color: t.muted, textAlign: 'center' }}>{detail}</Text> : null}
    </View>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', backgroundColor: t.soft, borderRadius: t.radius.control, padding: 2 }}
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: t.hit,
              borderRadius: t.radius.control - 2,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? t.surface : 'transparent',
            }}
          >
            <Text style={{ color: selected ? t.text : t.muted, fontWeight: selected ? '600' : '500', fontSize: t.type.control }}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SettingRow({
  title,
  detail,
  onPress,
  danger = false,
}: {
  title: string;
  detail?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  const content = (
    <View style={[styles.setting, { borderBottomColor: t.line, minHeight: t.hit }]}>
      <Text style={{ fontSize: t.type.body, color: danger ? t.danger : t.text, fontWeight: '500' }}>{title}</Text>
      {detail ? <Text style={{ fontSize: t.type.meta, color: t.muted, marginTop: 2 }}>{detail}</Text> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={detail ? `${title}，${detail}` : title} onPress={onPress}>
      {({ pressed }) => <View style={{ opacity: pressed ? t.pressedOpacity : 1 }}>{content}</View>}
    </Pressable>
  );
}

export function Dialog({
  visible,
  title,
  children,
  onRequestClose,
  actions,
}: {
  visible: boolean;
  title: string;
  children?: React.ReactNode;
  onRequestClose: () => void;
  actions: { title: string; onPress: () => void; variant?: ButtonVariant }[];
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onRequestClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭对话框"
        onPress={onRequestClose}
        style={{ flex: 1, backgroundColor: 'rgba(32,44,50,0.4)', justifyContent: 'center', padding: t.space.xl }}
      >
        <Pressable
          accessibilityViewIsModal
          accessibilityRole="summary"
          accessibilityLabel={title}
          onPress={() => undefined}
          style={{ backgroundColor: t.elevated, borderRadius: t.radius.dialog, padding: t.space.lg, gap: t.space.md }}
        >
          <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text }}>{title}</Text>
          {children}
          <View style={{ gap: t.space.sm }}>
            {actions.map(action => (
              <Button key={action.title} title={action.title} variant={action.variant} onPress={action.onPress} />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ObjectActionSheet({
  visible,
  title,
  detail,
  actions,
  onRequestClose,
}: {
  visible: boolean;
  title: string;
  detail?: string;
  actions: { id: string; title: string; onPress: () => void; danger?: boolean; disabled?: boolean }[];
  onRequestClose: () => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onRequestClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(32,44,50,0.4)' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭动作" style={{ flex: 1 }} onPress={onRequestClose} />
        <View style={{ backgroundColor: t.elevated, borderTopLeftRadius: t.radius.dialog, borderTopRightRadius: t.radius.dialog, padding: t.space.lg, gap: t.space.sm }}>
          <Text style={{ fontSize: t.type.section, fontWeight: '600', color: t.text }}>{title}</Text>
          {detail ? <Text style={{ fontSize: t.type.meta, color: t.muted }}>{detail}</Text> : null}
          {actions.map(action => (
            <Button
              key={action.id}
              title={action.title}
              disabled={action.disabled}
              variant={action.danger ? 'danger' : 'secondary'}
              onPress={() => {
                onRequestClose();
                action.onPress();
              }}
            />
          ))}
          <Button title="取消" variant="ghost" onPress={onRequestClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  setting: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
});
