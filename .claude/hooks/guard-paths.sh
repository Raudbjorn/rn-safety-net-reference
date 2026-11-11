#!/usr/bin/env bash
# PreToolUse hook for Edit|Write|MultiEdit. Exit 2 blocks the tool call and feeds stderr back to Claude.
# Protects what a person should own: generated files, the lockfile, CI config, and this guard itself.
# Fails CLOSED: if the input cannot be understood, the edit is refused rather than waved through.
set -euo pipefail

root="${CLAUDE_PROJECT_DIR:-$PWD}"
path=$(jq -er '.tool_input.file_path' 2>/dev/null) || { echo "guard-paths: unreadable hook input, refusing" >&2; exit 2; }

# Normalise (resolves ../ and symlink-free relative forms) so "src/../specs/TRACE.md" cannot slip through.
rel=$(realpath -m --relative-to="$root" -- "$path")

case "$rel" in
  specs/TRACE.md)
    echo "Blocked: $rel is generated. Run 'npm run trace:write' instead of editing it." >&2; exit 2 ;;
  package-lock.json)
    echo "Blocked: $rel is changed by npm, not by hand. Run npm install/ci." >&2; exit 2 ;;
  .github/workflows/*|.claude/settings.json|.claude/hooks/*)
    echo "Blocked: $rel is CI/guardrail configuration and needs a human change." >&2; exit 2 ;;
esac
exit 0
