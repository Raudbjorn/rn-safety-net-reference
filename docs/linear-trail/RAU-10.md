# RAU-10: Decision needed: a retry or record during a running sync waits for the next sync trigger

| | |
|---|---|
| State at export | Backlog |
| Parent | none |
| Sub-issues | none |
| Created | 2026-11-11 18:10 GMT |
| Source | https://linear.app/raudbjorn/issue/RAU-10/decision-needed-a-retry-or-record-during-a-running-sync-waits-for-the |
| Exported | 2026-11-11 21:40 GMT, `npx linearis@2026.8.0 issues read RAU-10` |

Verbatim copy. Linear is the source; this file is not updated when the issue changes.

## Description

Opened by the orchestrator from the reviewer's finding F1 on RAU-5. **Needs a person's decision; no agent should pick this up as is.**

Reproduced by the reviewer through the screen: drill A is rejected; online, the user records drill B and presses Retry on A while B's send is still open. A goes back to pending and is persisted, but `sync()` receives the flush that is already running, whose loop is past A. Result: `Pending: 1, Synced: 1` while Online. A is sent at the next trigger (Sync now, a new record, connectivity change). Nothing is lost, duplicated or reordered.

This falls short of the RAU-5 decision "when online, the screen starts a sync right after a retry". `record()` behaves the same way on `main`, so it comes from the shared in-flight flush in `src/sync/queue.ts`, not from the retry change.

Options: (a) accept and reword the decision in RAU-5; (b) have `flush()` run one more pass when entries became pending during the run; (c) queue a follow-up flush from the screen. (b) changes queue behaviour that REQ-DRILL-004 ordering tests depend on, so it needs its own requirement and tests.

## Comments (0, oldest first)

None.

