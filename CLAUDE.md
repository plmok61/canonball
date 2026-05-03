# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose

This is a **reusable scaffold for AI-assisted creative writing projects**. It provides a starting structure and workflow conventions that can be copied and adapted for new fiction projects.

## Directory Structure

```
project/
├── CLAUDE.md               # This guidance file (project-specific overrides go here)
├── README.md               # Premise, high-level story concept, inspirations
├── canon/                  # Single source of truth — authoritative and stable
│   ├── characters.md       # Character biographies, psychology, motivations, relationships
│   ├── themes.md           # Core themes, philosophical question, explicit constraints
│   ├── world.md            # Setting, world-building, rules, context
│   └── timeline.md         # Chronological events and story beats
├── outline/
│   └── outline.md          # Chapter-by-chapter breakdown with POV and thematic assignments
├── notes/                  # Raw brainstorming — informal, unstructured, may contradict canon
├── drafts/
│   ├── chapters/           # Prose drafts organized by chapter number
│   │   └── <ch-number>/    # e.g., 1/, 2/, etc.
│   └── full/               # Complete manuscript iterations
├── sessions/               # Per-session logs for continuity across Claude conversations
├── memory/                 # Claude session memory (loaded each session for continuity)
│   ├── MEMORY.md           # Memory index
│   ├── user_profile.md     # Author background, preferences
│   └── feedback_tone.md    # Tone register, style notes from prior sessions
└── .claude/
    └── settings.local.json # Minimal permissions (e.g., WebSearch if research is needed)
```

## Core Working Conventions

**Canon is authoritative.** When writing drafts or brainstorming, always check `canon/` files for consistency with established characters, world rules, timeline, and themes.

**Notes are exploratory.** Content in `notes/` may contradict canon — it feeds canon, not the reverse.

**Draft naming.** Version drafts clearly within each chapter folder (e.g., `draft1.md`, `draft2.md`, `draft2-author.md` for author-written versions).

**Memory continuity.** Read `memory/` at the start of each session to restore tonal and stylistic context from previous sessions.

**Session logs.** At the end of each writing session, create a file in `sessions/` (using `session-template.md`) recording decisions made, files touched, and where to pick up next time.

## Canon File Conventions

Each `canon/characters.md` entry should cover: Role, Biography, Appearance, Psychology, Motivation, and key relationships. Character bios function as worldview documents — not just who they are but how they see the world.

`canon/themes.md` should include explicit **constraints** — what the story must never do — alongside what it must accomplish. This prevents drift across long writing sessions.

## Scaffold Setup for a New Project

1. Copy this scaffold directory
2. Update `README.md` with the new premise
3. Populate `canon/` files before writing any prose
4. Write `outline/outline.md` with chapter structure and thematic assignments
5. Begin prose in `drafts/chapters/`
6. Use `notes/` freely for brainstorming without worrying about consistency
7. Promote resolved ideas from `notes/` into `canon/`
