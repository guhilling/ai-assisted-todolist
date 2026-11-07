import ExpoModulesCore

/// Drops the caches that keep the time zone the app started in (#526): Foundation's, which
/// expo-localization reads, then Hermes', which every `Date` uses. Synchronous, so it runs on the
/// JavaScript thread, the only one Hermes may be called on.
public class TimeZoneCacheModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TimeZoneCache")

    Function("reset") {
      NSTimeZone.resetSystemTimeZone()
      appContext?.runtime.withUnsafePointee { ResetHermesTimeZoneCache($0) }
    }
  }
}
