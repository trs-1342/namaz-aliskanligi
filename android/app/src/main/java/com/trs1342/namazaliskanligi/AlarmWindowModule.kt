package com.trs1342.namazaliskanligi

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
