import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
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
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const load = () => {
    setFailed(false);
    setUri(null);
    void attachmentPreviewUri(file).then(value => { setUri(value); }).catch(() => setFailed(true));
  };
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setUri(null);
    void attachmentPreviewUri(file).then(value => { if (!cancelled) setUri(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file]);
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ alignItems: 'flex-end', paddingTop: 8, paddingHorizontal: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭预览" onPress={onClose} style={{ width: t.hit, height: t.hit, alignItems: 'center', justifyContent: 'center' }}>
          <X size={24} color="#fff" />
        </Pressable>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        {failed ? <Text style={{ color: '#fff', textAlign: 'center' }}>图片无法加载</Text> : uri ? <RemoteImage uri={uri} resizeMode="contain" style={{ width: '100%', height: '80%' }} /> : <Text style={{ color: '#fff', textAlign: 'center' }}>加载中…</Text>}
      </View>
      <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: t.elevated, gap: 8 }}>
        {failed ? <Button title="重试" secondary onPress={load} /> : null}
        <Button title="下载并分享" onPress={onDownload} />
      </View>
    </View>
  );
}
