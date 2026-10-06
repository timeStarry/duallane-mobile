package com.timestarry.duallane

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityFocusRequestsTest {
  private data class Target(val view: Any, val activity: Any, val root: Any)

  private class Harness(initiallyResumed: Boolean = true) {
    val queued = mutableListOf<() -> Unit>()
    val captures = mutableListOf<Boolean>()
    val restores = mutableListOf<Boolean>()
    var view = Any()
    var activity = Any()
    var root = Any()
    var missing = false
    var state = AccessibilityFocusState(true, true, true, true, true, true, true, false, false, false)
    var actions = 0
    var actionResult = true
    var throwCapture = false
    var throwAction = false
    val requests = AccessibilityFocusRequests(
      { work -> queued.add(work); Unit },
      { _: Int ->
        if (throwCapture) throw IllegalStateException("synthetic")
        if (missing) null else Target(view, activity, root)
      },
      { target: Target, _: Int -> state.copy(sameView = state.sameView && target.view === view,
        sameActivity = state.sameActivity && target.activity === activity,
        sameRoot = state.sameRoot && target.root === root) },
    ) {
      actions++
      if (throwAction) throw IllegalStateException("synthetic")
      actionResult
    }

    init { if (initiallyResumed) requests.resume() }
    fun capture(ticket: Long = 1) = requests.captureTarget(12, ticket) { captures.add(it) }
    fun restore(ticket: Long = 1) = requests.restoreFocus(ticket) { restores.add(it) }
    fun run(index: Int = 0) { queued.removeAt(index)() }
    fun drain() { while (queued.isNotEmpty()) run() }
    fun afterDismissWithReader() { state = state.copy(windowFocused = true, readerEnabled = true, touchExploration = true) }
  }

  @Test fun lateReaderUsesCapturedExactTargetAndPerformsOnePublicAction() {
    val h = Harness()
    // Capturing an attached underlying entry does not require reader or window focus.
    h.capture(); h.drain()
    assertEquals(listOf(true), h.captures)
    assertEquals(0, h.actions)
    h.afterDismissWithReader()
    h.restore(); h.drain()
    assertEquals(listOf(true), h.restores)
    assertEquals(1, h.actions)
    h.restore(); h.drain()
    assertEquals(listOf(true, false), h.restores)
    assertEquals(1, h.actions)
  }

  @Test fun firstCaptureOfResumedLazyModuleSurvivesPendingUiRegistration() {
    val h = Harness(initiallyResumed = false)
    // initialize observes the resumed host synchronously, before its UI task.
    h.requests.resume()
    h.queued.add { h.requests.resume() }
    h.capture()
    assertTrue(h.captures.isEmpty())
    h.drain()
    assertEquals(listOf(true), h.captures)
    h.afterDismissWithReader(); h.restore(); h.drain()
    assertEquals(1, h.actions)
  }

  @Test fun pendingInitializationCannotReviveCancelledPausedOrInvalidatedCapture() {
    for (change in listOf("cancel", "pause", "invalidate")) {
      val h = Harness(initiallyResumed = false)
      h.requests.resume()
      h.queued.add { h.requests.resume() }
      h.capture()
      when (change) {
        "cancel" -> h.requests.cancel(1)
        "pause" -> h.requests.pause()
        else -> h.requests.invalidate()
      }
      h.drain(); h.afterDismissWithReader(); h.restore(); h.drain()
      assertEquals(listOf(false), h.captures)
      assertEquals(0, h.actions)
    }
    val paused = Harness(initiallyResumed = false)
    paused.capture(); paused.drain()
    assertEquals(listOf(false), paused.captures)
  }

  @Test fun readerOffAndPreDismissAreConsumedWithoutActionOrLaterReplay() {
    for (missing in listOf("reader", "touch", "window")) {
      val h = Harness()
      h.capture(); h.drain(); h.afterDismissWithReader()
      h.state = when (missing) {
        "reader" -> h.state.copy(readerEnabled = false)
        "touch" -> h.state.copy(touchExploration = false)
        else -> h.state.copy(windowFocused = false)
      }
      h.restore(); h.drain()
      h.afterDismissWithReader(); h.restore(); h.drain()
      assertEquals(listOf(false, false), h.restores)
      assertEquals(0, h.actions)
    }
  }

  @Test fun cancelBeforeCaptureInvocationClosesThatTicket() {
    val h = Harness()
    h.requests.cancel(5)
    h.capture(5); h.drain()
    h.afterDismissWithReader(); h.restore(5); h.drain()
    assertEquals(listOf(false), h.captures)
    assertEquals(0, h.actions)
    h.capture(6); h.drain(); h.restore(6); h.drain()
    assertEquals(listOf(false, true), h.captures)
    assertEquals(1, h.actions)
  }

  @Test fun queuedCaptureCannotSurviveCancelOrAnOlderRestore() {
    val h = Harness()
    h.capture(1)
    h.requests.cancel(1)
    h.drain()
    h.capture(2)
    h.restore(2) // A capture promise has not yet succeeded.
    h.drain(); h.afterDismissWithReader(); h.restore(2); h.drain()
    assertEquals(listOf(false, false), h.captures)
    assertTrue(h.restores.all { !it })
    assertEquals(0, h.actions)
  }

  @Test fun oldCaptureCannotReplaceNewerTargetWhenUiCallbacksAreReordered() {
    val h = Harness()
    h.capture(1); h.capture(2)
    h.run(1); h.run(0)
    assertEquals(listOf(true, false), h.captures)
    h.afterDismissWithReader(); h.restore(1); h.restore(2); h.drain()
    assertEquals(listOf(false, true), h.restores)
    assertEquals(1, h.actions)
  }

  @Test fun cancelAfterRestoreWasQueuedPreventsItsAction() {
    val h = Harness()
    h.capture(); h.drain(); h.afterDismissWithReader()
    h.restore(); h.requests.cancel(1); h.drain()
    assertEquals(listOf(false), h.restores)
    assertEquals(0, h.actions)
  }

  @Test fun duplicateQueuedRestoreDoesNotCancelOrDuplicateTheFirstAttempt() {
    val h = Harness()
    h.capture(); h.drain(); h.afterDismissWithReader()
    h.restore(); h.restore(); h.drain()
    assertEquals(listOf(false, true), h.restores)
    assertEquals(1, h.actions)
  }

  @Test fun newerCaptureInvalidatesAnOlderQueuedRestoreWithoutLosingNewSlot() {
    val h = Harness()
    h.capture(1); h.drain(); h.afterDismissWithReader()
    h.restore(1); h.capture(2); h.drain(); h.restore(2); h.drain()
    assertEquals(listOf(false, true), h.restores)
    assertEquals(1, h.actions)
  }

  @Test fun recycledTagDifferentActivityAndRootNeverReceiveCapturedFocus() {
    for (changed in listOf("view", "activity", "root")) {
      val h = Harness()
      h.capture(); h.drain(); h.afterDismissWithReader()
      when (changed) {
        "view" -> h.view = Any()
        "activity" -> h.activity = Any()
        else -> h.root = Any()
      }
      h.restore(); h.drain()
      assertEquals(listOf(false), h.restores)
      assertEquals(0, h.actions)
    }
  }

  @Test fun detachedHiddenUnlaidOutAndInactiveTargetsCannotRestore() {
    for (changed in listOf("attached", "shown", "layout", "host")) {
      val h = Harness()
      h.capture(); h.drain(); h.afterDismissWithReader()
      h.state = when (changed) {
        "attached" -> h.state.copy(attached = false)
        "shown" -> h.state.copy(shown = false)
        "layout" -> h.state.copy(laidOut = false)
        else -> h.state.copy(hostActive = false)
      }
      h.restore(); h.drain()
      assertEquals(0, h.actions)
      assertEquals(listOf(false), h.restores)
    }
  }

  @Test fun invalidCaptureStatesNeverCreateARestorableSlot() {
    for (changed in listOf("missing", "attached", "shown", "host", "view", "activity", "root")) {
      val h = Harness()
      h.missing = changed == "missing"
      h.state = when (changed) {
        "attached" -> h.state.copy(attached = false)
        "shown" -> h.state.copy(shown = false)
        "host" -> h.state.copy(hostActive = false)
        "view" -> h.state.copy(sameView = false)
        "activity" -> h.state.copy(sameActivity = false)
        "root" -> h.state.copy(sameRoot = false)
        else -> h.state
      }
      h.capture(); h.drain(); h.afterDismissWithReader(); h.restore(); h.drain()
      assertEquals(listOf(false), h.captures)
      assertEquals(0, h.actions)
    }
  }

  @Test fun pauseResumeDiscardsBothDeferredCaptureAndDeferredRestore() {
    val h = Harness()
    h.capture(1); h.requests.pause(); h.requests.resume(); h.drain()
    assertEquals(listOf(false), h.captures)
    h.capture(2); h.drain(); h.afterDismissWithReader(); h.restore(2)
    h.requests.pause(); h.requests.resume(); h.drain()
    assertEquals(listOf(false), h.restores)
    assertEquals(0, h.actions)
    h.capture(2); h.capture(3); h.drain(); h.restore(3); h.drain()
    assertEquals(listOf(false, true, false, true), h.captures)
    assertEquals(1, h.actions)
  }

  @Test fun backgroundCaptureDoesNotBecomeEligibleAfterResume() {
    val h = Harness()
    h.requests.pause(); h.capture(4); h.requests.resume(); h.capture(4); h.drain()
    assertEquals(listOf(false, false), h.captures)
  }

  @Test fun invalidatePreventsPendingAndFutureWorkEvenAfterResume() {
    for (duringRestore in listOf(false, true)) {
      val h = Harness()
      h.capture()
      if (duringRestore) { h.drain(); h.afterDismissWithReader(); h.restore() }
      h.requests.invalidate(); h.requests.resume(); h.drain()
      h.capture(2); h.restore(2); h.drain()
      assertEquals(0, h.actions)
      assertTrue(h.restores.all { !it })
    }
  }

  @Test fun nativeFailureAndFalseReturnDoNotRetryOrThrowAcrossPromise() {
    val h = Harness()
    h.throwCapture = true; h.capture(1); h.drain()
    assertEquals(listOf(false), h.captures)
    h.throwCapture = false; h.capture(2); h.drain(); h.afterDismissWithReader()
    h.throwAction = true; h.restore(2); h.drain(); h.restore(2); h.drain()
    assertEquals(1, h.actions)
    assertEquals(listOf(false, false), h.restores)
    h.throwAction = false; h.actionResult = false; h.capture(3); h.drain(); h.restore(3); h.drain()
    assertEquals(2, h.actions)
    assertFalse(h.restores.last())
  }

  @Test fun invalidNumericInputsCannotAliasAValidTicketOrTag() {
    for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1.0, 0.0, 1.5, 9007199254740992.0)) {
      assertNull(accessibilityFocusTicket(value))
    }
    for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 0.0, 1.5, 2147483648.0)) {
      assertNull(accessibilityFocusTag(value))
    }
    assertEquals(9007199254740991L, accessibilityFocusTicket(9007199254740991.0))
    assertEquals(12, accessibilityFocusTag(12.0))
  }
}
