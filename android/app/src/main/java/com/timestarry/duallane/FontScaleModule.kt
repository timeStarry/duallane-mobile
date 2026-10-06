package com.timestarry.duallane

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
