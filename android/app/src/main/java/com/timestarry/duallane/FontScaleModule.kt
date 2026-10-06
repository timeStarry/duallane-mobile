package com.timestarry.duallane

import android.content.ComponentCallbacks
import android.content.res.Configuration
import android.view.View
import android.view.ViewTreeObserver
import com.facebook.react.ReactActivity
import com.facebook.react.ReactApplication
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager

// A font snapshot is usable only after the current root has measured with it.
// The cancellable barrier also handles callbacks arriving before Activity config.
internal class FontScaleSynchronization(
  initialScale: Float,
  private val synchronizeLayout: (Float, () -> Unit, () -> Unit) -> (() -> Unit)?,
  private val publish: (Float, Long) -> Unit,
) {
  var fontScale = initialScale
    private set
  var revision = 0L
    private set
  private var desiredScale = initialScale
  private var foreground = false
  private var invalidated = false
  private var synchronized = false
  private var generation = 0L
  private var cancelBarrier: (() -> Unit)? = null
  private val snapshots = mutableListOf<Pair<(Float, Long) -> Unit, () -> Unit>>()

  fun configurationChanged(next: Float) {
    if (invalidated || !next.isFinite() || next <= 0f) return
    val changed = next != desiredScale
    desiredScale = next
    if (changed || (!synchronized && cancelBarrier == null)) begin()
  }

  fun resume(next: Float) {
    if (invalidated || !next.isFinite() || next <= 0f) return
    foreground = true
    desiredScale = next
    // A picker can resume without another configuration callback. Re-measure
    // that root even when the published scalar is already current.
    begin()
  }

  fun pause() {
    foreground = false
    synchronized = false
    cancel()
  }

  fun awaitSnapshot(ready: (Float, Long) -> Unit, unavailable: () -> Unit) {
    if (invalidated) unavailable()
    else if (synchronized && foreground) ready(fontScale, revision)
    else {
      snapshots.add(ready to unavailable)
      if (cancelBarrier == null) begin()
    }
  }

  private fun cancel() {
    generation++
    val previous = cancelBarrier
    cancelBarrier = null
    previous?.invoke()
  }

  private fun begin() {
    cancel()
    synchronized = false
    if (invalidated || !foreground) return
    val activeGeneration = generation
    val next = desiredScale
    var completed = false
    val cancellation = synchronizeLayout(next, {
      if (!invalidated && foreground && activeGeneration == generation) {
        completed = true
        cancelBarrier = null
        synchronized = true
        if (fontScale != next) {
          fontScale = next
          revision++
          publish(fontScale, revision)
        }
        val pending = snapshots.toList()
        snapshots.clear()
        pending.forEach { it.first(fontScale, revision) }
      }
    }, {
      if (!invalidated && activeGeneration == generation) {
        completed = true
        synchronized = false
        // Detach/current-root changes remove the native listeners. Do not keep
        // their cancellation handle as though a usable frame were still due.
        cancel()
      }
    })
    if (!completed && activeGeneration == generation) cancelBarrier = cancellation
    else cancellation?.invoke()
  }

  fun invalidate() {
    invalidated = true
    pause()
    val pending = snapshots.toList()
    snapshots.clear()
    pending.forEach { it.second() }
  }
}

class FontScaleModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), ComponentCallbacks, LifecycleEventListener {
  private val callbackContext = context.applicationContext
  @Volatile private var invalidated = false
  private var registered = false
  private var listeners = 0
  private val synchronization = FontScaleSynchronization(
    callbackContext.resources.configuration.fontScale,
    ::synchronizeLayout,
  ) { scale, version ->
    if (listeners > 0 && context.hasActiveReactInstance()) {
      context.emitDeviceEvent(EVENT_NAME, snapshot(scale, version))
    }
  }

  override fun getName() = "DualLaneFontScale"

  override fun initialize() {
    super.initialize()
    UiThreadUtil.runOnUiThread {
      // invalidate() can run before this posted registration reaches the main thread.
      if (!invalidated && !registered) {
        callbackContext.registerComponentCallbacks(this)
        context.addLifecycleEventListener(this)
        registered = true
      }
    }
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    val next = newConfig.fontScale
    UiThreadUtil.runOnUiThread { if (!invalidated) synchronization.configurationChanged(next) }
  }

  override fun onLowMemory() = Unit

  override fun onHostResume() {
    UiThreadUtil.runOnUiThread {
      if (!invalidated) synchronization.resume(callbackContext.resources.configuration.fontScale)
    }
  }

  override fun onHostPause() {
    UiThreadUtil.runOnUiThread { synchronization.pause() }
  }

  override fun onHostDestroy() = onHostPause()

  private fun synchronizeLayout(next: Float, ready: () -> Unit, interrupted: () -> Unit): (() -> Unit)? {
    val activity = context.currentActivity as? ReactActivity ?: return null
    val host = (callbackContext as? ReactApplication)?.reactHost ?: return null
    val root = activity.reactDelegate?.reactRootView ?: return null
    var closed = false
    var hostSynchronized = false
    var observer: ViewTreeObserver? = null
    lateinit var preDraw: ViewTreeObserver.OnPreDrawListener
    lateinit var attach: View.OnAttachStateChangeListener

    fun removePreDraw() {
      observer?.takeIf { it.isAlive }?.removeOnPreDrawListener(preDraw)
      root.viewTreeObserver.takeIf { it.isAlive && it !== observer }?.removeOnPreDrawListener(preDraw)
      observer = null
    }
    fun cleanup(unavailable: Boolean = false) {
      if (!closed) {
        closed = true
        removePreDraw()
        root.removeOnAttachStateChangeListener(attach)
        if (unavailable) interrupted()
      }
    }
    fun currentRoot() = !invalidated && context.hasActiveReactInstance() &&
      context.currentActivity === activity && host.currentReactContext === context &&
      activity.reactDelegate?.reactRootView === root
    fun matchingResources() = callbackContext.resources.configuration.fontScale == next &&
      context.resources.configuration.fontScale == next && activity.resources.configuration.fontScale == next
    fun synchronizeHost() {
      if (!hostSynchronized && root.isAttachedToWindow && matchingResources()) {
        // Public RN configuration processing refreshes SP metrics. Explicitly
        // request this root's measure even when those metrics already match.
        host.onConfigurationChanged(activity)
        hostSynchronized = true
        root.requestLayout()
      }
    }
    fun observePreDraw() {
      removePreDraw()
      observer = root.viewTreeObserver
      observer?.addOnPreDrawListener(preDraw)
    }
    preDraw = ViewTreeObserver.OnPreDrawListener {
      if (closed) Unit
      else if (!currentRoot()) cleanup(true)
      else if (!hostSynchronized) synchronizeHost()
      else if (root.isAttachedToWindow && matchingResources() && !root.isLayoutRequested) {
        // ReactSurfaceView.onMeasure has synchronously supplied the Activity
        // font scale to Fabric before this real traversal reaches pre-draw.
        cleanup()
        ready()
      }
      true
    }
    attach = object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(view: View) {
        if (!closed && currentRoot()) {
          observePreDraw()
          synchronizeHost()
          root.requestLayout()
        } else cleanup(true)
      }
      override fun onViewDetachedFromWindow(view: View) = cleanup(true)
    }
    root.addOnAttachStateChangeListener(attach)
    observePreDraw()
    if (!currentRoot()) cleanup(true)
    else {
      synchronizeHost()
      root.requestLayout()
    }
    return { cleanup() }
  }

  private fun snapshot(scale: Float, version: Long): WritableMap = Arguments.createMap().apply {
    putDouble("fontScale", scale.toDouble())
    putDouble("revision", version.toDouble())
  }

  @ReactMethod
  fun getFontScale(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      if (invalidated) {
        promise.reject("E_FONT_SCALE_INVALIDATED", "Font metrics module is unavailable")
      } else {
        synchronization.configurationChanged(callbackContext.resources.configuration.fontScale)
        synchronization.awaitSnapshot(
          { scale, version -> promise.resolve(snapshot(scale, version)) },
          { promise.reject("E_FONT_SCALE_INVALIDATED", "Font metrics module is unavailable") },
        )
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
        context.removeLifecycleEventListener(this)
        registered = false
      }
      synchronization.invalidate()
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
