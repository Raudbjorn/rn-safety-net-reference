# RAU-5: Manual retry of a rejected drill

| | |
|---|---|
| State at export | In Progress |
| Parent | none |
| Sub-issues | RAU-6, RAU-7, RAU-8, RAU-9 |
| Created | 2026-11-11 17:46 GMT |
| Source | https://linear.app/raudbjorn/issue/RAU-5/manual-retry-of-a-rejected-drill |
| Exported | 2026-11-11 21:40 GMT, `npx linearis@2026.8.0 issues read RAU-5` |

Verbatim copy. Linear is the source; this file is not updated when the issue changes.

## Description

**Demo issue** for the reference repo `rn-safety-net-reference` (invented drill-logbook domain). Written by the orchestrating Claude session on behalf of the repo owner; a person approves these requirements before work starts.

## Problem

A drill the gateway refuses is marked `rejected` and is never retried automatically (REQ-DRILL-007). Today the crew member has no way to send it again once the cause is fixed (for example, they were re-added to the vessel crew). The record is stuck on the device.

## Requirements (EARS, to be copied word for word into `specs/offline-drill-sync.md`)

* **REQ-DRILL-010** When the user retries a rejected drill, the app shall return it to pending under the same id and in its original position in the recorded order, and shall persist that change before any network call.
* **REQ-DRILL-011** If a retry is requested for a drill that is not rejected, then the app shall refuse the request and shall change nothing.
* **REQ-DRILL-012** While a drill is rejected, the app shall offer a retry action for that drill, and shall offer none for pending or synchronised drills.

## Decisions already made

* Retrying clears the stored rejection reason. The attempts count is kept.
* A retry never bypasses the queue: the drill is sent by the normal flush, so ordering (REQ-DRILL-004) and idempotency (REQ-DRILL-005/006) are unchanged.
* When online, the screen starts a sync right after a retry. Offline, the drill waits like any other pending drill.
* A refused retry (REQ-DRILL-011) is an error value, not an exception, and covers: unknown id, pending drill, synchronised drill.

## Out of scope

Discarding a rejected drill, editing it before retry, automatic retry policies, any gateway change.

## Done when

Every requirement has a test that fails without the behaviour, the PR gate is green on the branch, and an independent review is posted here. Merge and `Done` belong to a person.

## Comments (4, oldest first)

---

**Comment 1 of 4**

## Independent review of `rau-5-manual-retry-rejected-drill` at `864abef`

**Verdict: changes requested** (narrow).

I found no defect in the shipped code for REQ-DRILL-010, 011 or 012 on the ordinary path, nothing existing was weakened, the change stays in scope, and the local PR gate is green. What is short is the evidence. RAU-5 says done means "every requirement has a test that fails without the behaviour", and two behaviours named in the requirement text can be broken with every test still green (findings 2 and 3). Finding 1 needs a person's decision and not necessarily a code change on this branch.

What would turn this into an approve: the two tests described in findings 2 and 3, and a recorded decision on finding 1.

### Findings, by severity

**1. Medium, behaviour: a retry pressed while another send is in flight is not sent, although the app is online.**
`src/ui/DrillScreen.tsx:64` calling `src/sync/queue.ts:107`.
Scenario: drill A is rejected. Online, the user records drill B and, while B's send is still open, presses Retry on A. A goes back to pending and is persisted, but `sync()` is handed the flush that is already running, and its loop is already past A. Reproduced through the screen in a throwaway worktree: final state `Pending: 1, Synced: 1, Rejected: 0` with connectivity `Online` and 2 sends in total. A waits for the next trigger (Sync now, another record, a connectivity change). The RAU-5 decision "When online, the screen starts a sync right after a retry" does not hold in this interleaving.
Nothing is lost, duplicated or reordered, and the drill is shown honestly as pending. `record()` behaves the same way on this code (reproduced: a drill recorded during an open send stays pending), so this comes from the shared-flush design and was not introduced by the retry. My recommendation is a follow-up issue on `flush()` covering both paths, not a fix on this branch. That is a person's call.

**2. Medium, test gap on REQ-DRILL-012 ("a retry action for that drill"): nothing proves the control retries its own drill.**
`src/ui/DrillScreen.tsx:86`; `tests/component/DrillScreen.test.tsx:110-149`.
Every test that presses the control has exactly one entry and presses `retry-0`. With `onPress={() => void retry(entries[0]!.drill.id)}`, and also with "retry the first rejected entry", all 8 component tests stay green. The code is correct today; the wiring from a row to its drill is unguarded. A test that records two rejected drills, goes offline, presses `retry-1` and expects entry 1 pending with entry 0 still rejected passes on `864abef` and fails on the first mutant (tried, then discarded).

**3. Low, test gap on REQ-DRILL-010 ("persist that change before any network call"): the tests prove the change is persisted, not that the write is awaited.**
`src/sync/queue.ts:101`; `tests/unit/queue.test.ts:186`.
Removing the persist line is caught. Replacing it with `void this.persist()` is not, because the test store writes synchronously (`tests/unit/queue.test.ts:11-19`). On a store that writes asynchronously, that mutant lets the screen's sync send before the write lands. A test using a store that writes after a timer tick passes on `864abef` and fails on the mutant (tried, then discarded). If this ever regressed, the damage is bounded by gateway idempotency (REQ-DRILL-005/006).

**4. Low, failure path: a storage write failure during a retry throws and leaves memory and disk disagreeing.**
`src/sync/queue.ts:99-101`; `src/ui/DrillScreen.tsx:57` and `:86`.
Reproduced at queue level: with `setItem` rejecting once, `retryRejected` throws instead of returning an error value; memory says `pending`, disk says `rejected`. Read from source, not reproduced: the screen calls it as `void retry(...)`, so there is no refresh and no error line, and a later flush would send a drill whose return to pending was never persisted. `record()` has the same shape (`src/sync/queue.ts:81-82`), and RAU-5 only requires error values for refusals, so this is outside the stated decisions. Noted because REQ-DRILL-010's ordering does not hold on this path.

**5. Low, untested: the refused-retry error line.**
`src/ui/DrillScreen.tsx:59-62`. Removing `setError(result.error)` leaves every test green. Not a numbered requirement.

**6. Note: the standing mutation check does not know about the new requirements.**
`scripts/fault-inject.ts` has no mutant for REQ-DRILL-010, 011 or 012. Leaving it untouched on this branch is correct (guardrail changes are out of scope), but it means the table below is one-off evidence from this review and the gate will not re-check it. Suggest a follow-up issue.

### Requirement to test to mutation

One mutation at a time in a throwaway worktree at `864abef`, then `npx jest <file>`, then `git checkout -- .`. 29 mutants: 25 killed, 4 survived (one in finding 3, two in finding 2, one in finding 5).

| Requirement / decision | Mutation applied | Result | Test that went red |
|---|---|---|---|
| 010 returns to pending | drop `entry.status = 'pending'` | killed | `[REQ-DRILL-010] a retried drill returns to pending under the same id, in its original position` and 3 more |
| 010 same id | assign a new id on retry | killed | same test, and 3 more |
| 010 original position | move the entry to the end of the list | killed | same test, and `...is sent ahead of drills recorded after it` |
| 010 persisted | drop the `persist()` line | killed | `[REQ-DRILL-010] the return to pending is persisted before any network call` |
| 010 persisted before any network call | `void this.persist()` (not awaited) | **survived** | none (finding 3) |
| decision: reason cleared | drop `delete entry.reason` | killed | `[REQ-DRILL-010] a retry clears the stored rejection reason` |
| decision: attempts kept | reset `attempts` to 0 | killed | `[REQ-DRILL-010] a retry keeps the attempts count` |
| decision: retry never sends by itself | send inside `retryRejected`; or flush inside it | killed (both) | `...persisted before any network call` and others |
| 011 pending / synced refused | drop the status guard; accept pending only; accept synced only | killed (all 3) | `[REQ-DRILL-011] refuses a retry for a pending drill...` / `...for a synchronised drill...` |
| 011 unknown id refused, as a value | throw instead; or fall back to the first rejected drill | killed (both) | `[REQ-DRILL-011] refuses a retry for an unknown id and changes nothing` |
| 011 changes nothing | on refusal bump attempts and persist; bump in memory only; send | killed (all 3) | the pending and synchronised `[REQ-DRILL-011]` tests |
| 012 offered while rejected | never render the control | killed | all 5 `DrillScreen retry of a rejected drill` tests |
| 012 none for pending or synchronised | render on every entry; also on pending; also on synced | killed (all 3) | `[REQ-DRILL-012] only the rejected drill offers a retry action; synchronised and pending drills offer none` |
| 012 the action is for that drill | control retries `entries[0]`; or the first rejected entry | **survived** (both) | none (finding 2) |
| 012 the action does something | `onPress` does nothing; or skips `queue.retryRejected` | killed (both) | the online and offline `[REQ-DRILL-012] [REQ-DRILL-010]` tests |
| decision: online, sync right after a retry | drop `if (isOnline) await sync()` in `retry` | killed | `...online: retrying a rejected drill ends synchronised` |
| decision: offline, the drill waits | always sync in `retry` | killed | `...offline: a retried drill waits as pending and nothing is sent` |
| screen refreshed after a retry | drop `refresh()` in `retry` | killed | the offline test and `...withdrawn once the drill is pending again` |
| refused retry shown in the error line | drop `setError(result.error)` in `retry` | **survived** | none (finding 5) |

### Other checks

- **Existing evidence untouched:** `git diff main...HEAD --numstat -- tests/ specs/` gives 247 added, 0 removed across 4 files. No existing assertion or requirement line changed.
- **Spec wording:** the three requirement lines in `specs/offline-drill-sync.md` equal the RAU-5 text character for character (compared by script).
- **Scope:** `git diff main...HEAD --name-only` lists those 4 files plus `src/sync/queue.ts` and `src/ui/DrillScreen.tsx`. No CI, script, dependency or lockfile change. The branch sits directly on `main` (`9d8f33f`).
- **Pipeline:** `scripts/ci-local.sh HEAD`, exit 0, summary verbatim:

```
ci-local: commit 864abefba71d (RAU-8: DrillScreen offers a retry action on rejected drills)
PASS  fast   npm ci                               9s
PASS  fast   typecheck                            0s
PASS  fast   lint                                 1s
PASS  fast   unit + component (jest)              4s
PASS  fast   api                                  0s
PASS  fast   traceability, matrix current         0s
PASS  rules  Firestore rules (emulator)           4s
PASS  rules  mutation check                      35s

ci-local: PASS  864abefba71d  (log: reports/ci-local/864abefba71d.log)
```

Jest in that run: 39 passed. Mutation check: baseline green, M1 to M9 all KILLED, none NOT-APPLIED.

### Authors' comments (RAU-6, RAU-7, RAU-8), read after the verdict

Nothing they claimed was contradicted by what I found.

- Confirmed by re-running: at `a1153ab` jest is 14 failed, 25 passed and `tsc` fails with 9 x TS2339; at `f52373c` jest is 5 failed, 34 passed and `tsc` is clean; the diff sizes; "refused before anything is mutated or persisted"; the three fault-inject targets in `queue.ts` still apply.
- RAU-7 and RAU-8 both flagged the in-flight flush case (RAU-8 as read from source, not reproduced). I reproduced it, and the same for `record()`. RAU-7 judged it consistent with REQ-DRILL-004, which I agree with; neither comment sets it against the "sync right after a retry" decision, which is where it falls short (finding 1).
- RAU-7 flagged the storage-failure case; reproduced (finding 4). RAU-8 flagged the untested error line; confirmed (finding 5).
- RAU-6 lists 14 mutations tried against a throwaway implementation. I repeated equivalents against the real implementation and all were killed. That list has no "control wired to another drill" mutant, and no comment mentions that every press test has a single entry (finding 2). RAU-6 does say the persistence check runs against the in-memory store only, which is finding 3 stated less sharply.
- RAU-8's double-press note: with two presses in the same tick the error line was empty at the end. I did not look for the transient flash it describes.

### Commands run

```
git diff main...HEAD            (and --stat, --numstat, --name-only; -- tests/ specs/)
git log --stat main..HEAD ; git merge-base main HEAD
npx -y linearis@2026.8.0 issues read RAU-5
git worktree add --detach /tmp/review-rau5 HEAD   (node_modules symlinked)
npx jest                                          baseline at 864abef: 39 passed
npx jest tests/unit/queue.test.ts                 once per queue mutant (17)
npx jest tests/component/DrillScreen.test.tsx     once per screen mutant (12)
npx jest <scratch tests>                          7 reviewer-written cases, never committed
npx jest ; npx tsc --noEmit                       at a1153ab and f52373c, in the worktree
scripts/ci-local.sh HEAD
npx -y linearis@2026.8.0 issues discussions RAU-6 | RAU-7 | RAU-8   (after the verdict)
git worktree remove --force /tmp/review-rau5
```

The main checkout was not edited: `git status --short` is empty and HEAD is still `864abef`. `scripts/ci-local.sh` rewrote the git-ignored log `reports/ci-local/864abefba71d.log`, replacing an earlier log for the same commit.

### Not claimed

- Not run: Maestro flows, any device or simulator, the hosted CI. `scripts/ci-local.sh` is a local stand-in on this machine, run once.
- Real AsyncStorage and the real gateway were not exercised with a retry. All retry evidence is an in-memory store and a scripted transport. That a re-sent drill is accepted by the gateway rests on the existing REQ-DRILL-005/006 tests.
- The mutants are hand-picked, 29 of them; this is not exhaustive mutation testing. A survivor means "no test guards this", a kill means "at least one test does", nothing more.
- Findings 1 and 4 were reproduced with reviewer-written scratch tests that were discarded. They are not in the repo and nothing re-checks them. The screen half of finding 4 is read from source only.
- The benign half of the in-flight case (a retried drill positioned after the one being sent is picked up by the same pass, as RAU-7 states) was not reproduced.
- Not checked: layout and appearance of the new row, accessibility, the button label, a retry while connectivity flips, a retry on a queue whose stored data was unreadable at load.
- The findings rate the change against RAU-5 as written. Whether finding 1 is acceptable is a product decision I have not made.
- I did not modify the branch, commit, push, or change any issue status.

— reviewer agent (Claude subagent)

---

**Comment 2 of 4**

## Re-review of `rau-5-manual-retry-rejected-drill` at `bfed245` (one new commit since my first review)

**Updated verdict: approve**, with one thing my approval does not cover: finding 1 (RAU-10) is still undecided.

Findings 2 and 3 are closed: each of my three surviving mutants now turns exactly one test red, and the commit only adds tests. I have nothing left to ask of the branch.

**How finding 1 affects this.** My first review asked for two tests and a recorded decision on finding 1. The tests are in. The decision is not: RAU-10 is in Backlog with no comment and no decision. So the approve covers the code and its evidence against REQ-DRILL-010, 011 and 012. It does not say that merging is fine while a retry pressed during a running sync stays pending although the app is online, which falls short of the RAU-5 decision "when online, the screen starts a sync right after a retry". Nothing on the branch changed that behaviour. Whether to merge with it as a known limitation or to decide RAU-10 first is the merging person's call, and I have not made it.

### What I re-checked

**1. The commit only adds tests.** `git diff --numstat 864abef..bfed245`: `tests/component/DrillScreen.test.tsx` +30 −0, `tests/unit/queue.test.ts` +43 −0, nothing else. `git diff main...HEAD -- tests/ specs/` still has no removed line. Nothing under `src/`, `specs/`, `scripts/` or CI changed.

**2. The mutants that survived last time.** One at a time in a throwaway worktree at `bfed245` (baseline there: 41 passed), full `npx jest` each time, restored with `git checkout -- .`.

| Mutant | Result | Test that went red | The other 40 |
|---|---|---|---|
| retry control wired to `entries[0]` (`src/ui/DrillScreen.tsx:86`) | killed | `[REQ-DRILL-012] with two rejected drills, the second retry action retries that drill and only that drill` | pass |
| retry control wired to the first rejected entry (same line) | killed | same test | pass |
| `void this.persist()` in `retryRejected` (`src/sync/queue.ts:101`) | killed | `[REQ-DRILL-010] with slow storage, the return to pending is durable before the retry resolves and before anything is sent` | pass |

Each fails on the assertion that names the behaviour: the third send is `fire` where `abandon-ship` is expected; the stored status is `rejected` at both moments where `pending` is expected.

**3. Soundness of the two new tests.** No concern that blocks.

- Neither can pass for the wrong reason that I can construct. The component test checks which drill went over the wire, so a control retrying the other drill fails even though the summary line reads the same either way. The queue test asserts the stored status is `rejected` before the retry, so the setup cannot silently be wrong.
- Neither depends on timing when the code is correct: the queue awaits the write, however long it takes. Against the mutant the read happens in the same tick the retry resolves, before the 5 ms timer can fire, so the failure is deterministic too.
- Repeats on unmodified code: both test files 20 times, then 10 times with all cores busy. 30 of 30 green.
- Two limits, neither a defect. The component test tells entry 1 from entry 0 only; a control wired to the *last* entry would pass it with two drills. In the queue test the "at the next send" half cannot fail on its own: any queue change that breaks it also breaks the "when the retry resolved" half.

**4. Pipeline.** `scripts/ci-local.sh HEAD`, exit 0, summary verbatim:

```
ci-local: commit bfed245ec368 (RAU-9: tests for "that drill" (REQ-DRILL-012) and durable-before-send (REQ-DRILL-010))
PASS  fast   npm ci                              18s
PASS  fast   typecheck                            1s
PASS  fast   lint                                 1s
PASS  fast   unit + component (jest)              4s
PASS  fast   api                                  0s
PASS  fast   traceability, matrix current         0s
PASS  rules  Firestore rules (emulator)           5s
PASS  rules  mutation check                      34s

ci-local: PASS  bfed245ec368  (log: reports/ci-local/bfed245ec368.log)
```

Jest in that run: 41 passed. Mutation check: all 9 killed.

**5. The author's RAU-9 comment, read after the above.** It matches what I found: 2 files, 73 insertions, 0 deletions; the same three mutants with the same failing test and the same failure output. It says `scripts/ci-local.sh` was not run by the author; it is green in my run.

### Status of the first review's findings

- F1: open, RAU-10, Backlog, needs a person. Unchanged on the branch.
- F2, F3: closed by `bfed245` (RAU-9).
- F4, F5, F6: open, RAU-11, Backlog. Unchanged on the branch; none of them was a condition of my verdict.

### Not claimed

- Only the three named mutants were re-applied. The other 26 from the first review were not re-run; `src/` is byte-identical to `864abef`, so those results still describe the code, but I did not repeat them.
- Not run: Maestro flows, any device or simulator, hosted CI. `scripts/ci-local.sh` is a local stand-in, run once on this machine.
- Real AsyncStorage and the real gateway are still not exercised with a retry. The slow store delays writes by a fixed 5 ms and never fails.
- The new queue test covers `retryRejected` only. That the screen awaits the retry before it starts a sync is read from source (`src/ui/DrillScreen.tsx:57`), not tested under slow storage.
- 30 green repeats on one machine show no flakiness here; they do not prove there is none on the hosted runner.
- I did not modify the branch, commit, push, or change any issue status. `scripts/ci-local.sh` rewrote the git-ignored log `reports/ci-local/bfed245ec368.log`, replacing an earlier log for the same commit.

— reviewer agent (Claude subagent)

---

**Comment 3 of 4**

**Orchestrator summary** (the Claude Code session that dispatched the agents; it wrote no product code or tests).

Branch `rau-5-manual-retry-rejected-drill`, local only, four commits on top of `main`:

| Commit | Issue | Agent | Local pipeline (`scripts/ci-local.sh`, clean checkout) |
|---|---|---|---|
| `a1153ab` | RAU-6 | test-author | red as intended: 14 new tests fail on the missing behaviour, 25 existing pass |
| `f52373c` | RAU-7 | implementer | not run (screen tests still red by design) |
| `864abef` | RAU-8 | implementer | green, 8 of 8 steps, 9 of 9 mutations killed |
| `bfed245` | RAU-9 | test-author | green, 8 of 8 steps |

Review: first verdict **changes requested** (4 of 29 hand-made mutants survived a green pipeline), second verdict **approve** after RAU-9, explicitly not covering RAU-10.

**Waiting on a person**
- RAU-10: decide how a retry pressed during a running sync should behave.
- Read the requirement text above. The orchestrator wrote it; nobody has approved it yet.
- Push and pull request: the repo has no remote yet, so no hosted CI run exists. The pipeline results above are local runs of the same commands.
- Merge, and moving these issues to Done.

**Not claimed**
- One run on one machine. Hosted CI, the Android end-to-end job and any device have not run.
- Role boundaries were instructions checked afterwards by diff, not enforced by tooling in this run.
- All Linear activity here uses the repo owner's login; the signatures say which agent wrote what.

— orchestrator (Claude Code session)

---

**Comment 4 of 4**

Orchestrator: pushed to a private GitHub repo and opened the PR.

- PR: https://github.com/Raudbjorn/rn-safety-net-reference/pull/1 (commits a1153ab, f52373c, 864abef, bfed245)
- Hosted CI on the PR: both gating jobs passed (fast: typecheck, lint, jest, api, traceability; rules: Firestore emulator and mutation check, 9 of 9 mutants killed). Run: https://github.com/Raudbjorn/rn-safety-net-reference/actions/runs/43088769085
- This was the first hosted run of these workflows. The Android end-to-end job is skipped on PRs and has still never run.
- Not merged. Merge waits for a person, and RAU-10 is still undecided.

