# rn-safety-net-reference

A small, runnable reference for **putting a test safety net under a React Native + Node + Firebase app
before changing it**, using one offline-first feature (a drill logbook that must work with no signal).
It is a teaching artefact built from public tooling. It contains no code, data or configuration from any
real system.

The point is not the logbook. The point is the *shape*: every behaviour is a numbered requirement, every
requirement is proven by the cheapest test that can prove it, a script fails the build when one is
unproven, and a second script proves the tests can actually fail.

## Where to look first

| To see | Look at |
|---|---|
| One feature delivered by role-limited agents | [PR #1](https://github.com/Raudbjorn/rn-safety-net-reference/pull/1): four commits, each from one role |
| The pipeline rejecting a weakened test | [PR #2](https://github.com/Raudbjorn/rn-safety-net-reference/pull/2), a staged draft: one loosened assertion, everything green except the mutation check |
| What the agents were told and what they reported | `docs/linear-trail/` (a copy of the Linear issues and comments) and `.claude/agents/` |
| What keeps a role inside its lane | "Enforcement added after the run", below |
| What none of this proves | "Not claimed", at the end |

## The loop

```
specs/offline-drill-sync.md      EARS requirements with stable IDs (REQ-DRILL-003, REQ-AUTHZ-002, ...)
        |  a test cites the ID in its title: it('[REQ-DRILL-003] ...')
        v
npm run trace                    fails if a requirement has no test, or a test cites an unknown ID
npm run fault:check              breaks the code on purpose, in a throwaway copy; the suite must go red
scripts/check-evidence.sh        fails a commit that rewrites an existing test, requirement or mutant
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
scripts         check-traceability, fault-inject, check-evidence (existing evidence is append-only, one lane
                per commit), selftest-guards (tests the hooks and that gate), e2e.sh, ci-local.sh (the two
                PR-gating CI jobs on a clean checkout of one commit)
.github         ci.yml (3 jobs), claude-review.yml (optional), CODEOWNERS
.claude         hooks/ guard-paths.sh (who may write where, per role) and guard-bash.sh (no merge, push
                or Done from an agent); agents/ (spec-checker, test-author, implementer, mutant-author,
                ci-triager, reviewer); commands/linear-issue.md (the orchestration)
docs            linear-trail/ (a copy of the Linear issues and comments for RAU-5)
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
| `.claude/hooks/*.sh`, `scripts/check-evidence.sh` | `scripts/selftest-guards.sh`: 63 cases (31 path hook, 20 Bash hook, 12 evidence gate against a scratch repository); `shellcheck` clean. Until 2026-11-11 this row recorded 9 hand-run inputs to the path hook; the cases are now a script in the `fast` job |
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

The three agent files used in this run are unchanged since. `commands/linear-issue.md` has been rewritten
since (see the next section), so the orchestration as it now reads is not the one that ran.

The branch `staged/weakened-assertion` is a deliberate counter-example, labelled as staged in its commit
message: it loosens one assertion for REQ-DRILL-006. Typecheck, lint and every test pass; only the
mutation check fails (M2 survives).

## Enforcement added after the run (2026-11-11)

The RAU-5 run rested on instructions and on reading each commit's diff afterwards. These now stand
behind the roles:

| Control | What it refuses | Where | How it was checked |
|---|---|---|---|
| Write lanes | A subagent using Edit or Write outside its lane: `test-author` has `tests/` and `specs/`, `implementer` has `src/` and `server/`, `mutant-author` has `scripts/fault-inject.ts`, the three reading roles have nothing. A subagent with no lane defined is refused. | `.claude/hooks/guard-paths.sh` | 31 simulated inputs. Through Claude Code 2.1.321 in a scratch copy: a real `implementer` subagent was refused `tests/unit/canary.test.ts` and allowed `src/canary.ts`; a real `test-author` got the reverse; the main session was refused `specs/TRACE.md`. |
| A person's steps | From any session: `gh pr merge`, `gh pr review`, a Linear status of Done or Cancelled. From a subagent: also `git push`, `merge`, `rebase` and `gh pr create`. From a reading role: also `git commit`. | `.claude/hooks/guard-bash.sh` | 20 simulated inputs. Through Claude Code: a real `test-author` subagent was refused `git push origin HEAD`. |
| Evidence gate | A commit that removes or rewrites a line of an existing test, requirement, Maestro flow or mutant without an `Evidence-Change: <reason>` trailer, and a commit that spans two lanes (evidence, mutants, product, infrastructure). | `scripts/check-evidence.sh`: first step of the `fast` job on pull requests and of `scripts/ci-local.sh` | 12 cases against a scratch repository. On the real branches: the four RAU-5 commits pass, one lane each; `staged/weakened-assertion` fails on its one rewritten assertion, with no mutant involved. |
| Rules on `main` | For everyone, the owner included: a direct push, a force push, deletion, and a merge while a gating job is red or stale or a review thread is open. For everyone but the owner: a merge without a code-owner approval. The two gating checks only count when GitHub Actions reports them. | Two GitHub rulesets, `.github/CODEOWNERS` | Read back with `gh api repos/Raudbjorn/rn-safety-net-reference/rules/branches/main`. Not tried by attempting a forbidden push or merge. |
| Actions allow-list | A workflow using an action that is not GitHub's own or one of the two third-party actions in `ci.yml` and `claude-review.yml`, or one not pinned to a commit SHA. | Repository Actions settings | Read back with `gh api`. |

The self-test was itself checked the way the suite is: 13 deliberate breaks of the three scripts in a
throwaway copy (a lane widened, a refusal turned into a pass, `../` no longer normalised, removals
ignored, and so on), and it went red for each. A fourteenth break survived and showed a branch of the
gate that could never be reached; that branch was removed. The 13 are not kept as a script.

`commands/linear-issue.md` now starts by proving the hooks are live (it tries to write
`specs/TRACE.md` and stops if that is allowed), which is the failure that went unnoticed in the run.

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
  `rules` jobs, on this machine's OS, Node 24 and Java 25, not on the runner image; it is a stand-in.
  `actionlint` v1.7.12 was run again on both workflow files after their last edit (2026-11-11): no findings.
- iOS. `setAirplaneMode` is Android-only in Maestro, so flow 02 has no iOS equivalent here.
- A delivery with the hooks and the evidence gate switched on. They were exercised in two short scratch
  sessions and by the self-test (see "Enforcement added after the run"); no feature has been delivered
  under them. (Until 2026-11-11 this line said the hook had only been fed simulated input.)
- The three agents added on 2026-11-11, `spec-checker`, `mutant-author` and `ci-triager`, on a real issue.
  Their frontmatter parses (`claude plugin validate .claude/agents`); that is all that is known about
  them. The rewritten orchestration in `commands/linear-issue.md` is untried as well.
- A forbidden push or merge against the rules on `main`. They were read back from the API, not provoked.

**What the evidence does not prove**
- That a test was not weakened. The evidence gate sees removed and rewritten lines. A test can be
  disabled by *adding* a line (an early `return`, a mock that swallows the behaviour), and a reformat
  trips the gate without weakening anything. The mutation check and review are still what answer that
  question. (Until 2026-11-11 this section said branch protection and CODEOWNERS were the missing
  control; both are now set.)
- That a role cannot leave its lane. The path hook covers the file-editing tools. A role with Bash can
  still write anywhere with `sed` or a redirect; the evidence gate then judges the commit, not the
  attempt. `guard-bash.sh` matches command text, so an indirect spelling (a script file, an alias) passes.
- That the actor was a person. The rules on `main` cannot tell an agent from the owner, because both act
  with the owner's login. They stop a red, stale or unreviewed merge, not the wrong hand on a green one.
- That the mutation check covers the new feature. RAU-11 is still open: there is no mutant for
  REQ-DRILL-010 to 012. `mutant-author` is the role meant to add them and has not run.
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
- **A known defect, reproduced and not fixed.** `record()` and `retryRejected()` publish the new state
  in memory before the storage write lands. A flush that starts in that window sends the drill while
  storage still holds the old state: nothing at all for a new drill, `rejected` for a retried one.
  REQ-DRILL-001 and REQ-DRILL-010 forbid exactly that. Every test awaits one call before starting the
  next, so none of them sees it, and no mutant covers it. An automated review raised it on PR #1 on
  2026-11-11; it was then reproduced with a slow store in a throwaway copy of the branch, for both
  methods. `record()` on `main` has it too. It needs an issue and a failing test before a fix.
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
- The first two steps of the `fast` job need `git` history (`fetch-depth: 0`) and `jq`; both are on the
  runner image. Nothing was added to `package.json`.
- On GitHub: two rulesets on `main`, an Actions allow-list with SHA pinning required, merged branches
  deleted automatically, Projects switched off. These live in repository settings, not in this tree;
  the pull request that added this section lists the calls that made them.
- `docs/linear-trail/` is a one-off copy. Nothing regenerates it.
- `claude-review.yml` needs an `ANTHROPIC_API_KEY` secret. Use a key from a dedicated Console workspace with
  its own spend limit. The job is skipped unless the repository variable `CLAUDE_REVIEW_ENABLED` is `true`; it gates nothing.
