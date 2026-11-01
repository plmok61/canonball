# Open Work

Work on the Canonball desktop app that isn't done yet. Move items to `COMPLETED_WORK.md` when finished.

- Design: `docs/superpowers/specs/2026-10-31-canonball-app-design.md`
- Roadmap (how to start each phase in a fresh session): `docs/superpowers/plans/2026-10-31-roadmap.md`

## Build phases

- [ ] **Phase 7: Package & release.** Mac build, README, license (plan to write)

## Notes for later phases

- Markdown: `@tiptap/markdown` 3.32.2 with custom raw-atom nodes for HTML comments, raw HTML and footnotes; the text escaper overrides a private `encodeTextForMarkdown` — pin `@tiptap/*` exactly before upgrading.
- Known round-trip residuals: CRLF files come back with mixed line endings; inline HTML inside bold/italic splits the emphasis; first save normalizes syntax (e.g. `_em_` → `*em*`).
- `writeDoc` has no expected-mtime precondition: external changes are only detected on window focus. AI writes are covered by Phase 5's content check on Accept, but the writer's own autosave can still overwrite an accepted AI edit (see Phase 5 below). Add the precondition.
- Dev environment: `~/.npm` has root-owned files (fix with `sudo chown -R 501:20 ~/.npm`); the Electron binary may need `npx install-electron` after install.
- Phase 2 (writing aids):
  - harper.js is pinned at 2.13.0 and runs in an Electron `utilityProcess` (`src/main/grammar/`), linting paragraph text with `language: 'plaintext'`.
  - Spelling is Chromium's job. Harper's `SpellCheck` and `LongSentences` rules are off, and lints of kind `Spelling`/`Typo`/`Readability` are dropped. The dialect is fixed to American; a dialect setting is future work.
  - Ignored grammar lints last until the file is closed (they are kept per editor), and are never saved.
  - Right-click on a grammar underline that has fixes opens the grammar popover, so a misspelling inside such an underline gets Chromium's spelling menu only from words outside it (rare, since grammar spans are short). Right-click on an underline with no fixes shows the native menu.
  - The grammar popover is mouse-only; keyboard access is future work. It also isn't clamped to the viewport.
  - Harper's Node loader reads the WASM via `new URL(...).pathname`. A checkout path containing spaces (percent-encoded) would break loading. The packaged app in `/Applications` is fine.
  - Packaged check: `npm run build:unpack` works, and Harper loads from `app.asar`. Signing and notarization are Phase 7.
  - The grammar service has no request timeout. A hung Harper call would leave that request pending, though later edits still lint.
  - macOS gives some misspellings (e.g. "teh") no suggestions. That is OS dictionary behaviour.
- Protected files (replaced the Phase 3 access setting):
  - Rules live in `src/shared/protection.ts`; `.canonball/project.json` (`{ "version": 2, "protected": [...] }`, version 1 still read) is loaded and saved by `src/main/projectSettings.ts` (mutations queued per root). `src/main/aiAccess.ts` (`createAiAccess(root)`: `list`, `read`, `write`, `create`) is the only way Phase 5 AI tools may touch files. The AI reads every available `.md` file and never writes under a protected entry.
  - **Phase 5 rule:** an accepted AI edit must be written by main through `aiAccess.write`/`create`, and only after the writer presses Accept. The renderer's own `writeDoc` channel can write anywhere (protected files and `.canonball/` included), so it must never apply AI edits.
  - An unreadable `project.json` refuses every AI write and create (reads still work) until it is fixed; the file is never overwritten.
  - Renaming a protected folder outside the app orphans its entry in `project.json` (it matches nothing, so the folder is no longer protected). No migration yet.
  - `aiAccess` canonicalizes before checking, then writes; a symlink swapped in between by another local process could redirect a write (still inside the project). `create` through a dangling symlink into a protected folder is refused only by the exclusive create (`File already exists`); consider refusing symlinks in the tail segment.
  - The renderer matches protected entries literally; main also matches their on-disk spelling. A hand-edited `"DRAFTS"` gets main's protection but no Protected section entry or "Protected — AI won't edit" banner.
  - Saving `project.json` drops unknown top-level keys.
- Phase 4 (AI connection & chat):
  - Adapters live in `src/main/ai/`: `openaiCompat.ts` (OpenAI and the local server), `anthropic.ts`, `google.ts`, picked by `providers.ts` `adapterFor`. They share `http.ts` (`send`), `sse.ts` (`parseSse`) and `errors.ts` (`ProviderError` copy). They use plain `fetch` from main with no SDKs. Phase 5 adds tool calling per adapter.
  - `aiConfig.resolve(provider)` (`src/main/ai/aiConfig.ts`) is the only place a key is read for a request. Keys are encrypted with `safeStorage` in `<userData>/secrets.json` (`secrets.ts`), and the renderer only sees booleans.
  - Chats are saved in `.canonball/chats/<uuid>.json` (`src/main/chats.ts`) with a `*` `.gitignore`. Unreadable chat files are skipped and never overwritten.
  - Known gaps:
    - Switching projects or closing the window mid-reply stops the stream and loses the partial reply. The writer's message is already saved.
    - There is no request timeout; **Stop** is the only way out of a hung stream.
    - Only one local server URL is supported.
    - A renderer reload doesn't cancel a running stream.
  - Polish left:
    - A Google blocked prompt shows the generic "No reply came back" copy.
    - Connection-check results in Settings can arrive out of order.
    - Settings can stack over the prose dialog.
    - The chat log's live region is noisy for screen readers while streaming, and messages have no speaker labels.
    - A corrupt `secrets.json` is read as empty, so the next save drops the other keys.
    - There are no IPC handler tests for the new channels (Phase 5's `applyProposal`/`rejectProposal` included).
- Phase 5 (AI file tools & proposals):
  - Tools are in `src/main/ai/tools.ts` (`FILE_TOOLS`, `createToolRunner`). Errors go back to the model as tool results starting with `Error: `. The loop in `chatService.ts` stops after 10 tool rounds (`MAX_TOOL_ROUNDS`).
  - Proposals live in main memory (`src/main/ai/proposals.ts`, `createProposalStore`), keyed by UUID and project root, and are cleared on project switch. Accept re-reads the file through `aiAccess`, refuses if it no longer equals `before`, and writes through `aiAccess.write`/`create`. Cards and statuses are saved on the assistant message in the chat file.
  - The system prompt is built per request by `buildInstructions` (`src/main/ai/instructions.ts`) from the base text, tool or fallback rules, and top-level `memory/*.md` (20,000 characters each). Phase 6's session block is appended last.
  - Fallback (`src/main/ai/fallback.ts`): used when a tools request fails with 400/404/422/501 and a body mentioning tool/function; the `provider:model` pair is remembered for the app session, with no notice. Readable files are packed up to 24,000 characters (memory excluded, since it's already in the instructions; prose last). Edits use `<canonball-edit path>`/`<canonball-create path>` tags, which are filtered from the streamed text.
  - Google: tools with no parameters are sent without a `parameters` field (Gemini can reject an empty `properties` object). Not yet checked against the live API.
  - Known gaps:
    - The writer typing in the file while an Accept is running can autosave over the AI edit while the card says Accepted (`writeDoc` has no precondition).
    - `rejectsTools` matches broadly: an OpenAI context-length 400 mentions "functions", so it can put a model in fallback for the session.
    - Switching chat threads during an Accept leaves that thread's saved card `pending`; a later Accept says "no longer available" though the edit landed.
    - A `reloadToken` bump that arrives before the editor finishes loading is dropped until the next window focus.
    - OpenAI-compatible tool-call deltas without an `index` (some local servers) collapse into one call.
    - Fallback tag parsing accepts double-quoted `path` only; the packer reads files it then skips for size.
    - A failed card with no error text (hand-edited chat file) shows an empty alert.
- Phase 6 (brainstorm sessions):
  - A session is a chat thread with `session: { goal, endedAt? }`. The renderer (`src/renderer/src/chat/useSession.ts`, `SessionStart.tsx`, `SessionBanner.tsx`) sends `session: { goal, phase: 'brainstorm' | 'end' }` with each request until the session ends. `parseChatRequest` validates it in main.
  - The session block is built per request in `src/main/ai/sessions.ts` (`buildSessionBlock`), and `buildInstructions` appends it last. It holds the stance, the goal, the previous log's Next Session, the end rules (phase `end` only), and in tools mode the readable `canon/` and `notes/` packed by `packFiles` (24,000 characters). It is rebuilt in fallback form when a request falls back.
  - Session logs are the visible top-level `sessions/*.md` files except `README.md` and `session-template.md`. The newest is the one that sorts last by numeric `localeCompare`. The next log is `sessions/session-<N+1>.md`, from the highest `session-<N>.md`. The template is the project's `sessions/session-template.md`, or a built-in copy if that file is missing or hidden.
  - Stacked edits: the proposal store keeps each edit's `old_text`/`new_text` pairs. On Accept, if the file has moved on, it re-applies them when every `old_text` is still found exactly once, and otherwise refuses with "changed since". Applies run one at a time, so two Accepts on one file can't race.
  - Known gaps:
    - The previous log is found at request time, so a log the writer saves mid-session is read on the next message.
    - End session runs once. If the model forgets the log, or the log card fails or is rejected, there's no "write the log again" button (the writer can ask in chat).
    - If a second session ends before the first log is accepted, both logs target the same `session-N.md`, and the second Accept fails with "File already exists". A hidden `session-N.md` can collide the same way.
    - An empty end reply (no text and no cards) leaves the session open.
    - `loadProjectAccess` runs for every request with a project open, including plain chat.

## Decide later (after using the app)

- [ ] **Export: what gets exported.** The open file only, or a "Compile book" that combines chapters? Compiling needs a way to mark the current draft per chapter and set chapter order. Alternatively, export only from `drafts/full/`.
- [ ] **Export: how it looks.** A standard submission manuscript (double-spaced, name/page header, word count), a reader-ready book (title page, table of contents, typeset), or both as two styles.

## Later

- [ ] Export to Word, EPUB, PDF (once the decisions above are made)
- [ ] Windows and Linux builds
