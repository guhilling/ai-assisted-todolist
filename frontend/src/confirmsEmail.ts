/**
 * Whether what was typed confirms deleting the account (#213): the signed-in address, in any case
 * and with any spaces around it -- they are not what makes the address someone's own. Its own
 * module so the app's confirmation (#275) uses the same rule rather than a copy.
 */
export function confirmsEmail(typed: string, email: string) {
  return typed.trim().toLowerCase() === email.trim().toLowerCase()
}
