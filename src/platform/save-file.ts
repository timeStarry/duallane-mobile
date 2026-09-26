import { NativeModules } from 'react-native';

type SaveFileNativeModule = {
  saveFile: (uri: string, fileName: string, mimeType: string) => Promise<boolean>;
};

export async function saveFileToDevice(uri: string, fileName: string, mimeType: string): Promise<boolean> {
  const native = NativeModules.DualLaneSaveFile as SaveFileNativeModule | undefined;
  if (!native) throw new Error('Save to device is unavailable');
  return native.saveFile(uri, fileName, mimeType);
}
