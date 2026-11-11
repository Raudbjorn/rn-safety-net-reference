#!/usr/bin/env bash
# PreToolUse hook for Edit|Write|MultiEdit|NotebookEdit. Exit 2 blocks the tool call and feeds stderr
# back to Claude. Two layers:
#   1. Everyone, the main session included: generated files, the lockfile, CI config and the
#      guardrails themselves need a person.
#   2. Subagents: each role in .claude/agents/ may write only inside its own lane. Claude Code puts
#      the subagent's name in the hook input as `agent_type`; the main session has none.
# Fails CLOSED: unreadable input, or a subagent with no lane defined here, is refused, not waved through.
#
# This covers the file-editing tools only. A role with Bash can still write with sed or a redirect;
# scripts/check-evidence.sh is the check on what actually got committed.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$PWD}"
input=$(cat)
path=$(jq -er '.tool_input.file_path // .tool_input.notebook_path' <<<"$input" 2>/dev/null) ||
  { echo "guard-paths: unreadable hook input, refusing" >&2; exit 2; }
role=$(jq -er '.agent_type // "" | strings' <<<"$input" 2>/dev/null) ||
  { echo "guard-paths: unreadable agent_type in hook input, refusing" >&2; exit 2; }

# Normalise (resolves ../ and symlink-free relative forms) so "src/../specs/TRACE.md" cannot slip through.
rel=$(realpath -m --relative-to="$root" -- "$path")

case "$rel" in
  specs/TRACE.md)
    echo "Blocked: $rel is generated. Run 'npm run trace:write' instead of editing it." >&2; exit 2 ;;
  package-lock.json)
    echo "Blocked: $rel is changed by npm, not by hand. Run npm install/ci." >&2; exit 2 ;;
  .github/*|.claude/settings.json|.claude/hooks/*)
    echo "Blocked: $rel is CI/guardrail configuration and needs a human change." >&2; exit 2 ;;
esac

case "$role" in
  '')            exit 0 ;; # main session: layer 1 only
  test-author)   lanes=('tests/*' 'specs/*') ;;
  implementer)   lanes=('src/*' 'server/*') ;;
  mutant-author) lanes=('scripts/fault-inject.ts') ;;
  spec-checker|ci-triager|reviewer) lanes=() ;;
  *)
    echo "Blocked: subagent '$role' has no write lane in .claude/hooks/guard-paths.sh. Adding one is a human change." >&2
    exit 2 ;;
esac

for lane in "${lanes[@]}"; do
  # shellcheck disable=SC2254  # $lane is a glob on purpose
  case "$rel" in $lane) exit 0 ;; esac
done

echo "Blocked: $role may not write $rel. Its lane: ${lanes[*]:-none, this role is read-only}." \
  "If the task needs this file, say so in a Linear comment and stop." >&2
exit 2
