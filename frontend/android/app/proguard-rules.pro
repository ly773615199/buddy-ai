# Capacitor & WebView
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keep class org.apache.cordova.** { *; }
-keepclassmembers class * {
    @com.getcapacitor.annotation.* <methods>;
}
-keepclassmembers class * {
    @org.apache.cordova.* <methods>;
}

# WebView JavaScript interface
-keepclassmembers class fqcn.of.javascript.interface.for.webview {
    public *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Three.js / WebGL (如果用到 3D)
-keep class org.mozilla.javascript.** { *; }

# React (通常不需要，但保险起见)
-keep class com.facebook.react.** { *; }

# 保留行号信息（调试用）
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
