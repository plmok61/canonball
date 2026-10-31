import type { CloudProvider, ProviderId } from '../../shared/ai'
import type { Adapter } from './adapter'
import { anthropic } from './anthropic'
import { google } from './google'
import { OPENAI_BASE_URL, openaiCompat } from './openaiCompat'

export const BASE_URL: Record<CloudProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: OPENAI_BASE_URL,
  google: 'https://generativelanguage.googleapis.com/v1beta'
}

export function adapterFor(p: ProviderId): Adapter {
  if (p === 'anthropic') return anthropic
  if (p === 'google') return google
  return openaiCompat
}
