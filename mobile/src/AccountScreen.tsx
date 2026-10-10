import { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { LegalLinks } from './LegalLinks'
import type { Styles } from './styles'
import type { Theme } from './theme'
import type { Language, Messages } from './web'

/**
 * The account sheet (#275): who is signed in, signing out, deleting the account, and the legal
 * pages with the release -- what the website keeps in its header and footer.
 *
 * Deleting asks first, as the website does, in the website's words: the delete button stays
 * disabled until the signed-in address is typed, in any case and with any spaces around it, so two
 * taps in a row can never delete an account. A refused delete closes the question again and says
 * why; whoever shows the sheet signs out once `onDelete` says the account is gone.
 */
export function AccountScreen({
  email,
  language,
  messages,
  styles,
  theme,
  appVersion,
  failure,
  onSignOut,
  onDelete,
  onDone,
}: {
  /** The signed-in address, or null when the token names none: then nothing can be typed to match. */
  email: string | null
  language: Language
  messages: Messages
  styles: Styles
  theme: Theme
  appVersion: string
  /** What went wrong with the last delete, in the user's language. */
  failure?: string
  onSignOut: () => void
  /** Deletes the account; true once it is gone. */
  onDelete: () => Promise<boolean>
  onDone: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')
  const confirmed = email !== null && typed.trim().toLowerCase() === email.trim().toLowerCase()

  const keep = () => {
    setTyped('')
    setAsking(false)
  }

  const remove = async () => {
    setDeleting(true)
    if (!(await onDelete())) {
      setDeleting(false)
      keep()
    }
  }

  return (
    <ScrollView style={styles.formScreen} contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      <View style={styles.sectionHead}>
        <Text style={styles.formTitle}>{messages.account.open}</Text>
        <Pressable accessibilityRole="button" style={styles.quietButton} onPress={onDone}>
          <Text style={styles.quietButtonText}>{messages.account.done}</Text>
        </Pressable>
      </View>
      {email ? <Text style={styles.muted}>{messages.account.signedInAs(email)}</Text> : null}
      {failure ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {failure}
        </Text>
      ) : null}

      <View style={styles.account}>
        <Pressable accessibilityRole="button" style={styles.button} onPress={onSignOut}>
          <Text style={styles.buttonText}>{messages.app.signOut}</Text>
        </Pressable>
        {asking ? (
          <View accessibilityRole="alert" style={styles.confirm}>
            <Text style={styles.heading}>{messages.account.title}</Text>
            <Text style={styles.description}>{messages.account.body}</Text>
            <Text style={styles.label}>{messages.account.typeEmail}</Text>
            <TextInput
              style={styles.input}
              accessibilityLabel={messages.account.typeEmail}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              autoFocus
              keyboardType="email-address"
              placeholderTextColor={theme.textMuted}
              value={typed}
              onChangeText={setTyped}
            />
            <View style={styles.formButtons}>
              <Pressable accessibilityRole="button" style={styles.quietButton} onPress={keep}>
                <Text style={styles.quietButtonText}>{messages.account.keep}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: deleting || !confirmed }}
                disabled={deleting || !confirmed}
                style={[styles.dangerButton, (deleting || !confirmed) && styles.disabled]}
                onPress={() => void remove()}
              >
                <Text style={styles.dangerText}>{deleting ? messages.account.deleting : messages.account.confirm}</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable accessibilityRole="button" style={styles.quietButton} onPress={() => setAsking(true)}>
            <Text style={styles.dangerText}>{messages.account.delete}</Text>
          </Pressable>
        )}
      </View>

      <LegalLinks language={language} messages={messages} styles={styles} appVersion={appVersion} />
    </ScrollView>
  )
}
