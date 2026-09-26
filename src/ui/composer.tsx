import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Plus, Send, Smile, X } from 'lucide-react-native';
import { AttachmentPreview } from './files';
import { IconButton } from './primitives';
import { useTheme } from './theme';

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
}: {
  value: string;
  onChangeText: (text: string) => void;
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
}) {
  const t = useTheme();
  const maxHeight = t.type.bodyLine * 6;
  return (
    <View style={{ padding: t.space.md, gap: t.space.sm, backgroundColor: 'transparent' }}>
      {reply ? <ReplyPreview author={reply.author} preview={reply.preview} onClear={onClearReply} /> : null}
      {attachmentName ? <AttachmentPreview name={attachmentName} onRemove={onClearAttachment} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: t.space.sm }}>
        {onAttach ? (
          <IconButton label="添加" onPress={onAttach} disabled={attachDisabled}>
            <Plus color={attachDisabled ? t.control : t.shared} size={22} />
          </IconButton>
        ) : null}
        <TextInput
          accessibilityLabel="消息"
          multiline
          blurOnSubmit={false}
          placeholder={placeholder}
          placeholderTextColor={t.muted}
          value={value}
          onChangeText={onChangeText}
          style={{
            flex: 1,
            minHeight: t.hit,
            maxHeight,
            paddingHorizontal: t.space.md,
            paddingVertical: t.space.sm,
            borderRadius: t.radius.input,
            borderWidth: 1,
            borderColor: t.line,
            color: t.text,
            backgroundColor: t.surface,
            fontSize: t.type.body,
            lineHeight: t.type.bodyLine,
          }}
        />
        {onEmote ? (
          <IconButton label="表情" onPress={onEmote}>
            <Smile color={t.shared} size={22} />
          </IconButton>
        ) : null}
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
    </View>
  );
}
