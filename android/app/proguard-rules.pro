# Keep @JavascriptInterface methods on NativeBridge intact under R8 minification
-keepattributes JavascriptInterface
-keepclassmembers class com.timestarry.duallane.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.timestarry.duallane.NativeBridge { *; }
-keep class com.timestarry.duallane.PushKeepAliveService { *; }
-keep class com.timestarry.duallane.BootCompletedReceiver { *; }

# OkHttp / Okio rules
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
