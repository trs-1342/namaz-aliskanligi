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
// @generated begin withAndroidAlarm-onStart - expo prebuild (DO NOT MODIFY) sync-3c459805c6cc2105825496f06f7667e2c057148f

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
  }
// @generated end withAndroidAlarm-onStart
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
}
