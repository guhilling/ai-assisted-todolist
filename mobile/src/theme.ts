/**
 * The website's colours, light and dark, for the app (#267).
 *
 * They live in `frontend/src/App.css` as custom properties, which React Native cannot read, so
 * they are repeated here -- and `theme.test.ts` compares the two, so a colour changed on one side
 * only fails the build instead of the app quietly drifting from the website.
 */
export type Theme = {
  bg: string
  surfaceRaised: string
  border: string
  text: string
  textMuted: string
  accent: string
  accentContrast: string
  brandStrong: string
  danger: string
  importanceLow: string
  importanceMedium: string
  importanceHigh: string
}

export const light: Theme = {
  bg: '#ffffff',
  surfaceRaised: '#f2f2f2',
  border: '#f2f2f2',
  text: '#111111',
  textMuted: '#656565',
  accent: '#0067a6',
  accentContrast: '#ffffff',
  brandStrong: '#58791d',
  danger: '#b42318',
  importanceLow: '#656565',
  importanceMedium: '#0067a6',
  importanceHigh: '#b42318',
}

export const dark: Theme = {
  bg: '#111111',
  surfaceRaised: '#2d2d2d',
  border: '#2d2d2d',
  text: '#f2f2f2',
  textMuted: '#a9a9a9',
  accent: '#a6d8f5',
  accentContrast: '#111111',
  brandStrong: '#7eae2a',
  danger: '#f04438',
  importanceLow: '#a9a9a9',
  importanceMedium: '#a6d8f5',
  importanceHigh: '#f04438',
}
