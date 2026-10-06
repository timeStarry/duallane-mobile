import React from 'react';
import { Platform, Text as NativeText, type TextProps } from 'react-native';
import { useFontScale } from '../platform/font-scale';

export const Text = React.forwardRef<NativeText, TextProps>(function Text(props, ref) {
  const fontScale = useFontScale();
  // Android Dimensions can retain its old font scale until the host resumes.
  // Native configuration events replace only text; route/list/input stay mounted.
  return <NativeText {...props} ref={ref} key={Platform.OS === 'android' ? fontScale : 'native'} />;
});
