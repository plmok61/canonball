# AI-Isms Style System

This scaffold includes a built-in style rule system to prevent common AI writing patterns that make fiction feel mechanical or generic. The rules are loaded automatically — you don't need to copy/paste anything into your prompts.

## How it works

Two files in `memory/` work together:

- **`memory/style_rules.md`** — the rules AI reads and applies when writing prose. Hard rules (never do these) and strong preferences (avoid unless there's a reason). This is the file to edit when you want to add, remove, or adjust a rule.
- **`memory/ai-isms.json`** — the full pattern database backing the rules: 47 patterns with severity ratings, examples, why AI produces them, and per-pattern prompt instructions. Reference this when you want to understand a pattern in depth or pull a specific instruction.

`CLAUDE.md` instructs Claude to check `memory/style_rules.md` before writing any prose, so the rules apply automatically every session.

## Customizing the rules

**To add a rule:** Edit `memory/style_rules.md` directly. Add it under Hard Rules or Strong Preferences depending on how strictly you want it enforced.

**To remove or relax a rule:** Delete or soften the relevant line in `memory/style_rules.md`. You don't need to touch `ai-isms.json`.

**To look up a pattern in detail:** Find it in `memory/ai-isms.json` by its key (e.g., `em_dashes`, `rule_of_three`). Each entry includes examples, frequency notes, and a ready-made prompt instruction you can copy.

**To add genre-specific rules:** The `genre_specific` section of `ai-isms.json` has romance and dialogue patterns. Add your own keys to that section, then add the corresponding rule to `memory/style_rules.md`.

## Severity guide (for reference)

Patterns in `ai-isms.json` are rated 1–5. The hard rules in `memory/style_rules.md` come from severity 4–5:

| Severity | Meaning |
|---|---|
| 5 | Almost always ruins the prose — fix immediately |
| 4 | Common and noticeable — avoid by default |
| 3 | Minor — worth knowing but low priority |
| 1–2 | Situational — ignore unless it's a specific problem |

---

*Inspired by "The AI isms of Writing Bible," a community-compiled guide to AI writing patterns shared on the [r/WritingWithAI](https://www.reddit.com/r/WritingWithAI/) subreddit. Original document [here](https://docs.google.com/document/d/1l3OLrnWaXUqH0ycS-0so65Hd6ayxSQqUypRtrFHMt3M)
