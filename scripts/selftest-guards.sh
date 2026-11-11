#!/usr/bin/env bash
# Tests the guardrails themselves, so a broken guard shows up as a red step instead of as silence:
#   .claude/hooks/guard-paths.sh, .claude/hooks/guard-bash.sh   with simulated hook input
#   scripts/check-evidence.sh                                   against a scratch git repository
# Every case states the exit code it expects. The hooks are fed the JSON shape Claude Code documents
# for PreToolUse; that they are wired in and fire for a real subagent is a separate question
# (see README, Verification record).
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
paths_hook="$root/.claude/hooks/guard-paths.sh"
bash_hook="$root/.claude/hooks/guard-bash.sh"
evidence="$root/scripts/check-evidence.sh"

pass=0
fail=0
expect() { # expect <exit code> <description> <command...>
  local want="$1" what="$2" got=0
  shift 2
  "$@" >/dev/null 2>&1 || got=$?
  if [ "$got" -eq "$want" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "FAIL  $what: expected exit $want, got $got"
  fi
}

# ---- guard-paths.sh ------------------------------------------------------------------------------
edit() { # edit <role or ''> <path>
  local role="$1" path="$2" json
  if [ -n "$role" ]; then
    json=$(jq -nc --arg p "$path" --arg r "$role" '{tool_name:"Edit",agent_type:$r,tool_input:{file_path:$p}}')
  else
    json=$(jq -nc --arg p "$path" '{tool_name:"Edit",tool_input:{file_path:$p}}')
  fi
  CLAUDE_PROJECT_DIR="$root" "$paths_hook" <<<"$json"
}
raw_paths() { CLAUDE_PROJECT_DIR="$root" "$paths_hook" <<<"$1"; }

expect 0 'main session edits src'                      edit '' "$root/src/sync/queue.ts"
expect 0 'main session edits a test'                   edit '' "$root/tests/unit/queue.test.ts"
expect 2 'main session edits generated TRACE.md'       edit '' "$root/specs/TRACE.md"
expect 2 'TRACE.md reached through ../'                edit '' "$root/src/../specs/TRACE.md"
expect 2 'main session edits the lockfile'             edit '' "$root/package-lock.json"
expect 2 'main session edits a workflow'               edit '' "$root/.github/workflows/ci.yml"
expect 2 'main session edits CODEOWNERS'               edit '' "$root/.github/CODEOWNERS"
expect 2 'main session edits a hook'                   edit '' "$root/.claude/hooks/guard-paths.sh"
expect 2 'main session edits settings.json'            edit '' "$root/.claude/settings.json"
expect 2 'malformed input is refused'                  raw_paths 'not json'
expect 2 'input without a path is refused'             raw_paths '{"tool_input":{}}'
expect 2 'non-string agent_type is refused'            raw_paths '{"agent_type":7,"tool_input":{"file_path":"src/a.ts"}}'

expect 0 'test-author writes a test'                   edit test-author "$root/tests/unit/new.test.ts"
expect 0 'test-author writes the spec'                 edit test-author "$root/specs/offline-drill-sync.md"
expect 2 'test-author writes src'                      edit test-author "$root/src/sync/queue.ts"
expect 2 'test-author writes src through tests/../'    edit test-author "$root/tests/../src/sync/queue.ts"
expect 2 'test-author writes TRACE.md'                 edit test-author "$root/specs/TRACE.md"
expect 2 'test-author writes the mutant list'          edit test-author "$root/scripts/fault-inject.ts"
expect 0 'implementer writes src'                      edit implementer "$root/src/sync/queue.ts"
expect 0 'implementer writes server'                   edit implementer "$root/server/gateway.ts"
expect 2 'implementer writes a test'                   edit implementer "$root/tests/unit/queue.test.ts"
expect 2 'implementer writes the spec'                 edit implementer "$root/specs/offline-drill-sync.md"
expect 2 'implementer writes a script'                 edit implementer "$root/scripts/ci-local.sh"
expect 2 'implementer writes outside the repo'         edit implementer "$root/../elsewhere/src/a.ts"
expect 0 'mutant-author writes the mutant list'        edit mutant-author "$root/scripts/fault-inject.ts"
expect 2 'mutant-author writes another script'         edit mutant-author "$root/scripts/check-evidence.sh"
expect 2 'mutant-author writes a test'                 edit mutant-author "$root/tests/unit/queue.test.ts"
expect 2 'reviewer writes anything'                    edit reviewer "$root/src/sync/queue.ts"
expect 2 'spec-checker writes the spec'                edit spec-checker "$root/specs/offline-drill-sync.md"
expect 2 'ci-triager writes a test'                    edit ci-triager "$root/tests/unit/queue.test.ts"
expect 2 'a subagent with no lane is refused'          edit general-purpose "$root/src/sync/queue.ts"

# ---- guard-bash.sh -------------------------------------------------------------------------------
run() { # run <role or ''> <command>
  local role="$1" command="$2" json
  if [ -n "$role" ]; then
    json=$(jq -nc --arg c "$command" --arg r "$role" '{tool_name:"Bash",agent_type:$r,tool_input:{command:$c}}')
  else
    json=$(jq -nc --arg c "$command" '{tool_name:"Bash",tool_input:{command:$c}}')
  fi
  "$bash_hook" <<<"$json"
}

expect 0 'main session runs the tests'                 run '' 'npm test'
expect 0 'main session pushes a branch'                run '' 'git push -u origin rau-5-manual-retry'
expect 0 'main session opens a PR'                     run '' 'gh pr create --fill'
expect 2 'main session merges a PR'                    run '' 'gh pr merge 1 --squash'
expect 2 'main session approves a PR'                  run '' 'cd /tmp && gh pr review 1 --approve'
expect 2 'main session sets Done'                      run '' 'npx -y linearis@2026.8.0 issues update RAU-6 --status "Done"'
expect 0 'main session sets In Review'                 run '' 'npx -y linearis@2026.8.0 issues update RAU-6 --status "In Review"'
expect 2 'malformed input is refused'                  "$bash_hook" <<<'not json'
expect 0 'implementer commits'                         run implementer 'git add src && git commit -m "RAU-7: retry"'
expect 2 'implementer pushes'                          run implementer 'git push origin HEAD'
expect 2 'implementer pushes with -C'                  run implementer 'git -C /tmp/x push'
expect 2 'implementer pushes after another command'    run implementer 'npm test && git push'
expect 2 'implementer merges'                          run implementer 'git merge main'
expect 0 'implementer runs merge-base'                 run implementer 'git merge-base main HEAD'
expect 2 'test-author opens a PR'                      run test-author 'gh pr create --fill'
expect 2 'test-author sets Cancelled'                  run test-author 'npx linearis issues update RAU-6 --status=cancelled'
expect 0 'reviewer makes a throwaway worktree'         run reviewer 'git worktree add --detach /tmp/review HEAD'
expect 2 'reviewer commits'                            run reviewer 'git commit -am "tweak"'
expect 2 'ci-triager commits'                          run ci-triager 'git -c user.name=x commit -m y'
expect 0 'reviewer reads the log'                      run reviewer 'git log --oneline main..HEAD'

# ---- check-evidence.sh ---------------------------------------------------------------------------
scratch=$(mktemp -d "${TMPDIR:-/tmp}/selftest-guards.XXXXXX")
trap 'rm -rf "$scratch"' EXIT
g() { git -C "$scratch" -c user.name=selftest -c user.email=selftest@example.invalid -c commit.gpgsign=false "$@"; }
commit() { g add -A && g commit -q -m "$1"; }
fresh() { # reset the scratch repo to its base commit on a new branch
  g checkout -q -B "case-$RANDOM" base
}

g init -q -b main
mkdir -p "$scratch"/{tests,src,specs,scripts}
printf "it('[REQ-X-001] a', () => {\n  expect(status).toBe('synced');\n});\n" >"$scratch/tests/a.test.ts"
printf 'export const a = 1;\n' >"$scratch/src/a.ts"
printf -- '- **REQ-X-001** The app shall do the thing.\n' >"$scratch/specs/x.md"
printf '| REQ-X-001 | generated |\n' >"$scratch/specs/TRACE.md"
printf "  { id: 'M1' },\n" >"$scratch/scripts/fault-inject.ts"
commit 'base'
g tag base
gate() { (cd "$scratch" && "$evidence" base HEAD); }

fresh; printf "it('[REQ-X-001] b', () => {});\n" >>"$scratch/tests/a.test.ts"; commit 'add a test'
expect 0 'evidence: a commit that only adds a test' gate

fresh; printf 'export const b = 2;\n' >>"$scratch/src/a.ts"; printf '| regenerated |\n' >"$scratch/specs/TRACE.md"; commit 'product + regenerated matrix'
expect 0 'evidence: product change with a regenerated TRACE.md' gate

fresh; sed -i "s/toBe('synced')/toBeDefined()/" "$scratch/tests/a.test.ts"; commit 'loosen an assertion'
expect 1 'evidence: a rewritten assertion' gate

fresh; sed -i "s/toBe('synced')/toBe('stored')/" "$scratch/tests/a.test.ts"
commit "$(printf 'rename the status\n\nEvidence-Change: the status was renamed in the spec by a person')"
expect 0 'evidence: a rewritten assertion with a reason, evidence only' gate

fresh; sed -i "s/toBe('synced')/toBe('stored')/" "$scratch/tests/a.test.ts"; printf 'export const c = 3;\n' >>"$scratch/src/a.ts"
commit "$(printf 'rename everywhere\n\nEvidence-Change: renamed')"
expect 1 'evidence: a reason does not excuse touching product in the same commit' gate

fresh; printf "it('[REQ-X-001] c', () => {});\n" >>"$scratch/tests/a.test.ts"; printf 'export const d = 4;\n' >>"$scratch/src/a.ts"; commit 'test and code together'
expect 1 'evidence: one commit in two lanes' gate

fresh; sed -i 's/shall do the thing/should do the thing/' "$scratch/specs/x.md"; commit 'soften a requirement'
expect 1 'evidence: a rewritten requirement line' gate

fresh; : >"$scratch/scripts/fault-inject.ts"; commit 'drop a mutant'
expect 1 'evidence: a removed mutant' gate

fresh; g rm -q tests/a.test.ts; commit 'delete a test file'
expect 1 'evidence: a deleted test file' gate

fresh; printf 'export const e = 5;\n' >>"$scratch/src/a.ts"; commit 'good'; sed -i "s/toBe('synced')/toBeTruthy()/" "$scratch/tests/a.test.ts"; commit 'bad'
expect 1 'evidence: one bad commit among good ones' gate

fresh
expect 0 'evidence: an empty range' gate
expect 2 'evidence: an unknown base is refused' bash -c "cd '$scratch' && '$evidence' no-such-ref HEAD"

echo "selftest-guards: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
