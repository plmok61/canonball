#!/bin/bash
# Run roadmap phases unattended, one fresh Claude Code session per phase.
#
#   caffeinate -i bash scripts/run-phases.sh [options] PHASE... 2>&1 | tee -a .overnight/run.log
#
# Options:
#   --roadmap PATH      roadmap to follow (default: the only docs/superpowers/plans/*roadmap*.md)
#   --branch NAME       branch to work on, created if missing (default: overnight-phases)
#   --verify TEXT       how the agent should verify (default: "npm test and npm run build")
#   --max-attempts N    tries per phase, counting usage-limit retries (default: 6)
#   --bypass            skip all permission checks instead of using the built-in allowlist
#
# Each phase runs `claude -p` with the superpowers plugin. When a usage limit is hit, the
# script sleeps until the reset time and retries the phase; the superpowers ledger resumes
# at the first unfinished task. It stops at the first phase that doesn't finish DONE, since
# later phases usually build on earlier ones. Logs and status files go in .overnight/.
# macOS only (uses BSD `date`). Review a finished run with the review-overnight-run skill.
set -u

roadmap=""
branch="overnight-phases"
verify="npm test and npm run build"
max_attempts=6
bypass=false
phases=()

usage() { sed -n '2,17s/^# \{0,1\}//p' "$0"; exit "${1:-0}"; }

while (( $# )); do
  case $1 in
    --roadmap) roadmap=$2; shift 2 ;;
    --branch) branch=$2; shift 2 ;;
    --verify) verify=$2; shift 2 ;;
    --max-attempts) max_attempts=$2; shift 2 ;;
    --bypass) bypass=true; shift ;;
    -h|--help) usage ;;
    -*) echo "Unknown option: $1" >&2; usage 1 ;;
    *) phases+=("$1"); shift ;;
  esac
done
(( ${#phases[@]} )) || { echo "Name at least one phase number." >&2; usage 1; }

self=$(cd "$(dirname "$0")" && pwd -P)/$(basename "$0")
root=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Run this inside a git repo." >&2; exit 1; }
cd "$root" || exit 1
self=${self#"$(pwd -P)"/}

if [[ -z $roadmap ]]; then
  found=(docs/superpowers/plans/*roadmap*.md)
  if [[ ${#found[@]} -ne 1 || ! -f ${found[0]} ]]; then
    echo "Couldn't pick a roadmap automatically; pass --roadmap PATH." >&2; exit 1
  fi
  roadmap=${found[0]}
fi
[[ -f $roadmap ]] || { echo "Roadmap not found: $roadmap" >&2; exit 1; }
command -v claude >/dev/null || { echo "claude is not on PATH." >&2; exit 1; }

# Sleeps until 5 minutes after the "resets 4:50pm" time in the log,
# or 5 hours if no reset time can be found.
wait_for_reset() {
  local log=$1 reset target="" now
  now=$(date +%s)
  reset=$(grep -oE 'resets [0-9]{1,2}(:[0-9]{2})?[ap]m' "$log" | tail -1 | awk '{print $2}')
  if [[ -n $reset ]]; then
    [[ $reset == *:* ]] || reset="${reset%??}:00${reset: -2}"
    reset=$(echo "$reset" | tr a-z A-Z)
    target=$(date -j -f "%I:%M%p" "$reset" +%s 2>/dev/null)
    # A reset time earlier than now means tomorrow (calendar day, so DST-safe).
    [[ -n $target ]] && (( target <= now )) &&
      target=$(date -j -v+1d -f "%I:%M%p" "$reset" +%s 2>/dev/null)
  fi
  if [[ -z $target ]]; then
    target=$(( now + 5 * 3600 ))
  else
    target=$(( target + 300 ))
  fi
  echo "Usage limit hit at $(date '+%-I:%M %p'); sleeping until $(date -r "$target" '+%-I:%M %p')"
  sleep $(( target - now ))
}

# Refuse to start on a dirty tree: the agent commits as it goes, and would sweep up your edits.
if [[ -n $(git status --porcelain -- . ":!$self") ]]; then
  echo "Working tree has uncommitted changes. Commit or stash them first." >&2
  exit 1
fi

mkdir -p .overnight
git check-ignore -q .overnight/run.log || echo '.overnight/' >> .git/info/exclude

git switch -c "$branch" 2>/dev/null || git switch "$branch" || exit 1
echo "run start $(date '+%Y-%m-%d %H:%M') base $(git rev-parse --short HEAD) branch $branch phases ${phases[*]}" \
  >> .overnight/runs.log

if $bypass; then
  permissions=(--permission-mode bypassPermissions)
else
  permissions=(--permission-mode acceptEdits
    --allowedTools "Read" "Edit" "Write" "Glob" "Grep" "Task" "Skill" "TodoWrite"
                   "Agent" "SendMessage" "TaskStop" "ToolSearch"
                   "Bash(cd:*)" "Bash(git:*)" "Bash(npm:*)" "Bash(npx:*)" "Bash(node:*)"
                   "Bash(ls:*)" "Bash(mkdir:*)" "Bash(cat:*)" "Bash(rg:*)"
                   "Bash(grep:*)" "Bash(sed:*)" "Bash(wc:*)" "Bash(tail:*)" "Bash(head:*)"
                   "Bash(find:*)" "Bash(sleep:*)" "Bash(cp:*)"
                   "Bash(bash scripts/:*)"
                   "Bash(bash $HOME/.claude/plugins/cache/claude-plugins-official/superpowers/:*)"
    --disallowedTools "Bash(git push:*)" "Bash(git merge:*)" "Bash(git reset --hard:*)")
fi

for n in "${phases[@]}"; do
  rm -f ".overnight/phase-$n.status"
  read -r -d '' prompt <<EOF
You are running UNATTENDED. No human will answer questions until this run ends.
Do Phase $n of $roadmap, following its instructions for starting a phase.
- If the phase has no plan, use superpowers:writing-plans. Skip the interactive
  brainstorming Q&A: make the calls yourself from the spec and record each as a
  "Ruling:" line in the plan.
- Execute with superpowers:subagent-driven-development. If the plan's ledger
  already shows completed tasks, resume at the first unfinished one.
- I consent to working on the current branch ($branch). Don't create a
  worktree, merge, push, or open a PR. Commit as you go.
- Verify with $verify. Don't start dev servers or GUI apps (no one can see them).
- Ignore .overnight/ and $self; they belong to the runner, not the project.
- If anything needs my input: append it to NEEDS_INPUT.md (phase, task, question,
  what you'd assume), then move on to the next task that doesn't depend on it.
  Never wait for an answer.
- When finished, update the project's work-tracking docs as the roadmap says, commit,
  and write exactly one word, DONE, PARTIAL, or BLOCKED, to .overnight/phase-$n.status.
EOF

  for (( attempt = 1; attempt <= max_attempts; attempt++ )); do
    echo "=== Phase $n attempt $attempt $(date) ===" >> ".overnight/phase-$n.log"
    claude -p "$prompt" "${permissions[@]}" \
       --max-turns 400 \
       --output-format stream-json --verbose \
       >> ".overnight/phase-$n.log" 2>&1
    [[ -s .overnight/phase-$n.status ]] && break
    if tail -n 5 ".overnight/phase-$n.log" | grep -qiE 'hit your .*limit|rate_limit|429'; then
      (( attempt < max_attempts )) && wait_for_reset ".overnight/phase-$n.log"
    else
      break
    fi
  done

  phase_status=$(tr -d '[:space:]' 2>/dev/null < ".overnight/phase-$n.status")
  phase_status=${phase_status:-BLOCKED}
  echo "Phase $n: $phase_status ($(date '+%-I:%M %p'))"
  if [[ $phase_status != DONE ]]; then break; fi
done
