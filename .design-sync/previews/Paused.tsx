import { Paused } from 'frontend'

/** Shown instead of sign-in while an environment is stopped to save money. */
export function Named() {
  return <Paused environmentName="QA" />
}

/** A deployment that gives its environment no name. */
export function Unnamed() {
  return <Paused environmentName={null} />
}
