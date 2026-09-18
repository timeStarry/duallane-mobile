import { useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';
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
  useEffect(() => {
    let cancelled = false;
    if (uri.startsWith('file:') || /^https:\/\/avatars\.githubusercontent\.com\//i.test(uri)) {
      setSource(uri);
      return;
    }
    setSource(null);
    void localMediaUri(uri).then(local => { if (!cancelled) setSource(local); }).catch(() => { if (!cancelled) onError?.(); });
    return () => { cancelled = true; };
  }, [onError, uri]);
  if (!source) return null;
  return <Image source={{ uri: source }} style={style} onError={onError} accessibilityIgnoresInvertColors />;
}
