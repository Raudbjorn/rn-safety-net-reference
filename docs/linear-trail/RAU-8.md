# RAU-8: DrillScreen: retry action on rejected drills

| | |
|---|---|
| State at export | In Review |
| Parent | RAU-5 |
| Sub-issues | none |
| Created | 2026-11-11 17:46 GMT |
| Source | https://linear.app/raudbjorn/issue/RAU-8/drillscreen-retry-action-on-rejected-drills |
| Exported | 2026-11-11 21:40 GMT, `npx linearis@2026.8.0 issues read RAU-8` |

Verbatim copy. Linear is the source; this file is not updated when the issue changes.

## Description

Agent role: `implementer` (see `.claude/agents/implementer.md`).

Implement REQ-DRILL-012 from RAU-5 in `src/ui/DrillScreen.tsx`: a retry control on rejected entries only, calling the queue's `retryRejected`, then syncing when online.

**Done when:** all DrillScreen tests pass, `npm run test:fast` is green, no test or spec file changed.

## Comments (1, oldest first)

---

**Comment 1 of 1**

**RAU-8 implemented: retry action on rejected drills (REQ-DRILL-012)**

**Commit:** `864abefba71da4d007fd65a3d5245a044957e1fa` on `rau-5-manual-retry-rejected-drill` (local only, not pushed)

**Files changed:** `src/ui/DrillScreen.tsx` only (+20 / -1). No test, spec, CI, script or queue file touched; `specs/TRACE.md` did not need regenerating.

**What changed**
- New `retry(id)` handler, same shape as the existing `record` handler: calls `queue.retryRejected(id)`, refreshes the list, and on success starts a sync only when `isOnline`. Offline the drill just sits as pending.
- A refused retry (`Result` error) is shown in the existing `error` line, the same way a refused record is; a successful retry clears it.
- Each list row renders a `retry-<index>` button only while the entry's status is `rejected`.

**Commands run and results**
- Before the change: `npx jest tests/component/DrillScreen.test.tsx` -> 5 failed, 3 passed (the 5 failures are the `DrillScreen retry of a rejected drill` block, all on the missing `retry-<index>` control).
- After: same command -> 8 passed, 0 failed.
- `npm run test:fast` -> exit 0: `typecheck` clean, `lint` clean, `jest` 3 suites / 39 tests passed, `test:api` 5/5 passed, `trace` reports `requirements: 15, covered: 15`.

**Chosen here, not decided by the issue**
- Button title is `Retry <drill type>` (for example `Retry fire`), following the existing `Record <type>` buttons, so the controls are distinguishable to a screen reader. The tests only fix the testID.
- The row is now a `View` wrapping the label and the optional button, where it used to be a bare `Text`. No styling added.
- The list is refreshed after a refused retry as well as a successful one (same as `record`).

**Noticed, left alone**
- Read from source, not reproduced: `DrillQueue.flush()` shares one in-flight run, and that run iterates the entries it started with. A retry pressed while a sync is already running can therefore be skipped by that run if the loop is already past the entry; the drill then stays pending until the next sync trigger (record, Sync now, connectivity change). `record` has the same property today. This is in `src/sync/queue.ts`, outside RAU-8.
- The retry button has no busy/disabled state. A fast double press makes a second `retryRejected` call on a drill that is already pending, which the queue refuses; the refusal text includes the raw drill id and may flash in the error line.

**Not claimed**
- The refused-retry path through the screen (error line shows the queue's message) has no component test; it is covered only at queue level (REQ-DRILL-011). I did not add one because tests are outside this role.
- Not run: Maestro / device / simulator, the Firestore rules suite, CI. Verification is jest + typecheck + lint + API tests + trace on Node 24.22.2 locally, once.
- Nothing checked visually: layout of the new row and button on a real screen is unverified.
- Retry pressed during an in-flight sync, double press, and retry while connectivity flips are untested.

— implementer agent (Claude subagent)

