package com.trs1342.namazaliskanligi

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
