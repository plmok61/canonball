import {
  CLOUD_PROVIDERS,
  PROVIDER_LABEL,
  normalizeLocalUrl,
  type AiStatus,
  type CloudProvider,
  type ModelChoice,
  type ModelInfo,
  type ModelList,
  type ProviderId
} from '../../shared/ai'
import type { SettingsStore } from '../appSettings'
import type { FetchFn, ProviderConfig } from './adapter'
import { ProviderError } from './errors'
import { BASE_URL, adapterFor } from './providers'
import type { SecretStore } from './secrets'

/** Glue between app settings, encrypted keys and the provider adapters. */
export interface AiConfig {
  status(): Promise<AiStatus>
  setApiKey(p: CloudProvider, key: string | null): Promise<AiStatus>
  setLocalUrl(url: string | null): Promise<AiStatus>
  setModel(choice: ModelChoice | null): Promise<AiStatus>
  resolve(p: ProviderId): Promise<ProviderConfig>
  listModels(): Promise<ModelList>
}

export function createAiConfig(deps: {
  settings: SettingsStore
  secrets: SecretStore
  fetch: FetchFn
}): AiConfig {
  const { settings, secrets } = deps

  async function status(): Promise<AiStatus> {
    const [s, keys] = await Promise.all([settings.load(), secrets.status()])
    return {
      keys,
      localUrl: s.ai.localUrl,
      model: s.ai.model,
      encryptionAvailable: secrets.available()
    }
  }

  async function resolve(p: ProviderId): Promise<ProviderConfig> {
    if (p === 'local') {
      const url = (await settings.load()).ai.localUrl
      if (!url) throw new ProviderError('Add a local server URL in Settings.')
      return { provider: 'local', apiKey: null, baseUrl: url }
    }
    const key = await secrets.get(p)
    if (!key) throw new ProviderError(`Add your ${PROVIDER_LABEL[p]} API key in Settings.`)
    return { provider: p, apiKey: key, baseUrl: BASE_URL[p] }
  }

  async function listOne(p: ProviderId): Promise<ModelInfo[]> {
    const cfg = await resolve(p)
    return adapterFor(p).listModels(cfg, deps.fetch)
  }

  return {
    status,
    resolve,
    async setApiKey(p, key) {
      if (key === null) await secrets.clear(p)
      else await secrets.set(p, key)
      return status()
    },
    async setLocalUrl(url) {
      const localUrl = url === null ? null : normalizeLocalUrl(url)
      await settings.update((s) => ({ ...s, ai: { ...s.ai, localUrl } }))
      return status()
    },
    async setModel(model) {
      await settings.update((s) => ({ ...s, ai: { ...s.ai, model } }))
      return status()
    },
    async listModels() {
      const st = await status()
      const configured: ProviderId[] = CLOUD_PROVIDERS.filter((p) => st.keys[p])
      if (st.localUrl) configured.push('local')
      const results = await Promise.allSettled(configured.map(listOne))
      const out: ModelList = { models: [], errors: [] }
      results.forEach((r, i) => {
        const provider = configured[i]
        if (r.status === 'fulfilled') {
          out.models.push(...r.value)
        } else if (r.reason instanceof ProviderError) {
          out.errors.push({ provider, message: r.reason.message })
        } else {
          console.error(`Listing ${PROVIDER_LABEL[provider]} models failed:`, errorText(r.reason))
          out.errors.push({
            provider,
            message: `Something went wrong talking to ${PROVIDER_LABEL[provider]}.`
          })
        }
      })
      return out
    }
  }
}

/** A short description of an unexpected error for the log, never including request data. */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`
  return String(err)
}
