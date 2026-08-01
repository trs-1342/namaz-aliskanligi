package com.trs1342.namazaliskanligi

import android.content.Context
import android.os.Build
import android.view.WindowManager
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AlarmWindowModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "AlarmWindow"

  @ReactMethod
  fun setFlags(enabled: Boolean) {
    reactApplicationContext
      .getSharedPreferences("AlarmWindow", Context.MODE_PRIVATE)
      .edit()
      .putBoolean("alarmActive", enabled)
      .putLong("alarmFiredAt", if (enabled) System.currentTimeMillis() else 0L)
      .apply()

    val activity = reactApplicationContext.currentActivity ?: return
    activity.runOnUiThread {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        activity.setShowWhenLocked(enabled)
        activity.setTurnScreenOn(enabled)
      }
      @Suppress("DEPRECATION")
      if (enabled) {
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
