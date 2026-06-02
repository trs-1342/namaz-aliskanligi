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

class AlarmWindowModule(context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  override fun getName() = "AlarmWindow"

  private fun prefs() = reactApplicationContext.getSharedPreferences("AlarmWindow", Context.MODE_PRIVATE)

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
