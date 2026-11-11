# Offline drill logbook: requirements (EARS)

Each requirement has a stable ID. A test names the IDs it proves, in its title or a comment, as
`[REQ-...]`. `npm run trace` fails if a requirement has no test, or a test cites an unknown ID.
Linear issue IDs would go in the `Issue` column; the ones below are placeholders.

Patterns: *ubiquitous* ("The X shall..."), *event-driven* ("When..."), *state-driven* ("While..."),
*unwanted behaviour* ("If..., then...").

## Recording and storage

- **REQ-DRILL-001** The app shall persist every recorded drill on the device before it makes any network call.
- **REQ-DRILL-002** When a drill is recorded, the app shall assign it a unique id that does not change across retries.
- **REQ-DRILL-009** If a drill has missing or malformed fields, then the app shall refuse it and shall not persist it.

## Synchronisation

- **REQ-DRILL-003** If the network is unavailable, then the app shall keep the drill pending and shall not report it as synchronised.
- **REQ-DRILL-004** When connectivity returns, the app shall send pending drills in the order they were recorded.
- **REQ-DRILL-005** The gateway shall create at most one drill record per id, however many times that id is submitted.
- **REQ-DRILL-006** If the gateway stores a drill but the reply is lost, then the retry shall leave exactly one stored record and the app shall then mark the drill synchronised.
- **REQ-DRILL-007** If the gateway refuses a drill permanently, then the app shall mark it rejected, shall not retry it automatically, and shall show the reason.
- **REQ-DRILL-010** When the user retries a rejected drill, the app shall return it to pending under the same id and in its original position in the recorded order, and shall persist that change before any network call.
- **REQ-DRILL-011** If a retry is requested for a drill that is not rejected, then the app shall refuse the request and shall change nothing.

## Presentation

- **REQ-DRILL-008** While a drill is pending or rejected, the app shall display it distinctly from synchronised drills.
- **REQ-DRILL-012** While a drill is rejected, the app shall offer a retry action for that drill, and shall offer none for pending or synchronised drills.

## Authorisation (data layer)

- **REQ-AUTHZ-001** Only an active member of a vessel's crew shall be able to create drill records for that vessel.
- **REQ-AUTHZ-002** Drill records shall be append-only: no one shall be able to update or delete them.
- **REQ-AUTHZ-003** A user shall not be able to read the drill records of a vessel they are not an active crew member of.

## Worked example (one requirement, traced end to end)

| | |
|---|---|
| Requirement | REQ-DRILL-006: lost reply, retry, exactly one record |
| Issue | `SAFE-123` (placeholder) |
| Unit | `tests/unit/queue.test.ts`: a retry after `unavailable` ends `synced`, same id |
| Contract | `tests/unit/httpTransport.test.ts`: only an unreadable outcome maps to `unavailable` |
| Integration | `tests/api/gateway.test.ts`: stored-then-dropped reply, resubmission yields one record |
| End to end | `.maestro/03_lost_reply_retry.yaml`: the same, through the real app and gateway |
