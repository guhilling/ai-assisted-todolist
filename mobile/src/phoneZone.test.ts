import { getCalendars } from 'expo-localization'
import { phoneZone } from './phoneZone'

jest.mock('expo-localization', () => ({ getCalendars: jest.fn() }))

const calendars = getCalendars as jest.Mock

describe("the phone's time zone (#477)", () => {
  it('is the zone the platform names, under whichever name it uses', () => {
    calendars.mockReturnValue([{ timeZone: 'Asia/Kolkata' }])
    expect(phoneZone()).toBe('Asia/Kolkata')
  })

  it('is UTC where the platform names a fixed offset, which the backend refuses, or none', () => {
    calendars.mockReturnValue([{ timeZone: 'GMT+1' }])
    expect(phoneZone()).toBe('UTC')
    calendars.mockReturnValue([{ timeZone: null }])
    expect(phoneZone()).toBe('UTC')
  })
})
