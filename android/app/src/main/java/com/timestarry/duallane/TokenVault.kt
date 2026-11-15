package com.timestarry.duallane

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class BundledAppConfig(
    val defaultApiOrigin: String,
    val appVersion: String,
    val versionCode: Int,
)

class TokenVault(private val appContext: Context) {

    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val bundledConfig: BundledAppConfig = loadBundledConfig()

    private fun loadBundledConfig(): BundledAppConfig {
        return try {
            val raw = appContext.assets.open("app.config").bufferedReader().use { it.readText() }
            val json = JSONObject(raw)
            val extra = json.optJSONObject("extra")
            val androidObj = json.optJSONObject("android")
            val origin = extra?.optString("apiOrigin")
                ?.trim()
                ?.trimEnd('/')
                ?.takeIf { it.isNotEmpty() }
                ?: DEFAULT_API_ORIGIN
            val version = json.optString("version").takeIf { it.isNotBlank() } ?: BuildConfigFallback.VERSION_NAME
            val code = androidObj?.optInt("versionCode", BuildConfigFallback.VERSION_CODE)
                ?: BuildConfigFallback.VERSION_CODE
            BundledAppConfig(
                defaultApiOrigin = origin,
                appVersion = version,
                versionCode = code,
            )
        } catch (_: Throwable) {
            BundledAppConfig(
                defaultApiOrigin = DEFAULT_API_ORIGIN,
                appVersion = BuildConfigFallback.VERSION_NAME,
                versionCode = BuildConfigFallback.VERSION_CODE,
            )
        }
    }

    @Synchronized
    fun getApiOrigin(): String {
        val custom = prefs.getString(KEY_CUSTOM_ORIGIN, null)?.trim()?.trimEnd('/')
        return if (!custom.isNullOrEmpty()) custom else bundledConfig.defaultApiOrigin
    }

    @Synchronized
    fun setApiOrigin(origin: String) {
        val normalized = origin.trim().trimEnd('/')
        val current = getApiOrigin()
        if (normalized != current) {
            clearTokens()
        }
        prefs.edit().putString(KEY_CUSTOM_ORIGIN, normalized).apply()
    }

    @Synchronized
    fun isAuthenticated(): Boolean {
        val refresh = getRefreshToken()
        if (refresh.isNullOrBlank()) return false
        val refreshExp = prefs.getLong(KEY_REFRESH_EXP_MS, 0L)
        if (refreshExp > 0L && System.currentTimeMillis() >= refreshExp) {
            clearTokens()
            return false
        }
        return true
    }

    @Synchronized
    fun getAccessToken(): String? = decryptString(prefs.getString(KEY_ACCESS_TOKEN, null))

    @Synchronized
    fun getAccessTokenExpiresAtMs(): Long = prefs.getLong(KEY_ACCESS_EXP_MS, 0L)

    @Synchronized
    fun getRefreshToken(): String? = decryptString(prefs.getString(KEY_REFRESH_TOKEN, null))

    @Synchronized
    fun saveTokens(
        accessToken: String,
        refreshToken: String,
        accessExpiresIso: String?,
        refreshExpiresIso: String?,
    ) {
        val accessEnc = encryptString(accessToken)
        val refreshEnc = encryptString(refreshToken)
        val now = System.currentTimeMillis()
        val accessExpMs = parseIsoMs(accessExpiresIso) ?: (now + 14L * 60L * 1000L)
        val refreshExpMs = parseIsoMs(refreshExpiresIso) ?: (now + 30L * 24L * 3600L * 1000L)

        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessEnc)
            .putString(KEY_REFRESH_TOKEN, refreshEnc)
            .putLong(KEY_ACCESS_EXP_MS, accessExpMs)
            .putLong(KEY_REFRESH_EXP_MS, refreshExpMs)
            .apply()
    }

    @Synchronized
    fun clearTokens() {
        prefs.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_REFRESH_TOKEN)
            .remove(KEY_ACCESS_EXP_MS)
            .remove(KEY_REFRESH_EXP_MS)
            .remove(KEY_PKCE_VERIFIER)
            .remove(KEY_PKCE_STATE)
            .apply()
    }

    @Synchronized
    fun savePkceChallenge(verifier: String, state: String) {
        prefs.edit()
            .putString(KEY_PKCE_VERIFIER, encryptString(verifier))
            .putString(KEY_PKCE_STATE, state)
            .apply()
    }

    @Synchronized
    fun consumePkceVerifier(expectedState: String): String? {
        val storedState = prefs.getString(KEY_PKCE_STATE, null)
        val verifier = decryptString(prefs.getString(KEY_PKCE_VERIFIER, null))
        prefs.edit()
            .remove(KEY_PKCE_STATE)
            .remove(KEY_PKCE_VERIFIER)
            .apply()
        if (storedState.isNullOrBlank() || storedState != expectedState) {
            return null
        }
        return verifier
    }

    private fun parseIsoMs(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        return runCatching { Instant.parse(iso.trim()).toEpochMilli() }.getOrNull()
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) {
            return existing.secretKey
        }
        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private fun encryptString(plainText: String): String {
        return try {
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
            val iv = cipher.iv
            val cipherBytes = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
            val ivB64 = Base64.encodeToString(iv, Base64.NO_WRAP)
            val ctB64 = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
            "$ivB64:$ctB64"
        } catch (_: Throwable) {
            ""
        }
    }

    private fun decryptString(serialized: String?): String? {
        if (serialized.isNullOrBlank()) return null
        val parts = serialized.split(':', limit = 2)
        if (parts.size != 2) return null
        return try {
            val iv = Base64.decode(parts[0], Base64.NO_WRAP)
            val cipherBytes = Base64.decode(parts[1], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                getOrCreateSecretKey(),
                GCMParameterSpec(128, iv)
            )
            String(cipher.doFinal(cipherBytes), Charsets.UTF_8)
        } catch (_: Throwable) {
            null
        }
    }

    private object BuildConfigFallback {
        const val VERSION_NAME = "1.0.6"
        const val VERSION_CODE = 10006
    }

    companion object {
        private const val PREFS_NAME = "duallane_secure_vault"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "duallane_master_key_v1"
        private const val AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val DEFAULT_API_ORIGIN = "https://duallane.tsio.top"

        private const val KEY_CUSTOM_ORIGIN = "custom_api_origin"
        private const val KEY_ACCESS_TOKEN = "enc_access_token"
        private const val KEY_REFRESH_TOKEN = "enc_refresh_token"
        private const val KEY_ACCESS_EXP_MS = "access_exp_ms"
        private const val KEY_REFRESH_EXP_MS = "refresh_exp_ms"
        private const val KEY_PKCE_VERIFIER = "enc_pkce_verifier"
        private const val KEY_PKCE_STATE = "pkce_state"
    }
}
