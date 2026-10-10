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
  surfaceRaised: '#f6f8fa',
  border: '#e2e6ea',
  text: '#1a1f24',
  textMuted: '#5b6672',
  accent: '#0367a5',
  accentContrast: '#ffffff',
  brandStrong: '#4d7a0a',
  danger: '#c5221f',
  importanceLow: '#9aa5b1',
  importanceMedium: '#0367a5',
  importanceHigh: '#c5221f',
}

export const dark: Theme = {
  bg: '#14181c',
  surfaceRaised: '#1e242a',
  border: '#2c343c',
  text: '#e6eaee',
  textMuted: '#9aa5b1',
  accent: '#5ba3d9',
  accentContrast: '#14181c',
  brandStrong: '#9fd04a',
  danger: '#f28b82',
  importanceLow: '#6b7681',
  importanceMedium: '#5ba3d9',
  importanceHigh: '#f28b82',
}
