import type { ThemeSetting } from '../../../shared/types'

const OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Match System' }
]

export function ThemePicker({
  value,
  onChange
}: {
  value: ThemeSetting
  onChange(next: ThemeSetting): void
}): React.JSX.Element {
  return (
    <div className="cb-theme-picker" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
