package de.hilling.taskfest.timezonecache

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Drops the time zone Hermes cached for `Date` (#526). Synchronous, so it runs on the JavaScript
 * thread, the only one Hermes may be called on. The runtime's address comes from React Native's
 * own `javaScriptContextHolder`, as expo-modules-core installs itself from it.
 */
class TimeZoneCacheModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("TimeZoneCache")

    Function("reset") {
      val runtime = appContext.reactContext?.javaScriptContextHolder?.get() ?: 0L
      if (runtime != 0L) {
        resetHermes(runtime)
      }
    }
  }

  private external fun resetHermes(runtime: Long)

  companion object {
    init {
      System.loadLibrary("timezonecache")
    }
  }
}
