# Open Work

Work on the Canonball desktop app that isn't done yet. Move items to `COMPLETED_WORK.md` when finished.

- Design: `docs/superpowers/specs/2026-10-31-canonball-app-design.md`
- Roadmap (how to start each phase in a fresh session): `docs/superpowers/plans/2026-10-31-roadmap.md`

## Build phases

- [ ] **Phase 2: Writing aids.** Spellcheck and Harper grammar (plan to write)
- [ ] **Phase 3: AI permissions.** Badges, prose folders, access layer (plan to write)
- [ ] **Phase 4: AI connection & chat.** Providers, Keychain, model picker, chat (plan to write)
- [ ] **Phase 5: AI file tools & proposals.** Tools, Accept/Reject cards, style rules (plan to write)
- [ ] **Phase 6: Brainstorm sessions.** (plan to write)
- [ ] **Phase 7: Package & release.** Mac build, README, license (plan to write)

## Notes for later phases (learned in Phase 1)

- Markdown: `@tiptap/markdown` 3.32.2 with custom raw-atom nodes for HTML comments, raw HTML and footnotes; the text escaper overrides a private `encodeTextForMarkdown` — pin `@tiptap/*` exactly before upgrading.
- Known round-trip residuals: CRLF files come back with mixed line endings; inline HTML inside bold/italic splits the emphasis; first save normalizes syntax (e.g. `_em_` → `*em*`).
- `writeDoc` has no expected-mtime precondition: external changes are only detected on window focus. Add one before Phase 5 lets the AI write files.
- Dev environment: `~/.npm` has root-owned files (fix with `sudo chown -R 501:20 ~/.npm`); the Electron binary may need `npx install-electron` after install.
- Lint: `src/main/projectFs.ts` and its test have pre-existing eslint errors.

## Decide later (after using the app)

- [ ] **Export: what gets exported.** The open file only, or a "Compile book" that combines chapters? Compiling needs a way to mark the current draft per chapter and set chapter order. Alternatively, export only from `drafts/full/`.
- [ ] **Export: how it looks.** A standard submission manuscript (double-spaced, name/page header, word count), a reader-ready book (title page, table of contents, typeset), or both as two styles.

## Later

- [ ] Export to Word, EPUB, PDF (once the decisions above are made)
- [ ] Windows and Linux builds
