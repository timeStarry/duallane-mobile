const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { installInMainApplication } = require('./android-font-scale.cjs');

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

test('checked-in native project already contains the exact prebuild repair', () => {
  const contents = readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');
  assert.equal(installInMainApplication(contents), contents);
  const appConfig = readFileSync(join(__dirname, '../app.config.ts'), 'utf8');
  assert.equal((appConfig.match(/\.\/plugins\/android-font-scale\.cjs/g) ?? []).length, 1);
});
