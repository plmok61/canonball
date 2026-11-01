import {
  CLOUD_PROVIDERS,
  PROVIDER_LABEL,
  type AiStatus,
  type ChatSummary,
  type ModelChoice,
  type ModelList,
  type ProviderId
} from '../../../shared/ai'

interface Props {
  status: AiStatus | null
  models: ModelList | null
  summaries: ChatSummary[]
  threadValue: string
  busy: boolean
  onChooseModel(value: string): void
  onChooseThread(id: string): void
  onOpenSettings(): void
}

const PROVIDER_ORDER: ProviderId[] = [...CLOUD_PROVIDERS, 'local']

const choiceValue = (c: ModelChoice): string => `${c.provider}:${c.model}`

export function ChatHeader({
  status,
  models,
  summaries,
  threadValue,
  busy,
  onChooseModel,
  onChooseThread,
  onOpenSettings
}: Props): React.JSX.Element {
  const chosen = status?.model ?? null
  const listed = models?.models ?? []
  const chosenListed = chosen
    ? listed.some((m) => m.provider === chosen.provider && m.model === chosen.model)
    : false
  const groups = PROVIDER_ORDER.map((p) => {
    const options = listed
      .filter((m) => m.provider === p)
      .map((m) => ({ value: choiceValue(m), label: m.label }))
    if (chosen && !chosenListed && chosen.provider === p) {
      options.push({ value: choiceValue(chosen), label: chosen.model })
    }
    return { provider: p, options }
  }).filter((g) => g.options.length > 0)

  return (
    <>
      <header className="cb-chat-header">
        <div className="cb-chat-pickers">
          <select
            aria-label="Model"
            value={chosen ? choiceValue(chosen) : ''}
            disabled={status === null}
            onChange={(e) => onChooseModel(e.target.value)}
          >
            {!chosen && (
              <option value="" disabled>
                Choose a model
              </option>
            )}
            {groups.map((g) => (
              <optgroup key={g.provider} label={PROVIDER_LABEL[g.provider]}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <select
            aria-label="Chat"
            value={threadValue}
            disabled={busy}
            onChange={(e) => onChooseThread(e.target.value)}
          >
            {summaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
            <option value="">New chat</option>
          </select>
        </div>
        <button
          type="button"
          className="cb-chat-gear"
          aria-label="AI settings"
          title="AI settings"
          onClick={onOpenSettings}
        >
          ⚙
        </button>
      </header>
      {models && models.errors.length > 0 && (
        <ul className="cb-chat-model-errors">
          {models.errors.map((e) => (
            <li key={e.provider}>
              {PROVIDER_LABEL[e.provider]}: {e.message}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
