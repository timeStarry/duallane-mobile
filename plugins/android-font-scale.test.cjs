const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { assertFontLayoutRuntime, configureMainActivity, installFontScalePackage, FONT_SCALE_SOURCE } = require('./android-font-scale.cjs');

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
  assert.match(contents, /add\(FontScalePackage\(\)\)/);
  assert.match(contents, /CronetNetworking\.install\(this\)/);
  assert.match(contents, /ApplicationLifecycleDispatcher\.onConfigurationChanged\(this, newConfig\)/);
  assert.doesNotMatch(contents, /duallaneFontScale|duallane-font-scale-|\.reload\(|ReactNativeFeatureFlags|CANARY/);
  const appConfig = readFileSync(join(__dirname, '../app.config.ts'), 'utf8');
  assert.equal((appConfig.match(/\.\/plugins\/android-font-scale\.cjs/g) ?? []).length, 1);
  const androidManifest = readFileSync(join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(androidManifest, /android:configChanges="keyboard\|keyboardHidden\|orientation\|screenSize\|screenLayout\|uiMode\|smallestScreenSize\|fontScale"/);
});

test('font metrics package installs once in the reviewed Kotlin package list without changing lifecycle callbacks', () => {
  const source = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  const installed = installFontScalePackage(source);
  assert.equal((installed.match(/add\(FontScalePackage\(\)\)/g) ?? []).length, 1);
  assert.equal(installFontScalePackage(installed), installed);
  assert.match(installed, /add\(SaveFilePackage\(\)\)/);
  assert.match(installed, /ApplicationLifecycleDispatcher\.onConfigurationChanged\(this, newConfig\)/);
  assert.match(installed, /CronetNetworking\.install\(this\)/);
  const fresh = source.replace(/\s+add\(SaveFilePackage\(\)\)/, '').replace(/\s+add\(FontScalePackage\(\)\)/, '');
  assert.match(installFontScalePackage(fresh), /add\(FontScalePackage\(\)\)/);
});

test('unknown or ambiguous package registration templates fail closed', () => {
  const source = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  for (const altered of [
    source.replace('package com.timestarry.duallane', 'package different.app'),
    source.replace('ExpoReactHostFactory.getDefaultReactHost(', 'UnknownFactory.create('),
    source.replace('PackageList(this).packages.apply {', 'customPackages().apply {'),
    source + '\n// PackageList(this).packages.apply {',
    source.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n add(FontScalePackage())\n add(FontScalePackage())'),
  ]) assert.throws(() => installFontScalePackage(altered), /android-font-scale: unsupported font layout runtime/);
});

test('commented, quoted, or conditional registrations cannot masquerade as an installed package', () => {
  const source = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  for (const registration of [
    '// add(FontScalePackage())',
    '/* add(FontScalePackage()) */',
    '/*\n          add(FontScalePackage())\n          */',
    'val text = "add(FontScalePackage())"',
    'val text = """\n          add(FontScalePackage())\n          """',
    'if (false) add(FontScalePackage())',
  ]) assert.throws(() => installFontScalePackage(source.replace('add(FontScalePackage())', registration)),
    /android-font-scale: unsupported font layout runtime/, registration);
  const withoutPackage = source.replace(/^[ \t]*add\(FontScalePackage\(\)\)\r?\n/m, '');
  assert.throws(() => installFontScalePackage(`${withoutPackage}\n// add(FontScalePackage())`),
    /android-font-scale: unsupported font layout runtime/);
});

test('generated font module synchronizes public host metrics and root measurement before emitting scale', () => {
  assert.equal(typeof FONT_SCALE_SOURCE, 'string');
  assert.equal(readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/FontScaleModule.kt'), 'utf8').replaceAll('\r\n', '\n'), FONT_SCALE_SOURCE);
  assert.match(FONT_SCALE_SOURCE, /registerComponentCallbacks\(this\)/);
  assert.match(FONT_SCALE_SOURCE, /unregisterComponentCallbacks\(this\)/);
  assert.match(FONT_SCALE_SOURCE, /newConfig\.fontScale/);
  assert.match(FONT_SCALE_SOURCE, /host\.onConfigurationChanged\(activity\)/);
  assert.match(FONT_SCALE_SOURCE, /activity\.reactDelegate\?\.reactRootView/);
  assert.match(FONT_SCALE_SOURCE, /root\.requestLayout\(\)/);
  assert.match(FONT_SCALE_SOURCE, /OnPreDrawListener/);
  assert.match(FONT_SCALE_SOURCE, /!root\.isLayoutRequested/);
  assert.match(FONT_SCALE_SOURCE, /override fun onHostResume\(\)/);
  assert.match(FONT_SCALE_SOURCE, /removeOnPreDrawListener/);
  assert.match(FONT_SCALE_SOURCE, /removeOnAttachStateChangeListener/);
  assert.match(FONT_SCALE_SOURCE, /removeLifecycleEventListener\(this\)/);
  assert.match(FONT_SCALE_SOURCE, /putDouble\("fontScale", scale\.toDouble\(\)\)/);
  assert.match(FONT_SCALE_SOURCE, /putDouble\("revision", version\.toDouble\(\)\)/);
  assert.doesNotMatch(FONT_SCALE_SOURCE, /Settings\.|Log\.|\.reload\(|ReactNativeFeatureFlags|didUpdateDimensions|DisplayMetricsHolder|SurfaceHandler|postDelayed|Thread\.sleep/);
});
