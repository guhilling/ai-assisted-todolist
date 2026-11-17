import { AppleAuthenticationButton, AppleAuthenticationButtonStyle, AppleAuthenticationButtonType } from 'expo-apple-authentication'
import { googleSignInButton } from './web'

/**
 * Apple's own sign-in button (#281), drawn by iOS in the phone's language, as the website shows
 * Apple's images: white with an outline in light mode, white without one in dark mode, where Apple
 * forbids its black button on the website's dark page. As large as Google's beside it, as Apple's
 * rules ask, and with Apple's standard corners, as Gunnar chose for the website.
 */
export function AppleButton({ darkMode, onPress }: Readonly<{ darkMode: boolean; onPress: () => void }>) {
  return (
    <AppleAuthenticationButton
      testID="apple-sign-in"
      buttonType={AppleAuthenticationButtonType.SIGN_IN}
      buttonStyle={darkMode ? AppleAuthenticationButtonStyle.WHITE : AppleAuthenticationButtonStyle.WHITE_OUTLINE}
      style={{ alignSelf: 'center', width: googleSignInButton.width, height: googleSignInButton.height }}
      onPress={onPress}
    />
  )
}
