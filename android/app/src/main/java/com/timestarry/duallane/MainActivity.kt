package com.timestarry.duallane

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {

    private val ioExecutor = Executors.newCachedThreadPool()
    private lateinit var tokenVault: TokenVault
    private lateinit var networkGateway: NetworkGateway
    private lateinit var realtimeManager: RealtimeManager
    private lateinit var nativeBridge: NativeBridge

    private var webView: WebView? = null
    private var isPageLoaded = false
    private var pendingDeepLink: String? = null
    private var pendingPickerCallback: ((List<Uri>) -> Unit)? = null

    private var lastSafeTopPx = 0
    private var lastSafeBottomPx = 0
    private var lastImePx = 0

    private val backPressedCallback = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() {
            nativeBridge.emitBackPressed()
        }
    }

    private val pickSingleImage = registerForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        val cb = pendingPickerCallback
        pendingPickerCallback = null
        cb?.invoke(if (uri != null) listOf(uri) else emptyList())
    }

    private val pickMultipleImages = registerForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(9)
    ) { uris ->
        val cb = pendingPickerCallback
        pendingPickerCallback = null
        cb?.invoke(uris)
    }

    private val pickSingleFile = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val cb = pendingPickerCallback
        pendingPickerCallback = null
        cb?.invoke(if (uri != null) listOf(uri) else emptyList())
    }

    private val pickMultipleFiles = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        val cb = pendingPickerCallback
        pendingPickerCallback = null
        cb?.invoke(uris)
    }

    private val requestNotificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)

        tokenVault = TokenVault(applicationContext)
        networkGateway = NetworkGateway(applicationContext, tokenVault)
        realtimeManager = RealtimeManager(
            appContext = applicationContext,
            networkGateway = networkGateway,
            ioExecutor = ioExecutor,
            emitWsEvent = { socketId, eventType, payload ->
                nativeBridge.emitWsEvent(socketId, eventType, payload)
            }
        )
        nativeBridge = NativeBridge(
            activity = this,
            webViewProvider = { webView },
            networkGateway = networkGateway,
            realtimeManager = realtimeManager,
            ioExecutor = ioExecutor,
        )

        onBackPressedDispatcher.addCallback(this, backPressedCallback)

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val wv = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#0B111B"))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_NEVER

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                mediaPlaybackRequiresUserGesture = false
                textZoom = 100
                cacheMode = WebSettings.LOAD_DEFAULT
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }

            addJavascriptInterface(nativeBridge, "DualLaneNative")

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? {
                    val assetResp = assetLoader.shouldInterceptRequest(request.url)
                    if (assetResp != null) return assetResp
                    return networkGateway.interceptWebViewRequest(request.url)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    val uri = request.url ?: return false
                    if (uri.host == "appassets.androidplatform.net") {
                        return false
                    }
                    if (uri.scheme == "com.timestarry.duallane") {
                        handleIncomingUri(uri)
                        return true
                    }
                    openExternalBrowserUrl(uri.toString())
                    return true
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    super.onPageFinished(view, url)
                    isPageLoaded = true
                    dispatchCurrentInsets()
                    pendingDeepLink?.let { queued ->
                        pendingDeepLink = null
                        nativeBridge.emitDeepLink(queued)
                    }
                }
            }
        }

        webView = wv
        setContentView(wv)
        installWindowInsetsListeners(wv)

        handleIntentIfPresent(intent)
        wv.loadUrl(START_ASSET_URL)

        if (tokenVault.isAuthenticated()) {
            maybePromptNotificationPermission()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntentIfPresent(intent)
    }

    override fun onResume() {
        super.onResume()
        realtimeManager.isForeground = true
        webView?.onResume()
    }

    override fun onPause() {
        realtimeManager.isForeground = false
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        realtimeManager.closeAll()
        webView?.apply {
            removeJavascriptInterface("DualLaneNative")
            destroy()
        }
        webView = null
        ioExecutor.shutdownNow()
        super.onDestroy()
    }

    private fun handleIntentIfPresent(intent: Intent?) {
        val data = intent?.data ?: return
        handleIncomingUri(data)
    }

    private fun handleIncomingUri(uri: Uri) {
        if (uri.scheme == "com.timestarry.duallane" && uri.host == "oauth") {
            ioExecutor.execute {
                try {
                    networkGateway.completeGitHubOAuth(uri)
                    nativeBridge.emitOAuthResult(true, "")
                    runOnUiThread { maybePromptNotificationPermission() }
                } catch (err: Throwable) {
                    nativeBridge.emitOAuthResult(false, err.message ?: "GitHub 授权换取凭证失败")
                }
            }
            return
        }

        val serialized = uri.toString()
        if (isPageLoaded) {
            nativeBridge.emitDeepLink(serialized)
        } else {
            pendingDeepLink = serialized
        }
    }

    private fun installWindowInsetsListeners(targetView: View) {
        ViewCompat.setOnApplyWindowInsetsListener(targetView) { _, windowInsets ->
            updateFromWindowInsets(windowInsets)
            WindowInsetsCompat.CONSUMED
        }

        ViewCompat.setWindowInsetsAnimationCallback(
            targetView,
            object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                override fun onProgress(
                    insets: WindowInsetsCompat,
                    runningAnimations: MutableList<WindowInsetsAnimationCompat>,
                ): WindowInsetsCompat {
                    updateFromWindowInsets(insets)
                    return insets
                }
            }
        )
    }

    private fun updateFromWindowInsets(windowInsets: WindowInsetsCompat) {
        val sysBars = windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
        val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
        val density = resources.displayMetrics.density.coerceAtLeast(1f)

        val safeTopCss = (sysBars.top / density).roundToInt().coerceAtLeast(0)
        val safeBottomCss = (sysBars.bottom / density).roundToInt().coerceAtLeast(0)
        val rawImeBottom = (ime.bottom - sysBars.bottom).coerceAtLeast(0)
        val imeCss = (rawImeBottom / density).roundToInt().coerceAtLeast(0)

        if (safeTopCss != lastSafeTopPx || safeBottomCss != lastSafeBottomPx || imeCss != lastImePx) {
            lastSafeTopPx = safeTopCss
            lastSafeBottomPx = safeBottomCss
            lastImePx = imeCss
            dispatchCurrentInsets()
        }
    }

    private fun dispatchCurrentInsets() {
        if (!isPageLoaded) return
        nativeBridge.emitInsets(lastSafeTopPx, lastSafeBottomPx, lastImePx)
    }

    fun applySystemBarsAppearance(isDarkTheme: Boolean, bgHex: String) {
        val parsedColor = runCatching { Color.parseColor(bgHex) }.getOrNull()
        if (parsedColor != null) {
            window.decorView.setBackgroundColor(parsedColor)
            webView?.setBackgroundColor(parsedColor)
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDarkTheme
        controller.isAppearanceLightNavigationBars = !isDarkTheme
    }

    fun setJsCanGoBack(canGoBack: Boolean) {
        backPressedCallback.isEnabled = canGoBack
    }

    fun launchMediaPicker(mode: String, multiple: Boolean, callback: (List<Uri>) -> Unit) {
        pendingPickerCallback = callback
        try {
            if (mode == "image") {
                val req = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                if (multiple) {
                    pickMultipleImages.launch(req)
                } else {
                    pickSingleImage.launch(req)
                }
            } else {
                val types = arrayOf("*/*")
                if (multiple) {
                    pickMultipleFiles.launch(types)
                } else {
                    pickSingleFile.launch(types)
                }
            }
        } catch (_: Throwable) {
            pendingPickerCallback = null
            callback(emptyList())
        }
    }

    fun openOAuthCustomTab(url: String) {
        val uri = Uri.parse(url)
        try {
            val customTabs = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
            customTabs.launchUrl(this, uri)
        } catch (_: Throwable) {
            openExternalBrowserUrl(url)
        }
    }

    fun openExternalBrowserUrl(url: String) {
        runCatching {
            val uri = Uri.parse(url)
            val customTabs = CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
            customTabs.launchUrl(this, uri)
        }.onFailure {
            runCatching {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }
        }
    }

    private fun maybePromptNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                runCatching {
                    requestNotificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
    }

    companion object {
        private const val START_ASSET_URL = "https://appassets.androidplatform.net/assets/www/index.html"
    }
}
