import { useCallback, useEffect, useState } from 'react'
import type { ThemeSetting } from '../../../shared/types'
import { resolveTheme } from './resolveTheme'

const QUERY = '(prefers-color-scheme: dark)'

function systemQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null
}

/** Paint the OS preference immediately, before stored settings load, to avoid a flash. */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = resolveTheme('system', systemQuery()?.matches ?? false)
}

export function useTheme(): { theme: ThemeSetting; setTheme(next: ThemeSetting): void } {
  const [theme, setThemeState] = useState<ThemeSetting>('system')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.canonball
      .getSettings()
      .then((s) => {
        if (cancelled) return
        setThemeState(s.theme)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    // Until the stored setting loads, keep the synchronous default already applied.
    if (!loaded) return
    const mq = systemQuery()
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(theme, mq?.matches ?? false)
    }
    apply()
    if (theme !== 'system' || !mq) return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme, loaded])

  const setTheme = useCallback((next: ThemeSetting): void => {
    setThemeState(next)
    setLoaded(true)
    window.canonball.setSettings({ theme: next }).catch(() => {
      // the in-memory choice still applies for this session
    })
  }, [])

  return { theme, setTheme }
}
