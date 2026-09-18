import type { ExpoConfig } from 'expo/config';
const environment = process.env.APP_ENV ?? 'development';
if (!['development', 'test', 'production'].includes(environment)) throw new Error('Invalid APP_ENV');
const origin = process.env.EXPO_PUBLIC_API_ORIGIN ?? '';
if (origin) {
  let parsed: URL;
  try { parsed = new URL(origin); } catch { throw new Error('API origin must be an HTTPS origin without a path'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('API origin must be an HTTPS origin without credentials, a path, query or fragment');
  }
}
if (environment === 'production' && !origin) throw new Error('Production requires EXPO_PUBLIC_API_ORIGIN');
const appVersion = process.env.DUALLANE_APP_VERSION ?? '0.1.0';
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(appVersion)) throw new Error('DUALLANE_APP_VERSION must be SemVer');
const versionCode = Number(process.env.DUALLANE_ANDROID_VERSION_CODE ?? 1);
if (!Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2100000000) throw new Error('DUALLANE_ANDROID_VERSION_CODE must be a positive integer');
const updateUrl = process.env.DUALLANE_UPDATES_URL;
const certificate = process.env.DUALLANE_UPDATE_CERTIFICATE;
const keyId = process.env.DUALLANE_UPDATE_KEY_ID;
if (updateUrl && (!certificate || !keyId || !updateUrl.startsWith('https://'))) throw new Error('Signed OTA configuration is incomplete');
const config: ExpoConfig = {
  name: 'DualLane', slug: 'duallane-mobile', version: appVersion, platforms: ['android'],
  scheme: 'com.timestarry.duallane', userInterfaceStyle: 'automatic',
  runtimeVersion: 'android-1',
  android: { package: 'com.timestarry.duallane', versionCode, allowBackup: false, softwareKeyboardLayoutMode: 'pan',
    permissions: ['POST_NOTIFICATIONS'], blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SCHEDULE_EXACT_ALARM', 'android.permission.USE_EXACT_ALARM', 'android.permission.FOREGROUND_SERVICE'] },
  plugins: [['expo-build-properties', { android: { minSdkVersion: 26, compileSdkVersion: 36, targetSdkVersion: 36 } }],
    'expo-secure-store', 'expo-document-picker', ['expo-notifications', { defaultChannel: 'messages' }], './plugins/android-signing.cjs', './plugins/android-build-memory.cjs', './plugins/android-cronet.cjs'],
  updates: updateUrl ? { url: updateUrl, enabled: true, checkAutomatically: 'NEVER',
    codeSigningCertificate: certificate, codeSigningMetadata: { keyid: keyId!, alg: 'rsa-v1_5-sha256' } } : { enabled: false },
  extra: { environment, apiOrigin: origin, channel: 'internal', protocolMajor: 1 },
};
export default config;
