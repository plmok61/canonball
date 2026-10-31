const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** Links the app may hand to the system browser or mail client. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}
