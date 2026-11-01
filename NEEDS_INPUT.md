# Needs input

Questions from unattended runs. Nothing is blocked on them; each lists what was assumed.

## Phase 5, final review: Gemini tool schema (needs a live check)

- **Question:** Does Gemini accept our tool declarations? The final review flagged that Gemini has returned 400 `parameters.properties: should be non-empty for OBJECT type` for `list_files`'s empty schema. That error would silently send every Gemini model to fallback mode for the session.
- **What I did:** The Google adapter now omits `parameters` for tools with no properties (`src/main/ai/google.ts`). There was no network access in this run.
- **What I'm assuming:** Omitting `parameters` is valid for Gemini. Please send one real Gemini chat with a project open and check that it lists files using tools rather than the fallback.

## Phase 5: silent fallback

- **Question:** Should the writer see a notice when a model falls back to "no tools" mode? The plan's Ruling chose no notice. A false positive (for example, an OpenAI context-length 400 that mentions "functions") would quietly degrade the model for the rest of the session.
- **What I'm assuming:** No notice, as in the plan. This is listed in `OPEN_WORK.md`.
