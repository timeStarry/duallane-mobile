import React from 'react';
import { Platform, Text as NativeText, useWindowDimensions, type TextProps } from 'react-native';

export const Text = React.forwardRef<NativeText, TextProps>(function Text(props, ref) {
  const { fontScale } = useWindowDimensions();
  // Android can redraw scaled glyphs with the previous Fabric text measurement.
  // Replace only the text host; its route, list and any input siblings stay mounted.
  return <NativeText {...props} ref={ref} key={Platform.OS === 'android' ? fontScale : 'native'} />;
});
