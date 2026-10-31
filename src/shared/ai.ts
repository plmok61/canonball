export type CloudProvider = 'anthropic' | 'openai' | 'google'
export type ProviderId = CloudProvider | 'local'

export const CLOUD_PROVIDERS: CloudProvider[] = ['anthropic', 'openai', 'google']

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  local: 'Local server'
}

export interface ModelChoice {
  provider: ProviderId
  model: string
}
export interface ModelInfo extends ModelChoice {
  label: string
}
export interface ModelList {
  models: ModelInfo[]
  errors: { provider: ProviderId; message: string }[]
}
export interface AiStatus {
  keys: Record<CloudProvider, boolean>
  localUrl: string | null
  model: ModelChoice | null
  encryptionAvailable: boolean
}
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}
export interface ChatMessage extends ChatTurn {
  at: string
  model?: ModelChoice
}
export interface ChatThread {
  version: 1
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}
export interface ChatSummary {
  id: string
  title: string
  updatedAt: string
}
export interface ChatRequest {
  requestId: string
  model: ModelChoice
  messages: ChatTurn[]
}
export type ChatEvent =
  | { requestId: string; kind: 'delta'; text: string }
  | { requestId: string; kind: 'done'; stopped: boolean }
  | { requestId: string; kind: 'error'; message: string }

export const CHAT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const PROVIDER_IDS: readonly string[] = [...CLOUD_PROVIDERS, 'local']
const TITLE_MAX = 60
const REQUEST_ID_MAX = 200

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

export function isProviderId(x: unknown): x is ProviderId {
  return typeof x === 'string' && PROVIDER_IDS.includes(x)
}

export function parseModelChoice(x: unknown): ModelChoice | null {
  if (!isRecord(x)) return null
  if (!isProviderId(x.provider)) return null
  if (typeof x.model !== 'string' || x.model === '') return null
  return { provider: x.provider, model: x.model }
}

export function normalizeLocalUrl(input: string): string {
  const bad = new Error('Enter a URL starting with http:// or https://')
  const trimmed = input.trim()
  if (!/^https?:\/\/\S/i.test(trimmed)) throw bad
  try {
    new URL(trimmed)
  } catch {
    throw bad
  }
  const base = trimmed.replace(/\/+$/, '')
  return base.endsWith('/v1') ? base : base + '/v1'
}

export function chatTitle(firstUserMessage: string): string {
  const t = firstUserMessage.replace(/\s+/g, ' ').trim()
  if (t === '') return 'New chat'
  const chars = Array.from(t)
  return chars.length > TITLE_MAX ? chars.slice(0, TITLE_MAX - 1).join('') + '…' : t
}

export function mergeTurns(turns: ChatTurn[]): ChatTurn[] {
  const out: ChatTurn[] = []
  for (const t of turns) {
    const last = out[out.length - 1]
    if (last && last.role === t.role) last.content += '\n\n' + t.content
    else out.push({ role: t.role, content: t.content })
  }
  return out
}

function isRole(x: unknown): x is ChatTurn['role'] {
  return x === 'user' || x === 'assistant'
}

function parseTurns(x: unknown): ChatTurn[] | null {
  if (!Array.isArray(x)) return null
  const out: ChatTurn[] = []
  for (const m of x) {
    if (!isRecord(m) || !isRole(m.role) || typeof m.content !== 'string') return null
    out.push({ role: m.role, content: m.content })
  }
  return out
}

export function parseChatThread(x: unknown): ChatThread | null {
  if (!isRecord(x)) return null
  if (x.version !== 1) return null
  if (typeof x.id !== 'string' || !CHAT_ID_RE.test(x.id)) return null
  if (typeof x.title !== 'string') return null
  if (typeof x.createdAt !== 'string' || typeof x.updatedAt !== 'string') return null
  if (!Array.isArray(x.messages)) return null
  const messages: ChatMessage[] = []
  for (const m of x.messages) {
    if (!isRecord(m) || !isRole(m.role)) return null
    if (typeof m.content !== 'string' || typeof m.at !== 'string') return null
    const msg: ChatMessage = { role: m.role, content: m.content, at: m.at }
    if (m.model !== undefined) {
      const model = parseModelChoice(m.model)
      if (!model) return null
      msg.model = model
    }
    messages.push(msg)
  }
  return {
    version: 1,
    id: x.id,
    title: x.title,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    messages
  }
}

export function parseChatRequest(x: unknown): ChatRequest | null {
  if (!isRecord(x)) return null
  if (
    typeof x.requestId !== 'string' ||
    x.requestId === '' ||
    x.requestId.length > REQUEST_ID_MAX
  )
    return null
  const model = parseModelChoice(x.model)
  if (!model) return null
  const messages = parseTurns(x.messages)
  if (!messages || messages.length === 0) return null
  if (messages[messages.length - 1].role !== 'user') return null
  return { requestId: x.requestId, model, messages }
}
