package com.timestarry.duallane

import android.content.Context
import android.net.Uri
import android.util.Base64
import android.webkit.WebResourceResponse
import okhttp3.Cache
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit

data class PickedMediaEntry(
    val id: String,
    val uri: Uri,
    val name: String,
    val mimeType: String,
    val size: Long,
)

class NetworkGateway(
    private val appContext: Context,
    val tokenVault: TokenVault,
) {
    private val refreshLock = Any()
    private val secureRandom = SecureRandom()

    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .cache(Cache(File(appContext.cacheDir, "duallane_http_cache"), 64L * 1024L * 1024L))
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    fun getValidAccessToken(forceRefresh: Boolean = false): String? {
        if (!forceRefresh) {
            val current = tokenVault.getAccessToken()
            val expMs = tokenVault.getAccessTokenExpiresAtMs()
            if (!current.isNullOrBlank() && System.currentTimeMillis() + 30_000L < expMs) {
                return current
            }
        }

        synchronized(refreshLock) {
            if (!forceRefresh) {
                val rechecked = tokenVault.getAccessToken()
                val recheckedExp = tokenVault.getAccessTokenExpiresAtMs()
                if (!rechecked.isNullOrBlank() && System.currentTimeMillis() + 30_000L < recheckedExp) {
                    return rechecked
                }
            }

            val refreshToken = tokenVault.getRefreshToken() ?: return null
            val payload = JSONObject().put("refreshToken", refreshToken).toString()
            val req = Request.Builder()
                .url("${tokenVault.getApiOrigin()}/api/auth/mobile/refresh")
                .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                .header("Accept", "application/json")
                .build()

            return try {
                httpClient.newCall(req).execute().use { res ->
                    if (res.code == 401 || res.code == 403) {
                        tokenVault.clearTokens()
                        return null
                    }
                    if (!res.isSuccessful) {
                        return tokenVault.getAccessToken()
                    }
                    val body = res.body?.string().orEmpty()
                    val json = JSONObject(body)
                    val newAccess = json.optString("accessToken")
                    val newRefresh = json.optString("refreshToken")
                    if (newAccess.isBlank() || newRefresh.isBlank()) {
                        return null
                    }
                    tokenVault.saveTokens(
                        accessToken = newAccess,
                        refreshToken = newRefresh,
                        accessExpiresIso = json.optString("accessTokenExpiresAt", ""),
                        refreshExpiresIso = json.optString("refreshTokenExpiresAt", ""),
                    )
                    newAccess
                }
            } catch (_: Throwable) {
                tokenVault.getAccessToken()
            }
        }
    }

    fun startGitHubOAuth(inviteCode: String): String {
        val verifier = randomUrlSafeVerifier(64)
        val challenge = sha256Base64Url(verifier)
        val state = randomHex(16)
        tokenVault.savePkceChallenge(verifier, state)

        val bodyJson = JSONObject().apply {
            put("codeChallenge", challenge)
            put("redirectUri", MOBILE_REDIRECT_URI)
            put("state", state)
            if (inviteCode.isNotBlank()) {
                put("inviteCode", inviteCode.trim())
            }
        }

        val req = Request.Builder()
            .url("${tokenVault.getApiOrigin()}/api/auth/mobile/github/start")
            .post(bodyJson.toString().toRequestBody(JSON_MEDIA_TYPE))
            .header("Accept", "application/json")
            .build()

        httpClient.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractApiErrorMessage(raw, "发起 GitHub 登录失败 (${res.code})"))
            }
            val json = JSONObject(raw)
            val authUrl = json.optString("authorizationUrl")
            if (authUrl.isBlank()) {
                throw IllegalStateException("服务端未返回授权跳转地址")
            }
            return authUrl
        }
    }

    fun completeGitHubOAuth(callbackUri: Uri) {
        val oauthError = callbackUri.getQueryParameter("error")
        if (!oauthError.isNullOrBlank()) {
            val desc = callbackUri.getQueryParameter("error_description") ?: oauthError
            throw IllegalStateException("授权未完成：$desc")
        }

        val code = callbackUri.getQueryParameter("code")
            ?: throw IllegalStateException("缺少授权码 code")
        val state = callbackUri.getQueryParameter("state")
            ?: throw IllegalStateException("缺少安全校验参数 state")

        val verifier = tokenVault.consumePkceVerifier(state)
            ?: throw IllegalStateException("登录状态校验已过期，请重试")

        val bodyJson = JSONObject().apply {
            put("code", code)
            put("codeVerifier", verifier)
            put("redirectUri", MOBILE_REDIRECT_URI)
        }

        val req = Request.Builder()
            .url("${tokenVault.getApiOrigin()}/api/auth/mobile/github/exchange")
            .post(bodyJson.toString().toRequestBody(JSON_MEDIA_TYPE))
            .header("Accept", "application/json")
            .build()

        httpClient.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractApiErrorMessage(raw, "换取登录凭证失败 (${res.code})"))
            }
            val json = JSONObject(raw)
            val accessToken = json.optString("accessToken")
            val refreshToken = json.optString("refreshToken")
            if (accessToken.isBlank() || refreshToken.isBlank()) {
                throw IllegalStateException("凭证响应缺少有效令牌")
            }
            tokenVault.saveTokens(
                accessToken = accessToken,
                refreshToken = refreshToken,
                accessExpiresIso = json.optString("accessTokenExpiresAt", ""),
                refreshExpiresIso = json.optString("refreshTokenExpiresAt", ""),
            )
        }
    }

    fun loginWithEmailCode(email: String, challengeId: String, code: String): JSONObject {
        val bodyJson = JSONObject().apply {
            put("email", email.trim())
            put("challengeId", challengeId.trim())
            put("code", code.trim())
            put("client", "mobile")
        }

        val req = Request.Builder()
            .url("${tokenVault.getApiOrigin()}/api/v1/auth/email/verify")
            .post(bodyJson.toString().toRequestBody(JSON_MEDIA_TYPE))
            .header("Accept", "application/json")
            .build()

        httpClient.newCall(req).execute().use { res ->
            val raw = res.body?.string().orEmpty()
            if (!res.isSuccessful) {
                throw IllegalStateException(extractApiErrorMessage(raw, "验证码登录失败 (${res.code})"))
            }
            val json = JSONObject(raw)
            val accessToken = json.optString("accessToken")
            val refreshToken = json.optString("refreshToken")
            if (accessToken.isBlank() || refreshToken.isBlank()) {
                throw IllegalStateException("凭证响应缺少有效令牌")
            }
            tokenVault.saveTokens(
                accessToken = accessToken,
                refreshToken = refreshToken,
                accessExpiresIso = json.optString("accessTokenExpiresAt", ""),
                refreshExpiresIso = json.optString("refreshTokenExpiresAt", ""),
            )
            return JSONObject().put("ok", true)
        }
    }

    fun logout() {
        val refreshToken = tokenVault.getRefreshToken()
        tokenVault.clearTokens()
        if (!refreshToken.isNullOrBlank()) {
            val payload = JSONObject().put("refreshToken", refreshToken).toString()
            val req = Request.Builder()
                .url("${tokenVault.getApiOrigin()}/api/auth/mobile/logout")
                .post(payload.toRequestBody(JSON_MEDIA_TYPE))
                .build()
            runCatching { httpClient.newCall(req).execute().close() }
        }
    }

    fun executeApiCall(
        method: String,
        path: String,
        headersJson: String,
        bodyText: String,
    ): JSONObject {
        val isAbsolute = path.startsWith("http://") || path.startsWith("https://")
        val targetUrl = if (isAbsolute) path else "${tokenVault.getApiOrigin()}$path"
        val shouldAttachAuth = !isAbsolute && path.startsWith("/api/") && !path.startsWith("/api/p2p/")

        var response = performSingleHttpCall(
            method = method,
            targetUrl = targetUrl,
            headersJson = headersJson,
            bodyText = bodyText,
            bearerToken = if (shouldAttachAuth) getValidAccessToken(false) else null,
        )

        if (response.optInt("status") == 401 && shouldAttachAuth && tokenVault.isAuthenticated()) {
            val refreshed = getValidAccessToken(true)
            if (!refreshed.isNullOrBlank()) {
                response = performSingleHttpCall(
                    method = method,
                    targetUrl = targetUrl,
                    headersJson = headersJson,
                    bodyText = bodyText,
                    bearerToken = refreshed,
                )
            }
        }
        return response
    }

    private fun performSingleHttpCall(
        method: String,
        targetUrl: String,
        headersJson: String,
        bodyText: String,
        bearerToken: String?,
    ): JSONObject {
        val upperMethod = method.uppercase()
        val parsedHeaders = runCatching { JSONObject(headersJson) }.getOrNull() ?: JSONObject()
        val contentTypeStr = parsedHeaders.optString("Content-Type")
            .ifBlank { parsedHeaders.optString("content-type") }
            .ifBlank { "application/json; charset=utf-8" }

        val reqBody = when {
            upperMethod == "GET" || upperMethod == "HEAD" -> null
            bodyText.isNotEmpty() -> bodyText.toRequestBody(contentTypeStr.toMediaTypeOrNull())
            upperMethod == "POST" || upperMethod == "PUT" || upperMethod == "PATCH" ->
                ByteArray(0).toRequestBody(null)
            else -> null
        }

        val builder = Request.Builder()
            .url(targetUrl)
            .method(upperMethod, reqBody)
            .header("Accept", "application/json")

        val keys = parsedHeaders.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            val v = parsedHeaders.optString(k)
            if (k.isNotBlank() && v.isNotBlank()) {
                builder.header(k, v)
            }
        }
        if (!bearerToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $bearerToken")
        }

        httpClient.newCall(builder.build()).execute().use { res ->
            val respText = res.body?.string().orEmpty()
            return JSONObject().apply {
                put("status", res.code)
                put("ok", res.isSuccessful)
                put("bodyText", respText)
            }
        }
    }

    fun interceptWebViewRequest(url: Uri): WebResourceResponse? {
        if (url.host != "appassets.androidplatform.net") return null
        val path = url.encodedPath ?: return null
        if (!path.startsWith("/api/") && !path.startsWith("/emotes/")) {
            return null
        }

        val query = url.encodedQuery
        val fullPath = if (query.isNullOrBlank()) path else "$path?$query"
        val targetUrl = "${tokenVault.getApiOrigin()}$fullPath"
        val needsAuth = path.startsWith("/api/") && !path.startsWith("/api/p2p/")

        return try {
            var res = executeRawGet(targetUrl, if (needsAuth) getValidAccessToken(false) else null)
            if (res.code == 401 && needsAuth && tokenVault.isAuthenticated()) {
                res.close()
                val refreshed = getValidAccessToken(true)
                res = executeRawGet(targetUrl, refreshed)
            }

            val contentTypeHeader = res.header("Content-Type") ?: "application/octet-stream"
            val mimeType = contentTypeHeader.substringBefore(';').trim().ifBlank { "application/octet-stream" }
            val charset = contentTypeHeader.substringAfter("charset=", "").trim().ifBlank { null }

            val responseHeaders = mutableMapOf(
                "Access-Control-Allow-Origin" to "https://appassets.androidplatform.net",
            )
            res.header("Cache-Control")?.let { responseHeaders["Cache-Control"] = it }
            res.header("Content-Disposition")?.let { responseHeaders["Content-Disposition"] = it }
            res.header("ETag")?.let { responseHeaders["ETag"] = it }

            val bodyStream = res.body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
            val reason = res.message.ifBlank { if (res.isSuccessful) "OK" else "Error" }

            WebResourceResponse(
                mimeType,
                charset,
                res.code.coerceIn(100, 599),
                reason,
                responseHeaders,
                bodyStream,
            )
        } catch (_: Throwable) {
            WebResourceResponse(
                "text/plain",
                "utf-8",
                502,
                "Bad Gateway",
                mapOf("Access-Control-Allow-Origin" to "https://appassets.androidplatform.net"),
                ByteArrayInputStream(ByteArray(0)),
            )
        }
    }

    private fun executeRawGet(targetUrl: String, bearerToken: String?): okhttp3.Response {
        val builder = Request.Builder().url(targetUrl).get()
        if (!bearerToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $bearerToken")
        }
        return httpClient.newCall(builder.build()).execute()
    }

    fun uploadConversationFile(conversationId: String, media: PickedMediaEntry): JSONObject {
        val reserveBody = JSONObject().apply {
            put("fileName", media.name)
            put("mimeType", media.mimeType)
            put("byteSize", media.size)
            put("visibility", "conversation")
            put("conversationId", conversationId)
        }
        val reserveResp = executeApiCall(
            method = "POST",
            path = "/api/workspace/files/uploads/reserve",
            headersJson = "{}",
            bodyText = reserveBody.toString(),
        )
        val reserveJson = runCatching { JSONObject(reserveResp.optString("bodyText")) }.getOrNull() ?: JSONObject()
        if (!reserveResp.optBoolean("ok") || reserveJson.optString("status") == "rejected") {
            throw IllegalStateException(
                extractApiErrorMessage(reserveResp.optString("bodyText"), "文件上传配额不足或初始化失败")
            )
        }

        val uploadObj = reserveJson.optJSONObject("upload")
            ?: throw IllegalStateException("未获取到上传会话标识")
        val uploadId = uploadObj.optString("id")
        if (uploadId.isBlank()) throw IllegalStateException("上传会话 ID 为空")

        val mode = uploadObj.optString("mode", "single")
        val partCount = uploadObj.optInt("partCount", 1)
        val partSize = uploadObj.optInt("partSize", 4 * 1024 * 1024).coerceAtLeast(256 * 1024)

        var finalAttachment = reserveJson.optJSONObject("attachment")
        var finalUsedToday: Long? = if (reserveJson.has("usedToday")) reserveJson.optLong("usedToday") else null
        val encodedUploadId = URLEncoder.encode(uploadId, "UTF-8")

        if (mode == "chunked" && partCount > 1) {
            val input = appContext.contentResolver.openInputStream(media.uri)
                ?: throw IllegalStateException("无法读取所选文件")
            input.use { stream ->
                for (partNumber in 1..partCount) {
                    val buffer = readChunkExactOrEof(stream, partSize)
                    val shaHex = sha256Hex(buffer)
                    executeBinaryUpload(
                        method = "PUT",
                        path = "/api/workspace/files/uploads/$encodedUploadId/parts/$partNumber",
                        contentType = "application/octet-stream",
                        bytes = buffer,
                        extraHeaders = mapOf("X-Content-SHA256" to shaHex),
                    )
                }
            }
            val completeResp = executeApiCall(
                method = "POST",
                path = "/api/workspace/files/uploads/$encodedUploadId/complete",
                headersJson = "{}",
                bodyText = "",
            )
            if (!completeResp.optBoolean("ok")) {
                throw IllegalStateException("分片文件合并失败")
            }
            val completeJson = runCatching { JSONObject(completeResp.optString("bodyText")) }.getOrNull()
            completeJson?.optJSONObject("attachment")?.let { finalAttachment = it }
            if (completeJson?.has("usedToday") == true) {
                finalUsedToday = completeJson.optLong("usedToday")
            }
        } else {
            val bytes = readAllMediaBytes(media.uri, 64L * 1024L * 1024L)
            val putJson = executeBinaryUpload(
                method = "PUT",
                path = "/api/workspace/files/uploads/$encodedUploadId/content",
                contentType = "application/octet-stream",
                bytes = bytes,
            )
            putJson.optJSONObject("attachment")?.let { finalAttachment = it }
            if (putJson.has("usedToday")) {
                finalUsedToday = putJson.optLong("usedToday")
            }
        }

        val attId = finalAttachment?.optString("id").orEmpty()
        if (attId.isBlank()) throw IllegalStateException("上传完成但未返回附件 ID")

        val encodedAttId = URLEncoder.encode(attId, "UTF-8")
        val finalMime = finalAttachment?.optString("mimeType").takeUnless { it.isNullOrBlank() } ?: media.mimeType
        val downloadUrl = "/api/workspace/files/$encodedAttId/download"
        val previewUrl = if (finalMime.startsWith("image/")) {
            "/api/workspace/files/$encodedAttId/preview"
        } else {
            downloadUrl
        }

        return JSONObject().apply {
            put("id", attId)
            put("fileName", finalAttachment?.optString("fileName").takeUnless { it.isNullOrBlank() } ?: media.name)
            put("mimeType", finalMime)
            put("byteSize", finalAttachment?.optLong("byteSize", media.size) ?: media.size)
            put("url", previewUrl)
            put("downloadUrl", downloadUrl)
            if (finalUsedToday != null) {
                put("usedToday", finalUsedToday)
            }
        }
    }

    fun uploadCustomEmote(
        media: PickedMediaEntry,
        collectionId: String,
        addToLibrary: Boolean,
    ): JSONObject {
        val bytes = readAllMediaBytes(media.uri, 10L * 1024L * 1024L)
        val queryParts = mutableListOf<String>()
        if (collectionId.isNotBlank()) {
            queryParts.add("collectionId=${URLEncoder.encode(collectionId, "UTF-8")}")
            if (!addToLibrary) {
                queryParts.add("addToLibrary=false")
            }
        }
        val qs = if (queryParts.isEmpty()) "" else "?${queryParts.joinToString("&")}"
        val encodedName = URLEncoder.encode(media.name, "UTF-8").replace("+", "%20")

        return executeBinaryUpload(
            method = "POST",
            path = "/api/workspace/me/emotes$qs",
            contentType = media.mimeType.ifBlank { "image/png" },
            bytes = bytes,
            extraHeaders = mapOf("X-DualLane-File-Name" to encodedName),
        )
    }

    fun uploadBinaryAvatar(targetPath: String, media: PickedMediaEntry): JSONObject {
        val bytes = readAllMediaBytes(media.uri, 8L * 1024L * 1024L)
        return executeBinaryUpload(
            method = "PUT",
            path = targetPath,
            contentType = media.mimeType.ifBlank { "image/png" },
            bytes = bytes,
        )
    }

    fun readAllMediaBytes(uri: Uri, maxBytes: Long): ByteArray {
        val input = appContext.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("无法读取所选文件")
        input.use { stream ->
            val out = java.io.ByteArrayOutputStream()
            val buf = ByteArray(16 * 1024)
            var total = 0L
            while (true) {
                val n = stream.read(buf)
                if (n <= 0) break
                total += n
                if (total > maxBytes) {
                    throw IllegalStateException("文件超出大小限制")
                }
                out.write(buf, 0, n)
            }
            return out.toByteArray()
        }
    }

    private fun executeBinaryUpload(
        method: String,
        path: String,
        contentType: String,
        bytes: ByteArray,
        extraHeaders: Map<String, String> = emptyMap(),
    ): JSONObject {
        val url = "${tokenVault.getApiOrigin()}$path"
        var token = getValidAccessToken(false)
        var res = performBinaryCall(method, url, contentType, bytes, token, extraHeaders)
        if (res.first == 401 && tokenVault.isAuthenticated()) {
            token = getValidAccessToken(true)
            res = performBinaryCall(method, url, contentType, bytes, token, extraHeaders)
        }
        if (res.first !in 200..299) {
            throw IllegalStateException(extractApiErrorMessage(res.second, "上传请求失败 (${res.first})"))
        }
        return runCatching { JSONObject(res.second) }.getOrElse { JSONObject() }
    }

    private fun performBinaryCall(
        method: String,
        url: String,
        contentType: String,
        bytes: ByteArray,
        bearerToken: String?,
        extraHeaders: Map<String, String>,
    ): Pair<Int, String> {
        val builder = Request.Builder()
            .url(url)
            .method(method.uppercase(), bytes.toRequestBody(contentType.toMediaTypeOrNull()))
            .header("Accept", "application/json")
        if (!bearerToken.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $bearerToken")
        }
        for ((k, v) in extraHeaders) {
            builder.header(k, v)
        }
        httpClient.newCall(builder.build()).execute().use { resp ->
            return resp.code to resp.body?.string().orEmpty()
        }
    }

    private fun readChunkExactOrEof(stream: java.io.InputStream, maxLen: Int): ByteArray {
        val out = java.io.ByteArrayOutputStream(minOf(maxLen, 64 * 1024))
        val buf = ByteArray(16 * 1024)
        var remaining = maxLen
        while (remaining > 0) {
            val read = stream.read(buf, 0, minOf(buf.size, remaining))
            if (read <= 0) break
            out.write(buf, 0, read)
            remaining -= read
        }
        return out.toByteArray()
    }

    private fun extractApiErrorMessage(rawBody: String, fallback: String): String {
        if (rawBody.isBlank()) return fallback
        return runCatching {
            val json = JSONObject(rawBody)
            json.optJSONObject("error")?.optString("message")?.takeIf { it.isNotBlank() }
                ?: json.optString("message").takeIf { it.isNotBlank() }
                ?: fallback
        }.getOrDefault(fallback)
    }

    private fun randomUrlSafeVerifier(length: Int): String {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
        val sb = StringBuilder(length)
        for (i in 0 until length) {
            sb.append(alphabet[secureRandom.nextInt(alphabet.length)])
        }
        return sb.toString()
    }

    private fun randomHex(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        secureRandom.nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun sha256Base64Url(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.US_ASCII))
        return Base64.encodeToString(
            digest,
            Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP
        )
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val MOBILE_REDIRECT_URI = "com.timestarry.duallane://oauth"
        private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaTypeOrNull()
    }
}
