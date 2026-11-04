package de.hilling.taskfest.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.triggers.DateTrigger
import expo.modules.notifications.service.delegates.ExpoSchedulingDelegate
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread

/**
 * Moves the floating reminders to the new time zone's wall-clock time when the phone's zone
 * changes (#479): "pills at 08:00" stays at 08:00 after a flight, without the app being opened.
 *
 * Every reminder is a fixed moment in expo-notifications' store. A floating one -- the 08:00
 * summary, a task with a time and no zone -- carries the wall-clock time it stands for as
 * `wallClock` in its data (`mobile/src/reminders.ts`); a zoned one carries none and stays where it
 * is, since its moment is the same everywhere. Each floating one is scheduled again under its own
 * identifier, which replaces it, through expo's own delegate, so expo's store and its reboot handling
 * stay as they are. No JavaScript: the app may not be running. Added to the build by
 * `plugins/withTimeZoneReceiver.ts`, declared in the manifest by `src/timeZoneReceiver.ts`.
 */
class TimeZoneChangedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_TIMEZONE_CHANGED) {
      return
    }
    // The zone the broadcast names: a process already running may not have taken it up yet.
    val zone = intent.getStringExtra(Intent.EXTRA_TIMEZONE)?.let(TimeZone::getTimeZone) ?: TimeZone.getDefault()
    val pending = goAsync()
    thread {
      try {
        follow(context, zone)
      } catch (failure: Exception) {
        Log.w(TAG, "The reminders could not follow the time zone", failure)
      } finally {
        pending.finish()
      }
    }
  }

  private fun follow(context: Context, zone: TimeZone) {
    val scheduling = ExpoSchedulingDelegate(context)
    val wallClock = SimpleDateFormat(WALL_CLOCK, Locale.ROOT).apply { timeZone = zone }
    val now = System.currentTimeMillis()
    for (request in scheduling.getAllScheduledNotifications()) {
      // One at a time: a reminder that cannot move must not keep the rest where they were.
      try {
        val trigger = request.trigger as? DateTrigger ?: continue
        val at = request.content.body?.optString(WALL_CLOCK_KEY).orEmpty()
        if (at.isEmpty()) {
          continue
        }
        val moment = wallClock.parse(at)?.time ?: continue
        // Its time in the new zone is over -- a flight east may land after it: left where it was,
        // it still comes, late, rather than not at all, which is what expo makes of a past moment.
        if (moment == trigger.timestamp || moment <= now) {
          continue
        }
        // The app may have replaced or cleared its reminders meanwhile -- a sign-out, a new load --
        // and one it took away must not come back. Expo's own service does that on another thread,
        // so this narrows the window rather than closing it; the app's next replacement settles it.
        if (scheduling.getScheduledNotification(request.identifier) == null) {
          continue
        }
        scheduling.scheduleNotification(NotificationRequest(request.identifier, request.content, DateTrigger(trigger.channelId, moment)))
      } catch (failure: Exception) {
        Log.w(TAG, "Reminder ${request.identifier} could not follow the time zone", failure)
      }
    }
  }

  private companion object {
    const val TAG = "TaskFestReminders"
    /** The key in a reminder's data, and its format, as `mobile/src/notifications.ts` writes them. */
    const val WALL_CLOCK_KEY = "wallClock"
    const val WALL_CLOCK = "yyyy-MM-dd'T'HH:mm"
  }
}
