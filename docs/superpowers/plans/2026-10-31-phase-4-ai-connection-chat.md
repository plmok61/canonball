# Phase 4: AI Connection & Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The writer adds an Anthropic, OpenAI or Google API key (kept encrypted with the macOS Keychain) or a local OpenAI-compatible server URL, picks a model in the chat panel, and chats with streamed replies that are saved per project in `.canonball/chats/`.

**Architecture:** Every provider call happens in main, so keys never reach the renderer. Main has one small adapter per wire protocol (`openaiCompat` for OpenAI and local servers, `anthropic`, `google`) built on plain `fetch` and a shared SSE parser. A chat service runs one stream per renderer-chosen `requestId` and pushes `ChatEvent`s to the window. The renderer owns the conversation state, renders replies with a tiny markdown-to-React renderer, and saves threads through a validated `saveChat` channel. The AI has no file access this phase (Phase 5 adds tools).

**Tech Stack:** Electron 44 (main-process global `fetch`, `safeStorage`), React 19, TypeScript, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-canonball-app-design.md` (sections "Connecting the AI", "The screen › Right: AI chat", "Where chats live", "Anti-goals"). Earlier interfaces: the Phase 1–3 plans in this folder; the code is the authority where they differ (e.g. `requireCurrentRoot`, `writeDoc`, `ProseDialog`'s `.cb-dialog` overlay styles, `MenuCommand`).

## Rulings (calls made without the author)

- Ruling: providers are called with plain `fetch` from main, one adapter per wire protocol, no SDKs. Three protocols cover four connections, there's no dependency churn, and Phase 5 adds tool calling per adapter.
- Ruling: the connections are exactly `anthropic`, `openai`, `google` (API key each) and one `local` server URL. One local URL in v1; a list can come later.
- Ruling: keys are encrypted with Electron `safeStorage` (its key lives in the macOS Keychain) and the base64 ciphertext is stored in `<userData>/secrets.json`. Plaintext keys are never written to disk, never logged, and never sent to the renderer, which only learns `true/false` per provider. If `safeStorage.isEncryptionAvailable()` is false, saving a key is refused with `This Mac's Keychain isn't available, so API keys can't be saved.`
- Ruling: a key is trimmed; empty, longer than 500 characters, or containing whitespace → `That doesn't look like an API key.`
- Ruling: the local URL must start with `http://` or `https://` (else `Enter a URL starting with http:// or https://`). Trailing slashes are stripped and `/v1` is appended unless the path already ends in `/v1`, so `http://localhost:11434` (Ollama) becomes `http://localhost:11434/v1`. No key is sent to local servers.
- Ruling: models are listed live from each configured provider (no hard-coded model IDs): Anthropic `GET /v1/models?limit=1000` (label `display_name`); OpenAI `GET /v1/models` filtered to ids starting `gpt-`, `chatgpt-` or matching `^o\d`, minus ids containing `audio`, `realtime`, `transcribe`, `tts`, `image`, `embedding`, `search`; Google `GET /v1beta/models` keeping `gemini` models whose `supportedGenerationMethods` include `generateContent` (id without the `models/` prefix, label `displayName`); local `GET <url>/models`, all ids. Each list is sorted by label. One provider failing doesn't hide the others.
- Ruling: the chosen model is stored app-wide (not per project) in `settings.json` as `ai.model = { provider, model }`. If it's missing from the fetched list it stays selected and shows its id, so a network blip doesn't lose it.
- Ruling: Anthropic requests use `anthropic-version: 2023-06-01` and `max_tokens: 8192`. Other providers use their defaults.
- Ruling: before sending, consecutive messages with the same role are merged with a blank line, because a failed reply can leave two user turns in a row.
- Ruling: provider failures become writer-facing copy (`ProviderError`): 401/403 → `The <Label> API key was rejected. Check it in Settings.`; 429 → `<Label> is busy or rate-limiting requests. Try again in a moment.`; network failure on `local` → `Couldn't reach the local server at <url>. Is it running?`; other network failures → `Couldn't reach <Label>. Check your internet connection.`; other statuses → `<Label> returned an error (<status>): <message>` using the body's `error.message` when it's JSON, else the first 200 characters of the body. Labels: `Anthropic`, `OpenAI`, `Google`, `Local server`.
- Ruling: the Phase 4 system prompt is `CHAT_INSTRUCTIONS` (Task 5). Style rules and project memory join it in Phase 5.
- Ruling: chats are files `.canonball/chats/<uuid>.json`: `{ "version": 1, "id", "title", "createdAt", "updatedAt", "messages": [{ "role": "user" | "assistant", "content", "at", "model"? }] }`, 2-space indent and trailing newline, written atomically by main. The title is the first user message, whitespace-collapsed, cut to 60 characters with `…`. A thread isn't saved until its first message.
- Ruling: whenever main saves a chat it makes sure `.canonball/chats/.gitignore` contains `*`, so transcripts stay out of git in any project, including ones not made by the app. New projects keep the root `.gitignore` entry `.canonball/chats/` (already written by `createProject`).
- Ruling: chat files that fail to parse are skipped in the thread list and never overwritten.
- Ruling: the renderer saves the thread after the writer's message is added and again when the reply finishes, stops or fails. An error is shown under the conversation and not saved; an empty failed reply is dropped; a partial reply (stopped or failed) is kept and saved.
- Ruling: switching projects or closing the window mid-reply stops the stream; the writer's message is already saved, the partial reply is lost. Noted in `OPEN_WORK.md`.
- Ruling: replies are rendered by `renderChatMarkdown` (paragraphs, `#` headings, `-`/`*`/`1.` lists, `**bold**`, `*italic*`/`_italic_`, `` `code` ``) into React elements, never `innerHTML`, so the writer doesn't see raw markdown. Anything else shows as plain text.
- Ruling: settings open from a gear button in the chat panel (`aria-label="AI settings"`) and from **File › Settings…** (`CmdOrCtrl+,`, `MenuCommand` `'open-settings'`), also on the welcome screen.
- Ruling: `canonball:setSettings` now accepts only a valid `theme`; AI settings change only through the dedicated channels below. App-settings writes are serialized in main.
- Ruling: no request timeout; **Stop** is the way out of a hung stream. One reply streams at a time per chat panel; thread switching and New chat are disabled while it streams.

## Global Constraints

- **Keys never leave main in plaintext** except in the request to their own provider. No key in `settings.json`, logs, IPC replies, errors, or the project folder.
- **No server run by Canonball.** Requests go straight from main to `https://api.anthropic.com`, `https://api.openai.com`, `https://generativelanguage.googleapis.com`, or the writer's local URL.
- The AI has no file tools this phase and never edits prose (unchanged hard rule).
- The renderer touches the disk only through `window.canonball`. Every IPC argument is validated in main; chat writes go through `requireCurrentRoot(currentRoot, root)`; chat ids must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
- The app never writes a file the writer didn't change: opening a project or the chat panel writes nothing; only sending a message writes a chat file.
- Colours only from tokens in `src/renderer/src/theme/theme.css`. `contextIsolation: true`, `nodeIntegration: false`. The renderer CSP is unchanged (the renderer never fetches).
- Tests never hit the network: adapters take an injected `fetch`.

## Review Focus

1. **A key leaking.** The secrets file must not contain the key text, and no renderer-facing reply may carry it (Task 2: `stores only ciphertext`, `status reports booleans only`).
2. **Local server not running or wrong URL.** The writer gets the "Couldn't reach the local server" copy, not a hang or a stack trace (Task 3: `local network failure names the URL`).
3. **SSE chunks split mid-line or mid-character** (an emoji split across reads, `\r\n` line endings) must still yield exact text (Task 3: `parses events split across chunks and multibyte characters`).
4. **Stop mid-reply** keeps and saves the partial text, and the composer is usable again (Task 8: `stop keeps the partial reply and saves it`).
5. **A corrupt chat file** doesn't break the thread list and is never overwritten (Task 6: `skips unreadable chat files`).

---

### Task 1: Shared AI types and helpers

**Files:**
- Create: `src/shared/ai.ts`, `src/shared/ai.test.ts`

**Interfaces:**
- Produces (`src/shared/ai.ts`):
  ```ts
  export type CloudProvider = 'anthropic' | 'openai' | 'google'
  export type ProviderId = CloudProvider | 'local'
  export const CLOUD_PROVIDERS: CloudProvider[]               // ['anthropic','openai','google']
  export const PROVIDER_LABEL: Record<ProviderId, string>      // Anthropic, OpenAI, Google, Local server
  export interface ModelChoice { provider: ProviderId; model: string }
  export interface ModelInfo extends ModelChoice { label: string }
  export interface ModelList { models: ModelInfo[]; errors: { provider: ProviderId; message: string }[] }
  export interface AiStatus { keys: Record<CloudProvider, boolean>; localUrl: string | null; model: ModelChoice | null; encryptionAvailable: boolean }
  export interface ChatTurn { role: 'user' | 'assistant'; content: string }
  export interface ChatMessage extends ChatTurn { at: string; model?: ModelChoice }
  export interface ChatThread { version: 1; id: string; title: string; createdAt: string; updatedAt: string; messages: ChatMessage[] }
  export interface ChatSummary { id: string; title: string; updatedAt: string }
  export interface ChatRequest { requestId: string; model: ModelChoice; messages: ChatTurn[] }
  export type ChatEvent =
    | { requestId: string; kind: 'delta'; text: string }
    | { requestId: string; kind: 'done'; stopped: boolean }
    | { requestId: string; kind: 'error'; message: string }
  export const CHAT_ID_RE: RegExp
  export function isProviderId(x: unknown): x is ProviderId
  export function parseModelChoice(x: unknown): ModelChoice | null
  export function normalizeLocalUrl(input: string): string        // throws Error with the Rulings copy
  export function chatTitle(firstUserMessage: string): string
  export function mergeTurns(turns: ChatTurn[]): ChatTurn[]
  export function parseChatThread(x: unknown): ChatThread | null
  export function parseChatRequest(x: unknown): ChatRequest | null  // non-empty messages, last is 'user'
  ```

- [ ] **Step 1: Write failing tests** in `ai.test.ts`:
  - `normalizes local URLs`: `http://localhost:11434` → `http://localhost:11434/v1`; `http://localhost:1234/v1/` → `http://localhost:1234/v1`; `https://box.lan:8080/api` → `https://box.lan:8080/api/v1`; `localhost:11434` and `ftp://x` throw `Enter a URL starting with http:// or https://`
  - `titles from the first message`: `'  Where   does\nshe go?  '` → `'Where does she go?'`; a 100-char message → 60 chars ending in `…`
  - `merges consecutive same-role turns`: `[u'a', u'b', a'c']` → `[u'a\n\nb', a'c']`
  - `parseChatThread accepts a valid thread and rejects wrong shapes`: rejects bad id, `version: 2`, role `'system'`, non-string content, a `model` with unknown provider
  - `parseChatRequest requires a final user turn`: rejects empty messages, a last `assistant` turn, a bad `requestId`
- [ ] **Step 2: Run** `npm test -- src/shared/ai` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/shared/ai.ts`.
- [ ] **Step 4: Run** `npm test -- src/shared/ai` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: shared AI connection and chat types`.

---

### Task 2: Key storage and AI app settings

**Files:**
- Create: `src/main/ai/secrets.ts`, `src/main/ai/secrets.test.ts`
- Modify: `src/main/appSettings.ts`, `src/main/appSettings.test.ts`, `src/shared/types.ts` (`AppSettings`)

**Interfaces:**
- Consumes: Task 1's `CloudProvider`, `ModelChoice`, `parseModelChoice`, `normalizeLocalUrl`.
- Produces (`src/main/ai/secrets.ts`):
  ```ts
  export interface Encryptor { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }
  export interface SecretStore {
    available(): boolean
    status(): Promise<Record<CloudProvider, boolean>>
    get(p: CloudProvider): Promise<string | null>     // null when unset or undecryptable
    set(p: CloudProvider, key: string): Promise<void> // validates per Rulings, then encrypts
    clear(p: CloudProvider): Promise<void>
  }
  export function createSecretStore(file: string, enc: Encryptor): SecretStore
  ```
  The file is `{ "<provider>": "<base64 ciphertext>" }`, written with mode `0o600`. Writes are serialized.
- Produces (`src/main/appSettings.ts`): `AppSettings` gains `ai: { localUrl: string | null; model: ModelChoice | null }` (default both `null`; invalid stored values load as `null`). New `export interface SettingsStore { load(): Promise<AppSettings>; update(fn: (s: AppSettings) => AppSettings): Promise<AppSettings> }` and `createSettingsStore(file: string): SettingsStore`, which serializes updates; `ipc.ts` switches to it. `loadSettings`/`saveSettings` stay.

- [ ] **Step 1: Write failing tests**
  - `secrets.test.ts` (fake encryptor that reverses and prefixes the string, temp dir): `stores only ciphertext` (after `set('openai', 'sk-test-123')` the file text doesn't contain `sk-test-123`; `get` returns it); `status reports booleans only` (`{anthropic:false, openai:true, google:false}`, values are booleans); `clear removes the key`; `rejects malformed keys` (`''`, `'a b'`, 501 chars → `That doesn't look like an API key.`); `refuses when encryption is unavailable` (copy from Rulings, file not created); `an undecryptable entry reads as unset` (decrypt throws → `get` null)
  - `appSettings.test.ts`: `loads ai defaults`; `drops an invalid stored model or URL` (`ai.model.provider = 'bard'` → `null`); `serializes concurrent updates` (two `update` calls setting different fields both survive)
- [ ] **Step 2: Run** `npm test -- secrets appSettings` → FAIL.
- [ ] **Step 3: Implement.** Fix every `AppSettings` literal in tests so `npm run typecheck` passes.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: keychain-encrypted API keys and AI settings`.

---

### Task 3: SSE parser and OpenAI-compatible adapter

**Files:**
- Create: `src/main/ai/sse.ts`, `sse.test.ts`, `src/main/ai/errors.ts`, `errors.test.ts`, `src/main/ai/adapter.ts`, `src/main/ai/openaiCompat.ts`, `openaiCompat.test.ts`

**Interfaces:**
- Consumes: Task 1 types, `PROVIDER_LABEL`.
- Produces:
  ```ts
  // sse.ts
  export interface SseEvent { event: string | null; data: string }
  export function parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent>
  // errors.ts
  export class ProviderError extends Error {}   // name 'ProviderError'; message is writer-facing
  export function httpError(provider: ProviderId, status: number, body: string): ProviderError
  export function networkError(provider: ProviderId, err: unknown, baseUrl?: string): ProviderError  // AbortError is rethrown unchanged
  // adapter.ts
  export type FetchFn = typeof fetch
  export interface ProviderConfig { provider: ProviderId; apiKey: string | null; baseUrl: string }
  export interface StreamArgs { model: string; system: string; messages: ChatTurn[]; signal: AbortSignal }
  export interface Adapter {
    listModels(cfg: ProviderConfig, fetchFn: FetchFn): Promise<ModelInfo[]>
    streamChat(cfg: ProviderConfig, args: StreamArgs, fetchFn: FetchFn): AsyncIterable<string>  // text deltas
  }
  // openaiCompat.ts
  export const openaiCompat: Adapter   // POST <baseUrl>/chat/completions, stream:true, system as first message
  ```
  `parseSse` follows the SSE spec subset: `\n`, `\r\n` or `\r` line ends, multi-line `data:` joined with `\n`, `:` comments ignored, a blank line dispatches. Decode with one streaming `TextDecoder`. Adapters stop at `data: [DONE]`, send `Authorization: Bearer <key>` only when `apiKey` is set, and apply `mergeTurns`. The OpenAI base URL is `https://api.openai.com/v1`.

- [ ] **Step 1: Write failing tests**
  - `sse.test.ts`: `parses events split across chunks and multibyte characters` (feed `'event: a\r\ndata: {"t":"h'`, then the first two bytes of `'😀'`, then the rest plus `'"}\r\n\r\n'` → one event `{event:'a', data:'{"t":"h😀"}'}`); `joins multi-line data and ignores comments`
  - `errors.test.ts`: `maps statuses to writer copy` (401 anthropic → `The Anthropic API key was rejected. Check it in Settings.`; 429; 500 with `{"error":{"message":"boom"}}` → `OpenAI returned an error (500): boom`; non-JSON body cut to 200 chars); `local network failure names the URL` (`networkError('local', new TypeError('fetch failed'), 'http://localhost:11434/v1')` → `Couldn't reach the local server at http://localhost:11434/v1. Is it running?`)
  - `openaiCompat.test.ts` (fake `fetch` returning a `Response` over a `ReadableStream`): `streams text deltas` (two `choices[0].delta.content` chunks then `[DONE]` → `['Hel','lo']`; request body has `stream: true`, first message `{role:'system'}`, `Authorization` header); `omits the auth header without a key`; `lists and filters OpenAI chat models` (`gpt-4o`, `o3-mini` kept; `text-embedding-3-small`, `gpt-4o-realtime`, `dall-e-3` dropped); `lists every local model`; `throws ProviderError on a 401`
- [ ] **Step 2: Run** `npm test -- src/main/ai` → FAIL.
- [ ] **Step 3: Implement** the four modules.
- [ ] **Step 4: Run** `npm test -- src/main/ai` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: SSE parser and OpenAI-compatible provider adapter`.

---

### Task 4: Anthropic and Google adapters

**Files:**
- Create: `src/main/ai/anthropic.ts`, `anthropic.test.ts`, `src/main/ai/google.ts`, `google.test.ts`, `src/main/ai/providers.ts`

**Interfaces:**
- Consumes: Task 3's `Adapter`, `parseSse`, `httpError`, `networkError`, `mergeTurns`.
- Produces: `export const anthropic: Adapter`, `export const google: Adapter`, and in `providers.ts`:
  ```ts
  export const BASE_URL: Record<CloudProvider, string>   // https://api.anthropic.com/v1, https://api.openai.com/v1, https://generativelanguage.googleapis.com/v1beta
  export function adapterFor(p: ProviderId): Adapter     // openai and local → openaiCompat
  ```
- Anthropic: `POST <base>/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, body `{ model, max_tokens: 8192, system, messages, stream: true }`; yield `delta.text` from `content_block_delta` events whose `delta.type` is `text_delta`; an `error` event throws `ProviderError` with `Anthropic returned an error: <error.message>`; stop at `message_stop`.
- Google: `POST <base>/models/<model>:streamGenerateContent?alt=sse`, header `x-goog-api-key`, body `{ systemInstruction: { parts: [{ text }] }, contents: [{ role: 'user' | 'model', parts: [{ text }] }] }`; yield the joined `candidates[0].content.parts[].text` of each event.

- [ ] **Step 1: Write failing tests** (fake `fetch`):
  - `anthropic.test.ts`: `streams text deltas and sends the version header` (events `message_start`, `content_block_delta` ×2, `ping`, `message_stop` → `['Hi',' there']`; headers and `max_tokens: 8192` checked; the key is not in the URL); `an error event becomes a ProviderError`; `lists models with display names`
  - `google.test.ts`: `streams text and maps assistant to model` (request `contents[1].role === 'model'`, key sent as header not query); `lists gemini models that generate content` (drops `embedding-001`, strips `models/`)
- [ ] **Step 2: Run** `npm test -- anthropic google` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: Anthropic and Google provider adapters`.

---

### Task 5: Chat service and AI IPC

**Files:**
- Create: `src/main/ai/instructions.ts`, `src/main/ai/chatService.ts`, `chatService.test.ts`, `src/main/ai/aiConfig.ts`, `aiConfig.test.ts`
- Modify: `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts` (`CanonballApi`), test stubs of `window.canonball` so they typecheck

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
  ```ts
  // instructions.ts
  export const CHAT_INSTRUCTIONS: string
  // aiConfig.ts — glue between settings, secrets and adapters
  export interface AiConfig {
    status(): Promise<AiStatus>
    setApiKey(p: CloudProvider, key: string | null): Promise<AiStatus>
    setLocalUrl(url: string | null): Promise<AiStatus>
    setModel(choice: ModelChoice | null): Promise<AiStatus>
    resolve(p: ProviderId): Promise<ProviderConfig>   // throws ProviderError `Add a <Label> API key in Settings.` / `Add a local server URL in Settings.`
    listModels(): Promise<ModelList>                  // configured providers only, in parallel
  }
  export function createAiConfig(deps: { settings: SettingsStore; secrets: SecretStore; fetch: FetchFn }): AiConfig
  // chatService.ts
  export interface ChatService {
    start(req: ChatRequest, send: (e: ChatEvent) => void): void
    cancel(requestId: string): void
    cancelAll(): void
  }
  export function createChatService(deps: { resolve: AiConfig['resolve']; fetch: FetchFn }): ChatService
  ```
  `CHAT_INSTRUCTIONS` text: `You are the assistant inside Canonball, a writing app. The writer writes the prose. You keep notes, answer questions and help them think things through. Don't write, continue or rewrite their manuscript unless they ask for a sample passage, and label any sample as a sample for their notes. You can't see the project's files yet, so when a question depends on them, say so and ask the writer to paste the part you need.`
- `start` emits deltas, then exactly one `done` (`stopped: true` after `cancel`) or one `error` (non-`ProviderError` errors become `Something went wrong talking to <Label>.` and are logged without the request). A duplicate active `requestId` is ignored.
- `CanonballApi` gains (channels `canonball:<name>`):
  ```ts
  getAiStatus(): Promise<AiStatus>
  setApiKey(provider: CloudProvider, key: string | null): Promise<AiStatus>
  setLocalUrl(url: string | null): Promise<AiStatus>
  setModel(choice: ModelChoice | null): Promise<AiStatus>
  listModels(): Promise<ModelList>
  startChat(req: ChatRequest): Promise<void>     // events arrive on onChatEvent
  cancelChat(requestId: string): Promise<void>
  onChatEvent(handler: (e: ChatEvent) => void): () => void
  ```
  Main validates every argument (`parseChatRequest`, `parseModelChoice`, provider membership, string-or-null) and throws `Invalid argument`. Events go to the invoking `webContents` (skipped if destroyed). `openProject` and window close call `cancelAll()`. `secrets` uses `safeStorage` with file `<userData>/secrets.json`. `setSettings` keeps only a valid `theme`.

- [ ] **Step 1: Write failing tests**
  - `aiConfig.test.ts` (fake secrets, temp settings file, fake fetch): `status never contains key text` (`JSON.stringify(await status())` has no `sk-`); `listModels queries only configured providers and keeps the others when one fails` (OpenAI 401 + local OK → local models plus one OpenAI error); `resolve without a key asks for one in Settings`; `setLocalUrl normalizes and clears`
  - `chatService.test.ts` (fake adapter via fake fetch, or inject `resolve` returning a local config): `streams deltas then done`; `cancel ends with done stopped:true and aborts the fetch signal`; `a provider error becomes an error event`; `an unexpected error is reported without details`
- [ ] **Step 2: Run** `npm test -- aiConfig chatService` → FAIL.
- [ ] **Step 3: Implement** the modules, IPC handlers, preload methods and types.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat: streaming chat service and AI settings IPC`.

---

### Task 6: Chat storage in `.canonball/chats/`

**Files:**
- Create: `src/main/chats.ts`, `src/main/chats.test.ts`
- Modify: `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts`, test stubs

**Interfaces:**
- Consumes: `parseChatThread`, `CHAT_ID_RE` (Task 1); `writeDoc`, `resolveInside`, `requireCurrentRoot` (`projectFs.ts`).
- Produces (`src/main/chats.ts`):
  ```ts
  export const CHATS_REL = '.canonball/chats'
  export function listChats(root: string): Promise<ChatSummary[]>   // newest updatedAt first; [] when the folder is missing
  export function loadChat(root: string, id: string): Promise<ChatThread>  // throws 'Chat not found' / 'Chat file is unreadable'
  export function saveChat(root: string, thread: ChatThread): Promise<void> // throws 'Invalid chat'
  ```
- `CanonballApi` gains `listChats(): Promise<ChatSummary[]>`, `loadChat(id: string): Promise<ChatThread>`, `saveChat(root: string, thread: ChatThread): Promise<void>` (`'Project changed'` guard via `requireCurrentRoot`; `listChats`/`loadChat` use the open project).

- [ ] **Step 1: Write failing tests** in `chats.test.ts` (temp dir):
  - `listing a project without chats writes nothing` (`[]`, `.canonball` doesn't exist afterward)
  - `save then load round-trips` (file at `.canonball/chats/<id>.json`, 2-space indent, trailing newline)
  - `saving adds a gitignore inside the chats folder` (`.canonball/chats/.gitignore` reads `*\n`; an existing one is left alone)
  - `lists newest first`
  - `skips unreadable chat files` (a `<uuid>.json` with `{oops` is not listed; `loadChat` on it rejects `Chat file is unreadable`; saving a different thread leaves it byte-identical)
  - `rejects invalid ids and shapes` (`loadChat(root, '../x')` rejects; `saveChat` with role `'system'` rejects `Invalid chat`)
- [ ] **Step 2: Run** `npm test -- chats` → FAIL.
- [ ] **Step 3: Implement** `chats.ts`, IPC, preload, types.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: save chat threads in .canonball/chats`.

---

### Task 7: Settings dialog and menu command

**Files:**
- Create: `src/renderer/src/settings/SettingsDialog.tsx`, `SettingsDialog.test.tsx`
- Modify: `src/main/menu.ts`, `menu.test.ts`, `src/shared/types.ts` (`MenuCommand`), `src/renderer/src/App.tsx`, `App.test.tsx`, `src/renderer/src/assets/main.css`

**Interfaces:**
- Consumes: `getAiStatus`, `setApiKey`, `setLocalUrl`, `listModels` (Task 5); `CLOUD_PROVIDERS`, `PROVIDER_LABEL`.
- Produces: `SettingsDialog(props: { onClose(): void; onChanged(): void })`, a `role="dialog"` `aria-modal="true"` overlay titled `AI connections` reusing `.cb-dialog` styles. Per cloud provider: heading with the label, status text `Saved in Keychain` or `Not set`, a `type="password"` input `aria-label="<Label> API key"` (placeholder `Paste API key`, cleared after saving), **Save**, and **Remove** when set. A `Local server` row with a URL input (`aria-label="Local server URL"`, placeholder `http://localhost:11434`, prefilled), **Save**, **Remove**. Under the rows, after load and after each change, a `Connection check` list from `listModels()`: `<Label>: <n> models` or `<Label>: <error>`. Errors from saving show in `.cb-dialog-error`. **Done** and Escape call `onClose`. When `encryptionAvailable` is false, key inputs are disabled and the Keychain copy from Rulings is shown. Each successful change calls `onChanged`.
- `MenuCommand` gains `'open-settings'`; the File menu gets `Settings…` (`CmdOrCtrl+,`) above the separator. `App`'s menu handler switches on the command (today it treats anything not `open-project` as new-project) and opens the dialog on the welcome screen or in a project. `App` keeps `aiVersion: number`, bumped by `onChanged`, for Task 8.

- [ ] **Step 1: Write failing tests**
  - `SettingsDialog.test.tsx`: `shows which keys are saved without showing them` (status with `openai: true` → OpenAI says `Saved in Keychain`, inputs are empty); `saving a key calls setApiKey and clears the input` (and `onChanged` called); `Remove clears the key` (`setApiKey('openai', null)`); `shows a save error` (rejecting `setLocalUrl` → its message in the dialog); `lists the connection check` (`OpenAI: 2 models`, `Local server: Couldn't reach…`); `disables keys when the Keychain is unavailable`
  - `menu.test.ts`: `File menu has Settings with Cmd+,` sending `'open-settings'`
  - `App.test.tsx`: `the settings menu command opens the dialog and does not create a project`
- [ ] **Step 2: Run** `npm test -- SettingsDialog menu App` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat: AI connections settings dialog`.

---

### Task 8: Chat panel with model picker and streaming

**Files:**
- Create: `src/renderer/src/chat/ChatPanel.tsx`, `ChatPanel.test.tsx`, `src/renderer/src/chat/chatMarkdown.tsx`, `chatMarkdown.test.tsx`, `src/renderer/src/chat/chat.css`
- Delete: `src/renderer/src/chat/ChatPlaceholder.tsx`
- Modify: `src/renderer/src/App.tsx`, `App.test.tsx`, `src/renderer/src/assets/main.css` (chat panel layout)

**Interfaces:**
- Consumes: Task 5 and 6 API methods; Task 1 types, `chatTitle`, `PROVIDER_LABEL`.
- Produces: `renderChatMarkdown(text: string): React.ReactNode` and `ChatPanel(props: { root: string; aiVersion: number; onOpenSettings(): void })`. `App` renders `<ChatPanel key={project.root} … />` in the chat aside.
- Layout, top to bottom: header with a `<select aria-label="Model">` (`<optgroup>` per provider label, option value `` `${provider}:${model}` ``, a disabled `Choose a model` option when none is chosen; changing it calls `setModel`), a `<select aria-label="Chat">` of thread titles (newest first) plus **New chat**, and the gear button `aria-label="AI settings"`; per-provider model errors as muted text under the header; the conversation `role="log"` (writer messages plain text, replies through `renderChatMarkdown`); an error `role="alert"`; a `<textarea aria-label="Message">` where Enter sends and Shift+Enter adds a line, and a **Send** button that becomes **Stop** while streaming.
- With no connections configured the conversation area shows `Add an AI connection in Settings to start chatting.` with a button opening settings. Send is disabled with no model or an empty message.
- On mount: `listChats`; load the newest thread (or start an empty one), `getAiStatus` + `listModels`; refetch models when `aiVersion` changes. Send: append the user message (`at` = ISO time; new threads get `crypto.randomUUID()` and `chatTitle`), `saveChat`, `startChat` with a fresh `requestId` and the thread's turns, append an empty assistant message with `model` and fill it from `delta` events for that `requestId` only. On `done`/`error` follow the Rulings (keep partial, drop empty, show error, save). Unmount calls `cancelChat` for an active request.

- [ ] **Step 1: Write failing tests**
  - `chatMarkdown.test.tsx`: `renders paragraphs, headings, lists and emphasis without raw syntax` (`'# Ideas\n\n- **one**\n- _two_\n\nUse `x`.'` → an `h3`-or-lower heading `Ideas`, two `li`, a `strong`, an `em`, a `code`; text has no `**`, `#` or backticks); `never injects HTML` (`'<img src=x onerror=alert(1)>'` renders as text, no `img` element)
  - `ChatPanel.test.tsx` (stub `window.canonball`, capture the `onChatEvent` handler): `lists models grouped by provider and saves the choice`; `streams a reply into the conversation` (type, Enter → `saveChat` called with the user message and the derived title, `startChat` called; deltas `Hel`,`lo` then `done` → `Hello` shown and `saveChat` called again with two messages); `ignores events for other requests`; `stop keeps the partial reply and saves it` (Stop → `cancelChat(requestId)`; `done stopped:true` → partial text kept, saved, textarea enabled); `shows provider errors and drops an empty reply` (`error` event → alert with the message; saved thread has only the user message); `Shift+Enter adds a line instead of sending`; `prompts to add a connection when none is configured`; `opens the newest saved chat on mount`; `switching threads is disabled while streaming`
- [ ] **Step 2: Run** `npm test -- chatMarkdown ChatPanel` → FAIL.
- [ ] **Step 3: Implement.** Writer messages sit right-aligned on `--active` with `--active-text`; replies use `--text` on the panel background.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck`, `npm run lint`, `npm run build` → clean.
- [ ] **Step 5: Commit** `feat: chat panel with model picker and streamed replies`.

---

## Finishing

- Update `OPEN_WORK.md` "Notes for later phases" with a Phase 4 block (where adapters live, `aiConfig.resolve`, `CHAT_INSTRUCTIONS` is where Phase 5 adds style rules and tools, partial-reply loss on switch/close, no request timeout, one local URL), move Phase 4 to `COMPLETED_WORK.md`, and mark the roadmap row's plan with this file name.
