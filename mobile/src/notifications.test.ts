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
    createChannel: jest.fn().mockResolvedValue(undefined),
  } satisfies NotificationsApi
}

const CHANNEL = 'Due today'
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
    expect(api.createChannel).toHaveBeenCalledWith('reminders', 'Due today')
    expect(api.requestPermissionsAsync).toHaveBeenCalled()
  })

  it('replaces whatever was scheduled with the new reminders', async () => {
    const api = platform(granted)
    const at = new Date(2026, 9, 11, 8, 0)

    await createReminderScheduler(api, memoryFile(), CHANNEL).replace([{ at, title: '2 tasks due today' }])

    expect(api.cancelAllScheduledNotificationsAsync).toHaveBeenCalled()
    expect(api.scheduleNotificationAsync).toHaveBeenCalledWith({
      content: { title: '2 tasks due today' },
      trigger: { date: at, channelId: 'reminders' },
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

  it('reads a refusal as one even while Android would ask again', async () => {
    const refusedOnce = { granted: false, canAskAgain: true, status: 'denied' }

    await expect(createReminderScheduler(platform(refusedOnce), memoryFile(), CHANNEL).permission()).resolves.toBe('denied')
  })

  it('replaces one set at a time, so overlapping calls never leave two behind', async () => {
    const log: string[] = []
    const api = platform(granted)
    api.cancelAllScheduledNotificationsAsync.mockImplementation(async () => void log.push('cancel'))
    api.scheduleNotificationAsync.mockImplementation(async (request: { content: { title: string } }) => {
      await Promise.resolve()
      log.push(request.content.title)
      return 'id'
    })
    const scheduler = createReminderScheduler(api, memoryFile(), CHANNEL)
    const at = new Date(2026, 9, 11, 8, 0)

    await Promise.all([scheduler.replace([{ at, title: 'A' }]), scheduler.replace([{ at, title: 'B' }])])

    expect(log).toEqual(['cancel', 'A', 'cancel', 'B'])
  })

  it('leaves the reminders alone when they have not changed', async () => {
    const api = platform(granted)
    const scheduler = createReminderScheduler(api, memoryFile(), CHANNEL)
    const reminders = [{ at: new Date(2026, 9, 11, 8, 0), title: '2 tasks due today' }]

    await scheduler.replace(reminders)
    await scheduler.replace([...reminders])

    expect(api.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1)
    expect(api.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })

  it('schedules the same reminders once they are allowed', async () => {
    const api = platform(notAsked)
    const scheduler = createReminderScheduler(api, memoryFile(), CHANNEL)
    const reminders = [{ at: new Date(2026, 9, 11, 8, 0), title: '2 tasks due today' }]

    await scheduler.replace(reminders)
    api.getPermissionsAsync.mockResolvedValue(granted)
    await scheduler.replace(reminders)

    expect(api.scheduleNotificationAsync).toHaveBeenCalledTimes(1)
  })
})
