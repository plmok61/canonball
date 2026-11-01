// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ChatPanel } from './ChatPanel'
import { flushAll } from '../editor/saveRegistry'
import { CHANGED_SINCE_PROPOSAL, type Proposal } from '../../../shared/proposals'
import type {
  AiStatus,
  ChatEvent,
  ChatRequest,
  ChatSummary,
  ChatThread,
  ModelList
} from '../../../shared/ai'

const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  keys: { anthropic: true, openai: true, google: false },
  localUrl: null,
  model: { provider: 'openai', model: 'gpt-a' },
  encryptionAvailable: true,
  ...over
})

const twoProviders: ModelList = {
  models: [
    { provider: 'anthropic', model: 'claude-x', label: 'Claude X' },
    { provider: 'openai', model: 'gpt-a', label: 'GPT A' },
    { provider: 'openai', model: 'gpt-b', label: 'GPT B' }
  ],
  errors: []
}

vi.mock('../editor/saveRegistry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../editor/saveRegistry')>()),
  flushAll: vi.fn()
}))

beforeEach(() => {
  vi.mocked(flushAll).mockReset().mockResolvedValue(undefined)
})

let emit: ((e: ChatEvent) => void) | null = null

type Api = Record<
  | 'getAiStatus'
  | 'setModel'
  | 'listModels'
  | 'startChat'
  | 'cancelChat'
  | 'applyProposal'
  | 'rejectProposal'
  | 'listChats'
  | 'loadChat'
  | 'saveChat'
  | 'onChatEvent',
  Mock
>

function stub(
  opts: {
    status?: AiStatus
    models?: ModelList
    chats?: ChatSummary[]
    threads?: Record<string, ChatThread>
  } = {}
): Api {
  const s = opts.status ?? status()
  const api: Api = {
    getAiStatus: vi.fn().mockResolvedValue(s),
    setModel: vi.fn(async (choice) => ({ ...s, model: choice })),
    listModels: vi.fn().mockResolvedValue(opts.models ?? twoProviders),
    startChat: vi.fn().mockResolvedValue(undefined),
    cancelChat: vi.fn().mockResolvedValue(undefined),
    applyProposal: vi.fn(),
    rejectProposal: vi.fn().mockResolvedValue(undefined),
    listChats: vi.fn().mockResolvedValue(opts.chats ?? []),
    loadChat: vi.fn(async (id: string) => {
      const t = opts.threads?.[id]
      if (!t) throw new Error('Chat not found')
      return t
    }),
    saveChat: vi.fn().mockResolvedValue(undefined),
    onChatEvent: vi.fn((handler: (e: ChatEvent) => void) => {
      emit = handler
      return () => {
        if (emit === handler) emit = null
      }
    })
  }
  ;(window as unknown as { canonball: object }).canonball = api
  return api
}

afterEach(() => {
  cleanup()
  emit = null
  vi.restoreAllMocks()
})

/** Moves Date.now forward, past the guard that ignores a Stop click right after Send. */
function laterBy(ms: number): void {
  const t = Date.now() + ms
  vi.spyOn(Date, 'now').mockReturnValue(t)
}

function savedThreads(api: Api): ChatThread[] {
  return api.saveChat.mock.calls.map((c) => c[1] as ChatThread)
}

async function sendMessage(api: Api, text: string): Promise<ChatRequest> {
  const box = await screen.findByLabelText('Message')
  await waitFor(() => expect(box).toBeEnabled())
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('openai:gpt-a'))
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(api.startChat).toHaveBeenCalledTimes(1))
  return api.startChat.mock.calls[0][0] as ChatRequest
}

const fire = (e: ChatEvent): void => {
  act(() => emit!(e))
}

it('lists models grouped by provider and saves the choice', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const select = await screen.findByLabelText('Model')
  await waitFor(() => expect(select).toHaveValue('openai:gpt-a'))
  const groups = select.querySelectorAll('optgroup')
  expect([...groups].map((g) => g.label)).toEqual(['Anthropic', 'OpenAI'])
  expect(within(groups[1] as HTMLElement).getAllByRole('option')).toHaveLength(2)
  fireEvent.change(select, { target: { value: 'anthropic:claude-x' } })
  await waitFor(() =>
    expect(api.setModel).toHaveBeenCalledWith({ provider: 'anthropic', model: 'claude-x' })
  )
  await waitFor(() => expect(select).toHaveValue('anthropic:claude-x'))
})

it('keeps a chosen model that is missing from the list and shows its id', async () => {
  stub({ status: status({ model: { provider: 'local', model: 'llama3:8b' } }) })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const select = await screen.findByLabelText('Model')
  await waitFor(() => expect(select).toHaveValue('local:llama3:8b'))
  expect(within(select).getByRole('option', { name: 'llama3:8b' })).toBeInTheDocument()
})

it('offers a disabled Choose a model option when none is chosen', async () => {
  stub({ status: status({ model: null }) })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const select = await screen.findByLabelText('Model')
  await waitFor(() => expect(select).toHaveValue(''))
  expect(within(select).getByRole('option', { name: 'Choose a model' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'hi' } })
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
})

it('shows per-provider model errors', async () => {
  stub({
    models: {
      models: [{ provider: 'openai', model: 'gpt-a', label: 'GPT A' }],
      errors: [{ provider: 'anthropic', message: 'The Anthropic API key was rejected.' }]
    }
  })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  expect(
    await screen.findByText('Anthropic: The Anthropic API key was rejected.')
  ).toBeInTheDocument()
})

it('refetches models when aiVersion changes', async () => {
  const api = stub()
  const { rerender } = render(
    <ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />
  )
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(1))
  rerender(<ChatPanel root="/p" aiVersion={1} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await waitFor(() => expect(api.listModels).toHaveBeenCalledTimes(2))
  expect(api.getAiStatus).toHaveBeenCalledTimes(2)
})

it('streams a reply into the conversation', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'Who is   the villain?')
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(1))
  const first = savedThreads(api)[0]
  expect(api.saveChat.mock.calls[0][0]).toBe('/p')
  expect(first.title).toBe('Who is the villain?')
  expect(first.messages).toEqual([
    { role: 'user', content: 'Who is   the villain?', at: expect.any(String) }
  ])
  expect(req.model).toEqual({ provider: 'openai', model: 'gpt-a' })
  expect(req.messages).toEqual([{ role: 'user', content: 'Who is   the villain?' }])
  expect(screen.getByLabelText('Message')).toHaveValue('')
  fire({ requestId: req.requestId, kind: 'delta', text: 'Hel' })
  fire({ requestId: req.requestId, kind: 'delta', text: 'lo' })
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(within(screen.getByRole('log')).getByText('Hello')).toBeInTheDocument()
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  const second = savedThreads(api)[1]
  expect(second.id).toBe(first.id)
  expect(second.messages).toHaveLength(2)
  expect(second.messages[1]).toMatchObject({
    role: 'assistant',
    content: 'Hello',
    model: { provider: 'openai', model: 'gpt-a' }
  })
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
})

it('ignores events for other requests', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'hi')
  fire({ requestId: 'other', kind: 'delta', text: 'WRONG' })
  fire({ requestId: 'other', kind: 'done', stopped: false })
  expect(screen.queryByText(/WRONG/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  fire({ requestId: req.requestId, kind: 'delta', text: 'right' })
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(screen.getByText('right')).toBeInTheDocument()
})

it('stop keeps the partial reply and saves it', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'hi')
  fire({ requestId: req.requestId, kind: 'delta', text: 'Partial ans' })
  expect(screen.getByLabelText('Message')).toHaveAttribute('readonly')
  laterBy(1000)
  fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
  expect(api.cancelChat).toHaveBeenCalledWith(req.requestId)
  fire({ requestId: req.requestId, kind: 'done', stopped: true })
  expect(screen.getByText('Partial ans')).toBeInTheDocument()
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(savedThreads(api)[1].messages.map((m) => m.content)).toEqual(['hi', 'Partial ans'])
  expect(screen.getByLabelText('Message')).toBeEnabled()
  expect(screen.getByLabelText('Message')).not.toHaveAttribute('readonly')
  expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('a stopped empty reply is dropped without an alert', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'hi')
  fire({ requestId: req.requestId, kind: 'done', stopped: true })
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(savedThreads(api)[1].messages.map((m) => m.role)).toEqual(['user'])
  expect(screen.queryByRole('alert')).toBeNull()
})

it('says so when a reply finishes with no text', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'hi')
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'No reply came back. Try again or pick another model.'
  )
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(savedThreads(api)[1].messages.map((m) => m.role)).toEqual(['user'])
})

it('a Stop click right after Send does not cancel the reply', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const box = await screen.findByLabelText('Message')
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('openai:gpt-a'))
  fireEvent.change(box, { target: { value: 'hi' } })
  const sendButton = screen.getByRole('button', { name: 'Send' })
  const t0 = Date.now()
  const now = vi.spyOn(Date, 'now').mockReturnValue(t0)
  fireEvent.click(sendButton)
  await waitFor(() => expect(api.startChat).toHaveBeenCalledTimes(1))
  const stopButton = screen.getByRole('button', { name: 'Stop' })
  expect(stopButton).not.toBe(sendButton)
  now.mockReturnValue(t0 + 250)
  fireEvent.click(stopButton)
  expect(api.cancelChat).not.toHaveBeenCalled()
  now.mockReturnValue(t0 + 301)
  fireEvent.click(stopButton)
  const req = api.startChat.mock.calls[0][0] as ChatRequest
  expect(api.cancelChat).toHaveBeenCalledWith(req.requestId)
})

it('keeps focus in the composer across a reply, and Enter cannot send while streaming', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const box = await screen.findByLabelText('Message')
  box.focus()
  const req = await sendMessage(api, 'hi')
  expect(box).not.toBeDisabled()
  expect(box).toHaveAttribute('aria-busy', 'true')
  expect(box).toHaveFocus()
  fireEvent.change(box, { target: { value: 'again' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  expect(api.startChat).toHaveBeenCalledTimes(1)
  fire({ requestId: req.requestId, kind: 'delta', text: 'Hello' })
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(box).toHaveFocus()
  expect(box).not.toHaveAttribute('readonly')
  expect(box).toHaveAttribute('aria-busy', 'false')
})

it('shows provider errors and drops an empty reply', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'hi')
  fire({
    requestId: req.requestId,
    kind: 'error',
    message: 'OpenAI is busy or rate-limiting requests. Try again in a moment.'
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'OpenAI is busy or rate-limiting requests. Try again in a moment.'
  )
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(savedThreads(api)[1].messages).toHaveLength(1)
  expect(savedThreads(api)[1].messages[0].role).toBe('user')
  expect(screen.getByLabelText('Message')).toBeEnabled()
})

it('keeps a partial reply when the provider fails mid-stream', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'hi')
  fire({ requestId: req.requestId, kind: 'delta', text: 'Half' })
  fire({ requestId: req.requestId, kind: 'error', message: 'Couldn’t reach OpenAI.' })
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(savedThreads(api)[1].messages.map((m) => m.content)).toEqual(['hi', 'Half'])
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach OpenAI.')
})

it('shows a save failure without crashing', async () => {
  const api = stub()
  api.saveChat.mockRejectedValue(new Error('Chat file is unreadable'))
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await sendMessage(api, 'hi')
  expect(await screen.findByRole('alert')).toHaveTextContent('Chat file is unreadable')
  expect(screen.getByText('hi')).toBeInTheDocument()
})

it('Shift+Enter adds a line instead of sending', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const box = await screen.findByLabelText('Message')
  await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('openai:gpt-a'))
  fireEvent.change(box, { target: { value: 'line one' } })
  const ev = fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
  expect(ev).toBe(true)
  expect(api.startChat).not.toHaveBeenCalled()
  expect(api.saveChat).not.toHaveBeenCalled()
  expect(box).toHaveValue('line one')
})

it('prompts to add a connection when none is configured', async () => {
  stub({
    status: status({ keys: { anthropic: false, openai: false, google: false }, model: null }),
    models: { models: [], errors: [] }
  })
  const onOpenSettings = vi.fn()
  render(
    <ChatPanel root="/p" aiVersion={0} onOpenSettings={onOpenSettings} onFileChanged={vi.fn()} />
  )
  expect(
    await screen.findByText('Add an AI connection in Settings to start chatting.')
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
  expect(onOpenSettings).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'AI settings' }))
  expect(onOpenSettings).toHaveBeenCalledTimes(2)
})

const older: ChatThread = {
  version: 1,
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Older chat',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  messages: [{ role: 'user', content: 'old question', at: '2026-10-01T00:00:00.000Z' }]
}
const newest: ChatThread = {
  version: 1,
  id: '22222222-2222-4222-8222-222222222222',
  title: 'Newest chat',
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  messages: [
    { role: 'user', content: 'new question', at: '2026-10-02T00:00:00.000Z' },
    {
      role: 'assistant',
      content: 'A **bold** answer',
      at: '2026-10-02T00:00:01.000Z',
      model: { provider: 'openai', model: 'gpt-a' }
    }
  ]
}
const summaries: ChatSummary[] = [newest, older].map(({ id, title, updatedAt }) => ({
  id,
  title,
  updatedAt
}))

it('opens the newest saved chat on mount', async () => {
  const api = stub({ chats: summaries, threads: { [older.id]: older, [newest.id]: newest } })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const log = await screen.findByRole('log')
  expect(await within(log).findByText('new question')).toBeInTheDocument()
  expect(within(log).getByText('bold').tagName).toBe('STRONG')
  expect(api.loadChat).toHaveBeenCalledWith(newest.id)
  const chat = screen.getByLabelText('Chat')
  expect(chat).toHaveValue(newest.id)
  expect(
    within(chat)
      .getAllByRole('option')
      .map((o) => o.textContent)
  ).toEqual(['Newest chat', 'Older chat', 'New chat'])
  fireEvent.change(chat, { target: { value: older.id } })
  expect(await within(log).findByText('old question')).toBeInTheDocument()
  fireEvent.change(chat, { target: { value: '' } })
  await waitFor(() => expect(within(log).queryByText('old question')).toBeNull())
  expect(api.saveChat).not.toHaveBeenCalled()
})

it('continues a loaded thread with its full history', async () => {
  const api = stub({ chats: summaries, threads: { [older.id]: older, [newest.id]: newest } })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await screen.findByText('new question')
  const req = await sendMessage(api, 'follow up')
  expect(req.messages).toEqual([
    { role: 'user', content: 'new question' },
    { role: 'assistant', content: 'A **bold** answer' },
    { role: 'user', content: 'follow up' }
  ])
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(1))
  expect(savedThreads(api)[0]).toMatchObject({ id: newest.id, title: 'Newest chat' })
})

it('switching threads is disabled while streaming', async () => {
  const api = stub({ chats: summaries, threads: { [older.id]: older, [newest.id]: newest } })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await screen.findByText('new question')
  const req = await sendMessage(api, 'more')
  expect(screen.getByLabelText('Chat')).toBeDisabled()
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(screen.getByLabelText('Chat')).toBeEnabled()
})

it('cancels an active request on unmount', async () => {
  const api = stub()
  const { unmount } = render(
    <ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />
  )
  const req = await sendMessage(api, 'hi')
  unmount()
  expect(api.cancelChat).toHaveBeenCalledWith(req.requestId)
})

const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222'

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: PROPOSAL_ID,
  kind: 'edit',
  relPath: 'notes/ideas.md',
  before: 'old idea\n',
  after: 'new idea\n',
  status: 'pending',
  ...over
})

/** Sends a message and streams a reply that carries one proposal. */
async function replyWithProposal(api: Api, finishReply = true): Promise<ChatRequest> {
  const req = await sendMessage(api, 'tidy my notes')
  fire({ requestId: req.requestId, kind: 'delta', text: 'Here you go.' })
  fire({ requestId: req.requestId, kind: 'proposal', proposal: proposal() })
  if (finishReply) fire({ requestId: req.requestId, kind: 'done', stopped: false })
  return req
}

const card = (): HTMLElement => screen.getByRole('group', { name: 'Suggested edit to notes/ideas' })

function lastSavedProposal(api: Api): Proposal | undefined {
  const t = savedThreads(api).at(-1)
  return t?.messages.at(-1)?.proposals?.[0]
}

it('a proposal event shows a card in the reply', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await replyWithProposal(api)
  const reply = screen.getByText('Here you go.').closest('.cb-chat-reply') as HTMLElement
  expect(
    within(reply).getByRole('group', { name: 'Suggested edit to notes/ideas' })
  ).toBeInTheDocument()
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(lastSavedProposal(api)).toEqual(proposal())
})

it('a reply with only a proposal is kept', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await sendMessage(api, 'make a note')
  fire({ requestId: req.requestId, kind: 'proposal', proposal: proposal() })
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(card()).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  await waitFor(() => expect(api.saveChat).toHaveBeenCalledTimes(2))
  expect(lastSavedProposal(api)).toEqual(proposal())
})

it('accept applies, marks accepted, saves and reports the file', async () => {
  const api = stub()
  api.applyProposal.mockResolvedValue({ relPath: 'notes/ideas.md' })
  const onFileChanged = vi.fn()
  render(
    <ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={onFileChanged} />
  )
  await replyWithProposal(api)
  fireEvent.click(within(card()).getByRole('button', { name: 'Accept' }))
  await waitFor(() => expect(within(card()).getByText('Accepted')).toBeInTheDocument())
  expect(api.applyProposal).toHaveBeenCalledWith('/p', PROPOSAL_ID)
  expect(onFileChanged).toHaveBeenCalledWith('notes/ideas.md')
  await waitFor(() => expect(lastSavedProposal(api)?.status).toBe('accepted'))
  expect(lastSavedProposal(api)?.error).toBeUndefined()
})

it('accept saves typed text first', async () => {
  const api = stub()
  const order: string[] = []
  vi.mocked(flushAll).mockImplementation(async () => {
    order.push('flush')
  })
  api.applyProposal.mockImplementation(async () => {
    order.push('apply')
    return { relPath: 'notes/ideas.md' }
  })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await replyWithProposal(api)
  fireEvent.click(within(card()).getByRole('button', { name: 'Accept' }))
  await waitFor(() => expect(within(card()).getByText('Accepted')).toBeInTheDocument())
  expect(order).toEqual(['flush', 'apply'])
})

it('a failed save of typed text fails the card without applying', async () => {
  const api = stub()
  vi.mocked(flushAll).mockRejectedValue(new Error('disk full'))
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await replyWithProposal(api)
  fireEvent.click(within(card()).getByRole('button', { name: 'Accept' }))
  expect(await within(card()).findByRole('alert')).toHaveTextContent(
    "Couldn't save your own changes first: disk full"
  )
  expect(api.applyProposal).not.toHaveBeenCalled()
  await waitFor(() => expect(lastSavedProposal(api)?.status).toBe('failed'))
})

it('a failed accept shows the error on the card', async () => {
  const api = stub()
  api.applyProposal.mockRejectedValue(new Error(CHANGED_SINCE_PROPOSAL))
  const onFileChanged = vi.fn()
  render(
    <ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={onFileChanged} />
  )
  await replyWithProposal(api)
  fireEvent.click(within(card()).getByRole('button', { name: 'Accept' }))
  expect(await within(card()).findByRole('alert')).toHaveTextContent(CHANGED_SINCE_PROPOSAL)
  expect(within(card()).queryByRole('button')).toBeNull()
  expect(onFileChanged).not.toHaveBeenCalled()
  await waitFor(() =>
    expect(lastSavedProposal(api)).toMatchObject({
      status: 'failed',
      error: CHANGED_SINCE_PROPOSAL
    })
  )
})

it('a double-click on Accept applies once', async () => {
  const api = stub()
  let finishApply!: (v: { relPath: string }) => void
  api.applyProposal.mockReturnValue(new Promise((r) => (finishApply = r)))
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await replyWithProposal(api)
  const accept = within(card()).getByRole('button', { name: 'Accept' })
  fireEvent.click(accept)
  fireEvent.click(accept)
  await waitFor(() => expect(api.applyProposal).toHaveBeenCalledTimes(1))
  expect(within(card()).getByRole('button', { name: 'Accept' })).toBeDisabled()
  expect(within(card()).getByRole('button', { name: 'Reject' })).toBeDisabled()
  await act(async () => finishApply({ relPath: 'notes/ideas.md' }))
  expect(within(card()).getByText('Accepted')).toBeInTheDocument()
  expect(api.applyProposal).toHaveBeenCalledTimes(1)
})

it('reject marks rejected without writing', async () => {
  const api = stub()
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await replyWithProposal(api)
  fireEvent.click(within(card()).getByRole('button', { name: 'Reject' }))
  expect(within(card()).getByText('Rejected')).toBeInTheDocument()
  expect(api.rejectProposal).toHaveBeenCalledWith(PROPOSAL_ID)
  expect(api.applyProposal).not.toHaveBeenCalled()
  expect(flushAll).not.toHaveBeenCalled()
  await waitFor(() => expect(lastSavedProposal(api)?.status).toBe('rejected'))
})

it('accepting while the reply streams keeps both the text and the status', async () => {
  const api = stub()
  api.applyProposal.mockResolvedValue({ relPath: 'notes/ideas.md' })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  const req = await replyWithProposal(api, false)
  fireEvent.click(within(card()).getByRole('button', { name: 'Accept' }))
  fire({ requestId: req.requestId, kind: 'delta', text: ' More.' })
  await waitFor(() => expect(within(card()).getByText('Accepted')).toBeInTheDocument())
  fire({ requestId: req.requestId, kind: 'delta', text: ' Done.' })
  fire({ requestId: req.requestId, kind: 'done', stopped: false })
  expect(screen.getByText('Here you go. More. Done.')).toBeInTheDocument()
  expect(within(card()).getByText('Accepted')).toBeInTheDocument()
  await waitFor(() => {
    const last = savedThreads(api).at(-1)!.messages.at(-1)!
    expect(last.content).toBe('Here you go. More. Done.')
    expect(last.proposals?.[0].status).toBe('accepted')
  })
})

it('the next message tells the model what was accepted', async () => {
  const api = stub()
  api.applyProposal.mockResolvedValue({ relPath: 'notes/ideas.md' })
  render(<ChatPanel root="/p" aiVersion={0} onOpenSettings={vi.fn()} onFileChanged={vi.fn()} />)
  await replyWithProposal(api)
  fireEvent.click(within(card()).getByRole('button', { name: 'Accept' }))
  await waitFor(() => expect(within(card()).getByText('Accepted')).toBeInTheDocument())
  const box = screen.getByLabelText('Message')
  fireEvent.change(box, { target: { value: 'thanks' } })
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(api.startChat).toHaveBeenCalledTimes(2))
  const req = api.startChat.mock.calls[1][0] as ChatRequest
  expect(req.messages).toEqual([
    { role: 'user', content: 'tidy my notes' },
    {
      role: 'assistant',
      content: 'Here you go.\n\n[Suggested an edit to notes/ideas.md: accepted]'
    },
    { role: 'user', content: 'thanks' }
  ])
})
