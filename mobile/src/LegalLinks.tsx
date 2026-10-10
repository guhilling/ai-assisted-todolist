import { Linking, Pressable, Text, View } from 'react-native'
import type { Styles } from './styles'
import { imprintUrl, privacyUrls, termsUrls, type Language, type Messages } from './web'

/**
 * The website's legal footer, for the app (#275): the imprint, the privacy policy and the terms,
 * each the published page opened in the browser, and which release this is.
 *
 * On the sign-in and in the account sheet, so the pages are one tap away before signing in as well
 * as after -- the stores ask for the privacy policy to be reachable from inside the app.
 */
export function LegalLinks({
  language,
  messages,
  styles,
  appVersion,
}: {
  language: Language
  messages: Messages
  styles: Styles
  /** This build's release; 0.0.0 is a development build. */
  appVersion: string
}) {
  const link = (label: string, url: string) => (
    <Pressable key={label} accessibilityRole="link" onPress={() => void Linking.openURL(url)}>
      <Text style={styles.legalLink}>{label}</Text>
    </Pressable>
  )

  return (
    <View testID="legal" style={styles.legal}>
      {link(messages.footer.imprint, imprintUrl)}
      {link(messages.footer.privacy, privacyUrls[language])}
      {link(messages.footer.terms, termsUrls[language])}
      <Text style={styles.muted}>
        {appVersion === '0.0.0' ? messages.footer.developmentBuild : messages.footer.version(appVersion)}
      </Text>
    </View>
  )
}
