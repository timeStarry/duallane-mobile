package com.timestarry.duallane

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong

data class CachedMediaHit(
    val mimeType: String,
    val byteSize: Long,
    val etag: String?,
    val fetchedAtMs: Long,
    val openStream: () -> InputStream,
)

class MediaDiskCache(
    appContext: Context,
    private val maxTotalBytes: Long = 192L * 1024L * 1024L,
) {
    private val rootDir = File(appContext.filesDir, "duallane_media_cache_v1").apply {
        mkdirs()
    }
    private val keyLocks = ConcurrentHashMap<String, Any>()
    private val revalidatingKeys = ConcurrentHashMap.newKeySet<String>()
    private val bgExecutor: ExecutorService = Executors.newFixedThreadPool(3)
    private val lastPruneAtMs = AtomicLong(0L)

    fun keyLock(cacheKey: String): Any {
        val hash = sha256Hex(cacheKey)
        return keyLocks.computeIfAbsent(hash) { Any() }
    }

    fun get(cacheKey: String): CachedMediaHit? {
        val hash = sha256Hex(cacheKey)
        val binFile = File(rootDir, "$hash.bin")
        val metaFile = File(rootDir, "$hash.meta")
        if (!binFile.isFile || binFile.length() <= 0L || !metaFile.isFile) {
            return null
        }
        return runCatching {
            val metaJson = JSONObject(metaFile.readText(Charsets.UTF_8))
            val mime = metaJson.optString("mimeType", "application/octet-stream")
                .ifBlank { "application/octet-stream" }
            val etag = metaJson.optString("etag", "").takeIf { it.isNotBlank() }
            val fetchedAt = metaJson.optLong("fetchedAtMs", binFile.lastModified())
            CachedMediaHit(
                mimeType = mime,
                byteSize = binFile.length(),
                etag = etag,
                fetchedAtMs = fetchedAt,
                openStream = { FileInputStream(binFile) },
            )
        }.getOrNull()
    }

    fun put(cacheKey: String, urlHint: String, mimeType: String, etag: String?, bytes: ByteArray) {
        if (bytes.isEmpty() || bytes.size > 16 * 1024 * 1024) return
        val hash = sha256Hex(cacheKey)
        synchronized(keyLock(cacheKey)) {
            runCatching {
                rootDir.mkdirs()
                val tmpBin = File(rootDir, "$hash.bin.tmp")
                val finalBin = File(rootDir, "$hash.bin")
                tmpBin.writeBytes(bytes)
                if (!tmpBin.renameTo(finalBin)) {
                    tmpBin.copyTo(finalBin, overwrite = true)
                    tmpBin.delete()
                }
                val now = System.currentTimeMillis()
                finalBin.setLastModified(now)
                val meta = JSONObject().apply {
                    put("url", urlHint)
                    put("mimeType", mimeType.ifBlank { "application/octet-stream" })
                    if (!etag.isNullOrBlank()) {
                        put("etag", etag)
                    }
                    put("fetchedAtMs", now)
                }
                val tmpMeta = File(rootDir, "$hash.meta.tmp")
                val finalMeta = File(rootDir, "$hash.meta")
                tmpMeta.writeText(meta.toString(), Charsets.UTF_8)
                if (!tmpMeta.renameTo(finalMeta)) {
                    tmpMeta.copyTo(finalMeta, overwrite = true)
                    tmpMeta.delete()
                }
            }
        }
        maybeSchedulePrune()
    }

    fun touchFetchedAt(cacheKey: String) {
        val hash = sha256Hex(cacheKey)
        val metaFile = File(rootDir, "$hash.meta")
        val binFile = File(rootDir, "$hash.bin")
        if (!metaFile.isFile || !binFile.isFile) return
        synchronized(keyLock(cacheKey)) {
            runCatching {
                val now = System.currentTimeMillis()
                binFile.setLastModified(now)
                val json = JSONObject(metaFile.readText(Charsets.UTF_8))
                json.put("fetchedAtMs", now)
                metaFile.writeText(json.toString(), Charsets.UTF_8)
            }
        }
    }

    fun scheduleRevalidateOnce(cacheKey: String, task: () -> Unit) {
        val hash = sha256Hex(cacheKey)
        if (!revalidatingKeys.add(hash)) return
        bgExecutor.execute {
            try {
                task()
            } catch (_: Throwable) {
                // keep stale entry intact on transient network failure
            } finally {
                revalidatingKeys.remove(hash)
            }
        }
    }

    fun schedulePrefetch(task: () -> Unit) {
        bgExecutor.execute {
            runCatching { task() }
        }
    }

    fun invalidateMatching(predicate: (urlHint: String) -> Boolean) {
        runCatching {
            val files = rootDir.listFiles() ?: return
            for (f in files) {
                if (!f.name.endsWith(".meta")) continue
                val url = runCatching {
                    JSONObject(f.readText(Charsets.UTF_8)).optString("url", "")
                }.getOrDefault("")
                if (url.isNotEmpty() && predicate(url)) {
                    val stem = f.name.removeSuffix(".meta")
                    f.delete()
                    File(rootDir, "$stem.bin").delete()
                }
            }
        }
    }

    private fun maybeSchedulePrune() {
        val now = System.currentTimeMillis()
        val prev = lastPruneAtMs.get()
        if (now - prev < 5 * 60 * 1000L) return
        if (!lastPruneAtMs.compareAndSet(prev, now)) return
        bgExecutor.execute {
            runCatching { pruneToBudget() }
        }
    }

    private fun pruneToBudget() {
        val bins = rootDir.listFiles { f -> f.isFile && f.name.endsWith(".bin") } ?: return
        var total = bins.sumOf { it.length() }
        if (total <= maxTotalBytes) return
        val sortedOldestFirst = bins.sortedBy { it.lastModified() }
        val targetBytes = (maxTotalBytes * 85L) / 100L
        for (bin in sortedOldestFirst) {
            if (total <= targetBytes) break
            val len = bin.length()
            val stem = bin.name.removeSuffix(".bin")
            if (bin.delete()) {
                total -= len
            }
            File(rootDir, "$stem.meta").delete()
        }
    }

    private fun sha256Hex(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(input.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }
}
