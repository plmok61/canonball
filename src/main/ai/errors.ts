import { PROVIDER_LABEL, type ProviderId } from '../../shared/ai'

export class ProviderError extends Error {
  /** HTTP status and raw response body, when the error came from an HTTP response. */
  readonly status?: number
  readonly body?: string

  constructor(message: string, http?: { status: number; body: string }) {
    super(message)
    this.name = 'ProviderError'
    if (http) {
      this.status = http.status
      this.body = http.body
    }
  }
}

const TOOL_REJECT_STATUSES = new Set([400, 404, 422, 501])

/** True when a request failed because the model or server doesn't support tool calling. */
export function rejectsTools(err: unknown): boolean {
  if (!(err instanceof ProviderError)) return false
  if (err.status === undefined || !TOOL_REJECT_STATUSES.has(err.status)) return false
  return /tool|function/i.test(err.body ?? '')
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

export function httpError(provider: ProviderId, status: number, body: string): ProviderError {
  const label = PROVIDER_LABEL[provider]
  const http = { status, body }
  const badGoogleKey = provider === 'google' && status === 400 && body.includes('API_KEY_INVALID')
  if (status === 401 || status === 403 || badGoogleKey)
    return new ProviderError(`The ${label} API key was rejected. Check it in Settings.`, http)
  if (status === 429)
    return new ProviderError(`${label} is busy or rate-limiting requests. Try again in a moment.`, http)
  let message = body.slice(0, 200)
  try {
    const parsed: unknown = JSON.parse(body)
    const m = (parsed as { error?: { message?: unknown } } | null)?.error?.message
    if (typeof m === 'string' && m !== '') message = m
  } catch {
    // not JSON; keep the raw excerpt
  }
  return new ProviderError(`${label} returned an error (${status}): ${message}`, http)
}

export function networkError(provider: ProviderId, err: unknown, baseUrl?: string): ProviderError {
  if (isAbort(err)) throw err
  if (provider === 'local')
    return new ProviderError(`Couldn't reach the local server at ${baseUrl ?? ''}. Is it running?`)
  return new ProviderError(`Couldn't reach ${PROVIDER_LABEL[provider]}. Check your internet connection.`)
}
