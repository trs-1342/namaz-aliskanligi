/**
 * Expo Config Plugin — Android Alarm Desteği
 *
 * 1. AndroidManifest.xml: MainActivity'e showWhenLocked + turnScreenOn
 * 2. AlarmWindowModule.kt + AlarmWindowPackage.kt: ekran flag'lerini JS'den yönetmek için native modül
 * 3. ExpoNotificationBuilder.kt patch: alarm kanalı bildirimlerine fullScreenIntent ekle
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');
const fs = require('fs');
const path = require('path');

module.exports = function withAndroidAlarm(config) {
  config = addManifestFlags(config);
  config = addAlarmWindowModule(config);
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

      // AlarmWindowModule.kt
      const modulePath = path.join(srcDir, 'AlarmWindowModule.kt');
      if (!fs.existsSync(modulePath)) {
        fs.writeFileSync(modulePath, alarmWindowModuleKt(pkg), 'utf8');
        console.log('[withAndroidAlarm] ✓ AlarmWindowModule.kt oluşturuldu.');
      }

      // AlarmWindowPackage.kt
      const packagePath = path.join(srcDir, 'AlarmWindowPackage.kt');
      if (!fs.existsSync(packagePath)) {
        fs.writeFileSync(packagePath, alarmWindowPackageKt(pkg), 'utf8');
        console.log('[withAndroidAlarm] ✓ AlarmWindowPackage.kt oluşturuldu.');
      }

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

// ─── 3. ExpoNotificationBuilder.kt — fullScreenIntent patch ──────────────────

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

      // Zaten yamalıysa atla
      if (src.includes('@withAndroidAlarm')) return config;

      // Kaynak kodda gördüğümüz tam blok (satır 142-148)
      const target = `    builder.setContentIntent(
      createNotificationResponseIntent(
        context,
        notification,
        defaultAction
      )
    )`;

      // content.body → INotificationContent.body: JSONObject? (data alanı)
      // isAlarm: true olduğunda fullScreenIntent ekle
      const insertion = `
    // @withAndroidAlarm: alarm bildirimleri için tam ekran & ekran uyandırma
    if (content.body?.optBoolean("isAlarm", false) == true) {
      builder.setFullScreenIntent(
        createNotificationResponseIntent(context, notification, defaultAction),
        true
      )
    }`;

      if (src.includes(target)) {
        const patched = src.replace(target, target + insertion);
        fs.writeFileSync(builderPath, patched, 'utf8');
        console.log('[withAndroidAlarm] ✓ ExpoNotificationBuilder.kt — fullScreenIntent eklendi.');
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

import android.os.Build
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS'den çağrılan native modül.
 * Alarm başladığında ekranı açık tutar, kilitli ekran üzerinde gösterir.
 * Alarm bittiğinde flag'leri temizler.
 */
class AlarmWindowModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "AlarmWindow"

  @ReactMethod
  fun setFlags(enable: Boolean) {
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
