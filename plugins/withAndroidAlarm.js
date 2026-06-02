/**
 * Expo Config Plugin — Android Alarm Desteği
 *
 * Gri ekran sorununun kök nedeni: android:showWhenLocked manifest'te statik →
 * alarm olmadan da uygulama kilit ekranı üstüne çıkıyor.
 *
 * Çözüm mimarisi (3 katman):
 *  1. MainActivity.onStart() → SharedPreferences'tan alarm durumunu okur,
 *     setShowWhenLocked'ı NATIVE seviyede JS beklenmeden uygular.
 *  2. ExpoNotificationBuilder → alarm bildirimi oluşturulduğunda SharedPreferences'a
 *     alarmFiredAt yazar; böylece onCreate/onStart alarm zamanlamasını bilir.
 *  3. AlarmWindowModule → setFlags(true/false) çağrısında SharedPreferences günceller
 *     + JS tarafından moveToBackground / isScreenLocked erişimi.
 *
 * Android sürüm desteği:
 *  API 23+ (Android 6)  : fullScreenIntent
 *  API 27+ (Android 8.1): setShowWhenLocked / setTurnScreenOn (modern API)
 *  API 31+ (Android 12) : canScheduleExactAlarms
 *  API 33+ (Android 13) : POST_NOTIFICATIONS
 *  API 34+ (Android 14) : USE_EXACT_ALARM
 *  Eski sürümler        : deprecated window flag fallback
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');
const path = require('path');

module.exports = function withAndroidAlarm(config) {
  config = addManifestFlags(config);
  config = addAlarmWindowModule(config);
  config = patchMainActivity(config);
  config = patchFullScreenIntent(config);
  return config;
};

// ─── 1. AndroidManifest.xml ──────────────────────────────────────────────────
// Statik flag'ler fullScreenIntent için gerekli (activity başlamadan önce
// Android bu flag'leri kontrol eder). Gri ekran MainActivity.onStart()'ta
// SharedPreferences kontrolüyle düzeltiliyor.

function addManifestFlags(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:showWhenLocked'] = 'true';
      main.$['android:turnScreenOn'] = 'true';
    }
    return config;
  });
}

// ─── 2. AlarmWindowModule + AlarmWindowPackage ────────────────────────────────

function addAlarmWindowModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const pkg = config.android?.package;
      if (!pkg) { console.warn('[withAndroidAlarm] android.package bulunamadı.'); return config; }

      const pkgDir = pkg.replace(/\./g, '/');
      const srcDir = path.join(projectRoot, 'android/app/src/main/java', pkgDir);
      if (!fs.existsSync(srcDir)) { console.warn('[withAndroidAlarm] Android src bulunamadı.'); return config; }

      fs.writeFileSync(path.join(srcDir, 'AlarmWindowModule.kt'), alarmWindowModuleKt(pkg), 'utf8');
      console.log('[withAndroidAlarm] ✓ AlarmWindowModule.kt');

      fs.writeFileSync(path.join(srcDir, 'AlarmWindowPackage.kt'), alarmWindowPackageKt(pkg), 'utf8');
      console.log('[withAndroidAlarm] ✓ AlarmWindowPackage.kt');

      const mainAppPath = path.join(srcDir, 'MainApplication.kt');
      if (!fs.existsSync(mainAppPath)) { console.warn('[withAndroidAlarm] MainApplication.kt bulunamadı.'); return config; }

      let mainSrc = fs.readFileSync(mainAppPath, 'utf8');
      if (!mainSrc.includes('AlarmWindowPackage')) {
        try {
          mainSrc = mergeContents({
            tag: 'withAndroidAlarm-pkg',
            src: mainSrc,
            newSrc: '          (packages as MutableList<ReactPackage>).add(AlarmWindowPackage())',
            anchor: /PackageList\([^)]+\)\.packages/,
            offset: 1,
            comment: '//',
          }).contents;
          fs.writeFileSync(mainAppPath, mainSrc, 'utf8');
          console.log('[withAndroidAlarm] ✓ MainApplication.kt');
        } catch (e) {
          console.warn('[withAndroidAlarm] MainApplication.kt patch hatası:', e.message);
        }
      }

      return config;
    },
  ]);
}

// ─── 3. MainActivity.kt — onStart() patch ────────────────────────────────────
// GRİ EKRAN ÇÖZÜMÜ: onStart() her activity resume'unda SharedPreferences'ı
// okur ve showWhenLocked'ı JS beklenmeden native olarak set eder.
// Alarm yoksa → flag'leri temizle (kilit ekranı üstüne çıkma)
// Alarm varsa  → flag'leri set et (alarm ekranı kilit üstünde göster)

function patchMainActivity(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const pkg = config.android?.package;
      if (!pkg) return config;

      const pkgDir = pkg.replace(/\./g, '/');
      const mainActivityPath = path.join(
        projectRoot, 'android/app/src/main/java', pkgDir, 'MainActivity.kt'
      );

      if (!fs.existsSync(mainActivityPath)) {
        console.warn('[withAndroidAlarm] MainActivity.kt bulunamadı, onStart patch atlandı.');
        return config;
      }

      let src = fs.readFileSync(mainActivityPath, 'utf8');
      if (src.includes('@withAndroidAlarm-onStart')) {
        // Zaten yamalı — yeniden yaz (her build'de güncel olsun)
        src = src.replace(/\s*\/\/ @withAndroidAlarm-onStart[\s\S]*?^\s*\}\s*$/m, '');
      }

      const onStartCode = `
  // @withAndroidAlarm-onStart: Gri ekran düzeltmesi
  // SharedPreferences'tan alarm durumunu okur, showWhenLocked'ı JS olmadan uygular.
  override fun onStart() {
    super.onStart()
    try {
      val prefs = getSharedPreferences("AlarmWindow", android.content.Context.MODE_PRIVATE)
      val alarmActive  = prefs.getBoolean("alarmActive", false)
      val alarmFiredAt = prefs.getLong("alarmFiredAt", 0L)
      // 90 saniye içinde alarm ateşlendiyse showWhenLocked açık kalır
      val isRecent = alarmFiredAt > 0L && (System.currentTimeMillis() - alarmFiredAt) < 90_000L
      val show = alarmActive || isRecent
      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
        setShowWhenLocked(show)
        setTurnScreenOn(show)
      }
      @Suppress("DEPRECATION")
      if (!show) {
        window.clearFlags(
          android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
        )
      }
    } catch (_: Exception) { /* güvenli hata yutma */ }
  }`;

      try {
        src = mergeContents({
          tag: 'withAndroidAlarm-onStart',
          src,
          newSrc: onStartCode,
          anchor: /override fun getMainComponentName/,
          offset: 0,
          comment: '//',
        }).contents;
        fs.writeFileSync(mainActivityPath, src, 'utf8');
        console.log('[withAndroidAlarm] ✓ MainActivity.kt — onStart patch');
      } catch (e) {
        // Anchor bulunamazsa class kapanışından önce ekle
        try {
          src = mergeContents({
            tag: 'withAndroidAlarm-onStart',
            src,
            newSrc: onStartCode,
            anchor: /class MainActivity/,
            offset: 1,
            comment: '//',
          }).contents;
          fs.writeFileSync(mainActivityPath, src, 'utf8');
          console.log('[withAndroidAlarm] ✓ MainActivity.kt — onStart patch (fallback)');
        } catch (e2) {
          console.warn('[withAndroidAlarm] MainActivity.kt onStart patch hatası:', e2.message);
        }
      }

      return config;
    },
  ]);
}

// ─── 4. ExpoNotificationBuilder.kt — fullScreenIntent + SharedPreferences ────

function patchFullScreenIntent(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const builderPath = path.join(
        projectRoot,
        'node_modules/expo-notifications/android/src/main/java/' +
        'expo/modules/notifications/notifications/presentation/builders/ExpoNotificationBuilder.kt'
      );

      if (!fs.existsSync(builderPath)) {
        console.warn('[withAndroidAlarm] ExpoNotificationBuilder.kt bulunamadı.');
        return config;
      }

      let src = fs.readFileSync(builderPath, 'utf8');

      // Zaten güncel patch varsa atla
      if (src.includes('@withAndroidAlarm-v2')) return config;

      // Eski patch varsa temizle
      if (src.includes('@withAndroidAlarm')) {
        src = src.replace(/\n\s*\/\/ @withAndroidAlarm[\s\S]*?\}\s*\n/, '\n');
      }

      const target = `    builder.setContentIntent(
      createNotificationResponseIntent(
        context,
        notification,
        defaultAction
      )
    )`;

      const insertion = `
    // @withAndroidAlarm-v2: alarm bildirimleri için fullScreenIntent + SharedPreferences
    if (content.body?.optBoolean("isAlarm", false) == true) {
      builder.setFullScreenIntent(
        createNotificationResponseIntent(context, notification, defaultAction),
        true
      )
      // MainActivity.onStart()'ın alarm zamanlamasını bilmesi için SharedPreferences'a yaz
      try {
        context.getSharedPreferences("AlarmWindow", android.content.Context.MODE_PRIVATE)
          .edit()
          .putLong("alarmFiredAt", System.currentTimeMillis())
          .putBoolean("alarmActive", true)
          .apply()
      } catch (_: Exception) {}
    }`;

      if (src.includes(target)) {
        fs.writeFileSync(builderPath, src.replace(target, target + insertion), 'utf8');
        console.log('[withAndroidAlarm] ✓ ExpoNotificationBuilder.kt — fullScreenIntent + SharedPreferences');
      } else {
        console.warn('[withAndroidAlarm] setContentIntent bloğu bulunamadı — expo-notifications sürümü değişmiş olabilir.');
      }

      return config;
    },
  ]);
}

// ─── Kotlin şablonları ────────────────────────────────────────────────────────

function alarmWindowModuleKt(pkg) {
  return `package ${pkg}

import android.Manifest
import android.app.AlarmManager
import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.view.WindowManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

/**
 * AlarmWindowModule — Android 6+ (API 23+) desteği
 *
 * setFlags(true)  → alarm başladı; ekran flag'lerini set et + SharedPreferences güncelle
 * setFlags(false) → alarm bitti;  ekran flag'lerini temizle + SharedPreferences temizle
 * moveToBackground() → uygulamayı kilit ekranı arkasına gönder
 * isScreenLocked()   → kilit ekranı açık mı?
 * getDeviceInfo()    → API seviyesi, izin durumları
 */
class AlarmWindowModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "AlarmWindow"

  private fun prefs() = reactApplicationContext
    .getSharedPreferences("AlarmWindow", Context.MODE_PRIVATE)

  @ReactMethod
  fun setFlags(enable: Boolean) {
    // SharedPreferences güncelle — MainActivity.onStart() bunu okuyacak
    prefs().edit().apply {
      putBoolean("alarmActive", enable)
      if (!enable) putLong("alarmFiredAt", 0L) // alarm bitti, timestamp temizle
      apply()
    }

    val activity = reactApplicationContext.currentActivity ?: return
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        // API 27+ modern yol (Android 8.1+)
        activity.setShowWhenLocked(enable)
        activity.setTurnScreenOn(enable)
      }
      @Suppress("DEPRECATION")
      if (enable) {
        activity.window.addFlags(
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      } else {
        activity.window.clearFlags(
          WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      }
    }
  }

  @ReactMethod
  fun moveToBackground() {
    val activity = reactApplicationContext.currentActivity ?: return
    activity.runOnUiThread {
      activity.moveTaskToBack(true)
    }
  }

  @ReactMethod
  fun isScreenLocked(promise: Promise) {
    try {
      val km = reactApplicationContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
      promise.resolve(km?.isKeyguardLocked == true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    try {
      val map = WritableNativeMap()
      map.putInt("apiLevel", Build.VERSION.SDK_INT)
      map.putString("release", Build.VERSION.RELEASE)
      map.putString("manufacturer", Build.MANUFACTURER)
      map.putString("model", Build.MODEL)

      // Android 12+ (API 31): exact alarm izni
      val canScheduleExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)
          ?.canScheduleExactAlarms() ?: false
      } else true

      map.putBoolean("canScheduleExactAlarms", canScheduleExact)

      // Android 13+ (API 33): bildirim izni
      val hasNotifPerm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(
          reactApplicationContext, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
      } else true

      map.putBoolean("hasNotificationPermission", hasNotifPerm)

      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("ERR_DEVICE_INFO", e.message, e)
    }
  }
}
`;
}

function alarmWindowPackageKt(pkg) {
  return `package ${pkg}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AlarmWindowPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(AlarmWindowModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    emptyList()
}
`;
}
