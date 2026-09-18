const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const CRONET_EMBEDDED = 'org.chromium.net:cronet-embedded:143.7445.0';
const CRONET_OKHTTP = 'com.google.net.cronet:cronet-okhttp:0.1.1';
const INSTALL_CALL = 'CronetNetworking.install(this)';

const CRONET_SOURCE = `package com.timestarry.duallane

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
`;

const API_HOST_BLOCK = `        def duallaneOrigin = System.getenv("EXPO_PUBLIC_API_ORIGIN") ?: ""
        def duallaneHost = ""
        if (duallaneOrigin) {
            try { duallaneHost = new URI(duallaneOrigin).host ?: "" } catch (Exception ignored) {}
        }
        buildConfigField "String", "DUALLANE_API_HOST", "\\"\${duallaneHost}\\""
`;

function addGradleDependencies(contents) {
  if (!contents.includes('DUALLANE_API_HOST') && /versionName[^\n]*\n/.test(contents)) {
    contents = contents.replace(
      /versionName[^\n]*\n/,
      match => `${match}${API_HOST_BLOCK}`,
    );
  }
  if (contents.includes(CRONET_EMBEDDED)) return contents;
  if (!contents.includes('implementation("com.facebook.react:react-android")')) {
    throw new Error('Cannot find React Android dependency');
  }
  return contents.replace(
    'implementation("com.facebook.react:react-android")',
    `implementation("com.facebook.react:react-android")
    implementation("${CRONET_EMBEDDED}")
    implementation("${CRONET_OKHTTP}")`,
  );
}

function installInMainApplication(contents) {
  if (contents.includes(INSTALL_CALL)) return contents;
  if (!contents.includes('super.onCreate()')) throw new Error('Cannot find MainApplication onCreate');
  return contents.replace('super.onCreate()', `super.onCreate()\n    ${INSTALL_CALL}`);
}

module.exports = function withAndroidCronet(config) {
  config = withAppBuildGradle(config, mod => {
    mod.modResults.contents = addGradleDependencies(mod.modResults.contents);
    return mod;
  });
  config = withMainApplication(config, mod => {
    mod.modResults.contents = installInMainApplication(mod.modResults.contents);
    return mod;
  });
  config = withDangerousMod(config, ['android', async mod => {
    const file = join(mod.modRequest.platformProjectRoot, 'app/src/main/java/com/timestarry/duallane/CronetNetworking.kt');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, CRONET_SOURCE);
    return mod;
  }]);
  return config;
};

module.exports.addGradleDependencies = addGradleDependencies;
module.exports.installInMainApplication = installInMainApplication;
module.exports.CRONET_SOURCE = CRONET_SOURCE;
