import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, RotateCcw, X } from 'lucide-react-native';
import type { Attachment } from '../domain/contracts';
import { attachmentPreviewUri, emotePreviewUri, type MediaContext } from '../data/media';
import { RemoteImage } from './RemoteImage';
import { useTheme } from './theme';
import { errorText } from '../data/client';

type MediaViewerProps = {
  context: MediaContext;
  authorized: boolean;
  onClose: () => void;
  onDownload?: () => void | Promise<void>;
} & ({ file: Attachment; emoteShortcode?: never } | { file?: never; emoteShortcode: string });

export function MediaViewer({ file, emoteShortcode, context, authorized, onClose, onDownload }: MediaViewerProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const source = useMemo(() => ({ file, emoteShortcode, context }), [file, emoteShortcode, context]);
  const previewGeneration = useRef(0);
  const [preview, setPreview] = useState<{ source: typeof source; generation: number; uri: string | null; failed: boolean }>({ source, generation: 0, uri: null, failed: false });
  const uri = preview.source === source ? preview.uri : null;
  const failed = preview.source === source && preview.failed;
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
  }, [source, authorized]);
  const canDownload = !!onDownload && (!file || (file.status === 'available' && file.capabilities.canDownload));
  const download = async () => {
    if (downloadBusy.current || !authorized || !canDownload || !onDownload) return;
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
    const generation = ++previewGeneration.current;
    setPreview({ source, generation, uri: null, failed: false });
    if (authorized) {
      const load = source.file ? attachmentPreviewUri(source.file, source.context) : source.emoteShortcode ? emotePreviewUri(source.emoteShortcode, source.context) : Promise.reject(new Error('Preview source unavailable'));
      void load.then(value => { if (!cancelled) setPreview({ source, generation, uri: value, failed: false }); }).catch(() => { if (!cancelled) setPreview({ source, generation, uri: null, failed: true }); });
    }
    return () => { cancelled = true; };
  }, [source, authorized, attempt]);
  if (!authorized) return null;
  const saveTitle = downloading ? '保存中…' : `保存到手机${file ? `（${(file.byteSize / 1000000).toFixed(1)} MB）` : ''}`;
  return (
    <View testID="media-viewer" style={styles.viewer}>
      {!failed && uri ? <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <RemoteImage key={`${preview.generation}:${uri}`} uri={uri} resizeMode="contain" style={styles.image} onError={() => setPreview(current => current.source === source && current.generation === preview.generation ? { ...current, failed: true } : current)} />
      </View> : null}
      <View testID="media-viewer-top-controls" style={{ alignItems: 'flex-end', paddingTop: insets.top + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="关闭预览" onPress={onClose} style={({ pressed }) => [styles.close, { minWidth: t.hit, minHeight: t.hit, opacity: pressed ? t.pressedOpacity : 1 }]}>
          <X size={20} color="#fff" />
        </Pressable>
      </View>
      <View pointerEvents="none" style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }}>
        {failed ? <Text accessibilityRole="alert" style={styles.feedback}>图片无法加载</Text> : !uri ? <Text style={styles.feedback}>加载中…</Text> : null}
      </View>
      <View testID="media-viewer-bottom-controls" style={[styles.bottom, { paddingBottom: insets.bottom + 8, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
        {failed ? <Pressable accessibilityRole="button" accessibilityLabel="重试加载图片" onPress={() => setAttempt(value => value + 1)} style={({ pressed }) => [styles.action, { minWidth: t.hit, minHeight: t.hit, opacity: pressed ? t.pressedOpacity : 1 }]}>
          <RotateCcw size={18} color="#fff" />
          <Text style={[styles.actionText, { fontSize: t.type.control }]}>重试加载</Text>
        </Pressable> : null}
        {downloadError ? <Text accessibilityRole="alert" style={styles.feedback}>{downloadError}</Text> : null}
        {onDownload ? <Pressable accessibilityRole="button" accessibilityLabel={saveTitle} accessibilityState={{ disabled: downloading || !canDownload, busy: downloading }} disabled={downloading || !canDownload} onPress={() => void download()} style={({ pressed }) => [styles.action, { minWidth: t.hit, minHeight: t.hit, opacity: downloading || !canDownload ? t.disabledOpacity : pressed ? t.pressedOpacity : 1 }]}>
          <Download size={18} color="#fff" />
          <Text style={[styles.actionText, { fontSize: t.type.control }]}>{saveTitle}</Text>
        </Pressable> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: '#000' },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  close: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  bottom: { alignItems: 'center', gap: 4, paddingTop: 8, backgroundColor: 'transparent' },
  action: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'transparent' },
  actionText: { color: '#fff', flexShrink: 1, textAlign: 'center', textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
  feedback: { color: '#fff', textAlign: 'center', textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 },
});
