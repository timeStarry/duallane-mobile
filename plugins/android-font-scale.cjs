const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { withAndroidManifest, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const BASE_CONFIG_CHANGES = ['keyboard', 'keyboardHidden', 'orientation', 'screenSize', 'screenLayout', 'uiMode', 'smallestScreenSize'];

const FONT_SCALE_SOURCE = `package com.timestarry.duallane

import android.content.ComponentCallbacks
import android.content.res.Configuration
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager

class FontScaleModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), ComponentCallbacks {
  private val callbackContext = context.applicationContext
  @Volatile private var invalidated = false
  private var registered = false
  private var listeners = 0
  private var fontScale = callbackContext.resources.configuration.fontScale
  private var revision = 0L

  override fun getName() = "DualLaneFontScale"

  override fun initialize() {
    super.initialize()
    UiThreadUtil.runOnUiThread {
      // invalidate() can run before this posted registration reaches the main thread.
      if (!invalidated && !registered) {
        callbackContext.registerComponentCallbacks(this)
        registered = true
        update(callbackContext.resources.configuration.fontScale)
      }
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    val next = newConfig.fontScale
    UiThreadUtil.runOnUiThread { if (!invalidated) update(next) }
  }

  override fun onLowMemory() = Unit

  private fun update(next: Float) {
    if (next.isFinite() && next > 0f && next != fontScale) {
      fontScale = next
      revision++
      if (listeners > 0 && context.hasActiveReactInstance()) {
        context.emitDeviceEvent(EVENT_NAME, snapshot())
      }
    }
  }

  private fun snapshot(): WritableMap = Arguments.createMap().apply {
    putDouble("fontScale", fontScale.toDouble())
    putDouble("revision", revision.toDouble())
  }

  @ReactMethod
  fun getFontScale(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (invalidated) {
        promise.reject("E_FONT_SCALE_INVALIDATED", "Font metrics module is unavailable")
      } else {
        // Read after subscription so a change before listener registration cannot be lost.
        update(callbackContext.resources.configuration.fontScale)
        promise.resolve(snapshot())
      }
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    UiThreadUtil.runOnUiThread {
      if (!invalidated && eventName == EVENT_NAME) listeners++
    }
  }

  @ReactMethod
  fun removeListeners(count: Double) {
    UiThreadUtil.runOnUiThread {
      if (!invalidated && count.isFinite() && count > 0) listeners = (listeners - count.toInt()).coerceAtLeast(0)
    }
  }

  override fun invalidate() {
    invalidated = true
    UiThreadUtil.runOnUiThread {
      if (registered) {
        callbackContext.unregisterComponentCallbacks(this)
        registered = false
      }
      listeners = 0
    }
    super.invalidate()
  }

  companion object { private const val EVENT_NAME = "DualLaneFontScaleChanged" }
}

class FontScalePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(FontScaleModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

function fail(detail) {
  throw new Error(`android-font-scale: unsupported font layout runtime (${detail})`);
}

function assertFontLayoutRuntime(expoVersion, reactNativeVersion) {
  // A runtime upgrade must review configuration notification and text layout
  // again rather than silently bringing back a host reload.
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
  // Keep the Activity alive. The metrics module notifies JS without a host reload.
  if (!changes.includes('fontScale')) main[0].$['android:configChanges'] = [...changes, 'fontScale'].join('|');
  return manifest;
}

function installFontScalePackage(contents) {
  const anchors = [...contents.matchAll(/PackageList\(this\)\.packages\.apply \{/g)];
  const block = /^[ \t]*PackageList\(this\)\.packages\.apply \{([\s\S]*?)\n[ \t]*\}/m.exec(contents);
  const mentions = [...contents.matchAll(/\bFontScalePackage\b/g)];
  const registrations = block ? [...block[1].matchAll(/^[ \t]*add\(FontScalePackage\(\)\)[ \t]*\r?$/gm)] : [];
  // Only the reviewed package-list grammar is accepted. In particular, a line
  // inside a block comment or multiline string is not executable registration.
  const knownBody = block && block[1].split(/\r?\n/).every(line => {
    const value = line.trim();
    return !value || value.startsWith('//') || /^add\([A-Za-z_]\w*Package\(\)\)$/.test(value);
  });
  if (!/^package com\.timestarry\.duallane\s*$/m.test(contents) ||
      !contents.includes('ExpoReactHostFactory.getDefaultReactHost(') || anchors.length !== 1 || !knownBody ||
      registrations.length > 1 || mentions.length !== registrations.length) {
    fail('unrecognized MainApplication package registration');
  }
  if (registrations.length === 1) return contents;
  return contents.replace('PackageList(this).packages.apply {', 'PackageList(this).packages.apply {\n          add(FontScalePackage())');
}

module.exports = function withAndroidFontScale(config) {
  assertFontLayoutRuntime(require('expo/package.json').version, require('react-native/package.json').version);
  config = withAndroidManifest(config, mod => {
    mod.modResults = configureMainActivity(mod.modResults);
    return mod;
  });
  config = withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') fail('MainApplication must use Kotlin');
    mod.modResults.contents = installFontScalePackage(mod.modResults.contents);
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const file = join(mod.modRequest.platformProjectRoot, 'app/src/main/java/com/timestarry/duallane/FontScaleModule.kt');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, FONT_SCALE_SOURCE);
    return mod;
  }]);
};

module.exports.assertFontLayoutRuntime = assertFontLayoutRuntime;
module.exports.configureMainActivity = configureMainActivity;
module.exports.installFontScalePackage = installFontScalePackage;
module.exports.FONT_SCALE_SOURCE = FONT_SCALE_SOURCE;
