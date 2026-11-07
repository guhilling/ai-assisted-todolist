// Drops the time zone Hermes cached for `Date` (#526); see TimeZoneCacheModule.kt.
#include <jni.h>
#include <jsi/hermes-interfaces.h>
#include <jsi/jsi.h>

/// Backs `TimeZoneCacheModule.resetHermes`: drops Hermes' cached zone on the runtime whose address
/// is `runtime`, and does nothing when that runtime is not Hermes. Runs on the JavaScript thread.
extern "C" JNIEXPORT void JNICALL
Java_de_hilling_taskfest_timezonecache_TimeZoneCacheModule_resetHermes(JNIEnv *, jobject, jlong runtime) {
  auto *jsi = reinterpret_cast<facebook::jsi::Runtime *>(runtime);
  if (auto *hermes = facebook::jsi::castInterface<facebook::hermes::IHermes>(jsi)) {
    hermes->resetTimezoneCache();
  }
}
