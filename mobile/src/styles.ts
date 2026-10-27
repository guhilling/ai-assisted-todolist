import { StyleSheet } from 'react-native'
import type { Theme } from './theme'
import { googleSignInButton } from './web'

/** The app's styles in one theme's colours: one set for every screen, made once per theme. */
export function stylesFor(theme: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.bg, paddingHorizontal: 16 },
    signedOut: { flex: 1, justifyContent: 'center', gap: 16 },
    title: { fontSize: 32, fontWeight: '700', color: theme.brandStrong },
    muted: { color: theme.textMuted },
    notice: { color: theme.danger },
    button: { backgroundColor: theme.accent, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16 },
    buttonText: { color: theme.accentContrast, fontWeight: '600', textAlign: 'center' },
    // Google's button is its image, rounded as Google draws it, at its own size (#325).
    googleButton: { alignSelf: 'center', borderRadius: 20, overflow: 'hidden' },
    googleImage: { width: googleSignInButton.width, height: googleSignInButton.height },
    // A task's files (#274): on its row as the website's 64 px previews, in the editor as a list.
    // Indented as far as the row's description, past its tick and importance dot.
    fileStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingLeft: 48 },
    fileName: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 200 },
    preview: { width: 64, height: 64, borderRadius: 6 },
    previewLoading: { backgroundColor: theme.border },
    viewer: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', paddingVertical: 48 },
    viewedImage: { flex: 1, width: '100%' },
    editorFile: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pressed: { opacity: 0.7 },
    quietButton: { borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16 },
    quietButtonText: { color: theme.accent, fontWeight: '600', textAlign: 'center' },
    dangerText: { color: theme.danger, fontWeight: '600', textAlign: 'center' },
    disabled: { opacity: 0.5 },
    board: { flex: 1 },
    boardContent: { paddingVertical: 16, gap: 24 },
    section: { gap: 8 },
    sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    heading: { fontSize: 18, fontWeight: '700', color: theme.text },
    /** A section's heading and the weekday beside it (#337). */
    headingLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    headingWeekday: { fontSize: 15, color: theme.textMuted },
    overdue: { color: theme.danger },
    // A task's row, and its files below it (#274), between one line and the next.
    rowWithFiles: {
      gap: 6,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    rowBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: theme.textMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // The website's checkbox is ticked in --brand-strong.
    checked: { backgroundColor: theme.brandStrong, borderColor: theme.brandStrong },
    tick: { color: theme.accentContrast, fontSize: 14, fontWeight: 'bold', lineHeight: 16 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    // As on the website, told apart by fill as well as colour (#335): hollow, solid, ringed.
    importanceLOW: { borderWidth: 2, borderColor: theme.importanceLow },
    importanceMEDIUM: { backgroundColor: theme.importanceMedium },
    importanceHIGH: { backgroundColor: theme.importanceHigh, boxShadow: `0 0 0 2px ${theme.importanceHigh}4D` },
    unknownDot: { borderWidth: 1, borderColor: theme.textMuted },
    description: { flex: 1, color: theme.text },
    done: { color: theme.textMuted, textDecorationLine: 'line-through' },
    footer: { paddingVertical: 8, gap: 8 },
    undo: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.surfaceRaised,
      borderRadius: 6,
      paddingLeft: 16,
    },
    formScreen: { flex: 1, backgroundColor: theme.bg },
    form: { padding: 16, gap: 16 },
    formTitle: { fontSize: 20, fontWeight: '700', color: theme.text },
    label: { color: theme.textMuted, fontWeight: '600' },
    input: {
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 6,
      padding: 12,
      color: theme.text,
      backgroundColor: theme.surfaceRaised,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { borderWidth: 1, borderColor: theme.border, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 },
    chipActive: { backgroundColor: theme.accent, borderColor: theme.accent },
    chipText: { color: theme.text },
    chipTextActive: { color: theme.accentContrast },
    formButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    formFields: { flex: 1 },
    // The form's buttons, below its fields and above the keyboard (#382).
    formFooter: { padding: 16, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
    // The brand, and the documentation and the account beside it: these wrap below the brand
    // rather than leave the screen, in German or with large text on a narrow phone.
    boardHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
    headActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginLeft: 'auto' },
    // The sign-in's link to the documentation, at its top right as on the board (#384); laid over
    // the screen, so the sign-in below stays centred on it.
    signedOutHead: { position: 'absolute', top: 8, right: 0, zIndex: 1 },
    brand: { fontSize: 20, fontWeight: '700', color: theme.brandStrong },
    account: { gap: 8 },
    dangerButton: { borderWidth: 1, borderColor: theme.danger, borderRadius: 6, paddingVertical: 12, paddingHorizontal: 16 },
    offerButtons: { flexDirection: 'row', justifyContent: 'flex-end' },
    /** What the colours mean (#335): the offline note's box, with room on both sides. */
    legend: { backgroundColor: theme.surfaceRaised, borderRadius: 6, paddingHorizontal: 16, gap: 4, paddingTop: 12 },
    /** An overdue date on a row: the website's `.task-due--overdue` (#335). */
    overdueDate: { color: theme.danger, fontWeight: '600' },
    /** An importance dot inline in the legend's text, sat on its line. */
    legendDot: { marginBottom: 1 },
    offline: { backgroundColor: theme.surfaceRaised, borderRadius: 6, paddingLeft: 16, gap: 4, paddingTop: 12 },
    /** The reminders' offer: the offline note's box, with room on the right for its wrapped explanation (#336). */
    offer: { backgroundColor: theme.surfaceRaised, borderRadius: 6, paddingHorizontal: 16, gap: 4, paddingTop: 12 },
    confirm: { backgroundColor: theme.surfaceRaised, borderRadius: 6, padding: 16, gap: 12 },
    // Stacked: side by side, the two answers do not fit a phone's width.
    confirmButtons: { gap: 8 },
    legal: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', columnGap: 16, rowGap: 4 },
    legalLink: { color: theme.accent, paddingVertical: 8 },
  })
}

/** The styles every screen is handed. */
export type Styles = ReturnType<typeof stylesFor>
