# Phase 5: AI File Tools & Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI can list and read the files the writer lets it see, and propose edits and new files that appear in the chat as Accept/Reject cards; nothing is written until the writer accepts, prose is never written, models without tool calling get the readable files in the prompt instead, and `style_rules.md`, `names_to_avoid.md` and the rest of `memory/` shape the AI's instructions.

**Architecture:** Everything that touches files stays in main. Each adapter learns tool calling and yields a stream of text and tool-call parts. The chat service runs a tool loop per writer message: `list_files`/`read_file` answer from `createAiAccess(root)`; `propose_edit`/`create_note` are validated against the access layer and the file on disk and become in-memory `Proposal`s that are pushed to the renderer as a `proposal` chat event. The writer's **Accept** calls `applyProposal`, and main writes through `aiAccess.write`/`create` only after checking the file still holds the text the proposal was built from. Models that reject tools get a fallback prompt with packed files and a tagged edit format that main parses into the same proposals.

**Tech Stack:** Electron 44, React 19, TypeScript, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-canonball-app-design.md` (sections "AI permissions", "Connecting the AI", "The screen › Right: AI chat", "Style rules and names to avoid", "Anti-goals"). Earlier interfaces: the Phase 3 plan (`createAiAccess`) and Phase 4 plan (adapters, `chatService`, `ChatPanel`); the code is the authority where they differ.

## Rulings (calls made without the author)

- Ruling: four tools, named `list_files`, `read_file`, `propose_edit`, `create_note`. `create_note` creates any new `.md` file in a ✎ folder (`canon/` included, per spec), despite its name.
- Ruling: `propose_edit` takes `{ path, edits: [{ old_text, new_text }] }`. Each `old_text` must occur exactly once in the current file and edits must not overlap; they are applied together. Errors go back to the model as tool results: `old_text not found in <path>: "<first 60 chars>"`, `old_text appears <n> times in <path>; include more surrounding text`, `Edits overlap in <path>`. All changes to one file belong in one call (said in the tool description).
- Ruling: `create_note` takes `{ path, content }`. A path without `.md` gets `.md` appended. It never overwrites and makes no folders (the access layer already enforces both).
- Ruling: `read_file` returns at most 100,000 characters, then `\n\n[Truncated: the file is longer than 100000 characters.]`. `list_files` returns one line per file: `<path> (can edit)` or `<path> (read only)`, or `No files are visible to you.`
- Ruling: access errors (`AccessDenied`, including `Prose is never edited by the AI: …`) are returned to the model as error tool results with their message, never thrown to the writer. Unexpected errors become `Something went wrong with that file.` and are logged without file content.
- Ruling: a proposal stores the full `before` and `after` text. On Accept, main re-reads the file through `aiAccess.read`; if it no longer equals `before`, nothing is written and the card shows `This file changed after the AI suggested the edit. Ask again for a fresh suggestion.` This content check stands in for the missing `writeDoc` mtime precondition for AI writes.
- Ruling: before Accept, the renderer saves everything typed (`flushAll()`), so the writer's unsaved text in that file makes the content check fail rather than being overwritten. After a successful Accept the open editor of that file reloads (if it isn't dirty) and the tree refreshes.
- Ruling: proposals live in main memory, keyed by a main-generated UUID, together with the project root. Switching projects clears them. A proposal main no longer holds (app restarted) fails on Accept with `This suggestion is no longer available. Ask the AI again.` and the card shows that. Reject just drops it in main (unknown ids are ignored).
- Ruling: proposals are saved in the chat file on the assistant message (`proposals: Proposal[]`) with their status, `pending | accepted | rejected | failed`, plus `error` for `failed`. Cards can be accepted or rejected while a reply is still streaming.
- Ruling: history sent to the model is text only (tool calls and results aren't persisted). Each assistant turn that carried proposals gets a line appended per proposal: `[Suggested an edit to <path>: <status>]` / `[Suggested a new file <path>: <status>]`, so the model knows what the writer accepted.
- Ruling: at most 10 tool rounds per writer message. After the 10th round's results the loop ends with a delta `\n\n(I stopped after 10 file steps. Ask me to continue if you need more.)` and `done`.
- Ruling: fallback mode is used when a request with tools fails with HTTP 400, 404, 422 or 501 and the error body matches `/tool|function/i` (Ollama: `… does not support tools`). The same request is retried once without tools in fallback mode, and the `provider:model` pair is remembered for the rest of the app session. No notice is shown.
- Ruling: the fallback prompt packs whole readable files, at most 24,000 characters in total, in this order: `memory/`, `canon/`, `notes/`, `outline/`, `sessions/`, everything else, prose last; within a group by path. A file that doesn't fit is skipped (smaller later files may still fit) and the skipped paths are listed. Each file is `<file path="<path>" access="edit|read">\n<content>\n</file>`.
- Ruling: fallback edits use tags the model writes in its reply: `<canonball-edit path="…"><old>…</old><new>…</new></canonball-edit>` (one or more old/new pairs) and `<canonball-create path="…">content</canonball-create>`. Main filters these out of the streamed text as it arrives (nothing from `<canonball-` to the closing tag reaches the writer) and turns each into a proposal through the same validation as the tools. A rejected block becomes a muted line in the reply: `(Couldn't suggest that change: <reason>)`.
- Ruling: the system prompt is built per request by `buildInstructions` from the base text, the tool or fallback rules, and `memory/`. Memory files are read through `aiAccess`, so a ⊘ on `memory/` or a file keeps it out. `memory/style_rules.md` is introduced with `Whenever you write any sample passage, prose or dialogue (only ever into chat or a note, never a draft), follow these style rules:`; `memory/names_to_avoid.md` with `Whenever you suggest names, never use any of these:`; other `memory/*.md` (top level only) under `Project memory (how the writer works and wants you to talk):`. Each file is capped at 20,000 characters.
- Ruling: Anthropic tool calls use `tools: [{ name, description, input_schema }]`; OpenAI/local use `tools: [{ type: 'function', function: { name, description, parameters } }]`; Google uses `tools: [{ functionDeclarations: [...] }]` and the parameter schemas avoid `additionalProperties` so all three accept them. Google `functionCall` parts are replayed exactly as received (including `thoughtSignature`), kept in `ToolCall.meta`.
- Ruling: proposal cards name the file without `.md` (spec: no extensions). They show a line diff with unchanged runs collapsed to 2 lines of context around changes (`…` between), removed lines struck through on `--del-bg`, added lines on `--add-bg` (new theme tokens, light and dark).
- Ruling: `ChatPanel.tsx` is split before it grows: the header (model and thread pickers) moves to `ChatHeader.tsx`, the message list to `ChatLog.tsx`.

## Global Constraints

- **The AI never edits prose folders.** No tool, fallback block or Accept path may write to a prose folder; the access layer refuses, and tests prove it end to end.
- **Nothing is written until the writer presses Accept.** Proposing writes nothing. An accepted AI edit is written by main through `aiAccess.write`/`create` only, never the renderer's `writeDoc`.
- The app never writes a file the writer didn't change; Reject writes nothing.
- The renderer touches the disk only through `window.canonball`. Every IPC argument is validated in main; `applyProposal` goes through `requireCurrentRoot(currentRoot, root)`.
- Keys and project content go only to the provider the writer chose. Tests never hit the network (injected `fetch`).
- Colours only from tokens in `src/renderer/src/theme/theme.css`; no pure white or black.
- `contextIsolation: true`, `nodeIntegration: false`.

## Review Focus

1. **The writer edits the file between suggestion and Accept** (or has unsaved typing in it): Accept must write nothing and say the file changed (Task 3: `refuses when the file changed since the proposal`; Task 9: `accept saves typed text first`).
2. **A folder becomes prose (or ⊘) after the proposal was made**: Accept must be refused by the access layer at write time (Task 3: `accept is refused if the folder became prose`).
3. **A model that calls a tool with garbage arguments** (missing `path`, `edits` not an array, unparsable JSON in a stream): the model gets an error result, the chat keeps going (Task 4: `bad arguments become error results`; Task 2: `unparsable tool arguments become an empty object`).
4. **Fallback tags split across stream chunks** (`<canon` | `ball-edit …`): no tag text reaches the writer and the proposal is still parsed (Task 5: `filters tags split across chunks`).
5. **A restarted app showing an old pending card**: Accept fails with the "no longer available" copy rather than writing or crashing (Task 3: `unknown proposal ids fail with the expired copy`; Task 9: `an expired proposal shows its error`).

---

### Task 1: Shared proposal types, diff and model turns

**Files:**
- Create: `src/shared/proposals.ts`, `src/shared/proposals.test.ts`, `src/shared/diff.ts`, `src/shared/diff.test.ts`
- Modify: `src/shared/ai.ts`, `src/shared/ai.test.ts`

**Interfaces:**
- Produces (`src/shared/proposals.ts`):
  ```ts
  export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'failed'
  export interface Proposal {
    id: string               // CHAT_ID_RE uuid
    kind: 'edit' | 'create'
    relPath: string
    before: string           // '' for create
    after: string
    status: ProposalStatus
    error?: string           // only when status === 'failed'
  }
  export function parseProposal(x: unknown): Proposal | null
  export function displayPath(relPath: string): string        // strips a trailing .md
  export function proposalNote(p: Proposal): string           // the Rulings' `[Suggested …: <status>]` line
  export const EXPIRED_PROPOSAL = 'This suggestion is no longer available. Ask the AI again.'
  export const CHANGED_SINCE_PROPOSAL = 'This file changed after the AI suggested the edit. Ask again for a fresh suggestion.'
  ```
- Produces (`src/shared/diff.ts`):
  ```ts
  export interface DiffLine { kind: 'same' | 'add' | 'del'; text: string }
  export function diffLines(before: string, after: string): DiffLine[]
  export type DiffRow = DiffLine | { kind: 'gap' }
  export function collapseDiff(lines: DiffLine[], context = 2): DiffRow[]
  ```
  `diffLines` trims the common prefix and suffix, then runs an LCS on the middle; if the middle is over 4,000,000 cells it emits all `del` then all `add`.
- Modifies (`src/shared/ai.ts`): `ChatMessage` gains `proposals?: Proposal[]` (validated by `parseChatThread` via `parseProposal`); `ChatEvent` gains `| { requestId: string; kind: 'proposal'; proposal: Proposal }`; new `export function turnsForModel(messages: ChatMessage[]): ChatTurn[]` (role and content, with `proposalNote` lines appended to assistant turns that have proposals, separated by a blank line).

- [ ] **Step 1: Write failing tests**
  - `diff.test.ts`: `marks added and removed lines` (`'a\nb\nc'` → `'a\nB\nc'` gives same a, del b, add B, same c); `create diffs as all added` (`''` → `'x\ny'` gives two `add`, no `del` of an empty line); `collapses long unchanged runs` (20 same lines, one change at line 10 → 2 context lines each side and a `gap` at both ends)
  - `proposals.test.ts`: `parseProposal accepts a valid proposal and rejects bad shapes` (bad id, kind `'delete'`, status `'maybe'`, non-string `after`); `displayPath strips .md` (`notes/ideas.md` → `notes/ideas`, `notes/a.txt` unchanged); `proposalNote` (`edit` accepted → `[Suggested an edit to notes/ideas.md: accepted]`; create pending → `[Suggested a new file notes/x.md: pending]`)
  - `ai.test.ts`: `parseChatThread keeps valid proposals and rejects invalid ones`; `turnsForModel appends proposal notes to assistant turns`
- [ ] **Step 2: Run** `npm test -- src/shared` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- src/shared` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: shared proposal types, line diff and model turns`.

---

### Task 2: Tool calling in the provider adapters

**Files:**
- Modify: `src/main/ai/adapter.ts`, `openaiCompat.ts`, `openaiCompat.test.ts`, `anthropic.ts`, `anthropic.test.ts`, `google.ts`, `google.test.ts`, `errors.ts`, `errors.test.ts`, `chatService.ts` (only to compile against the new `streamChat`)

**Interfaces:**
- Produces (`adapter.ts`):
  ```ts
  export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }  // JSON Schema object
  export interface ToolCall { id: string; name: string; args: Record<string, unknown>; meta?: unknown }
  export interface ToolResult { callId: string; name: string; content: string; isError: boolean }
  export type AiMessage =
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
    | { role: 'tool'; results: ToolResult[] }      // answers the previous assistant's toolCalls
  export type StreamPart = { type: 'text'; text: string } | { type: 'tool_call'; call: ToolCall }
  export interface StreamArgs { model: string; system: string; messages: AiMessage[]; tools?: ToolSpec[]; signal: AbortSignal }
  export interface Adapter {
    listModels(cfg: ProviderConfig, fetchFn: FetchFn): Promise<ModelInfo[]>
    streamChat(cfg: ProviderConfig, args: StreamArgs, fetchFn: FetchFn): AsyncIterable<StreamPart>
  }
  export function toAiMessages(turns: ChatTurn[]): AiMessage[]   // mergeTurns, then map
  ```
- Produces (`errors.ts`): `ProviderError` gains readonly `status?: number` and `body?: string`, set by `httpError` (message unchanged); `export function rejectsTools(err: unknown): boolean` (Rulings: status 400/404/422/501 and body matching `/tool|function/i`).
- Each adapter sends `tools` only when `args.tools` is non-empty, and yields each tool call once, complete, after its arguments finish streaming. Arguments that don't parse as a JSON object become `{}`. Adjacent same-role text messages are still merged.
  - OpenAI/local: accumulate `delta.tool_calls[i]` by `index` (`id`, `function.name`, `function.arguments` fragments); emit when the stream ends (`[DONE]` or `finish_reason`). Assistant replay `{ role: 'assistant', content: content || null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }`; tool results as one `{ role: 'tool', tool_call_id, content }` per result.
  - Anthropic: `content_block_start` with `content_block.type === 'tool_use'` opens a call (`id`, `name`), `input_json_delta.partial_json` accumulates, `content_block_stop` emits. Replay assistant content blocks `[{ type: 'text', text }?, { type: 'tool_use', id, name, input }]`; results as a `user` message of `{ type: 'tool_result', tool_use_id, content, is_error }` blocks.
  - Google: a part with `functionCall` emits `{ id: 'call_<n>', name, args, meta: <the whole part> }`. Replay: `model` content whose parts are the text part (if any) plus each `meta` part as received; results as a `user` content of `{ functionResponse: { name, response: { content } } }` parts (`{ error: content }` when `isError`).

- [ ] **Step 1: Write failing tests** (fake `fetch`, existing helpers):
  - `openaiCompat.test.ts`: update text tests to `StreamPart`s; `streams a tool call split across chunks` (two `tool_calls` deltas with `arguments` `'{"pa'` and `'th":"a.md"}'` → one `tool_call` `{ id:'c1', name:'read_file', args:{path:'a.md'} }`; request body has `tools[0].type === 'function'`); `sends no tools field without tools`; `replays tool calls and results` (messages `[user, assistant+toolCalls, tool]` → body has `tool_calls[0].function.arguments === '{"path":"a.md"}'` and a `role:'tool'` message with `tool_call_id`); `unparsable tool arguments become an empty object`
  - `anthropic.test.ts`: `streams text then a tool use` (`content_block_start` tool_use, two `input_json_delta`, `content_block_stop` → text part then `tool_call`); `replays tool_use and tool_result blocks` (with `is_error: true`); `sends input_schema tools`
  - `google.test.ts`: `emits function calls and replays them with their signature` (part `{ functionCall:{name:'list_files',args:{}}, thoughtSignature:'sig' }` → `tool_call` whose replay request has that exact part and a `functionResponse` part); `sends functionDeclarations`
  - `errors.test.ts`: `rejectsTools spots tool-unsupported errors` (400 `{"error":"registry.ollama.ai/library/gemma does not support tools"}` → true; 400 `bad request` → false; 500 mentioning tools → false; a non-ProviderError → false)
- [ ] **Step 2: Run** `npm test -- src/main/ai` → FAIL.
- [ ] **Step 3: Implement.** In `chatService.ts`, pass `toAiMessages(req.messages)` and forward only `text` parts for now.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: tool calling in the provider adapters`.

---

### Task 3: Access checks and the proposal store

**Files:**
- Modify: `src/main/aiAccess.ts`, `src/main/aiAccess.test.ts`
- Create: `src/main/ai/proposals.ts`, `src/main/ai/proposals.test.ts`

**Interfaces:**
- Consumes: Task 1 `Proposal`, `EXPIRED_PROPOSAL`, `CHANGED_SINCE_PROPOSAL`.
- Produces (`aiAccess.ts`): `AiAccess` gains `checkWrite(relPath): Promise<string>` and `checkCreate(relPath): Promise<string>`, each returning the canonical path or throwing the same `AccessDenied` that `write`/`create` throw today (`write`/`create` call them, so the rules live once). `checkCreate` also refuses an existing file (`File already exists: <path>`) and a missing folder.
- Produces (`src/main/ai/proposals.ts`):
  ```ts
  export interface EditSpec { old_text: string; new_text: string }
  export interface ProposalStore {
    /** Validates against access and disk; returns the pending proposal or throws AccessDenied / ProposalError. Writes nothing. */
    proposeEdit(root: string, access: AiAccess, relPath: string, edits: EditSpec[]): Promise<Proposal>
    proposeCreate(root: string, access: AiAccess, relPath: string, content: string): Promise<Proposal>
    /** Writes through createAiAccess(root) after the content check; forgets the proposal. */
    apply(root: string, id: string): Promise<{ relPath: string }>
    reject(id: string): void
    clear(): void
  }
  export class ProposalError extends Error {}   // name 'ProposalError'; message goes back to the model
  export function createProposalStore(deps?: { access?: (root: string) => AiAccess }): ProposalStore  // default createAiAccess
  export function applyEdits(text: string, edits: EditSpec[], relPath: string): string               // throws ProposalError with the Rulings copy
  ```
  `proposeEdit` uses `checkWrite`, then `read`; `relPath` on the proposal is the canonical path. An edit whose result equals the file is refused with `That edit doesn't change <path>`. `apply` on an unknown id or another root throws `Error(EXPIRED_PROPOSAL)`; for `edit` it re-reads and compares to `before` (mismatch → `Error(CHANGED_SINCE_PROPOSAL)`, proposal kept so Reject still works), then `access.write`; for `create` it calls `access.create`. Access failures at apply time propagate their message and the proposal is forgotten.

- [ ] **Step 1: Write failing tests** (temp project dir with `DEFAULT_PROJECT_SETTINGS`, `notes/ideas.md`, `drafts/ch1.md`)
  - `aiAccess.test.ts`: `checkWrite and checkCreate refuse what write and create refuse` (prose, read-only, hidden, existing file, missing folder) and write nothing
  - `proposals.test.ts`: `applyEdits replaces unique text` and its three error copies (not found, appears 2 times, overlap); `proposing writes nothing` (file bytes and mtime unchanged after `proposeEdit` and `proposeCreate`; the created path doesn't exist); `refuses edits to prose` (`drafts/ch1.md` → `AccessDenied` `Prose is never edited by the AI: drafts/ch1.md`); `accept writes the edit` (`apply` → file holds `after`); `accept creates the new file`; `refuses when the file changed since the proposal` (change the file, `apply` rejects `CHANGED_SINCE_PROPOSAL`, file keeps the writer's text); `accept is refused if the folder became prose` (propose on `notes/ideas.md`, then `setProsePaths(root, ['drafts','notes'])`, `apply` rejects, file unchanged); `unknown proposal ids fail with the expired copy`; `reject forgets the proposal` (later `apply` → expired); `clear forgets everything`
- [ ] **Step 2: Run** `npm test -- aiAccess proposals` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: proposal store that writes only after Accept`.

---

### Task 4: File tools and the instructions builder

**Files:**
- Create: `src/main/ai/tools.ts`, `src/main/ai/tools.test.ts`, `src/main/ai/instructions.test.ts`
- Modify: `src/main/ai/instructions.ts`

**Interfaces:**
- Consumes: Task 2 `ToolSpec`, `ToolCall`, `ToolResult`; Task 3 `ProposalStore`, `ProposalError`, `AccessDenied`.
- Produces (`tools.ts`):
  ```ts
  export const FILE_TOOLS: ToolSpec[]    // list_files, read_file, propose_edit, create_note
  export interface ToolRunner { run(call: ToolCall): Promise<ToolResult> }
  export function createToolRunner(deps: {
    root: string; access: AiAccess; proposals: ProposalStore; onProposal(p: Proposal): void
  }): ToolRunner
  ```
  Results for proposals: `Suggested. The writer will see an Accept/Reject card; nothing changes until they accept.` Unknown tool → error `Unknown tool: <name>`. Missing or wrongly typed arguments → error `<tool> needs <field>` (e.g. `propose_edit needs edits: a list of { old_text, new_text }`).
- Produces (`instructions.ts`):
  ```ts
  export const BASE_INSTRUCTIONS: string
  export const TOOL_INSTRUCTIONS: string
  export const FALLBACK_INSTRUCTIONS: string   // the tag format from the Rulings
  export interface MemoryFile { relPath: string; content: string }
  export function loadMemory(access: AiAccess): Promise<MemoryFile[]>   // visible top-level memory/*.md, capped per Rulings
  export function buildInstructions(opts: { mode: 'tools' | 'fallback' | 'none'; memory: MemoryFile[]; files?: string }): string
  ```
  `CHAT_INSTRUCTIONS` is removed. `BASE_INSTRUCTIONS`: `You are the assistant inside Canonball, a writing app. The writer writes the prose. You keep notes, answer questions and help them think things through. Never write, continue or rewrite their manuscript. If they ask for a sample passage, put it in the chat or in a note, label it as a sample, and never put it in a draft.` `TOOL_INSTRUCTIONS` says: use `list_files`/`read_file` before answering questions about the project; changes are only suggestions the writer accepts or rejects; files in prose folders (drafts) can never be changed, so don't try; put every change to one file in one `propose_edit`. Mode `none` (no project open) adds `No project is open, so you can't see any files.`

- [ ] **Step 1: Write failing tests** (temp project as in Task 3; real `createProposalStore`)
  - `tools.test.ts`: `list_files shows only visible files with their access` (hide `outline` → not listed; `notes/ideas.md (can edit)`, `drafts/ch1.md (read only)`); `read_file returns content and refuses hidden files` (error result, `isError: true`); `read_file truncates long files`; `propose_edit creates a proposal and writes nothing` (`onProposal` called once; disk unchanged); `propose_edit on a draft returns the prose error` (`isError`, message contains `Prose is never edited by the AI`, `onProposal` not called); `create_note appends .md`; `bad arguments become error results` (`{}`, `{path: 3}`, `edits: 'x'` → `isError`, no throw); `unknown tools are reported`
  - `instructions.test.ts`: `includes style rules and names to avoid with their framing` (template's `style_rules.md` text appears after the Rulings' style sentence); `leaves out hidden memory` (`memory` set to ⊘ → no style rules); `includes other memory as project memory`; `fallback mode carries the tag format and the files`; `tools mode names the tools`
- [ ] **Step 2: Run** `npm test -- tools instructions` → FAIL.
- [ ] **Step 3: Implement.** Update `chatService.ts`/its test to use `buildInstructions({ mode: 'none', memory: [] })` until Task 6.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: AI file tools and memory-aware instructions`.

---

### Task 5: Fallback for models without tool calling

**Files:**
- Create: `src/main/ai/fallback.ts`, `src/main/ai/fallback.test.ts`

**Interfaces:**
- Consumes: `AiAccess`; Task 3 `EditSpec`.
- Produces:
  ```ts
  export const FALLBACK_BUDGET = 24_000
  export function packFiles(access: AiAccess, prose: (relPath: string) => boolean, budget?: number): Promise<string>
  export type FallbackBlock =
    | { kind: 'edit'; relPath: string; edits: EditSpec[] }
    | { kind: 'create'; relPath: string; content: string }
    | { kind: 'invalid'; reason: string }
  export interface BlockFilter {
    push(chunk: string): string      // text safe to show now
    end(): { text: string; blocks: FallbackBlock[] }   // flushes; an unclosed tag is dropped as invalid
  }
  export function createBlockFilter(): BlockFilter
  ```
  `packFiles` follows the Rulings' order and format and ends with `Not included (too long to fit): <paths>` when any were skipped. The filter holds back any trailing text that could be the start of `<canonball-` and everything inside a tag; a lone `<` in prose (e.g. `a < b`) is released as soon as it can't be a tag. Inner `old`/`new` text is taken verbatim except one leading and one trailing newline. Attribute `path` is required (`invalid` with `missing path` otherwise).

- [ ] **Step 1: Write failing tests** (`fallback.test.ts`; fake `AiAccess` for `packFiles`)
  - `packs files in priority order within budget` (memory before canon before notes, drafts last; a 30,000-char file skipped and listed; a later small file still included)
  - `formats files with path and access`
  - `filters tags split across chunks` (chunks `'Here: <canon'`, `'ball-edit path="notes/a.md"><old>x</old><new>y</n'`, `'ew></canonball-edit> Done.'` → visible text `'Here:  Done.'`, one edit block `{ relPath:'notes/a.md', edits:[{old_text:'x', new_text:'y'}] }`)
  - `parses create blocks and multiple edits in one block`
  - `passes ordinary angle brackets through` (`'a < b and <em>'` → unchanged)
  - `an unclosed tag becomes invalid and its text stays hidden`
- [ ] **Step 2: Run** `npm test -- fallback` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test -- fallback` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: prompt fallback for models without tool calling`.

---

### Task 6: Tool loop in the chat service and proposal IPC

**Files:**
- Modify: `src/main/ai/chatService.ts`, `chatService.test.ts`, `src/main/ipc.ts`, `src/preload/index.ts`, `src/shared/types.ts` (`CanonballApi`), renderer test stubs of `window.canonball`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces (`chatService.ts`):
  ```ts
  export interface ChatService {
    start(req: ChatRequest, root: string | null, send: (e: ChatEvent) => void): void
    cancel(requestId: string): void
    cancelAll(): void
  }
  export function createChatService(deps: {
    resolve: AiConfig['resolve']; fetch: FetchFn; proposals: ProposalStore
    access?: (root: string) => AiAccess          // default createAiAccess
  }): ChatService
  export const MAX_TOOL_ROUNDS = 10
  ```
  Per request: build the access and memory once; mode `tools` with a root (unless the model is remembered as no-tools → `fallback`), `none` without. Loop: stream, forward text deltas, collect tool calls; if any, run them in order through `createToolRunner` (emitting `proposal` events), append the assistant message and the `tool` results, and go again, up to `MAX_TOOL_ROUNDS`. If the first request of a tools-mode reply throws and `rejectsTools(err)`, remember `provider:model`, switch to fallback (`packFiles` with the settings' prose test, `FALLBACK_INSTRUCTIONS`) and retry once. In fallback mode text goes through `createBlockFilter`; at the end each block becomes a proposal via the store (`proposal` event) or a delta `\n\n(Couldn't suggest that change: <reason>)`. Cancel behaviour is unchanged (proposals already emitted stay).
- `CanonballApi` gains:
  ```ts
  /** Rejects with 'Project changed', the expired copy, the changed copy, or an access message. */
  applyProposal(root: string, id: string): Promise<{ relPath: string }>
  rejectProposal(id: string): Promise<void>
  ```
  Main validates both as strings (`id` must match `CHAT_ID_RE`), checks `requireCurrentRoot` for apply, and calls the store. `startChat` passes `currentRoot`. `openProject` calls `proposals.clear()` with `cancelAllChats()`. `renderChatMarkdown` input is unaffected.

- [ ] **Step 1: Write failing tests** in `chatService.test.ts` (temp project; fake OpenAI-compatible `fetch` scripted per request):
  - update existing tests to the new `start` signature
  - `runs read tools and answers` (request 1 returns a `read_file` call for `notes/ideas.md`; request 2's body contains a `role:'tool'` message with the file text; its text deltas reach `send`; ends `done`)
  - `emits a proposal event and writes nothing` (a `propose_edit` call → one `proposal` event with `status:'pending'`; disk unchanged)
  - `stops after the tool round limit` (fetch always returns a `list_files` call → exactly `MAX_TOOL_ROUNDS` requests, the final delta is the Rulings' stop line, then `done`)
  - `falls back when the model rejects tools` (first request 400 `does not support tools`; retry body has no `tools` and its system prompt contains `<file path="notes/ideas.md"`; reply text `'Sure <canonball-edit path="notes/ideas.md"><old>…</old><new>…</new></canonball-edit>'` → deltas show `Sure ` only, one `proposal` event; a second `start` for the same model sends no `tools` at all)
  - `a fallback block for a draft is refused in the reply` (edit block on `drafts/ch1.md` → no proposal event, a delta containing `Couldn't suggest that change: Prose is never edited by the AI`)
  - `without a project no tools are offered`
- [ ] **Step 2: Run** `npm test -- chatService` → FAIL.
- [ ] **Step 3: Implement** the service, IPC handlers, preload methods and types.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat: tool loop and proposal channels in the chat service`.

---

### Task 7: End-to-end "never prose into drafts" tests

**Files:**
- Create: `src/main/ai/proseGuard.e2e.test.ts`

**Interfaces:**
- Consumes: `createProject` (real `template/`), `createChatService`, `createProposalStore`, `setProsePaths`. Tests only; if one fails, fix the code it exposes in this task.

- [ ] **Step 1: Write the tests** (a real project created from `template/` in a temp dir plus a `drafts/chapters/ch1.md`; a scripted fake model for each provider wire format; after every test, every file under `drafts/` is byte-identical to before):
  - `a tool-calling model can't propose an edit to a draft` (OpenAI, Anthropic and Google formats each try `propose_edit` and `create_note` into `drafts/chapters/` → error tool results, no proposal events)
  - `a fallback model can't propose an edit to a draft`
  - `a prose folder chosen by the writer is protected too` (`setProsePaths(root, ['manuscript'])` with `manuscript/one.md` → refused)
  - `case and dot-dot spellings don't get around it` (`DRAFTS/chapters/ch1.md`, `notes/../drafts/chapters/ch1.md` → refused)
  - `accepting a proposal never lands in drafts` (propose on `notes/x.md`, make `notes` prose, `apply` rejects)
  - `style rules and names to avoid reach the model` (the first request's system text contains the template's `style_rules.md` and `names_to_avoid.md` bodies)
- [ ] **Step 2: Run** `npm test -- proseGuard` → PASS (fix and rerun if not).
- [ ] **Step 3: Commit** `test: end-to-end proof the AI never writes prose`.

---

### Task 8: Split ChatPanel

**Files:**
- Create: `src/renderer/src/chat/ChatHeader.tsx`, `src/renderer/src/chat/ChatLog.tsx`
- Modify: `src/renderer/src/chat/ChatPanel.tsx`

**Interfaces:**
- Produces:
  ```ts
  ChatHeader(props: { status: AiStatus | null; models: ModelList | null; summaries: ChatSummary[]; threadValue: string; busy: boolean; onChooseModel(value: string): void; onChooseThread(id: string): void; onOpenSettings(): void })
  ChatLog(props: { messages: ChatMessage[]; busy: boolean; connected: boolean; onOpenSettings(): void; renderProposals?(messageIndex: number): React.ReactNode })
  ```
  `ChatLog` owns the auto-scroll ref. Pure refactor: markup, labels and behaviour unchanged.

- [ ] **Step 1: Run** `npm test -- ChatPanel` → PASS (baseline).
- [ ] **Step 2: Move the code.**
- [ ] **Step 3: Run** `npm test` → PASS unchanged; `npm run typecheck` and `npm run lint` → clean; `ChatPanel.tsx` under 300 lines.
- [ ] **Step 4: Commit** `refactor: split chat header and log out of ChatPanel`.

---

### Task 9: Accept/Reject cards

**Files:**
- Create: `src/renderer/src/chat/ProposalCard.tsx`, `ProposalCard.test.tsx`
- Modify: `src/renderer/src/chat/ChatPanel.tsx`, `ChatPanel.test.tsx`, `ChatLog.tsx`, `chat.css`, `src/renderer/src/theme/theme.css` (`--add-bg`, `--del-bg` in light and dark), `src/renderer/src/App.tsx`, `App.test.tsx`, `src/renderer/src/editor/Editor.tsx`, `Editor.test.tsx`

**Interfaces:**
- Consumes: Task 1 `Proposal`, `diffLines`, `collapseDiff`, `displayPath`, `turnsForModel`; Task 6 `applyProposal`, `rejectProposal`, `proposal` events; Task 8 `ChatLog.renderProposals`.
- Produces:
  ```ts
  ProposalCard(props: { proposal: Proposal; onAccept(): void; onReject(): void; busy: boolean })
  // ChatPanel gains: onFileChanged(relPath: string): void
  // Editor gains: reloadToken?: number   // a change reloads the file from disk unless dirty
  ```
  Card: `role="group"` `aria-label="Suggested edit to <displayPath>"` (or `Suggested new file <displayPath>`); heading `Edit <displayPath>` / `New file <displayPath>`; diff rows from `collapseDiff(diffLines(before, after))` (`del` rows in a `<del>`, `add` rows in an `<ins>`, gaps as `…`); while `pending`, **Accept** and **Reject** buttons; after, the text `Accepted`, `Rejected`, or the `error` in `role="alert"`.
- `ChatPanel`: a `proposal` event appends to the streaming assistant message's `proposals`. Accept: `busy` for that card, `await flushAll()` (from `editor/saveRegistry`; a failure marks the card `failed` with `Couldn't save your own changes first: <message>`), `applyProposal(root, id)`; success → `accepted` and `onFileChanged(relPath)`; failure → `failed` with the message. Reject → `rejected`, `rejectProposal(id)` (errors ignored). Every status change saves the thread. Sending uses `turnsForModel`.
- `App`: `onFileChanged` refreshes the tree and, when it is the open file, bumps the editor's `reloadToken`. `Editor`'s reload shares the focus handler's logic.

- [ ] **Step 1: Write failing tests**
  - `ProposalCard.test.tsx`: `shows the file without .md and the added and removed lines` (`<del>` has the old line, `<ins>` the new); `a new file shows only added lines`; `Accept and Reject call back`; `shows the outcome instead of buttons once decided`; `an expired proposal shows its error` (`failed` + `EXPIRED_PROPOSAL` → alert text)
  - `ChatPanel.test.tsx`: `a proposal event shows a card in the reply`; `accept applies, marks accepted, saves and reports the file` (`applyProposal(root, id)`, saved thread's proposal `status: 'accepted'`, `onFileChanged('notes/ideas.md')`); `accept saves typed text first` (`flushAll` mocked, called before `applyProposal`); `a failed accept shows the error on the card` (reject with `CHANGED_SINCE_PROPOSAL`); `reject marks rejected without writing` (`rejectProposal` called, `applyProposal` not); `the next message tells the model what was accepted` (`startChat` turns contain `[Suggested an edit to notes/ideas.md: accepted]`)
  - `App.test.tsx`: `an accepted change refreshes the tree and reloads the open file`
  - `Editor.test.tsx`: `reloadToken reloads a clean editor from disk`; `reloadToken leaves a dirty editor alone`
- [ ] **Step 2: Run** `npm test -- ProposalCard ChatPanel App Editor` → FAIL.
- [ ] **Step 3: Implement.** Card on `--bg` (the chat panel is `--bg-chat`) with a `--border` outline; `--add-bg`/`--del-bg` are low-contrast warm green/red tints readable under `--text` in both themes.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck`, `npm run lint`, `npm run build` → clean.
- [ ] **Step 5: Commit** `feat: Accept/Reject cards for AI edits and new files`.

---

## Finishing

- Update `OPEN_WORK.md` "Notes for later phases" with a Phase 5 block (tools in `src/main/ai/tools.ts`, proposals in `proposals.ts` held in memory, the content check on Accept, the fallback budget and tag format, the 10-round cap, `buildInstructions` is where Phase 6's brainstorm stance goes, writer typing during an Accept can still overwrite the AI edit because `writeDoc` has no precondition), move Phase 5 to `COMPLETED_WORK.md`, and mark the roadmap row's plan with this file name.
