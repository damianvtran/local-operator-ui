# Team Bridge drafts and scheduled send — desktop verification

## Scope and preflight

Source implementation: `e400709b7146e39abc137561ac11c985c216c5ff`, based on
`feat/tb-direct-dm` at `2e16fb145677c168d0ecee37985c28b098904440`.
The upstream branch was fetched again before PR creation and remained at that
same head. Dependencies are the primary checkout's shared `node_modules`; no
second dependency installation, browser engine or app instance was created.

Test plan: verify scoped authored storage and the two-write first-schedule
transaction with shipped modules; exercise the real renderer API/shared mapping
against the runtime lane's isolated HTTP proxy and loopback hub fixture; use an
unauthorized HTTP request and strict invalid selectors/time as negative controls.
The adapter proof bundles the current TypeScript directly with esbuild, not a
previous compiled app. Native Electron IPC and the real Go/Mongo delivery worker
are outside this desktop adapter proof. Full automated coverage belongs to CI
once the integrated head is frozen; the local suites below are affected coverage.

## Privacy and durability

Existing chat inputs intentionally persist user-authored drafts; Team Bridge
uses a dedicated versioned authored-draft namespace instead of reusing a chat
session's identifiers or the runtime's inbound-message metadata cache. Its key
contains the account and organization, with individual person/chief/conversation
entries and one editable To draft per organization. Recipient chips, acknowledged
conversation IDs and scheduling retry references survive reload. Account-wide
Drafts lists combine only that account's scoped stores. Confirmed status responses
prune prior-account drafts even when the Team Bridge page is closed; offline or
pending identity reads do not erase user work. The editor also clears its prior
account's in-memory scopes on logout/account replacement.

Draft bodies are never logged or sent as telemetry. Inbound message bodies do not
enter this store, and `team_bridge/store.py` is unchanged. Storage failures retain
in-memory edits and refuse the outbound transaction before an unpersisted retry
key can leave the renderer. The UI states that device persistence failed.

## Executed affected checks

- `pnpm check-types`: main and renderer both passed.
- Changed-file `pnpm exec biome check`: passed; only three already-existing
  `useTopLevelRegex` warnings in `src/shared/desktop-contract.ts`.
- `node --test --test-concurrency=1 scripts/team-bridge-drafts-scheduled.test.mjs scripts/team-bridge-model.test.mjs scripts/team-bridge-directory.test.mjs scripts/team-bridge-scope.test.mjs`:
  **91 passed, 0 failed**.
- The new suite's 10 cases execute shipped hook/model/components, including
  account/org/target switching, reload, recipient retention, old-target send
  settlement, corrupt storage, quota failure, recipient-set change versus reorder,
  create-success/schedule-response-loss/reload retry, time bounds and cancel
  409/offline races. The cancel row remains visible after failure; `sending`
  rows expose neither edit nor cancellation. These JSDOM checks deliberately
  omit CSS and are not visual or native evidence.

## Actual proxy adapter exercise

`node scripts/team-bridge-scheduled-proxy-qa.mjs` runs inside the runtime lane's
`tests/unit/server/test_desktop_team_bridge_scheduled.py::proxy` context manager
with a disposable directory and test-only authorization injected in its process
environment. Both HTTP listeners are started and reaped by that fixture. No
operator credential or account is used.

Executed path:

`TeamBridgeApi -> desktopResult -> shared desktopEndpoint -> actual loopback
uvicorn router -> actual TeamBridgeClient -> loopback HTTP hub fixture`.

The `window.api.desktop.request` transport is the test seam; it sends real HTTP
using the production shared endpoint mapping. This is not a native IPC test and
not a real Go server/database test.

Observed responses, with private fixture bodies and authorization omitted:

| Operation | Actual HTTP | Parsed result |
| --- | --- | --- |
| GET without desktop authorization | 401 | Refused before hub |
| `team_bridge.scheduled.create` | 200 | Scheduled DTO; time/status checked |
| `team_bridge.scheduled.list` | 200 | One pending DTO |
| `team_bridge.scheduled.update` | 200 | Edited body checked, not logged |
| `team_bridge.scheduled.cancel` | 200 | `{}` from msg-only hub acknowledgement |
| `team_bridge.scheduled.list` | 200 | `{scheduled: []}` |

Every successful HTTP response had the existing keys `message`, `result`, and
`status`; the renderer's normal adapter unwraps `result`. Final fixture row was
absent, five authenticated hub requests were observed, and both fixture listener
threads were confirmed stopped before the command returned.

## Recovery contract and known limitation

A first schedule reuses `sendFirstMessage`. The acknowledged conversation ID is
saved before scheduling; retries/reloads reuse it and the same scheduling key.
Changing To recipients invalidates that ID; reordering identical chips does not.
An ambiguous schedule keeps its key even if text changes: the server's
`client_ref_conflict` is safer than silently creating a second schedule. The
previous-schedule recovery action can replay a previously confirmed time after
it becomes due; new schedules still use the inclusive one-minute..120-day window.
Failures preserve the draft. Successful writes clear only the submitted revision,
not text entered later or a different target's identical text.

Group creation itself has no server idempotency field. A lost *create* response
cannot be promised exactly once. Before that request the desktop records an
uncertain-create marker; an ambiguous failure blocks another attempt and asks the
reader to inspect Groups before deliberately allowing another creation attempt.
DM creation remains server find-or-create. Server create-idempotency is deferred
in this PR thread, not hidden behind a client retry or a new issue.

## Outstanding release gates — not claimed complete

- Browser host health check failed: its published process generation did not
  answer; no browser command was sent. There are **no rendered frames**, native
  app captures or visual geometry assertions for this slice. The scheduled
  loading/empty/error/populated/sending/read-only/confirmation stories and the
  interactive per-target draft story are ready for the browser lane once its
  host returns. This is a design/visual evidence blocker, not a passed check.
- 27 new English keys plus context are frozen. Seven shipped locales require
  translator and independent auditor receipts; the parent owns that lane. No
  coverage allowance was enlarged.
- The parent arranges independent code and design review rounds. No human
  reviewer, notification tag, issue, merge, flag or release is created by this
  slice. Full CI and the serialized evidence fold must pass on the integrated
  head before shipping.
