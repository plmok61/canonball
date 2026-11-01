import {
  CLOUD_PROVIDERS,
  isProviderId,
  type AiStatus,
  type ChatThread,
  type ModelChoice
} from '../../../shared/ai'

/** A brand-new thread lives only in memory until its first message is saved. */
export interface View {
  thread: ChatThread | null
  saved: boolean
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function parseChoice(value: string): ModelChoice | null {
  const i = value.indexOf(':')
  if (i < 0) return null
  const provider = value.slice(0, i)
  const model = value.slice(i + 1)
  return isProviderId(provider) && model !== '' ? { provider, model } : null
}

export function hasConnection(s: AiStatus): boolean {
  return s.localUrl !== null || CLOUD_PROVIDERS.some((p) => s.keys[p])
}
