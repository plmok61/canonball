# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Canonball is a desktop writing app ("Cursor for writers, with one inversion"): the writer writes the prose, and the AI keeps notes, answers questions and helps brainstorm. Files on disk are plain markdown, and writers never see raw markdown syntax.

## Stack

Electron + React + TypeScript, built with electron-vite. Editor: TipTap (free, open-source packages only). Tests: Vitest, with tests next to the code as `*.test.ts(x)`.

- `npm run dev` starts the app.
- `npm test` runs the test suite.
- `npm run build` builds the app.

## Where things live

- Design spec: `docs/superpowers/specs/2026-10-31-canonball-app-design.md`
- Roadmap and phase plans: `docs/superpowers/plans/`
- Open work: `OPEN_WORK.md` (move finished items to `COMPLETED_WORK.md`)
- New-project scaffold copied for each new writer project: `template/` (`canon/`, `notes/`, `outline/`, `drafts/`, `sessions/`, `memory/`)
- AI-isms reference material: `docs/reference/`
- `examples/` holds sample material; leave it alone.
- Unattended phase runner: `scripts/run-phases.sh` (logs in `.overnight/`, parked questions in `NEEDS_INPUT.md`). Review a run with the `review-overnight-run` skill.

## Hard rules

- **The AI never edits prose folders** (`drafts/` today; configurable prose folders arrive in Phase 3). No continue-writing, rewrite-selection, or ghost-text features, ever. Every AI edit elsewhere is shown to the writer for Accept/Reject.
- The app never writes a file the writer didn't change.
- The renderer touches the disk only through `window.canonball`. Every project-relative path is resolved inside the project root (`resolveInside`), and escapes are rejected.
- `contextIsolation: true`, `nodeIntegration: false`.

## Writing Style

Apply the rules in `template/memory/style_rules.md` whenever generating prose or dialogue, and check `template/memory/names_to_avoid.md` for names. These rules exist to prevent common AI writing patterns that make fiction feel generic.
