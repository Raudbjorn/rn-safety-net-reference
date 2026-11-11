# RAU-9: Review follow-up: tests for "that drill" (REQ-DRILL-012) and "before any network call" (REQ-DRILL-010)

| | |
|---|---|
| State at export | In Review |
| Parent | RAU-5 |
| Sub-issues | none |
| Created | 2026-11-11 18:10 GMT |
| Source | https://linear.app/raudbjorn/issue/RAU-9/review-follow-up-tests-for-that-drill-req-drill-012-and-before-any |
| Exported | 2026-11-11 21:40 GMT, `npx linearis@2026.8.0 issues read RAU-9` |

Verbatim copy. Linear is the source; this file is not updated when the issue changes.

## Description

Agent role: `test-author`. Opened by the orchestrator from the reviewer's findings F2 and F3 on RAU-5 (verdict: changes requested).

The code on the branch is correct for both cases; the gap is that no test would notice if it stopped being correct.

* **F2, REQ-DRILL-012 "for that drill".** Every press test has a single entry and presses `retry-0`. Wiring the control to `entries[0]`, or to the first rejected entry, leaves all component tests green. Add a test with two rejected drills that presses `retry-1` and asserts that drill, and only that drill, was retried.
* **F3, REQ-DRILL-010 "before any network call".** Removing `persist()` is caught, but `void this.persist()` is not, because the test store writes synchronously. Add a test with a store whose write resolves later and assert that the change is durable before `retryRejected` resolves and before anything is sent.

**Done when:** both tests pass on the branch as it is, each fails against its mutant in a throwaway worktree (state the mutant and the failure), no existing assertion changed, nothing under `src/` changed, `scripts/ci-local.sh HEAD` green.

## Comments (1, oldest first)

---

**Comment 1 of 1**

## Both review tests are in: commit `bfed245`

Branch `rau-5-manual-retry-rejected-drill`, commit `bfed245ec368a15081e063b6a40bdefedc419cd1` (local only, not pushed).

Both new tests **pass** on the branch as it is, and each **fails** against its mutant. `scripts/ci-local.sh` was **not** run by me (the orchestrator runs it), so that part of "Done when" is still open.

### Files changed (2 files, 73 insertions, 0 deletions)

| File | New test |
|---|---|
| `tests/component/DrillScreen.test.tsx` | F2: `[REQ-DRILL-012] with two rejected drills, the second retry action retries that drill and only that drill` |
| `tests/unit/queue.test.ts` | F3: `[REQ-DRILL-010] with slow storage, the return to pending is durable before the retry resolves and before anything is sent` |

Tests only. No existing assertion was edited or removed, and nothing under `src/`, `server/`, `scripts/`, `.github/` or `.claude/` changed. `npm run trace:write` left `specs/TRACE.md` unchanged, so it is not in the commit.

### What each test does

- **F2.** Records two drills online, both refused. Presses `retry-1`. Asserts the third send is the second drill (`['fire', 'abandon-ship', 'abandon-ship']`), `entry-1` ends `abandon-ship - synced`, `entry-0` is still rejected with its reason, `retry-0` is still offered and `retry-1` is gone.
- **F3.** Uses a store whose `setItem` only lands 5 ms later, so `data` holds what is durable at each moment. Reads the stored status of the drill at two moments: right after `await queue.retryRejected(id)` returns, and inside the transport at the first send after the retry. Both must be `pending`.

### Commands run on the real checkout (Node v24.22.2)

| Command | Result |
|---|---|
| `npm test` | **41 passed, 0 failed** (39 before, plus the 2 new) |
| `npx jest -t "slow storage\|two rejected drills"`, 8 runs | 2 passed each run |
| `npm run test:fast` (typecheck, lint, jest, API tests, trace) | green, exit 0: jest 41 passed, API 5 passed, `requirements: 15, covered: 15` |
| `npm run trace:write` | `requirements: 15, covered: 15`, no file change |

### Mutants

Run in a throwaway worktree, `git worktree add --detach /tmp/rau9-mutants HEAD`, with `node_modules` symlinked and the two new test files copied in. Unmutated, that worktree gave 41 passed. Each mutant below gave **40 passed, 1 failed**; the failing test is the new one, and the 39 earlier tests passed against all three, which confirms the reviewer's findings. The worktree is removed and `src/` in the real checkout was never edited.

**Mutant A: retry control wired to `entries[0]`**

```
-  onPress={() => void retry(item.drill.id)}
+  onPress={() => void retry(entries[0]!.drill.id)}

FAIL [REQ-DRILL-012] with two rejected drills, the second retry action retries that drill and only that drill
  expect(received).toEqual(expected) // deep equality
    Array [
      "fire",
      "abandon-ship",
  -   "abandon-ship",
  +   "fire",
    ]
```

**Mutant B: retry control wired to the first rejected entry**

```
-  onPress={() => void retry(item.drill.id)}
+  onPress={() => void retry(entries.find((e) => e.status === 'rejected')!.drill.id)}

FAIL [REQ-DRILL-012] with two rejected drills, the second retry action retries that drill and only that drill
  expect(received).toEqual(expected) // deep equality
    Array [
      "fire",
      "abandon-ship",
  -   "abandon-ship",
  +   "fire",
    ]
```

**Mutant C: `void this.persist()` in `retryRejected`**

```
-    await this.persist(); // REQ-DRILL-010: durable before any network call
+    void this.persist(); // REQ-DRILL-010: durable before any network call

FAIL [REQ-DRILL-010] with slow storage, the return to pending is durable before the retry resolves and before anything is sent
  expect(received).toEqual(expected) // deep equality
    Object {
  -   "atSendAfterRetry": "pending",
  -   "whenRetryResolved": "pending",
  +   "atSendAfterRetry": "rejected",
  +   "whenRetryResolved": "rejected",
    }
```

### Choices the issue did not decide

- **F2 runs online.** That lets the test check which drill actually went over the wire, not only what the screen shows. An offline variant (drill ends `pending`) was not added.
- **F3 is one test with one comparison for both moments**, so a failure reports both values, as in the mutant C output.
- **F3 reads the stored JSON directly** (`drill.id` and `status` of each stored entry), because the check inside the transport has to be synchronous. A change to the storage format would need this helper updated.

### Not claimed

- `scripts/ci-local.sh HEAD`, `npm run test:rules` (Firestore emulator) and the Maestro flows were not run on this commit.
- Mutants A and B fail on the same assertion in the same way; the test does not tell them apart. A list where the first entry is not rejected was not tried.
- Only the three named mutants were run. Other ways of getting the wiring or the persistence wrong were not explored this time.
- The slow store delays writes by a fixed 5 ms and never fails. A write that rejects, a crash between the status change and the write, and real AsyncStorage are still not exercised.
- F3 covers `retryRejected` only. Whether `record` and `flush` await their writes under slow storage is not tested here.
- F3's "before anything is sent" is observed with a flush called right after the retry resolves. The screen path (`retry` then `sync`) under slow storage is not tested.
- A retry requested while a flush is in flight, and two retries at once, remain untested.

— test-author agent (Claude subagent)

