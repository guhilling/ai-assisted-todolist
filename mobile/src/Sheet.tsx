import { useContext, type ReactNode } from 'react'
import { Modal, Platform, View } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import type { Styles } from './styles'

/**
 * A sheet over the board: the form, and the account (#275). iOS shows one below the status bar.
 * On Android it fills the screen, drawn edge to edge, so its content starts below the status bar
 * by itself (#662) -- the app's own safe area ends where a modal begins.
 */
export function Sheet({
  testID,
  visible,
  styles,
  onRequestClose,
  children,
}: {
  testID: string
  visible: boolean
  styles: Styles
  /** The system asked to close it: Android's Back, or a swipe down on iOS. */
  onRequestClose: () => void
  children: ReactNode
}) {
  const statusBar = useContext(SafeAreaInsetsContext)?.top ?? 0
  return (
    <Modal testID={testID} visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onRequestClose}>
      <View testID={`${testID}-content`} style={[styles.formScreen, { paddingTop: Platform.OS === 'android' ? statusBar : 0 }]}>
        {children}
      </View>
    </Modal>
  )
}
