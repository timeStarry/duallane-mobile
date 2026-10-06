import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import type { Attachment } from '../domain/contracts';
import { attachmentPreviewUri, type MediaContext } from '../data/media';
import { RemoteImage } from './RemoteImage';
import { Button } from './primitives';
import { useTheme } from './theme';
import { errorText } from '../data/client';

export function MediaViewer({
  file,
  context,
  authorized,
  onClose,
  onDownload,
}: {
  file: Attachment;
  context: MediaContext;
  authorized: boolean;
  onClose: () => void;
  onDownload: () => void | Promise<void>;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const downloadBusy = useRef(false);
  const downloadGeneration = useRef(0);
  useEffect(() => {
    const generation = downloadGeneration;
    downloadBusy.current = false;
    setDownloading(false);
    setDownloadError('');
    return () => { generation.current++; };
  }, [file, context, authorized]);
  const download = async () => {
    if (downloadBusy.current || !authorized || !file.capabilities.canDownload) return;
    const generation = downloadGeneration.current;
    downloadBusy.current = true;
    setDownloading(true);
    setDownloadError('');
    try { await onDownload(); }
    catch (error) { if (generation === downloadGeneration.current) setDownloadError(errorText(error)); }
    finally {
      if (generation === downloadGeneration.current) { downloadBusy.current = false; setDownloading(false); }
    }
  };
  useEffect(() => { if (!authorized) onClose(); }, [authorized, onClose]);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setUri(null);
    if (authorized) void attachmentPreviewUri(file, context).then(value => { if (!cancelled) setUri(value); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file, context, authorized, attempt]);
  if (!authorized) return null;
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ alignItems: 'flex-end', paddingTop: 8, paddingHorizontal: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭预览" onPress={onClose} style={{ width: t.hit, height: t.hit, alignItems: 'center', justifyContent: 'center' }}>
          <X size={24} color="#fff" />
        </Pressable>
      </View>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        {failed ? <Text style={{ color: '#fff', textAlign: 'center' }}>图片无法加载</Text> : uri ? <RemoteImage uri={uri} resizeMode="contain" style={{ width: '100%', height: '80%' }} onError={() => setFailed(true)} /> : <Text style={{ color: '#fff', textAlign: 'center' }}>加载中…</Text>}
      </View>
      <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16), backgroundColor: t.elevated, gap: 8 }}>
        {failed ? <Button title="重试" secondary onPress={() => setAttempt(value => value + 1)} /> : null}
        {downloadError ? <Text accessibilityRole="alert" style={{ color: t.danger }}>{downloadError}</Text> : null}
        <Button title={downloading ? '正在下载…' : '下载并分享'} disabled={downloading || !file.capabilities.canDownload} onPress={() => void download()} />
      </View>
    </View>
  );
}
