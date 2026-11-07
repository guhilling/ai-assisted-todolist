#import "ResetHermesTimeZoneCache.h"

#include <jsi/hermes-interfaces.h>
#include <jsi/jsi.h>

void ResetHermesTimeZoneCache(void *runtime) {
  auto *jsi = static_cast<facebook::jsi::Runtime *>(runtime);
  if (auto *hermes = facebook::jsi::castInterface<facebook::hermes::IHermes>(jsi)) {
    hermes->resetTimezoneCache();
  }
}
