/**
 * hilling.it's faces (#527), as on the website: Quicksand for the wordmark, Space Grotesk for
 * headings, Inter Tight for text. Static fonts embedded by expo-font (`assets/fonts/`), named by
 * their PostScript names, one per weight: such a face is chosen by its name, never by `fontWeight`,
 * which Android would otherwise fake.
 */
export const font = {
  brand: 'Quicksand-Bold',
  heading: 'SpaceGrotesk-Bold',
  text: 'InterTight-Regular',
  strong: 'InterTight-SemiBold',
} as const

/** The files `app.config.ts` embeds: one per face above, so none can be named but not embedded. */
export const fontFiles = Object.values(font).map((name) => `./assets/fonts/${name}.ttf`)
