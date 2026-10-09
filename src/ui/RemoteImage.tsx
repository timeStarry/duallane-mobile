import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { localMediaText, localMediaUri } from '../data/media';

export function RemoteImage({
  uri,
  style,
  onError,
  resizeMode,
  showLoadingIndicator = true,
  onLoad,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  onError?: () => void;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  showLoadingIndicator?: boolean;
  onLoad?: (dimensions: { width: number; height: number }) => void;
}) {
  const svg = /\.svg(\?|$)/i.test(uri);
  const [resolved, setResolved] = useState<{ uri: string; source: string | null }>({ uri, source: !svg && (uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri)) ? uri : null });
  const source = resolved.uri === uri ? resolved.source : null;
  const [failedUri, setFailedUri] = useState<string>();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const uriRef = useRef(uri);
  uriRef.current = uri;
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  useEffect(() => {
    let cancelled = false;
    setFailedUri(undefined);
    if (!svg && (uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri))) {
      setResolved({ uri, source: uri });
      return;
    }
    setResolved({ uri, source: null });
    const load = svg ? localMediaText(uri) : localMediaUri(uri);
    void load.then(local => { if (!cancelled) setResolved({ uri, source: local }); }).catch(() => {
      if (!cancelled) {
        setFailedUri(uri);
        onErrorRef.current?.();
      }
    });
    return () => { cancelled = true; };
  }, [svg, uri]);
  if (failedUri === uri) return <View style={style} />;
  if (!source) {
    return (
      <View style={[{ alignItems: 'center', justifyContent: 'center' }, style]}>
        {showLoadingIndicator ? <ActivityIndicator /> : null}
      </View>
    );
  }
  if (svg) {
    const flat = StyleSheet.flatten(style) as { width?: number; height?: number } | undefined;
    return <SvgXml xml={source} width={flat?.width ?? 40} height={flat?.height ?? 40} />;
  }
  return <Image key={uri} source={{ uri: source }} style={style} resizeMode={resizeMode} onLoad={event => {
    if (uriRef.current !== uri) return;
    const { width, height } = event.nativeEvent.source;
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) onLoadRef.current?.({ width, height });
  }} onError={() => { if (uriRef.current === uri) { setFailedUri(uri); onErrorRef.current?.(); } }} accessibilityIgnoresInvertColors />;
}
