import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform, StyleSheet, Text } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { Sheet } from './Sheet'
import { stylesFor } from './styles'
import { light } from './theme'

const insets = { top: 47, bottom: 34, left: 0, right: 0 }

function sheet(onRequestClose = jest.fn()) {
  return (
    <SafeAreaProvider initialMetrics={{ insets, frame: { x: 0, y: 0, width: 390, height: 844 } }}>
      <Sheet testID="sheet" visible styles={stylesFor(light)} onRequestClose={onRequestClose}>
        <Text>Inside</Text>
      </Sheet>
    </SafeAreaProvider>
  )
}

/** How far below the sheet's top its content begins. */
function contentTop() {
  return StyleSheet.flatten(screen.getByTestId('sheet-content').props.style).paddingTop
}

describe('a sheet over the board (#662)', () => {
  afterEach(() => jest.restoreAllMocks())

  it('begins below the status bar on Android, whose sheets fill the screen', async () => {
    jest.replaceProperty(Platform, 'OS', 'android')
    await render(sheet())

    expect(contentTop()).toBe(insets.top)
  })

  it('begins at its own top on iOS, which shows it below the status bar', async () => {
    await render(sheet())

    expect(contentTop()).toBe(0)
  })

  it('asks to be closed', async () => {
    const onRequestClose = jest.fn()
    await render(sheet(onRequestClose))

    await fireEvent(screen.getByTestId('sheet'), 'requestClose')

    expect(onRequestClose).toHaveBeenCalled()
  })
})
