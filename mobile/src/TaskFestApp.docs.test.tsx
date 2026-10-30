import { render, screen, userEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { TaskFestApp, type Dependencies } from './TaskFestApp'
import { dependencies as appDependencies, memorySessions, session, water } from './testing'
import { variants } from './variants'
import type { Language } from './web'

// The link to the documentation, at the top of the app (#384): the page the website's footer links
// as "About", signed in and signed out.

const PURPOSE = 'https://taskfest-docs.cloud.hilling.de/doc/purpose.html'

function dependencies(signedIn: boolean): Dependencies {
  return appDependencies({ sessions: memorySessions(signedIn ? session : null), fetchTasks: jest.fn().mockResolvedValue([water]) })
}

async function start(signedIn: boolean, language: Language = 'en') {
  await render(<TaskFestApp variant={variants.dev} language={language} dependencies={dependencies(signedIn)} />)
  await screen.findByText(signedIn ? 'Water the plants' : 'Sign in with Keycloak')
}

// jest-expo's Linking is a mock already, which outlives each test's calls unless they are cleared.
beforeEach(() => {
  jest.spyOn(Linking, 'openURL').mockClear().mockResolvedValue(true)
})

describe('the link to the documentation (#384)', () => {
  it('opens the documentation from the top of the board', async () => {
    await start(true)

    await userEvent.setup().press(screen.getByRole('link', { name: 'About ↗' }))

    expect(Linking.openURL).toHaveBeenCalledWith(PURPOSE)
  })

  it('opens it before signing in, too', async () => {
    await start(false)

    await userEvent.setup().press(screen.getByRole('link', { name: 'About ↗' }))

    expect(Linking.openURL).toHaveBeenCalledWith(PURPOSE)
  })

  it('says so in German', async () => {
    await start(true, 'de')

    expect(screen.getByRole('link', { name: 'Über das Projekt ↗' })).toBeOnTheScreen()
  })
})
