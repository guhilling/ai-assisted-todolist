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
    for (request in scheduling.allScheduledNotifications) {
      val trigger = request.trigger as? DateTrigger ?: continue
      val at = request.content.body?.optString(WALL_CLOCK_KEY).orEmpty()
      if (at.isEmpty()) {
        continue
      }
      val moment = wallClock.parse(at)?.time ?: continue
      if (moment != trigger.timestamp) {
        scheduling.scheduleNotification(NotificationRequest(request.identifier, request.content, DateTrigger(trigger.channelId, moment)))
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
