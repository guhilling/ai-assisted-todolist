#import <Foundation/Foundation.h>

/// Drops the time zone Hermes cached for `Date` (#526), on the runtime `runtime` points to. Does
/// nothing when that runtime is not Hermes. Call it on the JavaScript thread only.
FOUNDATION_EXPORT void ResetHermesTimeZoneCache(void *_Nonnull runtime);
