import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CLOUD_PROVIDERS,
  PROVIDER_LABEL,
  type AiStatus,
  type CloudProvider,
  type ModelList,
  type ProviderId
} from '../../../shared/ai'

interface Props {
  onClose(): void
  /** Called after every successful change to a connection. */
  onChanged(): void
}

const NO_KEYCHAIN = "This Mac's Keychain isn't available, so API keys can't be saved."
const CHECK_ORDER: ProviderId[] = [...CLOUD_PROVIDERS, 'local']

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function checkLines(list: ModelList): string[] {
  const lines: string[] = []
  for (const p of CHECK_ORDER) {
    const err = list.errors.find((e) => e.provider === p)
    if (err) {
      lines.push(`${PROVIDER_LABEL[p]}: ${err.message}`)
      continue
    }
    const n = list.models.filter((m) => m.provider === p).length
    if (n > 0) lines.push(`${PROVIDER_LABEL[p]}: ${n} ${n === 1 ? 'model' : 'models'}`)
  }
  return lines
}

export function SettingsDialog({ onClose, onChanged }: Props): React.JSX.Element {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [check, setCheck] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [keys, setKeys] = useState<Record<CloudProvider, string>>({
    anthropic: '',
    openai: '',
    google: ''
  })
  const [url, setUrl] = useState('')
  const doneRef = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)

  const runCheck = useCallback((): void => {
    window.canonball
      .listModels()
      .then((list) => {
        if (alive.current) setCheck(checkLines(list))
      })
      .catch((e) => {
        if (alive.current) setCheck([message(e)])
      })
  }, [])

  useEffect(() => {
    alive.current = true
    window.canonball
      .getAiStatus()
      .then((s) => {
        if (!alive.current) return
        setStatus(s)
        setUrl(s.localUrl ?? '')
      })
      .catch((e) => {
        if (alive.current) setError(message(e))
      })
    runCheck()
    return () => {
      alive.current = false
    }
  }, [runCheck])

  useEffect(() => {
    doneRef.current?.focus()
  }, [])

  const apply = async (
    change: () => Promise<AiStatus>,
    after?: (s: AiStatus) => void
  ): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const next = await change()
      if (!alive.current) return
      setStatus(next)
      after?.(next)
      onChanged()
      setCheck(null)
      runCheck()
    } catch (e) {
      if (alive.current) setError(message(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const keysDisabled = status !== null && !status.encryptionAvailable

  return (
    <div className="cb-dialog-overlay">
      <div
        className="cb-dialog cb-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cb-settings-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Tab') {
            const els = e.currentTarget.querySelectorAll<HTMLElement>(
              'input:not([disabled]), button:not([disabled])'
            )
            if (els.length === 0) return
            const first = els[0]
            const last = els[els.length - 1]
            if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault()
              first.focus()
            } else if (e.shiftKey && document.activeElement === first) {
              e.preventDefault()
              last.focus()
            }
          }
        }}
      >
        <h2 id="cb-settings-title">AI connections</h2>
        <div className="cb-dialog-list">
          {keysDisabled && <p>{NO_KEYCHAIN}</p>}
          {CLOUD_PROVIDERS.map((p) => {
            const label = PROVIDER_LABEL[p]
            const isSet = status?.keys[p] ?? false
            return (
              <section key={p} className="cb-settings-row">
                <h3>{label}</h3>
                <span className="cb-settings-status">
                  {isSet ? 'Saved in Keychain' : 'Not set'}
                </span>
                <div className="cb-settings-controls">
                  <input
                    type="password"
                    aria-label={`${label} API key`}
                    placeholder="Paste API key"
                    autoComplete="off"
                    disabled={keysDisabled}
                    value={keys[p]}
                    onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))}
                  />
                  <button
                    type="button"
                    disabled={busy || keysDisabled || keys[p] === ''}
                    onClick={() =>
                      void apply(
                        () => window.canonball.setApiKey(p, keys[p]),
                        () => setKeys((k) => ({ ...k, [p]: '' }))
                      )
                    }
                  >
                    Save
                  </button>
                  {isSet && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void apply(() => window.canonball.setApiKey(p, null))}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </section>
            )
          })}
          <section className="cb-settings-row">
            <h3>{PROVIDER_LABEL.local}</h3>
            <span className="cb-settings-status">{status?.localUrl ? 'Saved' : 'Not set'}</span>
            <div className="cb-settings-controls">
              <input
                type="text"
                aria-label="Local server URL"
                placeholder="http://localhost:11434"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || url.trim() === ''}
                onClick={() => void apply(() => window.canonball.setLocalUrl(url))}
              >
                Save
              </button>
              {status?.localUrl && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void apply(
                      () => window.canonball.setLocalUrl(null),
                      () => setUrl('')
                    )
                  }
                >
                  Remove
                </button>
              )}
            </div>
          </section>
          <h3>Connection check</h3>
          {check === null ? (
            <p>Checking…</p>
          ) : check.length === 0 ? (
            <p>Nothing connected yet.</p>
          ) : (
            <ul className="cb-settings-check">
              {check.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
        {error && (
          <p role="alert" className="cb-dialog-error">
            {error}
          </p>
        )}
        <div className="cb-dialog-actions">
          <button ref={doneRef} type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
