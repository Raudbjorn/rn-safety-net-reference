#!/usr/bin/env bash
# PreToolUse hook for Bash. Exit 2 blocks the command and feeds stderr back to Claude.
# Keeps the steps that belong to a person out of reach of a session in this repo:
#   - everyone, the main session included: merging or approving a pull request, and moving a Linear
#     issue to Done or Cancelled;
#   - subagents (hook input carries `agent_type`): also git push / merge / rebase and opening a PR,
#     which are the orchestrator's;
#   - read-only roles: also git commit.
# Fails CLOSED on unreadable input.
#
# Best effort by construction: it matches the command text, so an indirect spelling (a script file,
# an alias, `sh -c` with a variable) gets past it. Branch protection on `main` is the control that
# does not depend on the command line; this hook stops the direct, ordinary attempt and says why.
set -euo pipefail

input=$(cat)
cmd=$(jq -er '.tool_input.command' <<<"$input" 2>/dev/null) ||
  { echo "guard-bash: unreadable hook input, refusing" >&2; exit 2; }
role=$(jq -er '.agent_type // "" | strings' <<<"$input" 2>/dev/null) ||
  { echo "guard-bash: unreadable agent_type in hook input, refusing" >&2; exit 2; }

# A command word at the start of the line or after a shell separator, then its arguments.
readonly AT='(^|[;&|(`[:space:]])'
readonly GIT="${AT}git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+"

blocked() { echo "Blocked: $1" >&2; exit 2; }
matches() { grep -Eiq -- "$1" <<<"$cmd"; }

matches "${AT}gh[[:space:]]+pr[[:space:]]+(merge|review)" &&
  blocked "merging and approving pull requests belong to a person."
matches "linearis.*--status[[:space:]=]+[\"']?(done|cancel)" &&
  blocked "moving an issue to Done or Cancelled belongs to a person. Leave it In Review."

[ -z "$role" ] && exit 0

matches "${GIT}(push|merge|rebase)([[:space:]]|$)" &&
  blocked "$role may not push, merge or rebase. Commit on the branch and report; the orchestrator pushes."
matches "${AT}gh[[:space:]]+pr[[:space:]]+create" &&
  blocked "$role may not open a pull request. The orchestrator does that after the review."

case "$role" in
  spec-checker|ci-triager|reviewer)
    matches "${GIT}commit([[:space:]]|$)" &&
      blocked "$role is a read-only role and may not commit. Post findings as a Linear comment." ;;
esac
exit 0
