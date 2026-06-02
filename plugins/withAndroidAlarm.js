/**
 * Expo Config Plugin — Android Alarm Desteği
 *
 * 1. AndroidManifest.xml: MainActivity'e showWhenLocked + turnScreenOn
 * 2. AlarmWindowModule.kt + AlarmWindowPackage.kt: ekran flag'lerini JS'den yönetmek için native modül
 * 3. MainActivity.kt: alarm yokken kilit ekranı üstüne çıkmayı engelle
 * 4. ExpoNotificationBuilder.kt: alarm bildirimlerine fullScreenIntent ekle ve alarm durumunu native'e yaz
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

function addManifestFlags(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults.manifest.application?.[0];
    const main = app?.activity?.find((a) => a.$?.['android:name'] === '.MainActivity');
    if (main) {
      main.$['android:showWhenLocked'] = 'true';
      main.$['android:turnScreenOn'] = 'true';
    } else {
      console.warn('[withAndroidAlarm] MainActivity activity elementi bulunamadı.');
    }
    return config;
  });
}

// ─── 2. AlarmWindowModule native modülü ──────────────────────────────────────

function addAlarmWindowModule(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const pkg = config.android?.package;

      if (!pkg) {
        console.warn('[withAndroidAlarm] android.package bulunamadı, modül oluşturulamadı.');
        return config;
      }

      const pkgDir = pkg.replace(/\./g, '/');
      const srcDir = path.join(
        projectRoot,
        'android/app/src/main/java',
        pkgDir
      );

      if (!fs.existsSync(srcDir)) {
        console.warn(`[withAndroidAlarm] Android src klasörü bulunamadı: ${srcDir}`);
        return config;
      }

      fs.writeFileSync(path.join(srcDir, 'AlarmWindowModule.kt'), alarmWindowModuleKt(pkg), 'utf8');
      fs.writeFileSync(path.join(srcDir, 'AlarmWindowPackage.kt'), alarmWindowPackageKt(pkg), 'utf8');
      console.log('[withAndroidAlarm] ✓ AlarmWindowModule.kt ve AlarmWindowPackage.kt güncellendi.');

      // MainApplication.kt — paketi kaydet
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
          console.log('[withAndroidAlarm] ✓ MainApplication.kt güncellendi.');
        } catch (e) {
          console.warn('[withAndroidAlarm] MainApplication.kt patch hatası:', e.message);
        }
      }

      return config;
    },
  ]);
}

// ─── 3. MainActivity.kt — kilit ekranı güvenlik katmanı ──────────────────────

function patchMainActivity(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot } = config.modRequest;
      const pkg = config.android?.package;

      if (!pkg) {
        console.warn('[withAndroidAlarm] android.package bulunamadı, MainActivity patch atlandı.');
        return config;
      }

      const pkgDir = pkg.replace(/\./g, '/');
      const mainActivityPath = path.join(
        projectRoot,
        'android/app/src/main/java',
        pkgDir,
        'MainActivity.kt'
      );

      if (!fs.existsSync(mainActivityPath)) {
        console.warn('[withAndroidAlarm] MainActivity.kt bulunamadı, kilit ekranı patch atlandı.');
        return config;
      }

      let src = fs.readFileSync(mainActivityPath, 'utf8');

      if (src.includes('@withAndroidAlarm-lockscreen-v2')) {
        return config;
      }

      src = ensureKotlinImport(src, 'import android.app.KeyguardManager');
      src = ensureKotlinImport(src, 'import android.content.Context');
      src = ensureKotlinImport(src, 'import android.os.Build');
      src = ensureKotlinImport(src, 'import android.view.WindowManager');

      const helpers = `

  // @withAndroidAlarm-lockscreen-v2
  private fun shouldShowAlarmWindow(): Boolean {
    val prefs = getSharedPreferences("AlarmWindow", Context.MODE_PRIVATE)
    val alarmActive = prefs.getBoolean("alarmActive", false)
    val alarmFiredAt = prefs.getLong("alarmFiredAt", 0L)
    val isRecent = alarmFiredAt > 0L && (System.currentTimeMillis() - alarmFiredAt) < 90_000L
    return alarmActive || isRecent
  }

  private fun isScreenLockedForAlarm(): Boolean {
    val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    return keyguardManager.isKeyguardLocked
  }

  private fun applyAlarmWindowFlags() {
    val show = shouldShowAlarmWindow()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(show)
      setTurnScreenOn(show)
    }

    @Suppress("DEPRECATION")
    if (show) {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )
    } else {
      window.clearFlags(
        WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
      )

      if (isScreenLockedForAlarm()) {
        moveTaskToBack(true)
      }
    }
  }
`;

      src = src.replace(/\n}\s*$/, `${helpers}\n}`);

      if (src.includes('override fun onStart()')) {
        src = src.replace(
          /(override fun onStart\(\)\s*\{\s*super\.onStart\(\))/,
          '$1\n    applyAlarmWindowFlags()'
        );
      } else {
        src = src.replace(
          /\n}\s*$/,
          `

  override fun onStart() {
    super.onStart()
    applyAlarmWindowFlags()
  }
}`
        );
      }

      if (src.includes('override fun onResume()')) {
        src = src.replace(
          /(override fun onResume\(\)\s*\{\s*super\.onResume\(\))/,
          '$1\n    applyAlarmWindowFlags()'
        );
      } else {
        src = src.replace(
          /\n}\s*$/,
          `

  override fun onResume() {
    super.onResume()
    applyAlarmWindowFlags()
  }
}`
        );
      }

      fs.writeFileSync(mainActivityPath, src, 'utf8');
      console.log('[withAndroidAlarm] ✓ MainActivity.kt — kilit ekranı güvenlik patch eklendi.');

      return config;
    },
  ]);
}

function ensureKotlinImport(src, importLine) {
  if (src.includes(importLine)) return src;
  return src.replace(/package[^\n]+\n/, (match) => `${match}\n${importLine}\n`);
}

// ─── 4. ExpoNotificationBuilder.kt — fullScreenIntent patch ──────────────────

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
        console.warn('[withAndroidAlarm] ExpoNotificationBuilder.kt bulunamadı, fullScreenIntent atlandı.');
        return config;
      }

      let src = fs.readFileSync(builderPath, 'utf8');

      if (src.includes('@withAndroidAlarm-fullscreen-v2')) return config;

      // Eski patch varsa temizle; temiz EAS build'de zaten gerekmez ama lokal prebuild'i korur.
      src = src.replace(
        /\n    \/\/ @withAndroidAlarm: alarm bildirimleri için tam ekran & ekran uyandırma\n    if \(content\.body\?\.optBoolean\("isAlarm", false\) == true\) \{\n      builder\.setFullScreenIntent\(\n        createNotificationResponseIntent\(context, notification, defaultAction\),\n        true\n      \)\n    \}/,
        ''
      );

      const target = `    builder.setContentIntent(
      createNotificationResponseIntent(
        context,
        notification,
        defaultAction
      )
    )`;

      const insertion = `

    // @withAndroidAlarm-fullscreen-v2
    if (content.body?.optBoolean("isAlarm", false) == true) {
      context.getSharedPreferences("AlarmWindow", Context.MODE_PRIVATE)
        .edit()
        .putBoolean("alarmActive", true)
        .putLong("alarmFiredAt", System.currentTimeMillis())
        .apply()

      builder.setFullScreenIntent(
        createNotificationResponseIntent(context, notification, defaultAction),
        true
      )
    }`;

      if (src.includes(target)) {
        const patched = src.replace(target, target + insertion);
        fs.writeFileSync(builderPath, patched, 'utf8');
        console.log('[withAndroidAlarm] ✓ ExpoNotificationBuilder.kt — fullScreenIntent + alarm state eklendi.');
      } else {
        console.warn(
          '[withAndroidAlarm] setContentIntent bloğu bulunamadı. ' +
            'expo-notifications sürümü değişmiş olabilir. Elle kontrol edin.'
        );
      }

      return config;
    },
  ]);
}

// ─── Kotlin şablonları ────────────────────────────────────────────────────────

function alarmWindowModuleKt(pkg) {
  return `package ${pkg}

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS'den çağrılan native modül.
 * Alarm başladığında ekranı açık tutar, kilitli ekran üzerinde gösterir.
 * Alarm bittiğinde flag'leri temizler ve alarm durumunu native tarafta sıfırlar.
 */
class AlarmWindowModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "AlarmWindow"

  private fun prefs() = reactApplicationContext.getSharedPreferences("AlarmWindow", Context.MODE_PRIVATE)

  private fun isScreenLockedValue(): Boolean {
    val keyguardManager = reactApplicationContext.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    return keyguardManager.isKeyguardLocked
  }

  @ReactMethod
  fun setFlags(enable: Boolean) {
    val editor = prefs().edit().putBoolean("alarmActive", enable)

    if (enable) {
      val currentFiredAt = prefs().getLong("alarmFiredAt", 0L)
      if (currentFiredAt == 0L) {
        editor.putLong("alarmFiredAt", System.currentTimeMillis())
      }
    } else {
      editor.putLong("alarmFiredAt", 0L)
    }

    editor.apply()

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
      promise.resolve(isScreenLockedValue())
    } catch (e: Exception) {
      promise.reject("ALARM_WINDOW_SCREEN_LOCKED_ERROR", e)
    }
  }

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    try {
      val p = prefs()
      val map = Arguments.createMap()
      map.putInt("sdkInt", Build.VERSION.SDK_INT)
      map.putBoolean("screenLocked", isScreenLockedValue())
      map.putBoolean("alarmActive", p.getBoolean("alarmActive", false))
      map.putDouble("alarmFiredAt", p.getLong("alarmFiredAt", 0L).toDouble())
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("ALARM_WINDOW_DEVICE_INFO_ERROR", e)
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
