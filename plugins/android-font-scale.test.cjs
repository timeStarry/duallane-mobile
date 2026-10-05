const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { installInMainApplication, configureMainActivity } = require('./android-font-scale.cjs');

function manifest() {
  return { manifest: { application: [{ $: { 'android:name': '.MainApplication' }, activity: [
    { $: { 'android:name': '.MainActivity', 'android:configChanges': 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode',
      'android:launchMode': 'singleTask', 'android:windowSoftInputMode': 'adjustPan' } },
    { $: { 'android:name': '.OtherActivity', 'android:configChanges': 'orientation' } },
  ] }] } };
}

const main = `package com.timestarry.duallane
import android.content.res.Configuration
class MainApplication : Application(), ReactApplication {
  override val reactHost: ReactHost
    get() = ReactNativeHostWrapper.createReactHost(applicationContext, reactNativeHost)
  override fun onCreate() {
    super.onCreate()
    CronetNetworking.install(this)
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }
  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }
}
`;

test('font changes reload the public ReactHost after Expo configuration dispatch', () => {
  const result = installInMainApplication(main);
  assert.match(result, /private var duallaneFontScale: Float\? = null/);
  assert.ok(result.indexOf('duallaneFontScale = resources.configuration.fontScale') < result.indexOf('loadReactNative(this)'));
  assert.ok(result.indexOf('ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)') < result.indexOf('val previousFontScale'));
  assert.match(result, /val previousFontScale = duallaneFontScale\n    duallaneFontScale = newConfig.fontScale\n    if \(previousFontScale != null && previousFontScale != newConfig.fontScale\) \{\n[\s\S]*?reactHost.reload\("duallane_font_scale_changed"\)\n    \}/);
  assert.equal((result.match(/reactHost.reload\(/g) ?? []).length, 1);
  assert.ok(result.includes('CronetNetworking.install(this)'));
  assert.ok(result.includes('ApplicationLifecycleDispatcher.onApplicationCreate(this)'));
  assert.doesNotMatch(result, /ReactNativeFeatureFlags|CANARY|onConfigurationChanged.*orientation/);
});

test('repeated prebuild preserves LF and CRLF without duplicate reload hooks', () => {
  for (const source of [main, main.replace(/\n/g, '\r\n')]) {
    const result = installInMainApplication(source);
    assert.equal(installInMainApplication(result), result);
    assert.equal(result.includes('\r\n'), source.includes('\r\n'));
  }
});

test('unknown or ambiguous lifecycle templates fail instead of silently omitting the repair', () => {
  for (const source of [
    main.replace('class MainApplication', 'class CustomApplication'),
    main.replace('import android.content.res.Configuration\n', ''),
    main.replace('  override val reactHost: ReactHost\n', ''),
    main.replace('super.onCreate()', 'initializeApplication()'),
    main.replace('ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)', 'dispatchConfiguration(newConfig)'),
    main + 'class MainApplication : Application(), ReactApplication {\n',
  ]) assert.throws(() => installInMainApplication(source), /android-font-scale: unsupported MainApplication Kotlin template/);
});

test('partially removed or modified generated hooks fail closed', () => {
  const result = installInMainApplication(main);
  assert.throws(() => installInMainApplication(result.replace('duallane_font_scale_changed', 'modified_reason')), /modified change block/);
  assert.throws(() => installInMainApplication(result.replace('private var duallaneFontScale: Float? = null\n', '')), /modified state block/);
  assert.throws(() => installInMainApplication(main.replace('super.onCreate()', 'super.onCreate()\n    duallaneFontScale = 1f')), /conflicting font-scale implementation/);
});

test('MainActivity handles fontScale without changing other configuration or IME behavior', () => {
  const input = manifest();
  const original = structuredClone(input);
  const result = configureMainActivity(input);
  assert.equal(result.manifest.application[0].activity[0].$['android:configChanges'], 'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode|fontScale');
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
    assert.throws(() => configureMainActivity(input), /android-font-scale: unsupported MainApplication Kotlin template/);
  }
  assert.throws(() => configureMainActivity({}), /MainApplication manifest entry/);
});

test('checked-in native project already contains the exact prebuild repair', () => {
  const contents = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  assert.equal(installInMainApplication(contents), contents);
  const appConfig = readFileSync(join(__dirname, '../app.config.ts'), 'utf8');
  assert.equal((appConfig.match(/\.\/plugins\/android-font-scale\.cjs/g) ?? []).length, 1);
  const androidManifest = readFileSync(join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(androidManifest, /<activity android:name="\.MainActivity" android:configChanges="keyboard\|keyboardHidden\|orientation\|screenSize\|screenLayout\|uiMode\|fontScale"/);
});
