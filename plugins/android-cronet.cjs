const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { withAppBuildGradle, withDangerousMod, withMainApplication } = require('expo/config-plugins');

const CRONET_EMBEDDED = 'org.chromium.net:cronet-embedded:119.6045.31';
const CRONET_OKHTTP = 'com.google.net.cronet:cronet-okhttp:0.1.1';
const INSTALL_CALL = 'CronetNetworking.install(this)';

const CRONET_SOURCE = `package com.timestarry.duallane

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
`;

function addGradleDependencies(contents) {
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
