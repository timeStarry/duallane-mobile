package com.timestarry.duallane

import android.app.Activity
import android.content.Intent
import android.provider.DocumentsContract
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.net.URI
import kotlin.concurrent.thread

class SaveFileModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private data class PendingSave(val source: File, val promise: Promise)
  private var pending: PendingSave? = null

  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_CODE) return
      val save = synchronized(this@SaveFileModule) {
        pending.also { pending = null }
      } ?: return
      if (resultCode != Activity.RESULT_OK || data?.data == null) {
        save.promise.resolve(false)
        return
      }
      val destination = data.data!!
      thread(name = "duallane-save-file") {
        try {
          val expectedSize = save.source.length()
          val copied = save.source.inputStream().use { input ->
            context.contentResolver.openOutputStream(destination, "w")?.use { output ->
              input.copyTo(output).also { output.flush() }
            } ?: throw IllegalStateException("Could not open the selected document")
          }
          if (copied != expectedSize) throw IllegalStateException("Incomplete saved file")
          save.promise.resolve(true)
        } catch (error: Exception) {
          try { DocumentsContract.deleteDocument(context.contentResolver, destination) } catch (_: Exception) { }
          save.promise.reject("E_SAVE_FAILED", error)
        }
      }
    }
  }

  init { context.addActivityEventListener(listener) }

  override fun getName() = "DualLaneSaveFile"

  @ReactMethod
  fun saveFile(fileUri: String, fileName: String, mimeType: String, promise: Promise) {
    val source = try { File(URI(fileUri)).canonicalFile } catch (error: Exception) {
      promise.reject("E_INVALID_FILE", error)
      return
    }
    val cache = context.cacheDir.canonicalFile
    if (!source.path.startsWith(cache.path + File.separator) || !source.isFile) {
      promise.reject("E_INVALID_FILE", "Only a downloaded cache file may be saved")
      return
    }
    val activity = context.currentActivity ?: run {
      promise.reject("E_NO_ACTIVITY", "No activity is available to save the file")
      return
    }
    synchronized(this) {
      if (pending != null) {
        promise.reject("E_SAVE_BUSY", "Another file is being saved")
        return
      }
      pending = PendingSave(source, promise)
    }
    val title = fileName.substringAfterLast('/').substringAfterLast('\\')
      .filter { it.code >= 32 }.take(128).ifEmpty { "download" }
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = mimeType.ifBlank { "application/octet-stream" }
      putExtra(Intent.EXTRA_TITLE, title)
    }
    activity.runOnUiThread {
      try { activity.startActivityForResult(intent, REQUEST_CODE) }
      catch (error: Exception) {
        synchronized(this) { pending = null }
        promise.reject("E_SAVE_PICKER", error)
      }
    }
  }

  override fun invalidate() {
    synchronized(this) {
      pending?.promise?.reject("E_SAVE_CANCELLED", "File save was interrupted")
      pending = null
    }
    context.removeActivityEventListener(listener)
    super.invalidate()
  }

  companion object { private const val REQUEST_CODE = 52761 }
}

class SaveFilePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(SaveFileModule(reactContext), DeviceBuildModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class DeviceBuildModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "DualLaneBuildInfo"

  override fun getConstants(): Map<String, Any> = mapOf(
    "appVersion" to BuildConfig.VERSION_NAME,
    "versionCode" to BuildConfig.VERSION_CODE,
  )
}
