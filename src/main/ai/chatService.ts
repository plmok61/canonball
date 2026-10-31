import { PROVIDER_LABEL, type ChatEvent, type ChatRequest } from '../../shared/ai'
import { toAiMessages, type FetchFn } from './adapter'
import type { AiConfig } from './aiConfig'
import { errorText } from './aiConfig'
import { ProviderError } from './errors'
import { CHAT_INSTRUCTIONS } from './instructions'
import { adapterFor } from './providers'

export interface ChatService {
  /** Emits deltas, then exactly one `done` or one `error`. A duplicate active id is ignored. */
  start(req: ChatRequest, send: (e: ChatEvent) => void): void
  cancel(requestId: string): void
  cancelAll(): void
}

interface Active {
  controller: AbortController
  /** Emits the final event once; later calls (and deltas after it) are dropped. */
  finish(e: ChatEvent): void
}

export function createChatService(deps: {
  resolve: AiConfig['resolve']
  fetch: FetchFn
}): ChatService {
  const active = new Map<string, Active>()

  function stop(requestId: string): void {
    const a = active.get(requestId)
    if (!a) return
    a.controller.abort()
    a.finish({ requestId, kind: 'done', stopped: true })
  }

  async function run(req: ChatRequest, entry: Active, emit: (e: ChatEvent) => void): Promise<void> {
    const { requestId, model } = req
    const signal = entry.controller.signal
    try {
      const cfg = await deps.resolve(model.provider)
      if (signal.aborted) return
      const stream = adapterFor(model.provider).streamChat(
        cfg,
        { model: model.model, system: CHAT_INSTRUCTIONS, messages: toAiMessages(req.messages), signal },
        deps.fetch
      )
      for await (const part of stream) {
        if (signal.aborted) break
        if (part.type === 'text') emit({ requestId, kind: 'delta', text: part.text })
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
    start(req, send) {
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
      run(req, entry, emit).catch((err) =>
        console.error('Chat event delivery failed:', errorText(err))
      )
    },
    cancel: stop,
    cancelAll() {
      for (const id of [...active.keys()]) stop(id)
    }
  }
}
