import type { ThemeSetting } from '../../../shared/types'

export function resolveTheme(setting: ThemeSetting, systemDark: boolean): 'light' | 'dark' {
  if (setting === 'system') return systemDark ? 'dark' : 'light'
  return setting
}
