import type { ChatTurn, ModelInfo, ProviderId } from '../../shared/ai'

export type FetchFn = typeof fetch

export interface ProviderConfig {
  provider: ProviderId
  apiKey: string | null
  baseUrl: string
}

export interface StreamArgs {
  model: string
  system: string
  messages: ChatTurn[]
  signal: AbortSignal
}

export interface Adapter {
  listModels(cfg: ProviderConfig, fetchFn: FetchFn): Promise<ModelInfo[]>
  /** Yields text deltas. */
  streamChat(cfg: ProviderConfig, args: StreamArgs, fetchFn: FetchFn): AsyncIterable<string>
}
