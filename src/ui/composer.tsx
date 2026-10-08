import React, { useState } from 'react';
import { Keyboard, TextInput, View, useWindowDimensions } from 'react-native';
import { Text } from './Text';
import { Ellipsis, Paperclip, Plus, Reply, Send, Smile, X } from 'lucide-react-native';
import { AttachmentPreview } from './files';
import { IconButton, ObjectActionSheet } from './primitives';
import { useTheme } from './theme';
import { composerInputHeights } from './compactComposerLayout';
import { useFontScale } from '../platform/font-scale';

export function ReplyPreview({
  author,
  preview,
  onClear,
}: {
  author: string;
  preview: string;
  onClear?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, backgroundColor: t.soft, borderRadius: t.radius.control, padding: t.space.sm }}>
      <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: t.shared, borderRadius: 2 }} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: t.shared, fontSize: t.type.meta, fontWeight: '600' }}>回复 {author}</Text>
        <Text style={{ color: t.muted, fontSize: t.type.control }} numberOfLines={2}>{preview}</Text>
      </View>
      {onClear ? <IconButton label="取消回复" onPress={onClear}><X color={t.muted} size={18} /></IconButton> : null}
    </View>
  );
}

export function Composer({
  value,
  onChangeText,
  onFocus,
  onSend,
  onAttach,
  onEmote,
  sendDisabled = false,
  attachDisabled = false,
  placeholder = '发送消息',
  reply,
  onClearReply,
  attachmentName,
  onClearAttachment,
  compact = false,
  leading,
  trailing,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onFocus?: () => void;
  onSend: () => void;
  onAttach?: () => void;
  onEmote?: () => void;
  sendDisabled?: boolean;
  attachDisabled?: boolean;
  placeholder?: string;
  reply?: { author: string; preview: string };
  onClearReply?: () => void;
  attachmentName?: string;
  onClearAttachment?: () => void;
  compact?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const fontScale = useFontScale();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [leadingWidth, setLeadingWidth] = useState(0);
  const [trailingWidth, setTrailingWidth] = useState(0);
  const { minHeight, maxHeight } = composerInputHeights(fontScale, compact);
  const directControlCount = Number(!!onAttach) + Number(!!onEmote) + Number(!!reply) + Number(!!attachmentName);
  const navigationWidth = (leading ? Math.max(t.hit, leadingWidth) : 0) + (trailing ? Math.max(t.hit, trailingWidth) : 0);
  const directRowWidth = navigationWidth + t.hit * (3 + directControlCount)
    + t.space.xs * (directControlCount + Number(!!leading) + Number(!!trailing) + 3);
  const availableWidth = Math.min(width, measuredWidth || width);
  const combinedActions = compact && (availableWidth < 480 || availableWidth < directRowWidth);
  const actions = [
    ...(onAttach ? [{ id: 'attach', title: '添加', onPress: onAttach, disabled: attachDisabled }] : []),
    ...(onEmote ? [{ id: 'emote', title: '表情', onPress: onEmote }] : []),
    ...(reply && onClearReply ? [{ id: 'reply', title: '取消回复', onPress: onClearReply }] : []),
    ...(attachmentName && onClearAttachment ? [{ id: 'remove', title: `移除 ${attachmentName}`, onPress: onClearAttachment }] : []),
  ];
  const context = [reply ? `回复 ${reply.author}` : '', attachmentName ? `附件 ${attachmentName}` : ''].filter(Boolean).join('，');
  return (
    <View onLayout={event => setMeasuredWidth(event.nativeEvent.layout.width)} style={{ paddingHorizontal: compact ? t.space.xs : t.space.md, paddingVertical: compact ? 0 : t.space.md, gap: compact ? 0 : t.space.sm, backgroundColor: 'transparent' }}>
      {!compact && reply ? <ReplyPreview author={reply.author} preview={reply.preview} onClear={onClearReply} /> : null}
      {!compact && attachmentName ? <AttachmentPreview name={attachmentName} onRemove={onClearAttachment} /> : null}
      <View style={{ flexDirection: 'row', alignItems: compact ? 'center' : 'flex-end', gap: compact ? t.space.xs : t.space.sm }}>
        {leading ? <View testID="composer-leading" onLayout={event => setLeadingWidth(event.nativeEvent.layout.width)} style={{ flexShrink: 0 }}>{leading}</View> : null}
        {onAttach && !combinedActions ? (
          <IconButton label="添加" onPress={onAttach} disabled={attachDisabled}>
            <Plus color={attachDisabled ? t.control : t.shared} size={22} />
          </IconButton>
        ) : null}
        {compact && !combinedActions && reply ? (
          <IconButton label={`取消回复 ${reply.author}：${reply.preview}`} disabled={!onClearReply} onPress={() => onClearReply?.()}>
            <Reply color={t.shared} size={20} />
            <View pointerEvents="none" style={{ position: 'absolute', top: 5, right: 4 }}><X color={t.muted} size={12} /></View>
          </IconButton>
        ) : null}
        {compact && !combinedActions && attachmentName ? (
          <IconButton label={`移除 ${attachmentName}`} disabled={!onClearAttachment} onPress={() => onClearAttachment?.()}>
            <Paperclip color={t.shared} size={20} />
            <View pointerEvents="none" style={{ position: 'absolute', top: 5, right: 4 }}><X color={t.muted} size={12} /></View>
          </IconButton>
        ) : null}
        <TextInput
          accessibilityLabel="消息"
          multiline
          scrollEnabled
          blurOnSubmit={false}
          disableFullscreenUI
          placeholder={placeholder}
          placeholderTextColor={t.muted}
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight,
            maxHeight,
            paddingHorizontal: t.space.md,
            paddingVertical: compact ? t.space.xs : t.space.sm,
            includeFontPadding: !compact,
            borderRadius: t.radius.input,
            borderWidth: 1,
            borderColor: t.line,
            color: t.text,
            backgroundColor: t.surface,
            fontSize: t.type.body,
            lineHeight: t.type.bodyLine,
          }}
        />
        {onEmote && !combinedActions ? (
          <IconButton label="表情" onPress={onEmote}>
            <Smile color={t.shared} size={22} />
          </IconButton>
        ) : null}
        {combinedActions && (actions.length > 0 || context) ? (
          <IconButton label={`输入选项${context ? `，${context}` : ''}`} onPress={() => { Keyboard.dismiss(); setActionsOpen(true); }}>
            <Ellipsis color={t.shared} size={22} />
            {context ? <View accessible={false} style={{ position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: t.shared }} /> : null}
          </IconButton>
        ) : null}
        {trailing ? <View onLayout={event => setTrailingWidth(event.nativeEvent.layout.width)} style={{ flexShrink: 0 }}>{trailing}</View> : null}
        <View style={{ flexShrink: 0 }}>
          <IconButton label="发送" onPress={onSend} disabled={sendDisabled}>
            <View
              style={{
                minWidth: t.hit,
                minHeight: t.hit,
                borderRadius: t.radius.control,
                backgroundColor: sendDisabled ? t.soft : t.shared,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send color={sendDisabled ? t.muted : t.onShared} size={18} />
            </View>
          </IconButton>
        </View>
      </View>
      {actionsOpen ? <ObjectActionSheet visible title="输入选项" detail={[reply ? `回复 ${reply.author}：${reply.preview}` : '', attachmentName ? `附件 ${attachmentName}` : ''].filter(Boolean).join('\n')} actions={actions} onRequestClose={() => setActionsOpen(false)} /> : null}
    </View>
  );
}
