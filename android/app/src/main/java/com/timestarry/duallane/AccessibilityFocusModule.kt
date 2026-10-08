package com.timestarry.duallane

import android.app.Activity
import android.content.Context
import android.graphics.Rect
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.common.LifecycleState
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManager
import java.lang.ref.WeakReference

internal fun accessibilityFocusTicket(value: Double): Long? =
  if (value.isFinite() && value > 0 && value <= 9007199254740991.0 && value == value.toLong().toDouble()) value.toLong() else null

internal fun accessibilityFocusTag(value: Double): Int? =
  if (value.isFinite() && value > 0 && value <= Int.MAX_VALUE && value == value.toInt().toDouble()) value.toInt() else null

internal fun accessibilityFocusVisibleBounds(
  width: Int, height: Int, hasGlobalVisibleRect: Boolean, visibleWidth: Int, visibleHeight: Int,
) = width > 0 && height > 0 && hasGlobalVisibleRect && visibleWidth > 0 && visibleHeight > 0

internal data class AccessibilityFocusState(
  val hostActive: Boolean,
  val sameView: Boolean,
  val sameActivity: Boolean,
  val sameRoot: Boolean,
  val attached: Boolean,
  val shown: Boolean,
  val visibleBounds: Boolean,
  val windowFocused: Boolean,
  val readerEnabled: Boolean,
  val touchExploration: Boolean,
) {
  fun capturable() = hostActive && sameView && sameActivity && sameRoot && attached && shown
  fun restorable() = capturable() && visibleBounds && windowFocused && readerEnabled && touchExploration
}

// Bridge calls may arrive before their posted UI work. Reserve/close tickets at
// invocation time; lifecycle changes invalidate queued work without replaying it.
internal class AccessibilityFocusRequests<T : Any>(
  private val canonicalHostActive: () -> Boolean,
  private val dispatch: (() -> Unit) -> Unit,
  private val capture: (Int) -> T?,
  private val inspect: (T, Int) -> AccessibilityFocusState,
  private val focus: (T) -> Boolean,
) {
  private data class Target<T>(val ticket: Long, val tag: Int, val value: T)
  private val lock = Any()
  private var latestTicket = 0L
  private var closedThrough = 0L
  private var generation = 0L
  private var revision = 0L
  private var foreground = false
  private var invalidated = false
  private var target: Target<T>? = null

  fun resume() = synchronized(lock) { if (!invalidated) foreground = true }

  fun pause() = synchronized(lock) {
    foreground = false
    generation++
    revision++
    closedThrough = maxOf(closedThrough, latestTicket)
    target = null
  }

  fun invalidate() = synchronized(lock) {
    invalidated = true
    pause()
  }

  fun cancel(ticket: Long) = synchronized(lock) {
    if (ticket > 0) {
      closedThrough = maxOf(closedThrough, ticket)
      if (latestTicket <= ticket) {
        revision++
        target = null
      }
    }
  }

  fun captureTarget(tag: Int, ticket: Long, resolve: (Boolean) -> Unit) {
    val epoch = synchronized(lock) {
      if (tag <= 0 || ticket <= latestTicket || ticket <= closedThrough || invalidated) null
      else {
        latestTicket = ticket
        revision++
        target = null
        // AppState can emit active before this module's resume listener runs.
        // Sample the canonical host while reserving the new ticket so a real
        // pause cannot interleave between reopening the gate and reservation.
        val active = try { canonicalHostActive() } catch (_: RuntimeException) { false }
        if (!active) {
          foreground = false
          closedThrough = ticket
          null
        } else {
          foreground = true
          generation to revision
        }
      }
    }
    if (epoch == null) { resolve(false); return }
    try {
      dispatch {
        val accepted = synchronized(lock) {
          if (!current(ticket, epoch.first, epoch.second) || ticket <= closedThrough) false
          else {
            val candidate = try { capture(tag)?.takeIf { inspect(it, tag).capturable() } } catch (_: RuntimeException) { null }
            if (candidate != null && current(ticket, epoch.first, epoch.second) && ticket > closedThrough) {
              target = Target(ticket, tag, candidate)
              true
            } else false
          }
        }
        resolve(accepted)
      }
    } catch (_: RuntimeException) { cancel(ticket); resolve(false) }
  }

  fun restoreFocus(ticket: Long, resolve: (Boolean) -> Unit) {
    val pending = synchronized(lock) {
      val saved = target
      if (invalidated || !foreground || ticket <= 0 || ticket != latestTicket ||
          ticket <= closedThrough || saved?.ticket != ticket) {
        // A restore preceding its capture completion must never replay later.
        if (ticket > closedThrough) cancel(ticket)
        null
      } else {
        target = null
        closedThrough = ticket
        revision++
        Triple(saved, generation, revision)
      }
    }
    if (pending == null) { resolve(false); return }
    try {
      dispatch {
        val restored = synchronized(lock) {
          if (!current(ticket, pending.second, pending.third)) false
          else try {
            val saved = pending.first
            inspect(saved.value, saved.tag).restorable() &&
              current(ticket, pending.second, pending.third) && focus(saved.value)
          } catch (_: RuntimeException) { false }
        }
        resolve(restored)
      }
    } catch (_: RuntimeException) { cancel(ticket); resolve(false) }
  }

  private fun current(ticket: Long, epoch: Long, operation: Long) =
    !invalidated && foreground && ticket == latestTicket && generation == epoch && revision == operation
}

private data class AccessibilityFocusTarget(
  val view: WeakReference<View>,
  val activity: WeakReference<Activity>,
  val root: WeakReference<View>,
)

class AccessibilityFocusModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context), LifecycleEventListener {
  @Volatile private var invalidated = false
  private var registered = false
  private val requests = AccessibilityFocusRequests(
    { !invalidated && context.hasActiveReactInstance() && context.lifecycleState == LifecycleState.RESUMED },
    { block -> UiThreadUtil.runOnUiThread { block() } },
    ::capture,
    ::inspect,
  ) { saved ->
    saved.view.get()?.performAccessibilityAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null) == true
  }

  override fun getName() = "DualLaneAccessibilityFocus"

  override fun initialize() {
    super.initialize()
    // A lazy module's first JS call may beat posted lifecycle registration.
    // This opens only the ticket gate; the UI operation still checks live state.
    if (!invalidated && context.lifecycleState == LifecycleState.RESUMED) requests.resume()
    UiThreadUtil.runOnUiThread {
      if (!invalidated && !registered) {
        context.addLifecycleEventListener(this)
        registered = true
        if (context.lifecycleState == LifecycleState.RESUMED) requests.resume() else requests.pause()
      }
    }
  }

  override fun onHostResume() {
    if (!invalidated && context.lifecycleState == LifecycleState.RESUMED) requests.resume()
  }
  override fun onHostPause() = requests.pause()
  override fun onHostDestroy() = requests.pause()

  private fun resolve(tag: Int): View? =
    UIManagerHelper.getUIManagerForReactTag(context, tag)?.resolveView(tag)

  private fun capture(tag: Int): AccessibilityFocusTarget? {
    UiThreadUtil.assertOnUiThread()
    if (invalidated || !context.hasActiveReactInstance() || context.lifecycleState != LifecycleState.RESUMED) return null
    val activity = context.currentActivity ?: return null
    val root = activity.window?.decorView ?: return null
    val view = resolve(tag) ?: return null
    return AccessibilityFocusTarget(WeakReference(view), WeakReference(activity), WeakReference(root))
  }

  private fun inspect(saved: AccessibilityFocusTarget, tag: Int): AccessibilityFocusState {
    UiThreadUtil.assertOnUiThread()
    val view = saved.view.get()
    val activity = saved.activity.get()
    val root = saved.root.get()
    val hostActive = !invalidated && context.hasActiveReactInstance() && context.lifecycleState == LifecycleState.RESUMED
    val manager = context.getSystemService(Context.ACCESSIBILITY_SERVICE) as? AccessibilityManager
    // Fabric manages child layout. Its visible target can retain geometry while
    // the framework's attach-cycle layout flag is false; inspect current bounds.
    val visibleRect = Rect()
    val visibleBounds = view != null && accessibilityFocusVisibleBounds(
      view.width, view.height, view.getGlobalVisibleRect(visibleRect),
      visibleRect.width(), visibleRect.height(),
    )
    return AccessibilityFocusState(
      hostActive = hostActive && activity != null && !activity.isFinishing && !activity.isDestroyed,
      sameView = view != null && hostActive && resolve(tag) === view,
      sameActivity = activity != null && context.currentActivity === activity,
      sameRoot = root != null && activity?.window?.decorView === root && view?.rootView === root,
      attached = view?.isAttachedToWindow == true && root?.isAttachedToWindow == true,
      shown = view?.isShown == true,
      visibleBounds = visibleBounds,
      windowFocused = view?.hasWindowFocus() == true,
      readerEnabled = manager?.isEnabled == true,
      touchExploration = manager?.isTouchExplorationEnabled == true,
    )
  }

  @ReactMethod
  fun captureTarget(reactTag: Double, ticket: Double, promise: Promise) {
    val tag = accessibilityFocusTag(reactTag)
    val identity = accessibilityFocusTicket(ticket)
    if (tag == null || identity == null) promise.resolve(false)
    else requests.captureTarget(tag, identity) { promise.resolve(it) }
  }

  @ReactMethod
  fun restoreFocus(ticket: Double, promise: Promise) {
    val identity = accessibilityFocusTicket(ticket)
    if (identity == null) promise.resolve(false)
    else requests.restoreFocus(identity) { promise.resolve(it) }
  }

  @ReactMethod
  fun cancelTarget(ticket: Double) {
    accessibilityFocusTicket(ticket)?.let(requests::cancel)
  }

  override fun invalidate() {
    invalidated = true
    requests.invalidate()
    UiThreadUtil.runOnUiThread {
      if (registered) { context.removeLifecycleEventListener(this); registered = false }
    }
    super.invalidate()
  }
}

class AccessibilityFocusPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = listOf(AccessibilityFocusModule(reactContext))
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
