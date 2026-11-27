import { Component, type ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { Styles } from './styles'
import type { Messages } from './web'

type Props = {
  messages: Messages
  styles: Styles
  /** Before the board is drawn again: closes what was open over it, which may be what broke. */
  onRetry: () => void
  children: ReactNode
}

/**
 * What stands in for the board, its sheets and its viewer when one of them throws while drawn
 * (#687): a message and Try again, instead of the end of the app, as v1.8.1's BigInt progress
 * brought (#682). The session is held above it, so it survives.
 *
 * Only errors while drawing are caught, as with any React error boundary: one in a button's
 * handler, a timer or a promise is not. A class, since React has no hook for catching them.
 */
export class BoardBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    const { messages, styles, onRetry, children } = this.props
    if (!this.state.failed) {
      return children
    }
    return (
      <View style={styles.signedOut}>
        <Text style={styles.notice}>{messages.board.drawFailed}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            onRetry()
            this.setState({ failed: false })
          }}
        >
          <Text style={styles.buttonText}>{messages.board.retry}</Text>
        </Pressable>
      </View>
    )
  }
}
