import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val resolvedVersionName = System.getenv("DUALLANE_APP_VERSION")?.takeIf { it.isNotBlank() } ?: "1.0.7"
val resolvedVersionCode = System.getenv("DUALLANE_ANDROID_VERSION_CODE")?.toIntOrNull() ?: 10007

val keystorePath = System.getenv("DUALLANE_ANDROID_KEYSTORE")?.takeIf { it.isNotBlank() }
val keystoreStorePassword = System.getenv("DUALLANE_ANDROID_STORE_PASSWORD")
val keystoreKeyAlias = System.getenv("DUALLANE_ANDROID_KEY_ALIAS")
val keystoreKeyPassword = System.getenv("DUALLANE_ANDROID_KEY_PASSWORD")

android {
    namespace = "com.timestarry.duallane"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.timestarry.duallane"
        minSdk = 26
        targetSdk = 36
        versionCode = resolvedVersionCode
        versionName = resolvedVersionName
    }

    signingConfigs {
        if (
            keystorePath != null &&
            !keystoreStorePassword.isNullOrBlank() &&
            !keystoreKeyAlias.isNullOrBlank() &&
            !keystoreKeyPassword.isNullOrBlank()
        ) {
            create("release") {
                storeFile = File(keystorePath)
                storePassword = keystoreStorePassword
                keyAlias = keystoreKeyAlias
                keyPassword = keystoreKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
