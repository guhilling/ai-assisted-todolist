import { Slot } from 'expo-router'

/** One screen for now, so no navigator: the app decides itself between sign-in and the board. */
export default function Layout() {
  return <Slot />
}
