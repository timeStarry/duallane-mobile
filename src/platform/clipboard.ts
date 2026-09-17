import { Share } from 'react-native';

export async function copyText(text: string) {
  await Share.share({ message: text });
}
