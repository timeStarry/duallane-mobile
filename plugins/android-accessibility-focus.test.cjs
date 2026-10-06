const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { assertAccessibilityRuntime, installAccessibilityFocusPackage, ACCESSIBILITY_FOCUS_SOURCE } = require('./android-accessibility-focus.cjs');

const application = () => readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/MainApplication.kt'), 'utf8');

test('accessibility bridge accepts only the reviewed public RN/Expo API pair', () => {
  assert.doesNotThrow(() => assertAccessibilityRuntime('55.0.31', '0.83.10'));
  for (const versions of [['55.0.32', '0.83.10'], ['55.0.31', '0.83.9'], ['54.0.37', '0.81.5']]) {
    assert.throws(() => assertAccessibilityRuntime(...versions), /reviewed Expo/);
  }
});

test('package registration is idempotent and preserves other native owners', () => {
  const original = application();
  const installed = installAccessibilityFocusPackage(original);
  assert.equal((installed.match(/add\(AccessibilityFocusPackage\(\)\)/g) ?? []).length, 1);
  assert.equal(installAccessibilityFocusPackage(installed), installed);
  for (const text of ['add(FontScalePackage())', 'add(SaveFilePackage())', 'CronetNetworking.install(this)',
    'ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)']) assert.ok(installed.includes(text));
});

test('comments, quoted registrations, conditions and ambiguous templates fail closed', () => {
  const installed = installAccessibilityFocusPackage(application());
  for (const replacement of ['// add(AccessibilityFocusPackage())', '/* add(AccessibilityFocusPackage()) */',
    '/*\n add(AccessibilityFocusPackage())\n */', 'val text = "add(AccessibilityFocusPackage())"',
    'val text = """\n add(AccessibilityFocusPackage())\n """', 'if (false) add(AccessibilityFocusPackage())']) {
    assert.throws(() => installAccessibilityFocusPackage(installed.replace('add(AccessibilityFocusPackage())', replacement)), /registration/);
  }
  for (const source of [application().replace('package com.timestarry.duallane', 'package other.app'),
    application().replace('ExpoReactHostFactory.getDefaultReactHost(', 'OtherFactory.create('),
    application().replace('ExpoReactHostFactory.getDefaultReactHost(', '// ExpoReactHostFactory.getDefaultReactHost('),
    application().replace('PackageList(this).packages.apply {', 'otherPackages().apply {'),
    application().replace('PackageList(this).packages.apply {', '/*\n        PackageList(this).packages.apply {').replace('add(SaveFilePackage())', 'add(SaveFilePackage())\n */'),
    installed + '\n// AccessibilityFocusPackage',
    installed.replace('add(AccessibilityFocusPackage())', 'add(AccessibilityFocusPackage())\n add(AccessibilityFocusPackage())')]) {
    assert.throws(() => installAccessibilityFocusPackage(source), /registration/);
  }
});

test('generated bridge uses public exact-view APIs without logging, polling or fallback events', () => {
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /UIManagerHelper\.getUIManagerForReactTag\(context, tag\)\?\.resolveView\(tag\)/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /WeakReference<View>/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /WeakReference<Activity>/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /AccessibilityNodeInfo\.ACTION_ACCESSIBILITY_FOCUS, null/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /LifecycleState\.RESUMED/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /removeLifecycleEventListener\(this\)/);
  assert.doesNotMatch(ACCESSIBILITY_FOCUS_SOURCE, /Log\.|println|sendAccessibilityEvent|getDeclared|findViewById|postDelayed|Thread\.sleep|requestAccessibilityFocus\(/);
});

test('a lazily created resumed module opens its ticket gate before posting lifecycle registration', () => {
  const initialize = ACCESSIBILITY_FOCUS_SOURCE.split('override fun initialize() {')[1].split('override fun onHostResume()')[0];
  // A first JS capture can run before posted UI initialization, so it must not
  // inherit a false background state just because registration is still queued.
  const resume = initialize.indexOf('requests.resume()');
  assert.ok(resume >= 0 && resume < initialize.indexOf('UiThreadUtil.runOnUiThread'));
  assert.match(initialize, /context\.lifecycleState == LifecycleState\.RESUMED/);
});

test('restoration checks current visible geometry rather than the attach-cycle layout flag', () => {
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /val visibleBounds: Boolean/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /view\.getGlobalVisibleRect\(visibleRect\)/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /view\.width, view\.height/);
  assert.match(ACCESSIBILITY_FOCUS_SOURCE, /visibleRect\.width\(\), visibleRect\.height\(\)/);
  assert.doesNotMatch(ACCESSIBILITY_FOCUS_SOURCE, /isLaidOut|val laidOut:/);
});

test('generated native source and checked-in registration match the plugin', () => {
  assert.equal(readFileSync(join(__dirname, '../android/app/src/main/java/com/timestarry/duallane/AccessibilityFocusModule.kt'), 'utf8').replaceAll('\r\n', '\n'), ACCESSIBILITY_FOCUS_SOURCE);
  assert.equal(installAccessibilityFocusPackage(application()), application());
});
