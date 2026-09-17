package com.timestarry.duallane

import android.content.Context
import android.util.Log
import com.facebook.react.modules.network.OkHttpClientProvider
import com.google.net.cronet.okhttptransport.CronetInterceptor
import okhttp3.OkHttpClient
import org.chromium.net.CronetEngine

object CronetNetworking {
  @Volatile private var client: OkHttpClient? = null

  @JvmStatic
  fun install(context: Context) {
    if (client != null) return
    try {
      val engine = CronetEngine.Builder(context.applicationContext)
        .enableQuic(true)
        .enableHttp2(true)
        .enableBrotli(true)
        .build()
      val built = OkHttpClientProvider.createClientBuilder(context.applicationContext)
        .addInterceptor(CronetInterceptor.newBuilder(engine).build())
        .build()
      client = built
      OkHttpClientProvider.setOkHttpClientFactory { built }
      Log.i("duallane", "cronet_installed")
    } catch (error: Throwable) {
      Log.w("duallane", "cronet_failed")
    }
  }
}
