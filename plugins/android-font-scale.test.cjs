const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { assertFontLayoutRuntime, configureMainActivity } = require('./android-font-scale.cjs');

function manifest() {
  return { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, activity: [
    { $: { 'android:name': '.MainActivity', 'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize',
      'android:launchMode': 'singleTask', 'android:windowSoftInputMode': 'adjustPan' } },
    { $: { 'android:name': '.OtherActivity', 'android:configChanges': 'orientation' } },
  ] }] } };
}

test('only the reviewed stable framework pair owns font layout updates', () => {
  assert.doesNotThrow(() => assertFontLayoutRuntime('55.0.31', '0.83.10'));
  for (const pair of [
    ['54.0.37', '0.81.5'], ['54.0.37', '0.81.6'], ['55.0.31', '0.83.9'],
    ['55.0.31', '0.84.0'], ['55.0.32', '0.83.10'], ['55.0.31', '0.83.10-canary'],
  ]) assert.throws(() => assertFontLayoutRuntime(...pair), /requires the reviewed Expo/);
});

test('MainActivity handles fontScale without changing other configuration or IME behavior', () => {
  const input = manifest();
  const original = structuredClone(input);
  const result = configureMainActivity(input);
  assert.equal(result.manifest.application[0].activity[0].$['android:configChanges'], 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|smallestScreenSize|fontScale');
  assert.equal(result.manifest.application[0].activity[0].$['android:launchMode'], 'singleTask');
  assert.equal(result.manifest.application[0].activity[0].$['android:windowSoftInputMode'], 'adjustPan');
  assert.deepEqual(result.manifest.application[0].activity[1], original.manifest.application[0].activity[1]);
  const once = structuredClone(result);
  assert.deepEqual(configureMainActivity(result), once);
});

test('unknown or duplicate Activity manifest anchors and configuration flags fail closed', () => {
  const variants = [
    input => { input.manifest.application[0].$['android:name'] = '.UnknownApplication'; },
    input => { input.manifest.application[0].activity[0].$['android:name'] = '.UnknownActivity'; },
    input => { input.manifest.application[0].activity.push(structuredClone(input.manifest.application[0].activity[0])); },
    input => { input.manifest.application[0].activity[0].$['android:configChanges'] = 'orientation|fontScale'; },
    input => { input.manifest.application[0].activity[0].$['android:configChanges'] += '|unknownFlag'; },
    input => { input.manifest.application[0].activity[0].$['android:configChanges'] += '|uiMode'; },
  ];
  for (const alter of variants) {
    const input = manifest();
    alter(input);
    assert.throws(() => configureMainActivity(input), /android-font-scale: unsupported font layout runtime/);
  }
  assert.throws(() => configureMainActivity({}), /MainApplication manifest entry/);
});

test('checked-in native project retains Expo callbacks and custom modules without a font reload', () => {
  assertFontLayoutRuntime(require('expo/package.json').version, require('react-native/package.json').version);
  const contents = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  assert.match(contents, /ExpoReactHostFactory\.getDefaultReactHost\(/);
  assert.match(contents, /add\(SaveFilePackage\(\)\)/);
  assert.match(contents, /CronetNetworking\.install\(this\)/);
  assert.match(contents, /ApplicationLifecycleDispatcher\.onConfigurationChanged\(this, newConfig\)/);
  assert.doesNotMatch(contents, /duallaneFontScale|duallane-font-scale-|\.reload\(|ReactNativeFeatureFlags|CANARY/);
  const appConfig = readFileSync(join(__dirname, '../app.config.ts'), 'utf8');
  assert.equal((appConfig.match(/\.\/plugins\/android-font-scale\.cjs/g) ?? []).length, 1);
  const androidManifest = readFileSync(join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(androidManifest, /android:configChanges="keyboard\|keyboardHidden\|orientation\|screenSize\|screenLayout\|uiMode\|smallestScreenSize\|fontScale"/);
});
