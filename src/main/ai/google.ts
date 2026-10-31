import { mergeTurns, type ModelInfo } from '../../shared/ai'
import type { Adapter, ProviderConfig } from './adapter'
import { networkError } from './errors'
import { readJson, send } from './http'
import { parseSse } from './sse'

function headers(cfg: ProviderConfig, json: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  if (cfg.apiKey) h['x-goog-api-key'] = cfg.apiKey
  return h
}

export const google: Adapter = {
  async listModels(cfg, fetchFn) {
    const res = await send(cfg, fetchFn, `${cfg.baseUrl}/models?pageSize=1000`, {
      method: 'GET',
      headers: headers(cfg, false)
    })
    const list = ((await readJson(cfg, res)) as { models?: unknown } | null)?.models
    const models: ModelInfo[] = []
    if (Array.isArray(list)) {
      for (const m of list) {
        const { name, displayName, supportedGenerationMethods } = (m ?? {}) as {
          name?: unknown
          displayName?: unknown
          supportedGenerationMethods?: unknown
        }
        if (typeof name !== 'string') continue
        const id = name.replace(/^models\//, '')
        if (!id.includes('gemini')) continue
        if (!Array.isArray(supportedGenerationMethods) || !supportedGenerationMethods.includes('generateContent'))
          continue
        models.push({
          provider: cfg.provider,
          model: id,
          label: typeof displayName === 'string' && displayName !== '' ? displayName : id
        })
      }
    }
    return models.sort((a, b) => a.label.localeCompare(b.label))
  },

  async *streamChat(cfg, args, fetchFn) {
    const contents = mergeTurns(args.messages).map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }]
    }))
    const res = await send(
      cfg,
      fetchFn,
      `${cfg.baseUrl}/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: headers(cfg, true),
        body: JSON.stringify({ systemInstruction: { parts: [{ text: args.system }] }, contents }),
        signal: args.signal
      }
    )
    if (!res.body) return
    try {
      for await (const ev of parseSse(res.body)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          continue
        }
        const parts = (parsed as { candidates?: { content?: { parts?: unknown } }[] } | null)
          ?.candidates?.[0]?.content?.parts
        if (!Array.isArray(parts)) continue
        const text = parts
          .map((p) => (p as { text?: unknown } | null)?.text)
          .filter((t): t is string => typeof t === 'string')
          .join('')
        if (text !== '') yield text
      }
    } catch (err) {
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
  }
}
