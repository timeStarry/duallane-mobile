package com.timestarry.duallane

import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import com.facebook.react.modules.websocket.WebSocketModule
import com.google.net.cronet.okhttptransport.CronetInterceptor
import okhttp3.OkHttpClient
import org.chromium.net.CronetEngine

object CronetNetworking {
  @Volatile private var client: OkHttpClient? = null

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
      val built = OkHttpClientProvider.createClientBuilder(context.applicationContext)
        .addInterceptor(CronetInterceptor.newBuilder(engine).build())
        .build()
      client = built
      OkHttpClientProvider.setOkHttpClientFactory { built }
      WebSocketModule.setCustomClientBuilder { next -> next.addInterceptor(CronetInterceptor.newBuilder(engine).build()) }
      Log.i("duallane", "cronet_installed")
    } catch (error: Throwable) {
      Log.w("duallane", "cronet_failed")
    }
  }
}
