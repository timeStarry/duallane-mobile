package com.timestarry.duallane

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import okhttp3.Request
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipInputStream

data class OtaBundleState(
    val version: String,
    val bundleId: String,
    val sha256: String,
    val minNativeVersionCode: Int,
    val nativeVersionCodeAtInstall: Int,
    val verified: Boolean,
    val bootAttempts: Int,
)

class AppUpdateManager(
    private val appContext: Context,
    private val networkGateway: NetworkGateway,
) {
    private val stateLock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val otaRootDir = File(appContext.filesDir, "ota")
    private val bundlesRootDir = File(otaRootDir, "bundles")
    private val stateFile = File(otaRootDir, "state.json")
    private val apkUpdatesDir = File(appContext.cacheDir, "updates")

    @Volatile
    private var activeOtaState: OtaBundleState? = null

    @Volatile
    private var lastDownloadedApk: File? = null

    private var watchdogRunnable: Runnable? = null

    fun prepareBootState() {
        synchronized(stateLock) {
            val bundled = networkGateway.tokenVault.bundledConfig
            val loaded = readPersistedStateLocked() ?: run {
                activeOtaState = null
                return
            }

            if (bundled.versionCode < loaded.minNativeVersionCode) {
                clearActiveOtaLocked()
                return
            }

            if (
                bundled.versionCode > loaded.nativeVersionCodeAtInstall &&
                compareSemver(bundled.appVersion, loaded.version) >= 0
            ) {
                clearActiveOtaLocked()
                return
            }

            val indexFile = File(bundlesRootDir, "${loaded.sha256}/www/index.html")
            if (!indexFile.isFile || indexFile.length() <= 0L) {
                clearActiveOtaLocked()
                return
            }

            if (!loaded.verified) {
                if (loaded.bootAttempts >= 2) {
                    clearActiveOtaLocked()
                    return
                }
                val incremented = loaded.copy(bootAttempts = loaded.bootAttempts + 1)
                writePersistedStateLocked(incremented)
                activeOtaState = incremented
            } else {
                activeOtaState = loaded
            }
        }
    }

    fun getActiveOtaState(): OtaBundleState? = activeOtaState

    fun getActiveWwwDir(): File? {
        val state = activeOtaState ?: return null
        val dir = File(bundlesRootDir, "${state.sha256}/www")
        return if (dir.isDirectory) dir else null
    }

    fun getPendingApkFile(): File? {
        val f = lastDownloadedApk
        return if (f != null && f.isFile && f.length() > 128L) f else null
    }

    fun startBootWatchdogIfNeeded(onRollbackRequired: () -> Unit) {
        cancelWatchdog()
        val state = activeOtaState ?: return
        if (state.verified) return

        val task = Runnable {
            val current = activeOtaState
            if (current != null && !current.verified) {
                clearActiveOta()
                onRollbackRequired()
            }
        }
        watchdogRunnable = task
        mainHandler.postDelayed(task, WATCHDOG_TIMEOUT_MS)
    }

    fun markBundleHealthy() {
        cancelWatchdog()
        synchronized(stateLock) {
            val state = activeOtaState ?: return
            if (!state.verified || state.bootAttempts != 0) {
                val healthy = state.copy(verified = true, bootAttempts = 0)
                writePersistedStateLocked(healthy)
                activeOtaState = healthy
            }
            pruneInactiveBundlesLocked(state.sha256)
        }
    }

    fun clearActiveOta() {
        cancelWatchdog()
        synchronized(stateLock) {
            clearActiveOtaLocked()
        }
    }

    fun downloadAndStageOta(
        rawUrl: String,
        expectedSha256: String,
        version: String,
        bundleId: String,
        minNativeVersionCode: Int,
        onProgress: (phase: String, percent: Int, downloaded: Long, total: Long) -> Unit,
    ): OtaBundleState {
        val bundled = networkGateway.tokenVault.bundledConfig
        if (minNativeVersionCode > 0 && bundled.versionCode < minNativeVersionCode) {
            throw IllegalStateException("当前客户端底座版本较低，请使用应用内安装包升级")
        }
        val cleanExpectedSha = expectedSha256.trim().lowercase()
        if (cleanExpectedSha.length != 64) {
            throw IllegalStateException("热更资源缺少完整性校验摘要")
        }

        val resolvedUrl = resolveSameOriginUrl(rawUrl)
        otaRootDir.mkdirs()
        bundlesRootDir.mkdirs()

        val tempZipFile = File(otaRootDir, "ota_dl_${UUID.randomUUID()}.zip")
        val stagingBundleDir = File(otaRootDir, "staging_${UUID.randomUUID()}")
        val stagingWwwDir = File(stagingBundleDir, "www")

        try {
            onProgress("downloading", 0, 0L, 0L)
            val actualSha = streamDownloadToFile(
                url = resolvedUrl,
                destFile = tempZipFile,
                maxBytes = MAX_OTA_ZIP_BYTES,
                onProgress = { pct, read, total ->
                    onProgress("downloading", pct, read, total)
                },
            )

            onProgress("verifying", 100, tempZipFile.length(), tempZipFile.length())
            if (!actualSha.equals(cleanExpectedSha, ignoreCase = true)) {
                throw IllegalStateException("热更资源完整性校验未通过")
            }

            extractValidatedWwwZip(tempZipFile, stagingWwwDir)
            val entryHtml = File(stagingWwwDir, "index.html")
            if (!entryHtml.isFile || entryHtml.length() <= 0L) {
                throw IllegalStateException("热更包缺少入口文件 index.html")
            }

            val finalBundleDir = File(bundlesRootDir, cleanExpectedSha)
            if (finalBundleDir.exists()) {
                finalBundleDir.deleteRecursively()
            }
            if (!stagingBundleDir.renameTo(finalBundleDir)) {
                throw IllegalStateException("写入热更资源目录失败")
            }

            val resolvedMinCode = if (minNativeVersionCode > 0) minNativeVersionCode else bundled.versionCode
            val newState = OtaBundleState(
                version = version.trim().removePrefix("v"),
                bundleId = bundleId.trim().ifBlank { cleanExpectedSha.take(12) },
                sha256 = cleanExpectedSha,
                minNativeVersionCode = resolvedMinCode,
                nativeVersionCodeAtInstall = bundled.versionCode,
                verified = false,
                bootAttempts = 0,
            )

            synchronized(stateLock) {
                writePersistedStateLocked(newState)
                activeOtaState = newState
            }
            onProgress("ready", 100, tempZipFile.length(), tempZipFile.length())
            return newState
        } finally {
            runCatching { tempZipFile.delete() }
            if (stagingBundleDir.exists()) {
                runCatching { stagingBundleDir.deleteRecursively() }
            }
        }
    }

    fun downloadApkUpdate(
        rawUrl: String,
        expectedSha256: String,
        version: String,
        onProgress: (phase: String, percent: Int, downloaded: Long, total: Long) -> Unit,
    ): File {
        val resolvedUrl = resolveApkDownloadUrl(rawUrl)
        apkUpdatesDir.mkdirs()
        apkUpdatesDir.listFiles()?.forEach { old ->
            runCatching { old.delete() }
        }

        val safeVer = version.trim().removePrefix("v").replace(Regex("[^0-9A-Za-z._-]"), "_")
            .ifBlank { "latest" }
        val partFile = File(apkUpdatesDir, "duallane-$safeVer.apk.part")
        val finalFile = File(apkUpdatesDir, "duallane-$safeVer.apk")

        try {
            onProgress("downloading", 0, 0L, 0L)
            val actualSha = streamDownloadToFile(
                url = resolvedUrl,
                destFile = partFile,
                maxBytes = MAX_APK_BYTES,
                onProgress = { pct, read, total ->
                    onProgress("downloading", pct, read, total)
                },
            )

            onProgress("verifying", 100, partFile.length(), partFile.length())
            if (!hasZipSignature(partFile)) {
                throw IllegalStateException("下载的安装包格式无效，请稍后重试")
            }
            val cleanExpected = expectedSha256.trim().lowercase()
            if (cleanExpected.isNotEmpty() && !actualSha.equals(cleanExpected, ignoreCase = true)) {
                throw IllegalStateException("安装包完整性校验未通过，请重试")
            }

            if (finalFile.exists()) {
                finalFile.delete()
            }
            if (!partFile.renameTo(finalFile)) {
                throw IllegalStateException("保存安装包文件失败")
            }
            lastDownloadedApk = finalFile
            onProgress("ready", 100, finalFile.length(), finalFile.length())
            return finalFile
        } catch (err: Throwable) {
            runCatching { partFile.delete() }
            throw err
        }
    }

    private fun streamDownloadToFile(
        url: String,
        destFile: File,
        maxBytes: Long,
        onProgress: (percent: Int, downloaded: Long, total: Long) -> Unit,
    ): String {
        val req = Request.Builder()
            .url(url)
            .get()
            .header("Cache-Control", "no-cache")
            .header("Accept", "*/*")
            .build()

        networkGateway.httpClient.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) {
                throw IllegalStateException("下载更新包失败 (HTTP ${resp.code})")
            }
            val body = resp.body ?: throw IllegalStateException("更新响应内容为空")
            val contentLength = body.contentLength().coerceAtLeast(0L)
            if (contentLength > maxBytes) {
                throw IllegalStateException("更新包大小超出安全上限")
            }

            val digest = MessageDigest.getInstance("SHA-256")
            var totalRead = 0L
            var lastEmitMs = 0L

            BufferedInputStream(body.byteStream()).use { input ->
                FileOutputStream(destFile).use { output ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n <= 0) break
                        totalRead += n
                        if (totalRead > maxBytes) {
                            throw IllegalStateException("更新包大小超出安全上限")
                        }
                        digest.update(buf, 0, n)
                        output.write(buf, 0, n)

                        val now = System.currentTimeMillis()
                        if (now - lastEmitMs >= 75L) {
                            lastEmitMs = now
                            val pct = if (contentLength > 0L) {
                                ((totalRead * 100L) / contentLength).toInt().coerceIn(0, 99)
                            } else {
                                50
                            }
                            onProgress(pct, totalRead, contentLength)
                        }
                    }
                    output.flush()
                }
            }

            if (totalRead <= 64L) {
                throw IllegalStateException("下载到的更新包不完整")
            }
            onProgress(100, totalRead, if (contentLength > 0L) contentLength else totalRead)
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }

    private fun extractValidatedWwwZip(zipFile: File, destWwwDir: File) {
        destWwwDir.mkdirs()
        val canonicalRoot = destWwwDir.canonicalPath + File.separator
        var entryCount = 0
        var totalUncompressed = 0L

        ZipInputStream(BufferedInputStream(zipFile.inputStream())).use { zis ->
            while (true) {
                val entry = zis.nextEntry ?: break
                if (entry.isDirectory) {
                    zis.closeEntry()
                    continue
                }
                var relName = entry.name.replace('\\', '/').trim().removePrefix("./")
                if (relName.startsWith("assets/www/")) {
                    relName = relName.removePrefix("assets/www/")
                } else if (relName.startsWith("www/")) {
                    relName = relName.removePrefix("www/")
                }
                if (relName.isEmpty() || relName.startsWith("/") || relName.contains("..")) {
                    throw IllegalStateException("热更包包含不安全的路径项")
                }

                val ext = relName.substringAfterLast('.', "").lowercase()
                if (ext !in ALLOWED_OTA_EXTENSIONS) {
                    throw IllegalStateException("热更包包含不允许的资源类型 (.$ext)")
                }

                entryCount += 1
                if (entryCount > 500) {
                    throw IllegalStateException("热更包文件数量超出上限")
                }

                val targetFile = File(destWwwDir, relName)
                if (!targetFile.canonicalPath.startsWith(canonicalRoot)) {
                    throw IllegalStateException("热更包路径越界校验未通过")
                }
                targetFile.parentFile?.mkdirs()

                FileOutputStream(targetFile).use { fos ->
                    val buf = ByteArray(16 * 1024)
                    while (true) {
                        val n = zis.read(buf)
                        if (n <= 0) break
                        totalUncompressed += n
                        if (totalUncompressed > MAX_OTA_UNCOMPRESSED_BYTES) {
                            throw IllegalStateException("热更包解压体积超出上限")
                        }
                        fos.write(buf, 0, n)
                    }
                }
                zis.closeEntry()
            }
        }
    }

    private fun resolveSameOriginUrl(rawUrl: String): String {
        val origin = networkGateway.tokenVault.getApiOrigin().trimEnd('/')
        val originUri = Uri.parse(origin)
        val candidate = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            rawUrl.trim()
        } else {
            val path = if (rawUrl.startsWith("/")) rawUrl else "/$rawUrl"
            "$origin$path"
        }
        val parsed = Uri.parse(candidate)
        val sameOrigin = parsed.scheme.equals(originUri.scheme, ignoreCase = true) &&
            parsed.host.equals(originUri.host, ignoreCase = true) &&
            parsed.port == originUri.port
        if (!sameOrigin) {
            throw IllegalStateException("热更资源仅允许从当前可信服务同源加载")
        }
        val host = parsed.host?.lowercase().orEmpty()
        if (parsed.scheme != "https" && host != "127.0.0.1" && host != "localhost" && host != "10.0.2.2") {
            throw IllegalStateException("热更资源必须通过 HTTPS 传输")
        }
        return candidate
    }

    private fun resolveApkDownloadUrl(rawUrl: String): String {
        val origin = networkGateway.tokenVault.getApiOrigin().trimEnd('/')
        val candidate = if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
            rawUrl.trim()
        } else {
            val path = if (rawUrl.startsWith("/")) rawUrl else "/$rawUrl"
            "$origin$path"
        }
        val parsed = Uri.parse(candidate)
        val host = parsed.host?.lowercase().orEmpty()
        if (parsed.scheme != "https" && host != "127.0.0.1" && host != "localhost" && host != "10.0.2.2") {
            throw IllegalStateException("安装包下载必须通过 HTTPS 协议")
        }
        return candidate
    }

    private fun hasZipSignature(file: File): Boolean {
        if (!file.isFile || file.length() < 4L) return false
        return runCatching {
            file.inputStream().use { ins ->
                val b0 = ins.read()
                val b1 = ins.read()
                val b2 = ins.read()
                val b3 = ins.read()
                b0 == 0x50 && b1 == 0x4B && b2 == 0x03 && b3 == 0x04
            }
        }.getOrDefault(false)
    }

    private fun cancelWatchdog() {
        watchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        watchdogRunnable = null
    }

    private fun clearActiveOtaLocked() {
        activeOtaState = null
        runCatching { stateFile.delete() }
        runCatching { bundlesRootDir.deleteRecursively() }
    }

    private fun pruneInactiveBundlesLocked(keepSha256: String) {
        val children = bundlesRootDir.listFiles() ?: return
        for (dir in children) {
            if (dir.name != keepSha256) {
                runCatching { dir.deleteRecursively() }
            }
        }
    }

    private fun readPersistedStateLocked(): OtaBundleState? {
        if (!stateFile.isFile) return null
        return runCatching {
            val obj = JSONObject(stateFile.readText(Charsets.UTF_8))
            val version = obj.optString("version", "").trim()
            val sha256 = obj.optString("sha256", "").trim().lowercase()
            if (version.isEmpty() || sha256.length != 64) return null
            OtaBundleState(
                version = version,
                bundleId = obj.optString("bundleId", sha256.take(12)),
                sha256 = sha256,
                minNativeVersionCode = obj.optInt("minNativeVersionCode", 0),
                nativeVersionCodeAtInstall = obj.optInt("nativeVersionCodeAtInstall", 0),
                verified = obj.optBoolean("verified", false),
                bootAttempts = obj.optInt("bootAttempts", 0),
            )
        }.getOrNull()
    }

    private fun writePersistedStateLocked(state: OtaBundleState) {
        otaRootDir.mkdirs()
        val json = JSONObject().apply {
            put("version", state.version)
            put("bundleId", state.bundleId)
            put("sha256", state.sha256)
            put("minNativeVersionCode", state.minNativeVersionCode)
            put("nativeVersionCodeAtInstall", state.nativeVersionCodeAtInstall)
            put("verified", state.verified)
            put("bootAttempts", state.bootAttempts)
        }
        val tmp = File(otaRootDir, "state.json.tmp")
        tmp.writeText(json.toString(), Charsets.UTF_8)
        if (!tmp.renameTo(stateFile)) {
            stateFile.writeText(json.toString(), Charsets.UTF_8)
            runCatching { tmp.delete() }
        }
    }

    private fun compareSemver(a: String, b: String): Int {
        val pa = a.trim().removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val pb = b.trim().removePrefix("v").substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
        val maxLen = maxOf(pa.size, pb.size, 3)
        for (i in 0 until maxLen) {
            val va = pa.getOrElse(i) { 0 }
            val vb = pb.getOrElse(i) { 0 }
            if (va > vb) return 1
            if (va < vb) return -1
        }
        return 0
    }

    companion object {
        private const val WATCHDOG_TIMEOUT_MS = 6_500L
        private const val MAX_OTA_ZIP_BYTES = 20L * 1024L * 1024L
        private const val MAX_OTA_UNCOMPRESSED_BYTES = 30L * 1024L * 1024L
        private const val MAX_APK_BYTES = 45L * 1024L * 1024L

        private val ALLOWED_OTA_EXTENSIONS = setOf(
            "html", "js", "mjs", "css", "json", "svg", "png", "jpg",
            "jpeg", "webp", "gif", "ico", "woff", "woff2", "ttf", "txt"
        )
    }
}
