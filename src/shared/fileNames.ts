import type { EntryKind, Move } from './types'

/** Why `name` can't be used for a new file or folder, or null when it can. */
export function nameError(name: string): string | null {
  if (name === '') return 'Enter a name.'
  if (name.startsWith('.')) return "Names can't start with a dot."
  if (name.includes('/') || name.includes(':')) return "Names can't contain / or :."
  if (name === 'node_modules') return 'That name is reserved.'
  return null
}

/**
 * Ends the name in lower-case `.md`: adds it when missing and lower-cases one
 * typed in any case ("Notes.MD" becomes "Notes.md"), since the tree lists only
 * `.md` files.
 */
export function withMd(name: string): string {
  return (/\.md$/i.test(name) ? name.slice(0, -3) : name) + '.md'
}

/** `name` if free, else the first of `<base> copy`, `<base> copy 2`, ... that is. */
export function copyName(
  name: string,
  kind: EntryKind,
  taken: (candidate: string) => boolean
): string {
  if (!taken(name)) return name
  const ext = kind === 'file' && /\.md$/i.test(name) ? name.slice(-3) : ''
  const base = ext ? name.slice(0, -3) : name
  for (let n = 1; ; n++) {
    const candidate = `${base} copy${n === 1 ? '' : ` ${n}`}${ext}`
    if (!taken(candidate)) return candidate
  }
}

/** True when `path` is `base` or lies under it, matching whole segments. */
export function isAtOrUnder(path: string, base: string): boolean {
  return path === base || path.startsWith(base + '/')
}

export function remapPath(path: string, move: Move): string {
  return isAtOrUnder(path, move.from) ? move.to + path.slice(move.from.length) : path
}

/** Drops entries lying under another entry, keeping order. */
export function topmost(paths: string[]): string[] {
  return paths.filter((p) => !paths.some((other) => other !== p && isAtOrUnder(p, other)))
}
