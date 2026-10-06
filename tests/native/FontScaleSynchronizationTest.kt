package com.timestarry.duallane

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FontScaleSynchronizationTest {
  private class Barrier(val scale: Float, val ready: () -> Unit, val interrupted: () -> Unit) {
    var cancelled = false
  }

  private class Harness {
    var hasRoot = true
    val barriers = mutableListOf<Barrier>()
    val events = mutableListOf<Pair<Float, Long>>()
    val synchronization = FontScaleSynchronization(1f, { scale, ready, interrupted ->
      if (!hasRoot) null else {
        val barrier = Barrier(scale, ready, interrupted)
        barriers.add(barrier)
        val cancellation: () -> Unit = { barrier.cancelled = true }
        cancellation
      }
    }) { scale, revision -> events.add(scale to revision) }

    fun frame(index: Int = barriers.lastIndex) = barriers[index].ready()
    fun start() {
      synchronization.resume(1f)
      frame()
    }
  }

  @Test fun earlyApplicationCallbackDoesNotPublishBeforeRootMeasurement() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    // Expo's Activity config delegate and the root's measure have not run yet.
    assertTrue(h.events.isEmpty())
    assertEquals(1f, h.synchronization.fontScale)
    h.frame()
    assertEquals(listOf(2f to 1L), h.events)
  }

  @Test fun firstSnapshotWaitsForAnActualForegroundRootBarrier() {
    val h = Harness()
    val snapshots = mutableListOf<Pair<Float, Long>>()
    h.synchronization.awaitSnapshot({ scale, revision -> snapshots.add(scale to revision) }, { error("invalidated") })
    assertTrue(h.barriers.isEmpty())
    h.synchronization.resume(2f)
    assertTrue(snapshots.isEmpty())
    h.frame()
    assertEquals(listOf(2f to 1L), snapshots)
  }

  @Test fun rapidReturnToOneRejectsTheOldTwoTimesBarrier() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    val old = h.barriers.lastIndex
    h.synchronization.configurationChanged(1f)
    assertTrue(h.barriers[old].cancelled)
    h.frame(old) // Even an already queued callback cannot publish stale scale.
    h.frame()
    assertTrue(h.events.isEmpty())
    assertEquals(1f, h.synchronization.fontScale)
    assertEquals(0L, h.synchronization.revision)
  }

  @Test fun backgroundCancelsBarrierAndResumesWithCurrentConfiguration() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    val paused = h.barriers.lastIndex
    h.synchronization.pause()
    assertTrue(h.barriers[paused].cancelled)
    h.frame(paused)
    h.synchronization.configurationChanged(3f)
    assertEquals(paused + 1, h.barriers.size)
    h.synchronization.resume(1f)
    h.frame()
    assertTrue(h.events.isEmpty())
  }

  @Test fun invalidationCleansPendingSnapshotsAndIgnoresLateFrames() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    val old = h.barriers.lastIndex
    var rejected = 0
    h.synchronization.awaitSnapshot({ _, _ -> error("late snapshot") }, { rejected++ })
    h.synchronization.invalidate()
    assertTrue(h.barriers[old].cancelled)
    h.frame(old)
    h.synchronization.resume(2f)
    h.synchronization.configurationChanged(3f)
    h.synchronization.awaitSnapshot({ _, _ -> error("invalid snapshot") }, { rejected++ })
    assertEquals(2, rejected)
    assertTrue(h.events.isEmpty())
    assertEquals(old + 1, h.barriers.size)
  }

  @Test fun missingRootDefersSnapshotUntilResumeProvidesOne() {
    val h = Harness()
    h.hasRoot = false
    h.synchronization.resume(2f)
    var ready = false
    h.synchronization.awaitSnapshot({ scale, _ -> assertEquals(2f, scale); ready = true }, { error("invalidated") })
    assertFalse(ready)
    assertTrue(h.barriers.isEmpty())
    h.hasRoot = true
    h.synchronization.resume(2f)
    assertFalse(ready)
    h.frame()
    assertTrue(ready)
    assertEquals(listOf(2f to 1L), h.events)
  }

  @Test fun pickerResumeSynchronizesSameScaleWithoutRemountEvent() {
    val h = Harness()
    h.start()
    val previous = h.barriers.size
    h.synchronization.pause()
    h.synchronization.resume(1f)
    assertEquals(previous + 1, h.barriers.size)
    h.frame()
    assertTrue(h.events.isEmpty())
    assertEquals(0L, h.synchronization.revision)
  }

  @Test fun detachedRootDoesNotLeaveADeadBarrierBlockingAReplacement() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    val detached = h.barriers.lastIndex
    var snapshots = 0
    h.synchronization.awaitSnapshot({ _, _ -> snapshots++ }, { error("invalidated") })
    h.barriers[detached].interrupted()
    assertTrue(h.barriers[detached].cancelled)
    h.frame(detached)
    assertTrue(h.events.isEmpty())
    h.synchronization.awaitSnapshot({ _, _ -> snapshots++ }, { error("invalidated") })
    assertEquals(detached + 2, h.barriers.size)
    h.frame()
    assertEquals(2, snapshots)
    assertEquals(listOf(2f to 1L), h.events)
  }

  @Test fun unrelatedConfigurationDoesNotRequestOrPublishAnotherFontChange() {
    val h = Harness()
    h.start()
    val previous = h.barriers.size
    h.synchronization.configurationChanged(1f)
    assertEquals(previous, h.barriers.size)
    assertTrue(h.events.isEmpty())
  }

  @Test fun invalidScaleCannotReplaceThePendingValidScale() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    val previous = h.barriers.size
    for (scale in listOf(0f, -1f, Float.NaN, Float.POSITIVE_INFINITY)) {
      h.synchronization.configurationChanged(scale)
      h.synchronization.resume(scale)
    }
    assertEquals(previous, h.barriers.size)
    h.frame()
    assertEquals(listOf(2f to 1L), h.events)
  }

  @Test fun repeatedCallbacksKeepOnePendingBarrierAndOneRevision() {
    val h = Harness()
    h.start()
    h.synchronization.configurationChanged(2f)
    val previous = h.barriers.size
    h.synchronization.configurationChanged(2f)
    assertEquals(previous, h.barriers.size)
    h.frame()
    assertEquals(listOf(2f to 1L), h.events)
    h.synchronization.configurationChanged(1f)
    h.frame()
    assertEquals(listOf(2f to 1L, 1f to 2L), h.events)
  }
}
