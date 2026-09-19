import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Attachment } from '../domain/contracts';
import { attachmentPreviewUri } from '../data/media';
import { RemoteImage } from './RemoteImage';
import { Button } from './primitives';
import { useTheme } from './theme';

export function MediaViewer({
  file,
  onClose,
  onDownload,
}: {
  file: Attachment;
  onClose: () => void;
  onDownload: () => void;
}) {
  const t = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void attachmentPreviewUri(file).then(value => { if (!cancelled) setUri(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [file]);
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="关闭预览" onPress={onClose} style={{ flex: 1, justifyContent: 'center' }}>
        {uri ? <RemoteImage uri={uri} style={{ width: '100%', height: '80%' }} /> : <Text style={{ color: '#fff', textAlign: 'center' }}>加载中…</Text>}
      </Pressable>
      <View style={{ padding: 16, backgroundColor: t.elevated }}>
        <Button title="下载并分享" onPress={onDownload} />
      </View>
    </View>
  );
}
