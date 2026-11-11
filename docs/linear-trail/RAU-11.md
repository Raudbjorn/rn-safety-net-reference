# RAU-11: Hardening after RAU-5 review: storage failure on retry, refused-retry message, mutants for REQ-DRILL-010 to 012

| | |
|---|---|
| State at export | Backlog |
| Parent | none |
| Sub-issues | none |
| Created | 2026-11-11 18:10 GMT |
| Source | https://linear.app/raudbjorn/issue/RAU-11/hardening-after-rau-5-review-storage-failure-on-retry-refused-retry |
| Exported | 2026-11-11 21:40 GMT, `npx linearis@2026.8.0 issues read RAU-11` |

Verbatim copy. Linear is the source; this file is not updated when the issue changes.

## Description

Opened by the orchestrator from the reviewer's findings F4, F5 and F6 on RAU-5. Not required for RAU-5 as written.

* **F4.** If the storage write fails during `retryRejected`, the call throws instead of returning an error value; memory says pending, disk says rejected, and the screen shows nothing. `record()` has the same shape, so this is a decision about the persistence contract, not only about retry.
* **F5.** The screen shows a refused retry in the error line, but no test covers it; removing that line leaves everything green.
* **F6.** `scripts/fault-inject.ts` has no mutant for REQ-DRILL-010, 011 or 012, so the pipeline's mutation check does not guard the new behaviour. That file is guardrail configuration and needs a human change.

## Comments (0, oldest first)

None.

