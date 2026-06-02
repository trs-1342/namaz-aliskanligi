package com.trs1342.namazaliskanligi

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }

  // @withAndroidAlarm-lockscreen-v3: alarm yokken kilit ekranı üstüne çıkmayı engelle
  private fun applyAlarmWindowState() {
    try {
      val prefs = getSharedPreferences("AlarmWindow", android.content.Context.MODE_PRIVATE)
      val alarmActive = prefs.getBoolean("alarmActive", false)
      val alarmFiredAt = prefs.getLong("alarmFiredAt", 0L)
      val age = if (alarmFiredAt > 0L) System.currentTimeMillis() - alarmFiredAt else Long.MAX_VALUE
      val isRecent = alarmFiredAt > 0L && age in 0..90000L

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

}