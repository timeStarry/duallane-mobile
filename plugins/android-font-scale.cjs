const { withAndroidManifest } = require('expo/config-plugins');

const BASE_CONFIG_CHANGES = ['keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'screenLayout', 'uiMode', 'smallestScreenSize'];

function fail(detail) {
  throw new Error(`android-font-scale: unsupported font layout runtime (${detail})`);
}

function assertFontLayoutRuntime(expoVersion, reactNativeVersion) {
  // These exact stable versions own font-layout invalidation. A runtime upgrade
  // must review that path again rather than silently bringing back a host reload.
  if (expoVersion !== '55.0.31' || reactNativeVersion !== '0.83.10') {
    fail('requires the reviewed Expo 55.0.31 / React Native 0.83.10 pair');
  }
}

function configureMainActivity(manifest) {
  const applications = manifest?.manifest?.application;
  if (!Array.isArray(applications) || applications.length !== 1 ||
      !['.MainApplication', 'com.timestarry.duallane.MainApplication'].includes(applications[0].$?.['android:name'])) {
    fail('missing or ambiguous MainApplication manifest entry');
  }
  const activities = applications[0].activity;
  const main = Array.isArray(activities) ? activities.filter(activity =>
    ['.MainActivity', 'com.timestarry.duallane.MainActivity'].includes(activity.$?.['android:name'])) : [];
  if (main.length !== 1) fail('missing or ambiguous MainActivity manifest entry');
  const value = main[0].$['android:configChanges'];
  const changes = typeof value === 'string' ? value.split('|') : [];
  if (new Set(changes).size !== changes.length ||
      BASE_CONFIG_CHANGES.some(change => !changes.includes(change)) ||
      changes.some(change => !BASE_CONFIG_CHANGES.includes(change) && change !== 'fontScale')) {
    fail('unsupported MainActivity configChanges');
  }
  // React Native 0.83 updates attached surfaces and text layout in place.
  // Keep the Activity alive so no ReactHost reload races with old text finalizers.
  if (!changes.includes('fontScale')) main[0].$['android:configChanges'] = [...changes, 'fontScale'].join('|');
  return manifest;
}

module.exports = function withAndroidFontScale(config) {
  assertFontLayoutRuntime(require('expo/package.json').version, require('react-native/package.json').version);
  return withAndroidManifest(config, mod => {
    mod.modResults = configureMainActivity(mod.modResults);
    return mod;
  });
};

module.exports.assertFontLayoutRuntime = assertFontLayoutRuntime;
module.exports.configureMainActivity = configureMainActivity;
