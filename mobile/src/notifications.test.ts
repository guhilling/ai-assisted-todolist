import type { TextFile } from './keptBoard'
import { createReminderScheduler, type NotificationsApi } from './notifications'

function memoryFile(): TextFile {
  let content: string | undefined
  return {
    get exists() {
      return content !== undefined
    },
    text: async () => content ?? '',
    write: (text) => void (content = text),
    delete: () => void (content = undefined),
  }
}

function platform(permission: { granted: boolean; canAskAgain: boolean; status: string }, answer = permission) {
  return {
    getPermissionsAsync: jest.fn().mockResolvedValue(permission),
    requestPermissionsAsync: jest.fn().mockResolvedValue(answer),
    cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
    scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  } satisfies NotificationsApi
}

const CHANNEL = { name: 'Due today', importance: 5 }
const notAsked = { granted: false, canAskAgain: true, status: 'undetermined' }
const granted = { granted: true, canAskAgain: true, status: 'granted' }
const refused = { granted: false, canAskAgain: false, status: 'denied' }

describe('the reminders, as the platform keeps them (#273)', () => {
  it('says whether reminders may be shown, may be asked for, or were refused', async () => {
    await expect(createReminderScheduler(platform(granted), memoryFile(), CHANNEL).permission()).resolves.toBe('granted')
    await expect(createReminderScheduler(platform(notAsked), memoryFile(), CHANNEL).permission()).resolves.toBe(
      'undetermined',
    )
    await expect(createReminderScheduler(platform(refused), memoryFile(), CHANNEL).permission()).resolves.toBe('denied')
  })

  it('asks the platform, with a channel for Android to name them by', async () => {
    const api = platform(notAsked, granted)

    await expect(createReminderScheduler(api, memoryFile(), CHANNEL).ask()).resolves.toBe(true)
    expect(api.setNotificationChannelAsync).toHaveBeenCalledWith('reminders', CHANNEL)
    expect(api.requestPermissionsAsync).toHaveBeenCalled()
  })

  it('replaces whatever was scheduled with the new reminders', async () => {
    const api = platform(granted)
    const at = new Date(2026, 9, 11, 8, 0)

    await createReminderScheduler(api, memoryFile(), CHANNEL).replace([{ at, title: '2 tasks due today' }])

    expect(api.cancelAllScheduledNotificationsAsync).toHaveBeenCalled()
    expect(api.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: '2 tasks due today' },
      trigger: { type: 'date', date: at, channelId: 'reminders' },
    })
  })

  it('schedules nothing without permission, but still clears what was there', async () => {
    const api = platform(refused)

    await createReminderScheduler(api, memoryFile(), CHANNEL).replace([{ at: new Date(), title: '1 task due today' }])

    expect(api.cancelAllScheduledNotificationsAsync).toHaveBeenCalled()
    expect(api.scheduleNotificationAsync).not.toHaveBeenCalled()
  })

  it('remembers that the offer was declined', async () => {
    const file = memoryFile()
    const scheduler = createReminderScheduler(platform(notAsked), file, CHANNEL)

    await expect(scheduler.declined()).resolves.toBe(false)
    await scheduler.decline()

    await expect(createReminderScheduler(platform(notAsked), file, CHANNEL).declined()).resolves.toBe(true)
  })
})
