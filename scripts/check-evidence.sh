#!/usr/bin/env bash
# Evidence gate: what did the commits in <base>..<head> do to the things that prove the code works?
#
#   scripts/check-evidence.sh <base> [head]        head defaults to HEAD
#
# 1. Existing evidence is append-only. Tests, requirement lines, Maestro flows and the mutant list
#    may gain lines. A commit that removes or rewrites one fails, unless its message carries an
#    `Evidence-Change: <reason>` trailer. The reason is printed, so a changed assertion is a stated
#    decision a reviewer sees, not one line in a diff. Rule 2 keeps such a commit to evidence alone.
# 2. One lane per commit:
#      evidence        tests/  specs/  .maestro/
#      mutants         scripts/fault-inject.ts
#      product         src/  server/  App.tsx  index.ts  firestore.rules
#      infrastructure  everything else
#    A commit that changes code and its tests together cannot be read as "the test came first",
#    and it is the shape a test takes when it is bent to fit the code.
# specs/TRACE.md is generated, so it is exempt from both rules.
#
# Needs git only (no node_modules). Merge commits are skipped: they are judged by their parents.
# Exit 0 clean, 1 on a finding, 2 if the range cannot be read (fails closed).
set -euo pipefail

base="${1:?usage: check-evidence.sh <base> [head]}"
head="${2:-HEAD}"
for ref in "$base" "$head"; do
  git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null ||
    { echo "check-evidence: '$ref' is not a commit here; refusing to pass an unread range" >&2; exit 2; }
done

lane_of() {
  case "$1" in
    specs/TRACE.md) echo generated ;;
    tests/*|specs/*|.maestro/*) echo evidence ;;
    scripts/fault-inject.ts) echo mutants ;;
    src/*|server/*|App.tsx|index.ts|firestore.rules) echo product ;;
    *) echo infrastructure ;;
  esac
}

failed=0
count=0
while read -r commit; do
  count=$((count + 1))
  label="$(git log -1 --format='%h %s' "$commit" | cut -c1-78)"
  declare -A lanes=()
  removed_from=()
  while IFS=$'\t' read -r _added removed path; do
    [ -n "$path" ] || continue
    lane=$(lane_of "$path")
    [ "$lane" = generated ] && continue
    lanes[$lane]=1
    case "$lane" in
      evidence|mutants) [ "$removed" = 0 ] || removed_from+=("$path (-$removed)") ;;
    esac
  done < <(git -c core.quotePath=false show --numstat --no-renames --format= "$commit")

  touched=$(printf '%s\n' "${!lanes[@]}" | sort | paste -sd+ -)
  reason=$(git log -1 --format='%(trailers:key=Evidence-Change,valueonly,separator=%x20)' "$commit")
  problems=()

  if [ "${#lanes[@]}" -gt 1 ]; then
    problems+=("mixes lanes ($touched): split it so each commit stays in one")
  fi
  if [ "${#removed_from[@]}" -gt 0 ] && [ -z "$reason" ]; then
    problems+=("removes or rewrites existing evidence with no Evidence-Change trailer: ${removed_from[*]}")
  fi

  if [ "${#problems[@]}" -eq 0 ]; then
    printf 'ok    %-14s %s\n' "${touched:-generated}" "$label"
    if [ "${#removed_from[@]}" -gt 0 ]; then
      printf '      EVIDENCE CHANGED, reason given: %s\n      in: %s\n' "$reason" "${removed_from[*]}"
    fi
  else
    failed=1
    printf 'FAIL  %-14s %s\n' "$touched" "$label"
    printf '      %s\n' "${problems[@]}"
  fi
  unset lanes
done < <(git rev-list --reverse --no-merges "$base..$head")

echo
if [ "$failed" -eq 0 ]; then
  echo "check-evidence: $count commit(s) in $base..$head, existing evidence intact, one lane each"
else
  echo "check-evidence: FAILED (see above). A changed assertion needs a person: put it in its own"
  echo "commit with an 'Evidence-Change: <why>' trailer in the message."
fi
exit "$failed"
