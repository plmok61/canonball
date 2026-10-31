import { mergeTurns, type ChatTurn, type ModelInfo, type ProviderId } from '../../shared/ai'

export type FetchFn = typeof fetch

export interface ProviderConfig {
  provider: ProviderId
  apiKey: string | null
  baseUrl: string
}

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** A complete tool call. `meta` carries provider data that must be replayed as received. */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  meta?: unknown
}

export interface ToolResult {
  callId: string
  name: string
  content: string
  isError: boolean
}

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  /** Answers the previous assistant's toolCalls. */
  | { role: 'tool'; results: ToolResult[] }

export type StreamPart = { type: 'text'; text: string } | { type: 'tool_call'; call: ToolCall }

export interface StreamArgs {
  model: string
  system: string
  messages: AiMessage[]
  tools?: ToolSpec[]
  signal: AbortSignal
}

export interface Adapter {
  listModels(cfg: ProviderConfig, fetchFn: FetchFn): Promise<ModelInfo[]>
  /** Yields text deltas and complete tool calls. */
  streamChat(cfg: ProviderConfig, args: StreamArgs, fetchFn: FetchFn): AsyncIterable<StreamPart>
}

export function toAiMessages(turns: ChatTurn[]): AiMessage[] {
  return mergeTurns(turns).map((t) => ({ role: t.role, content: t.content }))
}

/**
 * Merges adjacent same-role messages: user text, assistant text (a text-only assistant message
 * absorbs the next one, keeping its tool calls), and tool results.
 */
export function mergeAiMessages(messages: AiMessage[]): AiMessage[] {
  const out: AiMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last?.role === 'user' && m.role === 'user') {
      out[out.length - 1] = { role: 'user', content: joinText(last.content, m.content) }
    } else if (last?.role === 'assistant' && m.role === 'assistant' && !last.toolCalls?.length) {
      out[out.length - 1] = m.toolCalls?.length
        ? { role: 'assistant', content: joinText(last.content, m.content), toolCalls: m.toolCalls }
        : { role: 'assistant', content: joinText(last.content, m.content) }
    } else if (last?.role === 'tool' && m.role === 'tool') {
      out[out.length - 1] = { role: 'tool', results: [...last.results, ...m.results] }
    } else {
      out.push(m)
    }
  }
  return out
}

function joinText(a: string, b: string): string {
  if (a === '') return b
  if (b === '') return a
  return a + '\n\n' + b
}

/** Parses streamed tool arguments; anything that isn't a JSON object becomes `{}`. */
export function parseToolArgs(text: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(text)
    return isPlainObject(v) ? v : {}
  } catch {
    return {}
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
