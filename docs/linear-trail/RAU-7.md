# RAU-7: Queue: retryRejected(id) returns a rejected drill to pending

| | |
|---|---|
| State at export | In Review |
| Parent | RAU-5 |
| Sub-issues | none |
| Created | 2026-11-11 17:46 GMT |
| Source | https://linear.app/raudbjorn/issue/RAU-7/queue-retryrejectedid-returns-a-rejected-drill-to-pending |
| Exported | 2026-11-11 21:40 GMT, `npx linearis@2026.8.0 issues read RAU-7` |

Verbatim copy. Linear is the source; this file is not updated when the issue changes.

## Description

Agent role: `implementer` (see `.claude/agents/implementer.md`).

Implement REQ-DRILL-010 and REQ-DRILL-011 from RAU-5 in `src/sync/queue.ts` so the queue tests written under the spec sub-issue pass. Follow the decisions in RAU-5 (reason cleared, attempts kept, persisted before any network call, refusal as a `Result` error).

**Done when:** the queue tests for 010 and 011 pass, no test or spec file changed, `npm run typecheck` and `npm run lint` are clean. The DrillScreen tests for 012 are expected to stay red until the screen sub-issue.

## Comments (1, oldest first)

---

**Comment 1 of 1**

## Implemented: `DrillQueue.retryRejected(id)` (REQ-DRILL-010, REQ-DRILL-011)

**Commit:** `f52373c545bdf36468c3fe0680b24e0287fb9ba3` on `rau-5-manual-retry-rejected-drill` (local only, not pushed)
**Files changed:** `src/sync/queue.ts` only (+19 lines, 0 removed). No file under `tests/`, `specs/`, `scripts/`, `.github/` or `.claude/` changed; `specs/TRACE.md` did not need regenerating.

### What it does

- `retryRejected(id: string): Promise<Result<QueueEntry, string>>`, the same shape as `record()`.
- A rejected entry is edited in place: `status` back to `pending`, `reason` removed, `attempts` and `id` untouched, so it keeps its position in the recorded order. The change is persisted, and nothing is sent: the drill leaves through the normal `flush()`.
- Unknown id, pending drill and synced drill each return `{ ok: false, error }` before anything is mutated or persisted.

### Commands run (Node 24.22.2)

| Command | Before | After |
|---|---|---|
| `npx jest tests/unit/queue.test.ts` | 9 failed, 10 passed | 19 passed |
| `npm run typecheck` | fails (TS2339 on `retryRejected`, per the RAU-6 commit message; I did not re-run it before the change) | clean, exit 0 |
| `npm run lint` | not run before | clean, exit 0 |
| `npm test` (full jest) | not run before | 34 passed, 5 failed, exit 1 |
| `npm run test:api` | not run before | 5 passed, exit 0 |
| `npm run trace` | not run before | `requirements: 15, covered: 15`, exit 0 |
| `npm run test:fast` | not run before | exit 1, stops at the jest step |

The 5 tests still red are all in `tests/component/DrillScreen.test.tsx`, under `DrillScreen retry of a rejected drill`, and are the REQ-DRILL-012 screen tests that belong to RAU-8:

1. `[REQ-DRILL-012] a rejected drill offers a retry action`
2. `[REQ-DRILL-012] only the rejected drill offers a retry action; synchronised and pending drills offer none`
3. `[REQ-DRILL-012] [REQ-DRILL-010] online: retrying a rejected drill ends synchronised`
4. `[REQ-DRILL-012] [REQ-DRILL-010] offline: a retried drill waits as pending and nothing is sent`
5. `[REQ-DRILL-012] the retry action is withdrawn once the drill is pending again`

Nothing else is red.

**Mutation check:** the three `scripts/fault-inject.ts` targets in `queue.ts` (M1, M2, M3) each still occur exactly once (counted before and after). `npx tsx scripts/fault-inject.ts M1 M2 M3` itself exits 2 with `baseline jest RED`, because of the 5 screen tests above, so the mutations were **not** actually exercised on this commit.

### Choices the issue did not decide

- **Success value:** returns a copy of the updated entry, mirroring `record()`. The tests only read `result.ok`.
- **Error text:** `no drill with id <id>` and `drill <id> is <status>; only a rejected drill can be retried`. The wording is mine; no test asserts on it.
- **One error type for all three refusals:** a plain string, as `record()` does, rather than a discriminated error kind. If the screen (RAU-8) needs to tell "unknown" from "not rejected", that would be a change here.
- **In-place edit** of the entry (as `runFlush` already does) rather than replacing the array.
- **Reason is removed** (`delete`), not set to an empty string, so the stored JSON has no `reason` key after a retry.

### Noticed, left alone

- `retryRejected` does not wait for or coordinate with a flush that is already running. A retried drill positioned after the one currently being sent is picked up by that same pass; one positioned before it waits for the next flush. Both look consistent with REQ-DRILL-004, but no test covers a retry during a flush.
- If `store.setItem` rejects, the entry is already `pending` in memory but not on disk, and the rejection propagates as an exception rather than a `Result`. `record()` behaves the same way today; I followed it rather than change the persistence contract inside this sub-issue.

### Not claimed

- **Not tested:** retry while a flush is in flight; a storage write failure during retry; a retry on a queue whose stored data was unreadable at load; ids that are not UUID-shaped (they are simply "unknown").
- **Not run:** the mutation check (blocked by the red baseline, above), `npm run test:rules` (Firestore emulator), Maestro/E2E, CI. Nothing was run on a device or simulator.
- **What the green queue tests do not prove:** that the screen uses this method correctly, or that a retried drill is accepted by the real gateway. They use an in-memory store and a scripted transport.
- **Residual risk:** a user can retry a drill whose cause is not fixed; it will be refused again and `attempts` grows by one each time. There is no cap, by design of RAU-5 (automatic retry policies are out of scope).
- **New state or dependencies:** none. No new dependency, no new storage key, no schema change; an entry without `reason` was already valid.

— implementer agent (Claude subagent)

