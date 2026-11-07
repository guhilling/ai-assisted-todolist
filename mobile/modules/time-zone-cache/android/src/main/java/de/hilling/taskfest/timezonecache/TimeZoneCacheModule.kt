package de.hilling.taskfest.timezonecache

import android.util.Log
import com.facebook.react.bridge.ReactContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Drops the time zone Hermes cached for `Date` (#526). Synchronous, so it runs on the JavaScript
 * thread, the only one Hermes may be called on. The runtime's address comes from React Native's
 * own `javaScriptContextHolder`, as expo-modules-core installs itself from it. The library is
 * loaded at the first call, not with the module, so one that cannot be loaded costs only the reset.
 */
class TimeZoneCacheModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TimeZoneCache")

    Function("reset") {
      val react = appContext.reactContext as? ReactContext
      val runtime = react?.javaScriptContextHolder?.get() ?: 0L
      if (runtime != 0L && loaded) {
        resetHermes(runtime)
      }
    }
  }

  private external fun resetHermes(runtime: Long)

  companion object {
    private val loaded: Boolean by lazy {
      try {
        System.loadLibrary("timezonecache")
        true
      } catch (failure: UnsatisfiedLinkError) {
        Log.w("TimeZoneCache", "Hermes' time zone cannot be dropped", failure)
        false
      }
    }
  }
}
