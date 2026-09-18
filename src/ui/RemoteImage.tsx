import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, View, type ImageStyle, type StyleProp } from 'react-native';
import { localMediaUri } from '../data/media';

export function RemoteImage({
  uri,
  style,
  onError,
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  onError?: () => void;
}) {
  const [source, setSource] = useState<string | null>(uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri) ? uri : null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    let cancelled = false;
    if (uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri)) {
      setSource(uri);
      return;
    }
    setSource(null);
    void localMediaUri(uri).then(local => { if (!cancelled) setSource(local); }).catch(() => { if (!cancelled) onErrorRef.current?.(); });
    return () => { cancelled = true; };
  }, [uri]);
  if (!source) {
    return (
      <View style={[{ alignItems: 'center', justifyContent: 'center' }, style]}>
        <ActivityIndicator />
      </View>
    );
  }
  return <Image source={{ uri: source }} style={style} onError={onError} accessibilityIgnoresInvertColors />;
}
