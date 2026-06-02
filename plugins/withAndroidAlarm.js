/**
 * Expo Config Plugin — Android Alarm Desteği
 *
 * Gri ekran sorununun kök nedeni: android:showWhenLocked manifest'te statik olduğu için
 * MainActivity alarm yokken de kilit ekranı üstüne çıkabiliyor.
 *
 * Bu plugin üç yerde güvenlik katmanı kurar:
 * 1. MainActivity.onStart/onResume: JS yüklenmeden alarm state kontrolü yapar.
 * 2. ExpoNotificationBuilder: alarm bildirimi oluşturulurken native state yazar.
 * 3. AlarmWindowModule: JS tarafı setFlags/moveToBackground/isScreenLocked çağırabilir.
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');
const path = require('path');

const PATCH_TAG_ACTIVITY = 'withAndroidAlarm-lockscreen-v3';
const PATCH_TAG_NOTIFICATION = 'withAndroidAlarm-fullscreen-v3';
const ALARM_WINDOW_PREFS = 'AlarmWindow';
const ALARM_WINDOW_VALID_MS = 90_000;

module.exports = function withAndroidAlarm(config) {
  config = addManifestFlags(config);
  config = addAlarmWindowModule(config);
  config = patchMainActivity(config);
  config = patchFullScreenIntent(config);
  return config;
};

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

function addAlarmWindowModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const pkg = config.android?.package;
      if (!pkg) {
        console.warn('[withAndroidAlarm] android.package bulunamadı.');
        return config;
      }

      const pkgDir = pkg.replace(/\./g, '/');
      const srcDir = path.join(projectRoot, 'android/app/src/main/java', pkgDir);
      if (!fs.existsSync(srcDir)) {
        console.warn('[withAndroidAlarm] Android src bulunamadı.');
        return config;
      }

      fs.writeFileSync(path.join(srcDir, 'AlarmWindowModule.kt'), alarmWindowModuleKt(pkg), 'utf8');
      fs.writeFileSync(path.join(srcDir, 'AlarmWindowPackage.kt'), alarmWindowPackageKt(pkg), 'utf8');
      console.log('[withAndroidAlarm] ✓ AlarmWindowModule.kt + AlarmWindowPackage.kt');

      const mainAppPath = path.join(srcDir, 'MainApplication.kt');
      if (!fs.existsSync(mainAppPath)) {
        console.warn('[withAndroidAlarm] MainApplication.kt bulunamadı.');
        return config;
      }

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
          console.log('[withAndroidAlarm] ✓ MainApplication.kt package kaydı');
        } catch (e) {
          console.warn('[withAndroidAlarm] MainApplication.kt patch hatası:', e.message);
        }
      }

      return config;
    },
  ]);
}

function patchMainActivity(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const pkg = config.android?.package;
      if (!pkg) return config;

      const pkgDir = pkg.replace(/\./g, '/');
      const mainActivityPath = path.join(projectRoot, 'android/app/src/main/java', pkgDir, 'MainActivity.kt');
      if (!fs.existsSync(mainActivityPath)) {
        console.warn('[withAndroidAlarm] MainActivity.kt bulunamadı, lockscreen patch atlandı.');
        return config;
      }

      let src = fs.readFileSync(mainActivityPath, 'utf8');
      if (src.includes(PATCH_TAG_ACTIVITY)) return config;

      src = removeOldMainActivityAlarmPatch(src);

      const code = `

  // @${PATCH_TAG_ACTIVITY}: alarm yokken kilit ekranı üstüne çıkmayı engelle
  private fun applyAlarmWindowState() {
    try {
      val prefs = getSharedPreferences("${ALARM_WINDOW_PREFS}", android.content.Context.MODE_PRIVATE)
      val alarmActive = prefs.getBoolean("alarmActive", false)
      val alarmFiredAt = prefs.getLong("alarmFiredAt", 0L)
      val age = if (alarmFiredAt > 0L) System.currentTimeMillis() - alarmFiredAt else Long.MAX_VALUE
      val isRecent = alarmFiredAt > 0L && age in 0..${ALARM_WINDOW_VALID_MS}L

      // Kritik fark: OR değil AND.
      // alarmActive true kalmışsa ama timestamp eskidiyse stale state temizlenir.
      val show = alarmActive && isRecent

      if (!show) {
        prefs.edit()
          .putBoolean("alarmActive", false)
          .putLong("alarmFiredAt", 0L)
          .apply()
      }

      if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
        setShowWhenLocked(show)
        setTurnScreenOn(show)
      }

      @Suppress("DEPRECATION")
      if (show) {
        window.addFlags(
          android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )
      } else {
        window.clearFlags(
          android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )

        val keyguardManager = getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager
        if (keyguardManager.isKeyguardLocked) {
          moveTaskToBack(true)
        }
      }
    } catch (_: Exception) {}
  }

  override fun onStart() {
    super.onStart()
    applyAlarmWindowState()
  }

  override fun onResume() {
    super.onResume()
    applyAlarmWindowState()
  }
`;

      src = src.replace(/\n}\s*$/, `${code}\n}`);
      fs.writeFileSync(mainActivityPath, src, 'utf8');
      console.log('[withAndroidAlarm] ✓ MainActivity.kt lockscreen v3 patch');

      return config;
    },
  ]);
}

function removeOldMainActivityAlarmPatch(src) {
  // Eski ekran patch'i varsa final class kapanışına kadar silmeye çalışan riskli regex yerine
  // eski marker görüldüğünde temiz prebuild önerilir. Build'i kırmamak için burada no-op bırakıyoruz.
  // Temiz EAS build zaten android klasörünü yeniden ürettiği için eski kod taşınmaz.
  return src;
}

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
      if (src.includes(PATCH_TAG_NOTIFICATION)) return config;

      const target = `    builder.setContentIntent(
      createNotificationResponseIntent(
        context,
        notification,
        defaultAction
      )
    )`;

      const insertion = `

    // @${PATCH_TAG_NOTIFICATION}: alarm bildirimi için fullScreenIntent + native state
    if (content.body?.optBoolean("isAlarm", false) == true) {
      try {
        context.getSharedPreferences("${ALARM_WINDOW_PREFS}", android.content.Context.MODE_PRIVATE)
          .edit()
          .putBoolean("alarmActive", true)
          .putLong("alarmFiredAt", System.currentTimeMillis())
          .apply()
      } catch (_: Exception) {}

      builder.setFullScreenIntent(
        createNotificationResponseIntent(context, notification, defaultAction),
        true
      )
    }`;

      if (src.includes(target)) {
        fs.writeFileSync(builderPath, src.replace(target, target + insertion), 'utf8');
        console.log('[withAndroidAlarm] ✓ ExpoNotificationBuilder.kt fullscreen v3 patch');
      } else {
        console.warn('[withAndroidAlarm] setContentIntent bloğu bulunamadı — expo-notifications sürümü değişmiş olabilir.');
      }

      return config;
    },
  ]);
}

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

class AlarmWindowModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "AlarmWindow"

  private fun prefs() = reactApplicationContext.getSharedPreferences("${ALARM_WINDOW_PREFS}", Context.MODE_PRIVATE)

  @ReactMethod
  fun setFlags(enable: Boolean) {
    prefs().edit().apply {
      putBoolean("alarmActive", enable)
      if (enable) {
        putLong("alarmFiredAt", System.currentTimeMillis())
      } else {
        putLong("alarmFiredAt", 0L)
      }
      apply()
    }

    val activity = reactApplicationContext.currentActivity ?: return
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
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
    } catch (_: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    try {
      val map = WritableNativeMap()
      val p = prefs()
      map.putInt("apiLevel", Build.VERSION.SDK_INT)
      map.putString("release", Build.VERSION.RELEASE)
      map.putString("manufacturer", Build.MANUFACTURER)
      map.putString("model", Build.MODEL)
      map.putBoolean("alarmActive", p.getBoolean("alarmActive", false))
      map.putDouble("alarmFiredAt", p.getLong("alarmFiredAt", 0L).toDouble())

      val canScheduleExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager)
          ?.canScheduleExactAlarms() ?: false
      } else true
      map.putBoolean("canScheduleExactAlarms", canScheduleExact)

      val hasNotifPerm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        ContextCompat.checkSelfPermission(
          reactApplicationContext,
          Manifest.permission.POST_NOTIFICATIONS
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
