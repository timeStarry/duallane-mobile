package com.timestarry.duallane

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.OpenableColumns
import android.util.Base64
import android.view.HapticFeedbackConstants
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService

class NativeBridge(
    private val activity: MainActivity,
    private val webViewProvider: () -> WebView?,
    private val networkGateway: NetworkGateway,
    private val realtimeManager: RealtimeManager,
    private val appUpdateManager: AppUpdateManager,
    private val ioExecutor: ExecutorService,
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val pickedFiles = ConcurrentHashMap<String, PickedMediaEntry>()

    @JavascriptInterface
    fun getBootstrapInfo(): String {
        val cfg = networkGateway.tokenVault.bundledConfig
        val ota = appUpdateManager.getActiveOtaState()
        return JSONObject().apply {
            put("authenticated", networkGateway.tokenVault.isAuthenticated())
            put("apiOrigin", networkGateway.tokenVault.getApiOrigin())
            put("appVersion", ota?.version ?: cfg.appVersion)
            put("nativeVersion", cfg.appVersion)
            put("versionCode", cfg.versionCode)
            put("otaActive", ota != null)
            put("otaBundleId", ota?.bundleId ?: "")
            put("platform", "android")
            put("systemTheme", if (activity.isSystemDarkMode()) "dark" else "light")
        }.toString()
    }

    @JavascriptInterface
    fun setApiOrigin(origin: String): String {
        return try {
            val clean = origin.trim().trimEnd('/')
            val parsed = Uri.parse(clean)
            val scheme = parsed.scheme?.lowercase()
            val host = parsed.host?.lowercase()
            if (host.isNullOrBlank() || (scheme != "https" && host != "127.0.0.1" && host != "localhost" && host != "10.0.2.2")) {
                return JSONObject()
                    .put("ok", false)
                    .put("error", "服务地址必须使用 HTTPS 协议")
                    .toString()
            }
            realtimeManager.shutdownOnLogout()
            networkGateway.tokenVault.setApiOrigin(clean)
            JSONObject()
                .put("ok", true)
                .put("apiOrigin", clean)
                .toString()
        } catch (err: Throwable) {
            JSONObject()
                .put("ok", false)
                .put("error", err.message ?: "无效的服务地址")
                .toString()
        }
    }

    @JavascriptInterface
    fun startGitHubOAuth(inviteCode: String) {
        ioExecutor.execute {
            try {
                val authUrl = networkGateway.startGitHubOAuth(inviteCode)
                mainHandler.post {
                    activity.openOAuthCustomTab(authUrl)
                }
            } catch (err: Throwable) {
                emitOAuthResult(false, err.message ?: "启动 GitHub 登录失败")
            }
        }
    }

    @JavascriptInterface
    fun loginWithEmailCode(callId: String, email: String, challengeId: String, code: String) {
        ioExecutor.execute {
            try {
                val res = networkGateway.loginWithEmailCode(email, challengeId, code)
                PushKeepAliveService.syncServiceState(activity.applicationContext)
                resolveCall(callId, true, res.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "验证码登录失败")
            }
        }
    }

    @JavascriptInterface
    fun logout() {
        realtimeManager.shutdownOnLogout()
        ioExecutor.execute {
            networkGateway.logout()
        }
    }

    @JavascriptInterface
    fun httpRequest(
        callId: String,
        method: String,
        path: String,
        headersJson: String,
        bodyText: String,
    ) {
        ioExecutor.execute {
            try {
                val result = networkGateway.executeApiCall(method, path, headersJson, bodyText)
                resolveCall(callId, true, result.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "网络请求失败")
            }
        }
    }

    @JavascriptInterface
    fun pickMedia(callId: String, mode: String, multiple: Boolean) {
        mainHandler.post {
            activity.launchMediaPicker(mode, multiple) { uris ->
                ioExecutor.execute {
                    try {
                        val arr = JSONArray()
                        for (uri in uris) {
                            val entry = registerPickedUri(uri)
                            val obj = JSONObject().apply {
                                put("id", entry.id)
                                put("name", entry.name)
                                put("mimeType", entry.mimeType)
                                put("size", entry.size)
                                if (entry.mimeType.startsWith("image/")) {
                                    buildImagePreviewDataUrl(uri)?.let { put("previewDataUrl", it) }
                                }
                            }
                            arr.put(obj)
                        }
                        resolveCall(callId, true, JSONObject().put("files", arr).toString())
                    } catch (err: Throwable) {
                        resolveCall(callId, false, err.message ?: "读取所选媒体失败")
                    }
                }
            }
        }
    }

    @JavascriptInterface
    fun uploadConversationFile(callId: String, conversationId: String, pickedFileId: String) {
        ioExecutor.execute {
            try {
                val entry = pickedFiles[pickedFileId]
                    ?: throw IllegalStateException("未找到待上传文件，请重新选择")
                val res = networkGateway.uploadConversationFile(conversationId, entry)
                resolveCall(callId, true, res.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "文件上传失败")
            }
        }
    }

    @JavascriptInterface
    fun uploadTextAttachment(
        callId: String,
        conversationId: String,
        fileName: String,
        content: String,
    ) {
        ioExecutor.execute {
            try {
                val cleanName = fileName.trim().ifBlank { "pasted.txt" }
                val bytes = content.toByteArray(Charsets.UTF_8)
                val res = networkGateway.uploadConversationBytes(
                    conversationId = conversationId,
                    fileName = cleanName,
                    mimeType = "text/plain; charset=utf-8",
                    bytes = bytes,
                )
                resolveCall(callId, true, res.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "长文本附件上传失败")
            }
        }
    }

    @JavascriptInterface
    fun uploadCustomEmote(
        callId: String,
        pickedFileId: String,
        collectionId: String,
        addToLibrary: Boolean,
    ) {
        ioExecutor.execute {
            try {
                val entry = pickedFiles[pickedFileId]
                    ?: throw IllegalStateException("未找到待上传贴纸图片")
                val res = networkGateway.uploadCustomEmote(entry, collectionId, addToLibrary)
                resolveCall(callId, true, res.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "贴纸上传失败")
            }
        }
    }

    @JavascriptInterface
    fun uploadBinaryAvatar(callId: String, targetPath: String, pickedFileId: String) {
        ioExecutor.execute {
            try {
                val entry = pickedFiles[pickedFileId]
                    ?: throw IllegalStateException("未找到头像图片")
                val res = networkGateway.uploadBinaryAvatar(targetPath, entry)
                resolveCall(callId, true, res.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "头像上传失败")
            }
        }
    }

    @JavascriptInterface
    fun readPickedFileBase64(callId: String, pickedFileId: String) {
        ioExecutor.execute {
            try {
                val entry = pickedFiles[pickedFileId]
                    ?: throw IllegalStateException("未找到待读取文件")
                val bytes = networkGateway.readAllMediaBytes(entry.uri, 12L * 1024L * 1024L)
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                resolveCall(callId, true, JSONObject().put("base64", b64).toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "读取文件失败")
            }
        }
    }

    @JavascriptInterface
    fun wsConnect(socketId: String, path: String, authenticated: Boolean) {
        realtimeManager.connect(socketId, path, authenticated)
    }

    @JavascriptInterface
    fun wsSend(socketId: String, data: String) {
        realtimeManager.send(socketId, data)
    }

    @JavascriptInterface
    fun wsClose(socketId: String) {
        realtimeManager.close(socketId)
    }

    @JavascriptInterface
    fun syncNotificationContext(json: String) {
        runCatching {
            realtimeManager.syncNotificationContext(json)
            if (networkGateway.tokenVault.isAuthenticated()) {
                PushKeepAliveService.syncServiceState(activity.applicationContext)
            }
        }
    }

    @JavascriptInterface
    fun clearConversationNotification(conversationId: String) {
        realtimeManager.clearConversationNotification(conversationId)
    }

    @JavascriptInterface
    fun getBackgroundPushStatus(): String {
        return JSONObject().apply {
            put("keepAliveEnabled", networkGateway.tokenVault.isKeepAliveEnabled())
            put("notificationsGranted", activity.isNotificationsGranted())
            put("ignoringBatteryOptimizations", activity.isIgnoringBatteryOptimizations())
        }.toString()
    }

    @JavascriptInterface
    fun setKeepAliveEnabled(enabled: Boolean): String {
        networkGateway.tokenVault.setKeepAliveEnabled(enabled)
        PushKeepAliveService.syncServiceState(activity.applicationContext)
        return getBackgroundPushStatus()
    }

    @JavascriptInterface
    fun requestIgnoreBatteryOptimizations() {
        mainHandler.post {
            activity.requestIgnoreBatteryOptimizations()
        }
    }

    @JavascriptInterface
    fun requestNotificationPermission() {
        mainHandler.post {
            activity.requestNotificationPermissionOrSettings()
        }
    }

    @JavascriptInterface
    fun haptic(kind: String) {
        mainHandler.post {
            val view = webViewProvider()
            if (view != null) {
                val feedback = when (kind) {
                    "heavy" -> HapticFeedbackConstants.LONG_PRESS
                    "medium" -> HapticFeedbackConstants.CONTEXT_CLICK
                    else -> HapticFeedbackConstants.CLOCK_TICK
                }
                if (view.performHapticFeedback(feedback)) return@post
            }
            runCatching {
                val durationMs = when (kind) {
                    "heavy" -> 22L
                    "medium" -> 14L
                    else -> 8L
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vm?.defaultVibrator?.vibrate(
                        VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE)
                    )
                } else {
                    @Suppress("DEPRECATION")
                    val vib = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    vib?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
                }
            }
        }
    }

    @JavascriptInterface
    fun shareText(title: String, text: String) {
        mainHandler.post {
            val sendIntent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, title)
                putExtra(Intent.EXTRA_TEXT, text)
            }
            activity.startActivity(Intent.createChooser(sendIntent, title.ifBlank { "分享" }))
        }
    }

    @JavascriptInterface
    fun copyText(text: String) {
        mainHandler.post {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            clipboard?.setPrimaryClip(ClipData.newPlainText("DualLane", text))
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String) {
        mainHandler.post {
            activity.openExternalBrowserUrl(url)
        }
    }

    @JavascriptInterface
    fun syncSystemBars(mode: String, bgHex: String) {
        mainHandler.post {
            activity.applySystemBarsAppearance(mode == "dark", bgHex)
        }
    }

    @JavascriptInterface
    fun setCanGoBack(canGoBack: Boolean) {
        mainHandler.post {
            activity.setJsCanGoBack(canGoBack)
        }
    }

    @JavascriptInterface
    fun prefetchMedia(urlsJson: String) {
        runCatching {
            val arr = JSONArray(urlsJson)
            val list = ArrayList<String>(minOf(arr.length(), 48))
            for (i in 0 until minOf(arr.length(), 48)) {
                val u = arr.optString(i, "").trim()
                if (u.isNotEmpty()) list.add(u)
            }
            if (list.isNotEmpty()) {
                networkGateway.prefetchMediaUrls(list)
            }
        }
    }

    @JavascriptInterface
    fun markBundleHealthy() {
        appUpdateManager.markBundleHealthy()
    }

    @JavascriptInterface
    fun downloadAndStageOta(
        callId: String,
        url: String,
        sha256: String,
        version: String,
        bundleId: String,
        minNativeVersionCode: Int,
    ) {
        ioExecutor.execute {
            try {
                val state = appUpdateManager.downloadAndStageOta(
                    rawUrl = url,
                    expectedSha256 = sha256,
                    version = version,
                    bundleId = bundleId,
                    minNativeVersionCode = minNativeVersionCode,
                    onProgress = { phase, pct, read, total ->
                        emitUpdateProgress("ota", phase, pct, read, total)
                    },
                )
                val res = JSONObject().apply {
                    put("ok", true)
                    put("version", state.version)
                    put("bundleId", state.bundleId)
                }
                resolveCall(callId, true, res.toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "下载热更资源失败")
            }
        }
    }

    @JavascriptInterface
    fun applyStagedOta() {
        mainHandler.post {
            activity.reloadForOtaUpdate()
        }
    }

    @JavascriptInterface
    fun rollbackOta() {
        appUpdateManager.clearActiveOta()
        mainHandler.post {
            activity.reloadForOtaUpdate()
        }
    }

    @JavascriptInterface
    fun downloadAndInstallApk(
        callId: String,
        url: String,
        sha256: String,
        version: String,
    ) {
        ioExecutor.execute {
            try {
                val apkFile = appUpdateManager.downloadApkUpdate(
                    rawUrl = url,
                    expectedSha256 = sha256,
                    version = version,
                    onProgress = { phase, pct, read, total ->
                        emitUpdateProgress("apk", phase, pct, read, total)
                    },
                )
                mainHandler.post {
                    try {
                        val status = activity.requestInstallApk(apkFile)
                        resolveCall(
                            callId,
                            true,
                            JSONObject().put("ok", true).put("status", status).toString()
                        )
                    } catch (err: Throwable) {
                        resolveCall(callId, false, err.message ?: "调起系统安装器失败")
                    }
                }
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "下载安装包失败")
            }
        }
    }

    @JavascriptInterface
    fun installPendingApk(callId: String) {
        mainHandler.post {
            try {
                val pending = appUpdateManager.getPendingApkFile()
                    ?: throw IllegalStateException("请先下载更新安装包")
                val status = activity.requestInstallApk(pending)
                resolveCall(callId, true, JSONObject().put("ok", true).put("status", status).toString())
            } catch (err: Throwable) {
                resolveCall(callId, false, err.message ?: "调起系统安装器失败")
            }
        }
    }

    private fun registerPickedUri(uri: Uri): PickedMediaEntry {
        val resolver = activity.contentResolver
        var fileName = "attachment"
        var byteSize = 0L
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx >= 0 && !cursor.isNull(nameIdx)) {
                        fileName = cursor.getString(nameIdx) ?: fileName
                    }
                    if (sizeIdx >= 0 && !cursor.isNull(sizeIdx)) {
                        byteSize = cursor.getLong(sizeIdx)
                    }
                }
            }
        val mime = resolver.getType(uri)?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        val id = "pf_${UUID.randomUUID()}"
        val entry = PickedMediaEntry(
            id = id,
            uri = uri,
            name = fileName,
            mimeType = mime,
            size = byteSize,
        )
        pickedFiles[id] = entry
        return entry
    }

    private fun buildImagePreviewDataUrl(uri: Uri): String? {
        return runCatching {
            val resolver = activity.contentResolver
            val boundsOpts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, boundsOpts) }
            if (boundsOpts.outWidth <= 0 || boundsOpts.outHeight <= 0) return null

            var sample = 1
            val maxDim = 256
            while (boundsOpts.outWidth / sample > maxDim || boundsOpts.outHeight / sample > maxDim) {
                sample *= 2
            }
            val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
            val bmp = resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, decodeOpts)
            } ?: return null

            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 78, out)
            bmp.recycle()
            val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            "data:image/jpeg;base64,$b64"
        }.getOrNull()
    }

    fun resolveCall(callId: String, ok: Boolean, payload: String) {
        evalJs(
            "window.__duallaneResolveCall && window.__duallaneResolveCall(${JSONObject.quote(callId)}, $ok, ${JSONObject.quote(payload)});"
        )
    }

    fun emitWsEvent(socketId: String, eventType: String, payload: String) {
        evalJs(
            "window.__duallaneOnWsEvent && window.__duallaneOnWsEvent(${JSONObject.quote(socketId)}, ${JSONObject.quote(eventType)}, ${JSONObject.quote(payload)});"
        )
    }

    fun emitOAuthResult(ok: Boolean, errorMsg: String) {
        evalJs(
            "window.__duallaneOnOAuthResult && window.__duallaneOnOAuthResult($ok, ${JSONObject.quote(errorMsg)});"
        )
    }

    fun emitDeepLink(url: String) {
        evalJs(
            "window.__duallaneOnDeepLink && window.__duallaneOnDeepLink(${JSONObject.quote(url)});"
        )
    }

    fun emitBackPressed() {
        evalJs("window.__duallaneOnBackPressed && window.__duallaneOnBackPressed();")
    }

    fun emitInsets(safeTopCssPx: Int, safeBottomCssPx: Int, imeHeightCssPx: Int) {
        evalJs(
            "window.__duallaneSetInsets && window.__duallaneSetInsets($safeTopCssPx, $safeBottomCssPx, $imeHeightCssPx);"
        )
    }

    fun emitSystemTheme(mode: String) {
        evalJs(
            "window.__duallaneOnSystemTheme && window.__duallaneOnSystemTheme(${JSONObject.quote(mode)});"
        )
    }

    fun emitAppResumed() {
        evalJs("window.__duallaneOnAppResumed && window.__duallaneOnAppResumed();")
    }

    fun emitUpdateProgress(
        kind: String,
        phase: String,
        percent: Int,
        downloadedBytes: Long,
        totalBytes: Long,
    ) {
        val payload = JSONObject().apply {
            put("kind", kind)
            put("phase", phase)
            put("percent", percent)
            put("downloadedBytes", downloadedBytes)
            put("totalBytes", totalBytes)
        }.toString()
        evalJs(
            "window.__duallaneOnUpdateProgress && window.__duallaneOnUpdateProgress(${JSONObject.quote(payload)});"
        )
    }

    private fun evalJs(script: String) {
        mainHandler.post {
            val wv = webViewProvider() ?: return@post
            wv.evaluateJavascript(script, null)
        }
    }
}
