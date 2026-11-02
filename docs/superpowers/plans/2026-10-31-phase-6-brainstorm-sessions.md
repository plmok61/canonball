# Phase 6: Brainstorm Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The writer starts a brainstorm session with a goal. The AI takes the v1 stance, having already read the readable canon, the notes and the previous session's "Next Session". When the writer ends the session, the AI drafts a log in `sessions/` from the template as an Accept/Reject card, followed by one card per locked-in decision it offers to move into `canon/`.

**Architecture:** A session is an ordinary chat thread with a `session` field (`goal`, `endedAt`). The renderer sends `session: { goal, phase }` with each request while the session is open. Main (`src/main/ai/sessions.ts`) turns that into an extra instructions block: the stance, the goal, the previous log's Next Session, and the readable canon and notes packed into the prompt. For `phase: 'end'` it also adds the log path, the date, the template and the promotion rules. The log and canon changes reuse Phase 5's tools, fallback tags and proposal cards unchanged. Per-decision cards on the same canon file can be accepted one after another, because the proposal store re-applies an edit's own `old_text`/`new_text` pairs when the file has moved on.

**Tech Stack:** Electron 44, React 19, TypeScript, Vitest + Testing Library. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-31-canonball-app-design.md` ("Brainstorm sessions (carried over from v1)", "AI permissions", "Style rules and names to avoid"). Earlier interfaces: the Phase 5 plan (`buildInstructions`, `packFiles`, `createProposalStore`, `createChatService`, `ChatPanel`/`useProposals`). Where the plans and the code differ, the code is the authority.

## Rulings (calls made without the author)

- Ruling: a session is a chat thread with `session: { goal: string; endedAt?: string }`. `ChatThread.version` stays `1` (the field is optional, so older files still load). The title is `chatTitle('Brainstorm: ' + goal)`.
- Ruling: the chat header gets a **Brainstorm** button (`aria-label="Start a brainstorm session"`, disabled while a reply streams or no model is chosen). It opens a form in place of the composer: label `What do you want to figure out?`, buttons **Start session** (disabled while the goal is blank) and **Cancel**. Starting creates a new thread and sends the goal as the first user message, so the AI opens the session straight away.
- Ruling: while a session thread is open and not ended, a banner above the log shows `Brainstorm: <goal>` and an **End session** button, disabled while a reply streams. Pressing it sends the user message `End the session and write the log.` with `phase: 'end'`. When that reply finishes with no error and wasn't stopped, `endedAt` is set and saved, and the banner shows `Brainstorm: <goal> · Ended` with no button. A failed or stopped end leaves the session open, so the writer can press End session again.
- Ruling: requests carry `session?: { goal: string; phase: 'brainstorm' | 'end' }` (goal 1–2,000 characters, otherwise the request is invalid). An ended session sends no `session`, so later messages in that thread are ordinary chat.
- Ruling: main adds the session block only when a project is open. Its layout is `SESSION_STANCE`, then `The writer's goal for this session: <goal>`, then the previous Next Session (if any), then the end rules (phase `end` only), then the packed files (tools mode only).
- Ruling, stance copy (`SESSION_STANCE`): `This is a brainstorm session. Open doors rather than closing them. Offer several directions, argue for the ones you find most interesting and say why. Ask questions that make the writer commit to a choice. Don't resolve things before the writer does, and don't treat an idea as settled until the writer says it is. You have already read the canon and notes included below, so build on them, and point out when an idea contradicts them.`
- Ruling, reading canon and notes before starting: in tools mode, every session request gets the readable `canon/` and `notes/` files packed into the prompt by `packFiles` (24,000-character budget, same format and skip list). Fallback mode already packs everything, so nothing is added there.
- Ruling, previous session: the session logs are the visible `sessions/*.md` files at the top level, except `README.md` and `session-template.md`. The newest is the one whose file name sorts last under `localeCompare(…, undefined, { numeric: true })`, so `session-10.md` comes after `session-9.md` and `2026-05-02.md` after `2026-04-30.md`. Its "Next Session" section runs from a heading matching `/^#{1,6}\s*Next Session\s*$/i` to the next heading of the same or a higher level. HTML comments are removed, the result is trimmed and capped at 4,000 characters, and it is introduced as `Where the last session (<relPath>) said to pick up:`. A missing or empty section adds nothing.
- Ruling, log path: `sessions/session-<N>.md`, where `N` is one more than the highest `session-<N>.md` among the visible session logs (`1` if there are none). The date is the main process's local `YYYY-MM-DD` (injectable `now` for tests). The template is the project's `sessions/session-template.md` read through `aiAccess`. If that file is missing or hidden, a built-in copy of `template/sessions/session-template.md` is used.
- Ruling, end copy (`sessionEndInstructions`), built from these lines:
  - `The writer has ended the session. First, suggest a new file at <logPath> that logs this session using the template below.`
  - `Replace [N] with <N> and [Date] with <date>, fill in every section from this conversation, and remove the HTML comments. Under What Was Written, list only files that were actually changed or suggested in this session. If nothing was, write "Nothing yet."`
  - `Then, for each decision the writer clearly locked in (not ideas still open), suggest one change to the matching canon/ file: one suggestion per decision, even when two decisions go to the same file. Skip decisions that canon already records. Use the canon/ file that fits best, or suggest a new one there if none fits.`
  - `After the suggestions, tell the writer in one or two sentences what you suggested. They will accept or reject each card.`
  - Then `Template:` and the template text.
  - In tools mode it names `create_note`/`propose_edit`. In fallback mode it names the `canonball-create`/`canonball-edit` tags.
- Ruling: "one suggestion per decision" overrides Phase 5's "put every change to one file in one call" for the end request only. Phase 5's content check would reject the second card for a file once the first was accepted, so the proposal store keeps each edit's `EditSpec[]` (main memory only, not in the shared `Proposal`). On Accept, if the file no longer equals `before`, the store re-applies those edits to the current text with `applyEdits`. If every `old_text` is still found exactly once, it writes that result. Otherwise it refuses with `CHANGED_SINCE_PROPOSAL` as before. The writer's own changes are never overwritten, because an edit only replaces its own unique `old_text`. The card's diff still shows the original context.
- Ruling: if `sessions/` isn't editable, the log suggestion comes back to the model as an access error and the model tells the writer. There is no special UI for that.
- Ruling: the session banner and form live in `src/renderer/src/chat/SessionBanner.tsx` and `SessionStart.tsx`. The send and end logic lives in a `useSession` hook, so `ChatPanel.tsx` stays under about 350 lines.

## Global Constraints

- **The AI never edits prose folders.** Sessions add no new write path: the log and canon changes are Phase 5 proposals, checked by the access layer when proposed and again on Accept.
- **Nothing is written until the writer presses Accept.** Ending a session writes nothing except the chat file.
- The app never writes a file the writer didn't change. A re-applied (rebased) edit replaces only its own `old_text`.
- The renderer touches the disk only through `window.canonball`. The new request field is validated in main (`parseChatRequest`).
- Tests never hit the network (injected `fetch`).
- Colours only from tokens in `src/renderer/src/theme/theme.css`; no pure white or black.
- Follow `template/memory/style_rules.md` in every user-facing string.

## Review Focus

1. **Two decisions for the same canon file, accepted one after the other.** Both must land, and the second must not fail with "file changed" (Task 2: `stacked edits to one file can both be accepted`).
2. **The writer edits inside the span an AI edit replaces, between the proposal and Accept.** Accept must refuse and write nothing (Task 2: `a rebased edit is refused when its old text is gone`).
3. **No previous logs, or only `README.md` and `session-template.md`, or a log with no Next Session heading.** No "last session" block, no crash, and the log path is `sessions/session-1.md` (Task 3: `with no logs there is no previous section and the log is session 1`).
4. **A thread file saved before Phase 6, or one with a malformed `session` field.** The old file loads, and the malformed one is rejected like any other bad chat file (Task 1: `parseChatThread keeps a valid session and rejects a bad one`).
5. **End session fails or is stopped.** The session stays open and End session works again (Task 5: `a failed end keeps the session open`).

---

### Task 1: Shared session types

**Files:**
- Modify: `src/shared/ai.ts`, `src/shared/ai.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ChatSession { goal: string; endedAt?: string }
  export interface SessionRequest { goal: string; phase: 'brainstorm' | 'end' }
  // ChatThread gains   session?: ChatSession
  // ChatRequest gains  session?: SessionRequest
  export const SESSION_GOAL_MAX = 2000
  export const END_SESSION_MESSAGE = 'End the session and write the log.'
  export function sessionTitle(goal: string): string   // chatTitle('Brainstorm: ' + goal)
  ```
  `parseChatThread` keeps `session` when `goal` is a non-empty string and `endedAt` is absent or a string, and rejects the thread otherwise. `parseChatRequest` keeps `session` when `goal` is 1–`SESSION_GOAL_MAX` characters after trimming and `phase` is one of the two values, and returns `null` otherwise.

- [ ] **Step 1: Write failing tests** in `ai.test.ts`: `parseChatThread keeps a valid session and rejects a bad one` (a thread with no `session` still parses; `{goal:'Ship'}` and `{goal:'Ship', endedAt:'2026-10-31T…'}` are kept; `{goal:''}`, `{goal:3}` and `{goal:'x', endedAt:5}` → `null`). `parseChatRequest validates the session field` (valid brainstorm and end kept; `phase:'later'`, a blank goal and a 2,001-character goal → `null`; no session → no `session` key). `sessionTitle prefixes and truncates` (`sessionTitle('the ship')` → `'Brainstorm: the ship'`; a long goal ends with `…` at 60 characters).
- [ ] **Step 2: Run** `npm test -- src/shared/ai` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: session fields on chat threads and requests`.

---

### Task 2: Stacked edits in the proposal store

**Files:**
- Modify: `src/main/ai/proposals.ts`, `src/main/ai/proposals.test.ts`

**Interfaces:**
- Changes `createProposalStore` internals only. A held entry becomes `{ root, proposal, edits?: EditSpec[] }`. `apply` for `edit`: read the current text; if it equals `before`, write `after`; else if `edits` is set, try `applyEdits(current, edits, relPath)`. If that throws a `ProposalError`, or the result equals `current`, throw `Error(CHANGED_SINCE_PROPOSAL)` and keep the proposal held. Otherwise write the result. All other behaviour is unchanged. The doc comment on the file is updated to match.

- [ ] **Step 1: Write failing tests** in `proposals.test.ts`. `stacked edits to one file can both be accepted`: `notes/ideas.md` = `'A fox.\nA hen.\n'`; propose `fox→wolf` and `hen→owl` separately; apply both in order; the file is `'A wolf.\nA owl.\n'`. `a rebased edit keeps the writer's other changes`: after proposing `fox→wolf`, the writer appends `'A cat.\n'`; apply → `'A wolf.\nA hen.\nA cat.\n'`. `a rebased edit is refused when its old text is gone`: the writer changes `fox` to `dog`; apply rejects `CHANGED_SINCE_PROPOSAL`, the file keeps the writer's text, and the proposal is still held. The existing `refuses when the file changed since the proposal` must still pass unchanged.
- [ ] **Step 2: Run** `npm test -- proposals` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: accept stacked AI edits to one file`.

---

### Task 3: Session context builder

**Files:**
- Create: `src/main/ai/sessions.ts`, `src/main/ai/sessions.test.ts`
- Modify: `src/main/ai/fallback.ts` (`packFiles` gains an `include` option), `src/main/ai/fallback.test.ts`

**Interfaces:**
- Consumes: `AiAccess`, `packFiles`, Task 1 `SessionRequest`.
- Produces (`fallback.ts`): `packFiles(access, prose, budget?, include?: (relPath: string) => boolean)` packs only files for which `include` returns true (all files when it is omitted).
- Produces (`sessions.ts`):
  ```ts
  export const SESSION_STANCE: string                      // Rulings copy, verbatim
  export const BUILTIN_SESSION_TEMPLATE: string            // same text as template/sessions/session-template.md
  export const NEXT_SESSION_CAP = 4000
  export function nextSessionSection(markdown: string): string            // '' when absent
  export function sessionLogs(access: AiAccess): Promise<string[]>        // relPaths, oldest → newest per Rulings
  export function nextLogNumber(logs: string[]): number
  export function localDate(now: Date): string                            // YYYY-MM-DD, local time
  export function sessionEndInstructions(opts: { mode: 'tools' | 'fallback'; logPath: string; n: number; date: string; template: string }): string
  export function buildSessionBlock(opts: {
    access: AiAccess; session: SessionRequest; mode: 'tools' | 'fallback'
    prose: (relPath: string) => boolean; now: Date
  }): Promise<string>
  ```
  `buildSessionBlock` produces the Rulings layout. In tools mode its packed files come from `packFiles(access, prose, FALLBACK_BUDGET, p => p.startsWith('canon/') || p.startsWith('notes/'))`, introduced by `The readable canon and notes:`. A previous log that fails to read is skipped silently.

- [ ] **Step 1: Write failing tests.** Use a temp project created from `template/` with `createProject` and default settings. The template's `canon/characters.md` and `notes/README.md` are present.
  - `fallback.test.ts`: `packFiles packs only included files`.
  - `sessions.test.ts`:
    - `nextSessionSection reads to the next heading`: `'## Next Session\n<!-- x -->\nCall the harbour.\n\n## Other\nNo'` → `'Call the harbour.'`. A `### Sub` heading inside the section is kept. A trailing section at the end of the file works. A missing heading gives `''`. A long section is capped at 4,000 characters.
    - `sessionLogs ignores the README and template and sorts numerically`: with `session-2.md`, `session-10.md` and `session-9.md` → `[…2, …9, …10]`.
    - `nextLogNumber`: `[]` → 1; `['sessions/session-3.md','sessions/2026-05-02.md']` → 4.
    - `localDate` → `'2026-10-31'` for `new Date(2026, 9, 31, 23, 30)`.
    - `with no logs there is no previous section and the log is session 1`: the end block contains `sessions/session-1.md` and no `Where the last session`.
    - `includes the previous Next Session`: `sessions/session-1.md` has `## Next Session\nAsk about the lighthouse.` → the brainstorm block contains `Where the last session (sessions/session-1.md) said to pick up:` and `Ask about the lighthouse.`.
    - `a hidden previous log is left out`: set `sessions/session-1.md` to ⊘ → no `Where the last session`.
    - `tools mode packs canon and notes only`: the block contains `<file path="canon/characters.md"` and nothing under `memory/`, `outline/` or `drafts/`. Fallback mode contains no `<file`.
    - `the end block carries the stance, goal, path, date and template`: the project's template text appears after `Template:`, and the block contains `create_note`. In fallback mode it contains `canonball-create` instead.
    - `falls back to the built-in template`: delete `sessions/session-template.md` → `BUILTIN_SESSION_TEMPLATE` appears. Also assert that `BUILTIN_SESSION_TEMPLATE` equals the file in `template/sessions/`.
- [ ] **Step 2: Run** `npm test -- sessions fallback` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: session context for brainstorm requests`.

---

### Task 4: Sessions in the chat service

**Files:**
- Modify: `src/main/ai/instructions.ts` (`buildInstructions` gains `session?: string`, appended last), `src/main/ai/instructions.test.ts`, `src/main/ai/chatService.ts`, `src/main/ai/chatService.test.ts`, `src/main/ai/proseGuard.e2e.test.ts`

**Interfaces:**
- Consumes: Task 3 `buildSessionBlock`; Task 1 `ChatRequest.session`.
- Produces: `createChatService` deps gain `now?: () => Date` (default `() => new Date()`). When `req.session` is set and a root is open, the service builds the block once per request, with the settings' prose test from `loadProjectAccess(root)` and the request's mode (`tools`, or `fallback` when the model is in the no-tools set or the retry switches to fallback; build it again for the fallback retry). It passes the block as `buildInstructions({ …, session })`. Without a root, `session` is ignored.

- [ ] **Step 1: Write failing tests.** Use `chatService.test.ts` and the existing scripted OpenAI-compatible fake.
  - `instructions.test.ts`: `appends the session block last`.
  - `a session request carries the stance, goal and canon`: the first request's system text contains `SESSION_STANCE`, `The writer's goal for this session: the ship arrives` and `<file path="canon/`.
  - `a plain request has no session block`.
  - `the end request names the log path and date` (`now` fixed): it contains `sessions/session-1.md` and `2026-10-31`.
  - `an end session produces a log card and one card per decision`: the scripted model calls `create_note` for `sessions/session-1.md` and two `propose_edit`s on `canon/characters.md`. Expect three `proposal` events and no files written. Applying all three through the store in order succeeds.
  - `fallback sessions get the end rules in tag form`.
  - `proseGuard.e2e.test.ts`: `an ended session can't log into drafts` (the model tries `create_note` at `drafts/chapters/session-1.md` → error result, no proposal, drafts unchanged).
- [ ] **Step 2: Run** `npm test -- chatService instructions proseGuard` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck` and `npm run lint` → clean.
- [ ] **Step 5: Commit** `feat: brainstorm stance and session log in chat requests`.

---

### Task 5: Session UI

**Files:**
- Create: `src/renderer/src/chat/SessionStart.tsx`, `SessionBanner.tsx`, `useSession.ts`, `SessionBanner.test.tsx`, `SessionStart.test.tsx`
- Modify: `src/renderer/src/chat/ChatHeader.tsx`, `ChatPanel.tsx`, `ChatPanel.test.tsx`, `chat.css`

**Interfaces:**
- Consumes: Task 1 types and `END_SESSION_MESSAGE`, `sessionTitle`.
- Produces:
  ```ts
  SessionStart(props: { canStart: boolean; onStart(goal: string): void; onCancel(): void })
  SessionBanner(props: { session: ChatSession; busy: boolean; onEnd(): void })
  // ChatHeader gains: onStartSession(): void; canStartSession: boolean
  ```
  `SessionStart` is a `<form aria-label="Start a brainstorm session">` with a textarea labelled `What do you want to figure out?`. Enter or **Start session** submits the trimmed goal. Escape or **Cancel** cancels. It is focused on open. `SessionBanner` is a `role="status"` bar: `Brainstorm: <goal>` plus the **End session** button, or `Brainstorm: <goal> · Ended`.
- `ChatPanel`: refactor `send` into `sendMessage(text: string, opts?: { thread?: ChatThread; session?: SessionRequest; onDone?(): void })`. `onDone` runs only when the reply finishes with no error and wasn't stopped. Normal sends add `session: { goal, phase: 'brainstorm' }` when the open thread has an un-ended session. Start session: build a new thread with `session: { goal }` and `title: sessionTitle(goal)`, then `sendMessage(goal, { thread, session: { goal, phase: 'brainstorm' } })`. End session: `sendMessage(END_SESSION_MESSAGE, { session: { goal, phase: 'end' }, onDone: mark ended })`. Marking ended sets `session.endedAt` and saves the thread. The form replaces the composer while it is open. Picking another thread closes it.

- [ ] **Step 1: Write failing tests.**
  - `SessionStart.test.tsx`: `starts with the trimmed goal` (`'  the ship  '` → `onStart('the ship')`); `Start is disabled for a blank goal or when it can't start`; `Escape cancels`.
  - `SessionBanner.test.tsx`: `shows the goal and End session`; `End session is disabled while busy`; `an ended session shows Ended and no button`.
  - `ChatPanel.test.tsx`:
    - `starting a session sends the goal with the session field`: `startChat` gets `session: {goal:'the ship', phase:'brainstorm'}` and `messages` ending with the goal; the saved thread has `session.goal` and title `Brainstorm: the ship`.
    - `messages in an open session carry the brainstorm phase`.
    - `ending a session sends the end message and marks it ended`: `phase:'end'`, last turn `END_SESSION_MESSAGE`; after `done`, the saved thread has `endedAt` and the banner shows `Ended`.
    - `a failed end keeps the session open` (an `error` event → no `endedAt`, End session enabled).
    - `an ended session sends plain messages` (no `session` key).
    - `Brainstorm is disabled while a reply streams`.
- [ ] **Step 2: Run** `npm test -- Session ChatPanel` → FAIL.
- [ ] **Step 3: Implement.** The banner sits on `--bg-chat` with a `--border` bottom rule and uses `--text-muted` for `· Ended`.
- [ ] **Step 4: Run** `npm test` → PASS; `npm run typecheck`, `npm run lint`, `npm run build` → clean.
- [ ] **Step 5: Commit** `feat: start and end brainstorm sessions in the chat panel`.

---

## Finishing

- Add a Phase 6 block to "Notes for later phases" in `OPEN_WORK.md`. It covers where the session block is built (`src/main/ai/sessions.ts`), how the newest log and the next log number are chosen, the rebase-on-Accept rule for stacked edits, and the known gaps (the previous log is found at request time, so a log the writer saves mid-session is read on the next message). Move Phase 6 to `COMPLETED_WORK.md`, and set the roadmap row's plan to this file name.
