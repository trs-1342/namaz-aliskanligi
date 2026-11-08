# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Add any project specific keep options here:

# ---------------------------------------------------------------------------
# R8 HAZIRLIĞI (bu kurallar yalnız minifyEnabled=true iken tüketilir; minify
# kapalıyken derlemeye hiçbir etkisi yoktur).
#
# Etkinleştirme:
#   android/gradle.properties -> android.enableMinifyInReleaseBuilds=true
# Etkinleştirmeden ÖNCE fiziksel cihaz testi zorunludur (alarm penceresi, arka
# plan beacon görevi, bildirim kanalı sesi).
# ---------------------------------------------------------------------------

# KAPSAM İLKESİ: paket geneli (`com.trs1342.namazaliskanligi.**`) keep YOK.
# Yalnızca yansıma/JNI/RN bridge nedeniyle statik olarak erişilemez görünen
# üyeler korunur; geri kalan uygulama kodu R8 tarafından serbestçe küçültülüp
# yeniden adlandırılabilir.

# 1) AlarmWindowModule — eski mimari (legacy bridge) NativeModule'ü.
#    JavaModuleWrapper, modül sınıfının metotlarını `getDeclaredMethods()` ile
#    tarayıp @ReactMethod anotasyonuna göre seçer; Kotlin/Java tarafında bu
#    metotların HİÇBİR çağıranı yoktur. Keep olmadan R8 bunları ölü kod sayar →
#    setFlags/moveToBackground/isScreenLocked/getDeviceInfo JS'ten çağrılamaz →
#    tam ekran alarm penceresi çalışmaz.
#    Sınıfın KENDİSİ yeniden adlandırılabilir (AlarmWindowPackage onu doğrudan
#    `AlarmWindowModule(reactContext)` ile üretir; JS tarafı yalnız getName()'in
#    döndürdüğü "AlarmWindow" METNİNİ kullanır, sınıf adını değil).
-keepclassmembers class com.trs1342.namazaliskanligi.AlarmWindowModule {
    @com.facebook.react.bridge.ReactMethod <methods>;
    public java.lang.String getName();
}

# 2) AlarmWindowPackage — MainApplication.getPackages() içinde doğrudan
#    örneklenir, dolayısıyla sınıf zaten erişilebilir. ReactPackage sözleşme
#    metotları arayüz üzerinden çağrıldığı için imzalarını koruyoruz.
#    (Genel `class * implements ReactPackage` kuralı KULLANILMADI: tüm kütüphane
#    paketlerini de kapsar ve gereksiz genişlikte olur; onlar kendi consumer
#    kurallarını gönderiyor.)
-keepclassmembers class com.trs1342.namazaliskanligi.AlarmWindowPackage {
    public <init>();
    public java.util.List createNativeModules(com.facebook.react.bridge.ReactApplicationContext);
    public java.util.List createViewManagers(com.facebook.react.bridge.ReactApplicationContext);
}

# 3) Manifest'te ADIYLA yazılı, Android çerçevesi tarafından yansımayla
#    örneklenen bileşenler (android:name=".MainApplication" / ".MainActivity").
#    AGP bunlar için otomatik keep kuralı üretir; burada açıkça belirtmek
#    otomatik üretime bağımlılığı kaldırır. Üye korumasına gerek yok, yalnız
#    sınıf adı ve varsayılan kurucu korunur.
-keep class com.trs1342.namazaliskanligi.MainApplication { <init>(); }
-keep class com.trs1342.namazaliskanligi.MainActivity { <init>(); }

# 4) @ReactMethod anotasyonunun çalışma zamanında okunabilmesi için gereken tek
#    attribute. (AGP'nin proguard-android.txt dosyası zaten `*Annotation*`
#    içeriyor; bu satır ona bağımlı kalmamak için savunma amaçlı ve dardır.)
-keepattributes RuntimeVisibleAnnotations

# NOT: `-keep class kotlin.Metadata` KULLANILMADI. Uygulamanın kendi kodu Kotlin
# yansıması kullanmıyor; expo-modules-core'un Kotlin tabanlı modül çözümü için
# gereken kuralları expo-modules-core kendi consumer dosyasında gönderiyor.

# NOT: expo-task-manager / expo-background-task / expo-notifications /
# expo-location / expo-modules-core kendi consumer proguard kurallarını AAR
# içinde gönderiyor (kontrol edildi), bu yüzden burada tekrarlanmadı.
#
# NOT: shrinkResources KAPALI bırakıldı. assets/alarm.mp3 -> res/raw/alarm.mp3
# olarak paketleniyor ve yalnızca ADI ile (bildirim kanalı sesi) referans
# ediliyor; kaynak küçültücü bunu "erişilmiyor" sayıp silebilir ve ezan sesi
# kaybolur. Açılacaksa önce res/raw/keep.xml eklenmelidir.
