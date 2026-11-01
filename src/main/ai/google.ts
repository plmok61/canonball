import type { ModelInfo } from '../../shared/ai'
import {
  isPlainObject,
  mergeAiMessages,
  type Adapter,
  type AiMessage,
  type ProviderConfig
} from './adapter'
import { networkError } from './errors'
import { readJson, send } from './http'
import { parseSse } from './sse'

function headers(cfg: ProviderConfig, json: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  if (cfg.apiKey) h['x-goog-api-key'] = cfg.apiKey
  return h
}

interface WireContent {
  role: 'user' | 'model'
  parts: unknown[]
}

/**
 * Maps messages to Gemini contents. Function calls are replayed as the exact parts received
 * (`meta`, which carries `thoughtSignature`); results ride in a user content.
 */
function toWire(messages: AiMessage[]): WireContent[] {
  const out: WireContent[] = []
  const push = (c: WireContent): void => {
    const last = out[out.length - 1]
    if (last && last.role === c.role) last.parts.push(...c.parts)
    else out.push(c)
  }
  for (const m of mergeAiMessages(messages)) {
    if (m.role === 'user') {
      push({ role: 'user', parts: [{ text: m.content }] })
    } else if (m.role === 'assistant') {
      const calls = m.toolCalls ?? []
      const parts: unknown[] = calls.length > 0 && m.content === '' ? [] : [{ text: m.content }]
      for (const c of calls) {
        parts.push(
          isPlainObject(c.meta) && isPlainObject(c.meta.functionCall)
            ? c.meta
            : { functionCall: { name: c.name, args: c.args } }
        )
      }
      push({ role: 'model', parts })
    } else {
      push({
        role: 'user',
        parts: m.results.map((r) => ({
          functionResponse: {
            name: r.name,
            response: r.isError ? { error: r.content } : { content: r.content }
          }
        }))
      })
    }
  }
  return out
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
        if (
          !Array.isArray(supportedGenerationMethods) ||
          !supportedGenerationMethods.includes('generateContent')
        )
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
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: args.system }] },
      contents: toWire(args.messages)
    }
    if (args.tools && args.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: args.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }
      ]
    }
    const res = await send(
      cfg,
      fetchFn,
      `${cfg.baseUrl}/models/${encodeURIComponent(args.model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: headers(cfg, true),
        body: JSON.stringify(body),
        signal: args.signal
      }
    )
    if (!res.body) return
    let callCount = 0
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
        let text = ''
        for (const part of parts) {
          if (!isPlainObject(part)) continue
          if (typeof part.text === 'string' && part.thought !== true) text += part.text
          const fc = part.functionCall
          if (isPlainObject(fc)) {
            if (text !== '') yield { type: 'text', text }
            text = ''
            callCount++
            yield {
              type: 'tool_call',
              call: {
                id: `call_${callCount}`,
                name: typeof fc.name === 'string' ? fc.name : '',
                args: isPlainObject(fc.args) ? fc.args : {},
                meta: part
              }
            }
          }
        }
        if (text !== '') yield { type: 'text', text }
      }
    } catch (err) {
      throw networkError(cfg.provider, err, cfg.baseUrl)
    }
  }
}
