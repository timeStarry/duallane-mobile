import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Attachment } from '../domain/contracts';
import type { UploadTask } from '../data/transfers';
import { formatBytes } from './format';
import { Button, IconButton, Label } from './primitives';
import { useTheme } from './theme';

function fileStatus(file: Attachment) {
  if (file.status === 'available' && file.capabilities.canDownload) return '可下载';
  if (file.status === 'available') return '暂不可下载';
  return '暂不可用';
}

export function FileRow({ file, download }: { file: Attachment; download: () => void }) {
  const t = useTheme();
  return (
    <View style={[fileStyles.row, { borderColor: t.line }]}>
      <Text style={{ color: t.text, fontSize: t.type.body }} numberOfLines={2}>{file.fileName}</Text>
      <Label muted>{formatBytes(file.byteSize)} · {fileStatus(file)}</Label>
      <Button title="下载并保存" secondary disabled={!file.capabilities.canDownload} onPress={download} />
    </View>
  );
}

export function AttachmentPreview({
  name,
  detail,
  onRemove,
}: {
  name: string;
  detail?: string;
  onRemove?: () => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.space.sm, backgroundColor: t.soft, borderRadius: t.radius.control, padding: t.space.sm }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.text, fontSize: t.type.control }} numberOfLines={2}>{name}</Text>
        {detail ? <Text style={{ color: t.muted, fontSize: t.type.meta }}>{detail}</Text> : null}
      </View>
      {onRemove ? <IconButton label={`移除 ${name}`} onPress={onRemove}><Text style={{ color: t.danger, fontWeight: '600' }}>移除</Text></IconButton> : null}
    </View>
  );
}

export function TransferItem({
  task,
  progress,
  onResume,
  onPause,
  onCancel,
  busy = false,
}: {
  task: UploadTask;
  progress?: string;
  onResume: () => void;
  onPause: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.space.sm, paddingVertical: t.space.sm, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <Text style={{ color: t.text, fontSize: t.type.body }}>{task.fileName}</Text>
      <Label muted>{formatBytes(task.byteSize)}{progress ? ` · ${progress}` : task.complete ? ' · 已完成' : ' · 未完成'}</Label>
      <View style={fileStyles.actions}>
        <Button title="继续" secondary disabled={busy || task.complete} onPress={onResume} />
        <Button title="暂停" secondary onPress={onPause} />
        <Button title="取消" variant="danger" disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}

const fileStyles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingVertical: 14, minHeight: 72, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
