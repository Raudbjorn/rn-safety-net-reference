# rn-safety-net-reference

A small, runnable reference for **putting a test safety net under a React Native + Node + Firebase app
before changing it**, using one offline-first feature (a drill logbook that must work with no signal).
It is a teaching artefact built from public tooling. It contains no code, data or configuration from any
real system.

The point is not the logbook. The point is the *shape*: every behaviour is a numbered requirement, every
requirement is proven by the cheapest test that can prove it, a script fails the build when one is
unproven, and a second script proves the tests can actually fail.

## The loop

```
specs/offline-drill-sync.md      EARS requirements with stable IDs (REQ-DRILL-003, REQ-AUTHZ-002, ...)
        |  a test cites the ID in its title: it('[REQ-DRILL-003] ...')
        v
npm run trace                    fails if a requirement has no test, or a test cites an unknown ID
npm run fault:check              breaks the code on purpose, in a throwaway copy; the suite must go red
```

| Layer | Proves | Tool | Command | Speed |
|---|---|---|---|---|
| Unit | queue logic, persistence order, retries | Jest (jest-expo) | `npm test` | ~1 s |
| Contract | HTTP outcome -> app result mapping | Jest | `npm test` | ~1 s |
| Component | what the screen shows offline / online / rejected | React Native Testing Library | `npm test` | ~1 s |
| API | idempotency, validation, lost-reply behaviour | `node:test` + real Express app | `npm run test:api` | ~0.3 s |
| Data-layer authorisation | who may create / read / change records | Firestore emulator + `@firebase/rules-unit-testing` | `npm run rules:ci` | ~10 s |
| End to end | the above, through the real app on a device | Maestro on an Android emulator | `npm run e2e` | minutes |

## What the feature is designed around

A drill recorded with no signal must not be lost, must not be reported as sent, and must not be recorded
twice when the connection comes back. Hence: persist before any network call; the client assigns the
id; the gateway is idempotent per id; a reply that never arrives is treated as "unknown, retry the
same id" rather than "failed" (`src/sync/httpTransport.ts` maps 5xx, 408, 429, timeouts and network errors to
`unavailable`; other 4xx are permanent `rejected`).

## Layout

```
src/domain      zod schemas shared by app and gateway (one contract), Result<T,E> type
src/sync        DrillQueue (offline queue), HTTP transport; both take their dependencies as arguments
src/ui          DrillScreen (receives `isOnline`; never decides what online means)
server          Express gateway with test-only fault hooks (off unless FAULTS=1)
firestore.rules client-SDK authorisation (REQ-AUTHZ-*)
tests           unit, component, api, rules
.maestro        three device flows (offline -> online; lost reply -> retry)
scripts         check-traceability, fault-inject, e2e.sh, ci-local.sh (the two PR-gating CI jobs on a clean checkout of one commit)
.github         ci.yml (3 jobs), claude-review.yml (optional)
.claude         a PreToolUse hook that stops an AI agent editing generated / CI / guardrail files;
                agents/ (test-author, implementer, reviewer) and commands/linear-issue.md (the orchestration)
```

## Verification record

Run on one machine (Linux, Node 24.22.2, Java 25) on 2026-11-11, from the final state of the repo:

| Check | Result |
|---|---|
| `npm run typecheck`, `npm run lint` | clean |
| `npm test` | 3 suites, 25 tests passed |
| `npm run test:api` | 5 passed |
| `npm run rules:ci` (Firestore emulator 1.22.0) | 17 passed |
| `npm run trace` | 12 of 12 requirements have a test |
| `npm run fault:check` | baseline green for jest, api, rules; 9 of 9 mutations killed, each by the test for the requirement it breaks (`--why` lists them) |
| `.claude/hooks/guard-paths.sh` | exercised with 9 simulated hook inputs, including a `../` traversal and malformed input |
| `scripts/e2e.sh` | plumbing only, with stand-ins for `adb` and `maestro` (see below) |
| both workflows | `actionlint` v1.7.12: no findings |

Checked against the sources rather than from memory: Maestro 2.12.1 asset digest and zip layout; the
`claude-code-action` inputs (`action.yml`); the emulator-runner inputs and KVM step (its README); every
action tag resolved to a commit SHA with `gh api` on 2026-11-11.

Rules tests have a **control** for each kind of denial: the same user, one attribute flipped, must
succeed. `assertFails` passes on *any* denial, so without controls a typo in the rules would make every
negative test pass for the wrong reason.

## Agent delivery run (Linear RAU-5, 2026-11-11)

One feature, "manual retry of a rejected drill" (REQ-DRILL-010, 011, 012), was delivered on the branch
`rau-5-manual-retry-rejected-drill` by Claude subagents working from Linear issues, each inside the role
in `.claude/agents/`. The orchestrating Claude Code session wrote the issues, dispatched the agents and
ran `scripts/ci-local.sh` between steps; it wrote no product code or tests. Each agent posted its
evidence as a comment on its issue.

| Step | Issue | Commit | `scripts/ci-local.sh` on that commit |
|---|---|---|---|
| Requirements copied into the spec, 14 failing tests | RAU-6, test-author | `a1153ab` | red, as intended: typecheck (9 errors on the missing method), jest (14 new failed, 25 passed), mutation check refused to run on a red baseline |
| `DrillQueue.retryRejected` | RAU-7, implementer | `f52373c` | not run (the screen tests were still red by design) |
| Retry control on the screen | RAU-8, implementer | `864abef` | green, 8 of 8 steps, 9 of 9 mutations killed |
| Independent review | RAU-5, reviewer | none | **changes requested**: 29 hand-made mutants in a throwaway worktree, 25 killed, 4 survived while the pipeline was green |
| Two tests for the surviving mutants | RAU-9, test-author | `bfed245` | green, 8 of 8 steps |
| Re-review | RAU-5, reviewer | none | **approve**, explicitly not covering the open decision in RAU-10 |

Left for a person: RAU-10 (a retry pressed while a sync is running waits for the next sync trigger;
`record` on `main` behaves the same), RAU-11 (storage failure during a retry throws instead of returning
an error value; refused-retry message untested; no mutants for the three new requirements in
`scripts/fault-inject.ts`), and the merge itself.

The branch `staged/weakened-assertion` is a deliberate counter-example, labelled as staged in its commit
message: it loosens one assertion for REQ-DRILL-006. Typecheck, lint and every test pass; only the
mutation check fails (M2 survives).

## Not claimed

**Not run at all**
- The Maestro flows (`.maestro/*.yaml`) have never been executed. No emulator, device or Maestro install
  was available here. They use only `launchApp`, `tapOn`, `assertVisible`, `extendedWaitUntil` and
  `setAirplaneMode`, but their syntax, timeouts and selectors are unproven against a real build.
- `expo prebuild`, the Gradle release build, the emulator job, and `claude-review.yml` have not run.
  On GitHub the two gating jobs (`fast`, `rules`) ran for the first time on 2026-11-11, once each: green
  on `main` and on PR #1, red on the staged draft PR #2 at the mutation check only (M2 survived). The
  emulator job is skipped on pushes and PRs. `actionlint` checks syntax and
  expressions, not whether the jobs succeed. `scripts/ci-local.sh` runs the same commands as the `fast` and
  `rules` jobs, on this machine's OS, Node 24 and Java 25, not on the runner image; it is a stand-in, and the
  two workflow files were edited after `actionlint` last ran.
- iOS. `setAirplaneMode` is Android-only in Maestro, so flow 02 has no iOS equivalent here.
- The hook was tested as a script with simulated input, not through Claude Code.
- The hook deliberately does **not** block `tests/` or `specs/`: an agent has to write tests alongside the
  change. So nothing here stops an agent weakening an existing assertion. What catches that is the
  mutation check (a weakened test stops killing its mutant), the traceability gate, and human review of any
  changed assertion. Branch protection plus CODEOWNERS on `tests/`, `specs/` and `.github/` is the missing
  control and is not set up.

**What the evidence does not prove**
- The agent run was one run, on one machine, on one small feature. It says nothing about how often a
  run goes this way.
- The role boundaries (the test author does not touch `src/`, implementers do not touch `tests/` or
  `specs/`, the reviewer does not commit) were **instructions, checked afterwards by diff, not enforced**.
  The subagents ran under a Claude Code session whose project directory was not this repo, so the
  `.claude` hook did not apply to them.
- Every Linear action was made with the repo owner's own login, so Linear shows one author; the agents
  signed their comments with their role. Nothing was triggered from Linear: a session read the issues.
  The orchestrator, not a person, wrote the requirement text in RAU-5.
- The reviewer's 29 mutants were applied by hand in a scratch worktree and discarded. Nothing re-checks
  them; the pipeline's own mutation check does not cover REQ-DRILL-010 to 012 (RAU-11).
- `scripts/e2e.sh` was smoke-tested with shims that imitate the app. That checks its gateway start-up,
  fault arming, record count and cleanup. It says nothing about the app or Maestro.
- The Maestro flows are listed in `specs/TRACE.md` but the traceability gate does **not** count them as
  proof, because they only run on an emulator in CI.
- Nine mutations is a sample, not coverage. Surviving mutants elsewhere are possible. Mutation check
  scope is the files named in `scripts/fault-inject.ts`.
- The gateway is an in-memory stand-in. It proves the *contract* (idempotent per id, lost reply, 4xx/5xx
  semantics), not any real backend. In particular, **Firestore rules do not apply to server code using the
  Admin SDK or a service account**; anything a backend writes needs its own authorisation tests.
- No database integration tests are included. For SQL Server, `@testcontainers/mssqlserver` is the
  approach I would use; it is not implemented here and I have not tried it.
- Firestore offline persistence and conflict behaviour are not exercised: the queue is the app's own,
  over `AsyncStorage`, to keep the idempotency argument explicit.

**Observed once, not understood to the root**
- The Firestore emulator (1.22.0) prints `evaluation error at L32:24 ...` beside some denials. A probe with
  `debug()` showed the rule inputs evaluating correctly (true, true, false for the three users), so I
  believe it is the emulator's verbose reporting of a first evaluation pass, but I did not read the emulator's
  source. The positive controls exist so the suite does not depend on that explanation.
- Timings are from a single run.

**Residual risk this does not remove**
- Green tests here do not make a different codebase safe; they show the method works on this one.
- CI is pinned to Java 21 and `ubuntu-24.04`; I ran Java 25 locally. The `rules` job has passed on Java 21
  in hosted CI once; the Android job's Java 21 build is still untested.
- The Gradle release build of React Native 0.88 with the New Architecture was not attempted; it is the
  most likely place for the first CI failure.

**New state and dependencies**
- Expo 58 / React Native 0.88.1 / React 19.3, Jest 30, jest-expo 58, RNTL 14, Express 5, Zod 4, ESLint 10,
  TypeScript 6, firebase 13, firebase-tools 15, `@firebase/rules-unit-testing` 6. `npm ci` reproduces them
  from `package-lock.json`.
- `firebase-tools` downloads the Firestore emulator jar to `~/.cache/firebase/emulators` on first use.
- CI downloads Maestro 2.12.1 (~350 MB) and verifies its SHA-256 before use.
- `claude-review.yml` needs an `ANTHROPIC_API_KEY` secret. Use a key from a dedicated Console workspace with
  its own spend limit. The job is skipped unless the repository variable `CLAUDE_REVIEW_ENABLED` is `true`; it gates nothing.
