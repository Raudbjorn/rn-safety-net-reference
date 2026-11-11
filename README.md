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
scripts         check-traceability, fault-inject, e2e.sh
.github         ci.yml (3 jobs), claude-review.yml (optional)
.claude         a PreToolUse hook that stops an AI agent editing generated / CI / guardrail files
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

## Not claimed

**Not run at all**
- The Maestro flows (`.maestro/*.yaml`) have never been executed. No emulator, device or Maestro install
  was available here. They use only `launchApp`, `tapOn`, `assertVisible`, `extendedWaitUntil` and
  `setAirplaneMode`, but their syntax, timeouts and selectors are unproven against a real build.
- `expo prebuild`, the Gradle release build, the emulator job, and `claude-review.yml` have not run.
  **No workflow has ever executed on GitHub**: nothing was pushed. `actionlint` checks syntax and
  expressions, not whether the jobs succeed.
- iOS. `setAirplaneMode` is Android-only in Maestro, so flow 02 has no iOS equivalent here.
- The hook was tested as a script with simulated input, not through Claude Code.
- The hook deliberately does **not** block `tests/` or `specs/`: an agent has to write tests alongside the
  change. So nothing here stops an agent weakening an existing assertion. What catches that is the
  mutation check (a weakened test stops killing its mutant), the traceability gate, and human review of any
  changed assertion. Branch protection plus CODEOWNERS on `tests/`, `specs/` and `.github/` is the missing
  control and is not set up.

**What the evidence does not prove**
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
- CI is pinned to Java 21 and `ubuntu-24.04`; I ran Java 25 locally, so the Java 21 choice is untested.
- The Gradle release build of React Native 0.88 with the New Architecture was not attempted; it is the
  most likely place for the first CI failure.

**New state and dependencies**
- Expo 58 / React Native 0.88.1 / React 19.3, Jest 30, jest-expo 58, RNTL 14, Express 5, Zod 4, ESLint 10,
  TypeScript 6, firebase 13, firebase-tools 15, `@firebase/rules-unit-testing` 6. `npm ci` reproduces them
  from `package-lock.json`.
- `firebase-tools` downloads the Firestore emulator jar to `~/.cache/firebase/emulators` on first use.
- CI downloads Maestro 2.12.1 (~350 MB) and verifies its SHA-256 before use.
- `claude-review.yml` needs an `ANTHROPIC_API_KEY` secret. Use a key from a dedicated Console workspace with
  its own spend limit. Without the secret the job fails; it gates nothing.
