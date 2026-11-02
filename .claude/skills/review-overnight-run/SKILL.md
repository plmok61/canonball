---
name: review-overnight-run
description: Use when the writer asks how an unattended or overnight run went, how far the phases got, or what happened while they were away — any time `.overnight/` holds logs from scripts/run-phases.sh.
---

# Review an overnight run

`scripts/run-phases.sh` runs roadmap phases unattended, one `claude -p` session per phase, on a branch (default `overnight-phases`). This skill turns what it left behind into a short report the author can act on.

**Read-only.** Don't merge, push, delete, edit code, or answer the parked questions yourself. Suggest those as next steps and wait.

## What the run leaves behind

| Path | Contents |
|---|---|
| `.overnight/run.log` | One line per phase (`Phase 5: DONE (10:31 PM)`) and every usage-limit sleep |
| `.overnight/runs.log` | `run start <date> base <sha> branch <name> phases <n...>`, one line per start |
| `.overnight/phase-N.status` | `DONE`, `PARTIAL` or `BLOCKED`. A missing file means the run died or was interrupted |
| `.overnight/phase-N.log` | Stream-JSON from every attempt, separated by `=== Phase N attempt K ===` lines |
| `NEEDS_INPUT.md` | Questions the agent parked, each with what it assumed |
| `.superpowers/sdd/<plan>/progress.md` | Ledger of a phase still mid-execution (deleted when a phase finishes cleanly) |

## Steps

Run these from the repo root. Gather everything first, then write one report.

1. **Phase outcomes.** `cat .overnight/run.log; tail -3 .overnight/runs.log; grep -H . .overnight/phase-*.status`

2. **How each session ended.** One run can print several `result` lines (background subagent notifications end a turn early), so read the *last* one per attempt. Costs are cumulative within a session.

   ```bash
   for f in .overnight/phase-*.log; do echo "-- $f"; jq -rR 'fromjson? | select(.type=="result") | "\(.subtype) error=\(.is_error) turns=\(.num_turns) denials=\((.permission_denials//[])|length) | \((.result//"")|tostring|gsub("\n";" ")|.[0:140])"' "$f"; done
   ```

   `You've hit your 5-hour limit` means a usage-limit pause, not a failure. `error_during_execution` with `aborted_streaming` means someone pressed Ctrl-C.

3. **Refused commands** (only matters without `--bypass`). Count them by first word to see what the allowlist is missing:

   ```bash
   cat .overnight/phase-*.log | jq -rR 'fromjson? | select(.type=="result") | .permission_denials[]? | (.tool_input.command // .tool_name) | tostring | split("\n")[0]' | sed -E 's/^cd [^&;]+(&&|;) *//' | awk '{print $1}' | sort | uniq -c | sort -rn | head -12
   ```

   Commands that are on the allowlist still get refused when they're compound (heredocs, pipes, `VAR=... &&` prefixes). Dozens of refusals per phase waste turns and usage; suggest adding the top entries or using `--bypass`.

4. **What was committed.** Take BASE from the latest `base` in `runs.log`; if there's no `runs.log`, use `git merge-base main <branch>`.

   ```bash
   git log --oneline BASE..overnight-phases
   git diff --stat BASE..overnight-phases | tail -1
   git status --porcelain
   ```

   Untracked build output or stray files in `git status` are cleanup items.

5. **Decisions made without the author.** Each plan written unattended records its calls as `Ruling:` lines:

   ```bash
   git diff BASE..overnight-phases -U0 -- docs/superpowers/plans | grep -c '^+.*Ruling'
   ```

   There are usually dozens. Read them, then report the count per plan and only the handful that change user-facing behavior or carry a real cost if wrong. Point to the plan files for the rest.

6. **Parked questions.** Read `NEEDS_INPUT.md` in full. Every entry goes in the report.

7. **Unfinished work.** `ls .superpowers/sdd/ 2>/dev/null`. For each ledger, find tasks without a `Task <N>: complete` line. A leftover folder for a phase marked DONE is stale scratch (the cleanup `rm` was probably refused) and safe to delete.

8. **Verify the branch yourself.** Run the project's checks (`npm test` and `npm run build` for Canonball) on the branch. Report the counts. Don't trust the agent's own "all tests pass".

## The report

Lead with one sentence: how many phases finished, and whether the branch passes its checks. Then, in this order:

- **Phases:** one row each, with phase, status, finish time, and usage-limit pauses.
- **Questions for you:** each `NEEDS_INPUT.md` entry in a sentence or two, with what was assumed.
- **Decisions worth checking:** the few rulings that matter, plus where the rest live.
- **Problems:** stopped phases and why, unfinished tasks, heavy permission refusals.
- **Cleanup:** stale `.superpowers/sdd/` folders, untracked files.
- **Next steps:** try the app (`npm run dev`), since unattended runs only ran tests and builds and no one has seen the screens. Then answer the parked questions, review the branch diff, and merge or open a PR. To continue, give the restart command with the next phase numbers, e.g. `caffeinate -i bash scripts/run-phases.sh 7 2>&1 | tee -a .overnight/run.log`.
