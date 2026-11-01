import { PROVIDER_LABEL, type ChatEvent, type ChatRequest } from '../../shared/ai'
import { isProse } from '../../shared/access'
import { createAiAccess, type AiAccess } from '../aiAccess'
import { loadProjectAccess } from '../projectSettings'
import {
  toAiMessages,
  type AiMessage,
  type FetchFn,
  type ToolCall,
  type ToolResult,
  type ToolSpec
} from './adapter'
import type { AiConfig } from './aiConfig'
import { errorText } from './aiConfig'
import { ProviderError, rejectsTools } from './errors'
import { createBlockFilter, packFiles, type FallbackBlock } from './fallback'
import { buildInstructions, loadMemory, type MemoryFile } from './instructions'
import type { ProposalStore } from './proposals'
import { adapterFor } from './providers'
import { createToolRunner, FILE_TOOLS, type ToolRunner } from './tools'

/** Model requests per writer message, tool rounds included. */
export const MAX_TOOL_ROUNDS = 10
const ROUND_LIMIT_NOTE = `\n\n(I stopped after ${MAX_TOOL_ROUNDS} file steps. Ask me to continue if you need more.)`

export interface ChatService {
  /**
   * Emits deltas and proposals, then exactly one `done` or one `error`. A duplicate active id
   * is ignored. With a `root` the model gets the file tools (or the prompt fallback).
   */
  start(req: ChatRequest, root: string | null, send: (e: ChatEvent) => void): void
  cancel(requestId: string): void
  cancelAll(): void
}

interface Active {
  controller: AbortController
  /** Emits the final event once; later calls (and deltas after it) are dropped. */
  finish(e: ChatEvent): void
}

/** What one request to the model produced. */
interface Round {
  text: string
  calls: ToolCall[]
}

export function createChatService(deps: {
  resolve: AiConfig['resolve']
  fetch: FetchFn
  proposals: ProposalStore
  access?: (root: string) => AiAccess
}): ChatService {
  const accessFor = deps.access ?? createAiAccess
  const active = new Map<string, Active>()
  /** `provider:model` pairs that rejected tool calling, for the rest of the app session. */
  const noTools = new Set<string>()

  function stop(requestId: string): void {
    const a = active.get(requestId)
    if (!a) return
    a.controller.abort()
    a.finish({ requestId, kind: 'done', stopped: true })
  }

  async function run(
    req: ChatRequest,
    root: string | null,
    entry: Active,
    emit: (e: ChatEvent) => void
  ): Promise<void> {
    const { requestId, model } = req
    const signal = entry.controller.signal
    let sent = ''
    const delta = (text: string): void => {
      if (text === '') return
      sent += text
      emit({ requestId, kind: 'delta', text })
    }
    try {
      const cfg = await deps.resolve(model.provider)
      if (signal.aborted) return

      /** One request; text parts reach the writer through `onText` as they arrive. */
      async function request(
        system: string,
        messages: AiMessage[],
        tools: ToolSpec[] | undefined,
        onText: (text: string) => void
      ): Promise<Round> {
        const round: Round = { text: '', calls: [] }
        const stream = adapterFor(model.provider).streamChat(
          cfg,
          { model: model.model, system, messages, tools, signal },
          deps.fetch
        )
        for await (const part of stream) {
          if (signal.aborted) break
          if (part.type === 'text') {
            round.text += part.text
            onText(part.text)
          } else {
            round.calls.push(part.call)
          }
        }
        return round
      }

      const messages = toAiMessages(req.messages)
      if (root === null) {
        await request(buildInstructions({ mode: 'none', memory: [] }), messages, undefined, delta)
      } else {
        const access = accessFor(root)
        const memory = await loadMemory(access)
        if (signal.aborted) return
        const key = `${model.provider}:${model.model}`
        const runner = createToolRunner({
          root,
          access,
          proposals: deps.proposals,
          onProposal: (proposal) => emit({ requestId, kind: 'proposal', proposal })
        })
        const fallback = (): Promise<void> =>
          runFallback(root, access, memory, messages, runner, request, delta, signal)

        if (noTools.has(key)) {
          await fallback()
        } else {
          const system = buildInstructions({ mode: 'tools', memory })
          for (let round = 1; round <= MAX_TOOL_ROUNDS && !signal.aborted; round++) {
            let r: Round
            // Keep text from separate rounds apart; only once this round actually speaks.
            let separate = round > 1 && sent !== '' && !sent.endsWith('\n')
            const roundDelta = (text: string): void => {
              if (separate && text !== '') {
                separate = false
                delta('\n\n')
              }
              delta(text)
            }
            try {
              r = await request(system, messages, FILE_TOOLS, roundDelta)
            } catch (err) {
              // Only the first request can be the one that rejects tools; retry it once without.
              if (round !== 1 || !rejectsTools(err)) throw err
              noTools.add(key)
              await fallback()
              break
            }
            if (signal.aborted || r.calls.length === 0) break
            const results: ToolResult[] = []
            for (const call of r.calls) {
              if (signal.aborted) break
              results.push(await runner.run(call))
            }
            if (signal.aborted) break
            messages.push(
              { role: 'assistant', content: r.text, toolCalls: r.calls },
              { role: 'tool', results }
            )
            if (round === MAX_TOOL_ROUNDS) delta(ROUND_LIMIT_NOTE)
          }
        }
      }
      entry.finish({ requestId, kind: 'done', stopped: signal.aborted })
    } catch (err) {
      if (signal.aborted) {
        entry.finish({ requestId, kind: 'done', stopped: true })
      } else if (err instanceof ProviderError) {
        entry.finish({ requestId, kind: 'error', message: err.message })
      } else {
        const label = PROVIDER_LABEL[model.provider]
        console.error(`Chat with ${label} failed:`, errorText(err))
        entry.finish({
          requestId,
          kind: 'error',
          message: `Something went wrong talking to ${label}.`
        })
      }
    }
  }

  return {
    start(req, root, send) {
      if (active.has(req.requestId)) return
      let finished = false
      const entry: Active = {
        controller: new AbortController(),
        finish(e) {
          if (finished) return
          finished = true
          if (active.get(req.requestId) === entry) active.delete(req.requestId)
          send(e)
        }
      }
      active.set(req.requestId, entry)
      const emit = (e: ChatEvent): void => {
        if (!finished) send(e)
      }
      run(req, root, entry, emit).catch((err) =>
        console.error('Chat event delivery failed:', errorText(err))
      )
    },
    cancel: stop,
    cancelAll() {
      for (const id of [...active.keys()]) stop(id)
    }
  }
}

/**
 * Prompt fallback: the readable files go in the system prompt, tagged blocks are filtered out
 * of the reply and each becomes a proposal through the same tool validation, or a muted line.
 */
async function runFallback(
  root: string,
  access: AiAccess,
  memory: MemoryFile[],
  messages: AiMessage[],
  runner: ToolRunner,
  request: (
    system: string,
    messages: AiMessage[],
    tools: ToolSpec[] | undefined,
    onText: (text: string) => void
  ) => Promise<Round>,
  delta: (text: string) => void,
  signal: AbortSignal
): Promise<void> {
  const { settings } = await loadProjectAccess(root)
  const files = await packFiles(access, (relPath) => isProse(settings, relPath))
  const system = buildInstructions({ mode: 'fallback', memory, files })
  const filter = createBlockFilter()
  await request(system, messages, undefined, (text) => delta(filter.push(text)))
  // A cancelled reply makes no proposals from what it had written so far.
  if (signal.aborted) return
  const { text, blocks } = filter.end()
  delta(text)
  for (const block of blocks) {
    if (signal.aborted) return
    if (block.kind === 'invalid') {
      delta(refusal(block.reason))
      continue
    }
    const result = await runner.run(blockCall(block))
    if (result.isError) delta(refusal(result.content.replace(/^Error: /, '')))
  }
}

function refusal(reason: string): string {
  return `\n\n(Couldn't suggest that change: ${reason})`
}

/** A fallback block as the equivalent tool call, so it gets exactly the tools' validation. */
function blockCall(block: Exclude<FallbackBlock, { kind: 'invalid' }>): ToolCall {
  return block.kind === 'edit'
    ? { id: 'fallback', name: 'propose_edit', args: { path: block.relPath, edits: block.edits } }
    : { id: 'fallback', name: 'create_note', args: { path: block.relPath, content: block.content } }
}
