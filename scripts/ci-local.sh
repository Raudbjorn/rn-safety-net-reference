#!/usr/bin/env bash
# Runs the two jobs that gate a pull request in .github/workflows/ci.yml (`fast` and `rules`) against a
# clean checkout of ONE commit, so uncommitted files and leftover local state cannot make it pass.
#
#   scripts/ci-local.sh [ref]        default ref: HEAD
#   CI_LOCAL_BASE=<ref>              what the evidence gate compares against (default: main)
#
# A stand-in for the hosted run, not a replacement: the commands are the same, the machine is not
# (this host's OS, Node and Java instead of the runner image). Every step runs even after a failure,
# so the summary shows everything that is wrong, and the exit code is non-zero if any step failed.
set -euo pipefail

readonly REQUIRED_NODE_MAJOR=24

ref="${1:-HEAD}"
root=$(git rev-parse --show-toplevel)
sha=$(git -C "$root" rev-parse --verify "${ref}^{commit}")

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" != "$REQUIRED_NODE_MAJOR" ]; then
  echo "ci-local: Node $REQUIRED_NODE_MAJOR required (ci.yml NODE_VERSION), found $(node -v)" >&2
  exit 2
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/ci-local.XXXXXX")
log_dir="$root/reports/ci-local"
log="$log_dir/${sha:0:12}.log"
mkdir -p "$log_dir"
: >"$log"

cleanup() {
  git -C "$root" worktree remove --force "$work" >/dev/null 2>&1 || rm -rf "$work"
}
trap cleanup EXIT

git -C "$root" worktree add --quiet --detach "$work" "$sha"
cd "$work"

failed=0
summary=()

step() {
  local job="$1" name="$2"
  shift 2
  local start=$SECONDS status=PASS
  printf '\n===== [%s] %s =====\n$ %s\n' "$job" "$name" "$*" >>"$log"
  if ! "$@" >>"$log" 2>&1; then
    status=FAIL
    failed=1
  fi
  summary+=("$(printf '%-4s  %-5s  %-34s %3ss' "$status" "$job" "$name" "$((SECONDS - start))")")
  echo "${summary[-1]}"
}

skip() {
  summary+=("$(printf '%-4s  %-5s  %-34s' SKIP "$1" "$2")")
  echo "${summary[-1]}"
}

trace_is_current() {
  npm run --silent trace:write && git diff --exit-code specs/TRACE.md
}

base="${CI_LOCAL_BASE:-main}"

echo "ci-local: commit ${sha:0:12} ($(git -C "$root" log -1 --format=%s "$sha"))"

# The evidence gate is taken from the checkout this script was started in, not from the commit under
# test: a commit must not be judged by its own copy of the gate. The self-test is the commit's own,
# because it tests that commit's guardrails; commits older than the self-test skip it.
step fast 'evidence append-only, lanes' "$root/scripts/check-evidence.sh" "$base" "$sha"
if [ -f scripts/selftest-guards.sh ]; then
  step fast 'guardrail self-test' bash scripts/selftest-guards.sh
else
  skip fast 'guardrail self-test (not in commit)'
fi
step fast 'npm ci' npm ci --no-audit --no-fund
step fast 'typecheck' npm run --silent typecheck
step fast 'lint' npm run --silent lint
step fast 'unit + component (jest)' npm test --silent
step fast 'api' npm run --silent test:api
step fast 'traceability, matrix current' trace_is_current
step rules 'Firestore rules (emulator)' npm run --silent rules:ci
step rules 'mutation check' npm run --silent fault:check -- --why

echo
if [ "$failed" -eq 0 ]; then
  echo "ci-local: PASS  ${sha:0:12}  (log: ${log#"$root"/})"
else
  echo "ci-local: FAIL  ${sha:0:12}  (log: ${log#"$root"/})"
fi
exit "$failed"
