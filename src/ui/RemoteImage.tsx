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
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  onError?: () => void;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  showLoadingIndicator?: boolean;
}) {
  const svg = /\.svg(\?|$)/i.test(uri);
  const [source, setSource] = useState<string | null>(!svg && (uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri)) ? uri : null);
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!svg && (uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri))) {
      setSource(uri);
      return;
    }
    setSource(null);
    const load = svg ? localMediaText(uri) : localMediaUri(uri);
    void load.then(local => { if (!cancelled) setSource(local); }).catch(() => {
      if (!cancelled) {
        setFailed(true);
        onErrorRef.current?.();
      }
    });
    return () => { cancelled = true; };
  }, [svg, uri]);
  if (failed) return <View style={style} />;
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
  return <Image source={{ uri: source }} style={style} resizeMode={resizeMode} onError={() => { setFailed(true); onErrorRef.current?.(); }} accessibilityIgnoresInvertColors />;
}
