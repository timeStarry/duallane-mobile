package com.timestarry.duallane

import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import com.google.net.cronet.okhttptransport.CronetInterceptor
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import org.chromium.net.CronetEngine

object CronetNetworking {
  @Volatile private var client: OkHttpClient? = null

  internal fun webSocketAwareInterceptor(cronet: Interceptor): Interceptor = Interceptor { chain ->
    val request = chain.request()
    val isWebSocketUpgrade = headerContainsToken(request, "Upgrade", "websocket") &&
      headerContainsToken(request, "Connection", "upgrade")
    // RealWebSocket needs OkHttp's exchange, which a Cronet HTTP response cannot provide.
    // cronet-okhttp 0.1.1 rejects upload rewind; preserve OkHttp request-body semantics.
    if (isWebSocketUpgrade || request.body != null) chain.proceed(request) else cronet.intercept(chain)
  }

  private fun headerContainsToken(request: Request, name: String, token: String): Boolean =
    request.headers(name).any { value ->
      value.split(',').any { it.trim().equals(token, ignoreCase = true) }
    }

  @JvmStatic
  fun install(context: Context) {
    if (client != null) return
    try {
      val builder = CronetEngine.Builder(context.applicationContext)
        .enableQuic(true)
        .enableHttp2(true)
        .enableBrotli(true)
      val host = BuildConfig.DUALLANE_API_HOST
      if (host.isNotBlank()) builder.addQuicHint(host, 443, 443)
      val engine = builder.build()
      val cronet = CronetInterceptor.newBuilder(engine).build()
      val built = OkHttpClientProvider.createClientBuilder(context.applicationContext)
        .addInterceptor(webSocketAwareInterceptor(cronet))
        .build()
      client = built
      OkHttpClientProvider.setOkHttpClientFactory { built }
      Log.i("duallane", "cronet_installed")
    } catch (error: Throwable) {
      Log.w("duallane", "cronet_failed")
    }
  }
}
