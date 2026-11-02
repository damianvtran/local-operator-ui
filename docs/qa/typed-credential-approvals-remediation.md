# Typed credential approvals: remediation evidence and limits

## Synthetic paths

`Mesh/Tab` retains the legacy Credential stories for older-backend compatibility.
The new `TypedCredential*` stories opt into `credential_approvals: 1`, validate
operation and both digests against an invented row, and implement stateful
`approveCredential` / `applyCredential` responses before the invalidated list
refetch. Stories cover finite share, inheritance, empty, loading, signing,
requested/refused, expanded Details, multiple cards, approved, failed, settled,
retryable apply and permanent refusal. Approved and failed open stories expose
the file-key disclosure after the record has settled. No real approval IDs or
credentials are used. These stories have NOT been built or visually exercised
in this remediation pass; manager-scheduled browser/design/UX proof is pending.

The selected `scripts/mesh-tab.test.mjs` also owns a loopback HTTP lane. A server
bound only to `127.0.0.1` on an ephemeral port receives the endpoint mapper's real
POST path and JSON through `desktopResult` and the preload seam. It checks the
three-field acknowledgment against synthetic digests, returns a signed-but-busy
phase, accepts a retry with the identical body, and refuses a changed digest
with HTTP 409 and its authored message. The synthetic state changes from
requested to failed to connected and remains connected after the refused echo.
The server and connections are closed in `finally`.

This is real HTTP **fixture** evidence, not production backend/signature/helper
or credential-store side-effect proof. A separate isolated backend fixture with
an approved test signer is still needed for that claim. No live daemon approve
routes or real pending approvals were touched.

## Remediation checks

All selected test files run serially, one at a time, bounded by 120 seconds:

```
env -u NODE_TEST_CONTEXT NODE_OPTIONS=--max-old-space-size=2048 timeout 120 node --test --test-concurrency=1 scripts/mesh-tab.test.mjs
# tests 110, pass 110, fail 0 (includes synthetic loopback HTTP)
env -u NODE_TEST_CONTEXT NODE_OPTIONS=--max-old-space-size=2048 timeout 120 node --test --test-concurrency=1 scripts/i18n/locale-parity.test.mjs
# tests 44, pass 44, fail 0
```

No full suite, build, Storybook server, Electron or browser was launched.
Typechecks are left to CI under the host resource hold. Generator and scoped
lint/string checks are source checks, not rendered or native proof.

## Audit freshness

R1-1 corrects English `scope_session` and its context: session scope authorizes
incoming-session-bound borrowing on the recipient holder, not only the original
requesting session (the signed share has no such session id). All seven locale
values change accordingly. TA2 French spacing, Hindi terminology/agreement,
Russian session terminology and Chinese boundary spacing/ellipsis fixes also
change target bytes.

Existing first-audit receipts remain untouched as historical evidence. The second
audit receipts were inspected from the auditor's handoff; none can be assembled
against these final namespace hashes because the English source changed. No
historical receipt was relabeled as a fresh audit and no self-audit was written.
Fresh independent delta audits and ledger assembly are required before merge.
Unchanged individual values can retain their prior semantic findings; this does
not make the whole-namespace receipt hashes fresh.

## Explicitly deferred: R1-5 presence-key setup offer

The parser now retains `typed_approval.upgrade` metadata. No supported operator
key setup op/renderer entry point was found in the desktop contract or settings/
onboarding surfaces. Backend `desktop_approval.upgrade()` explicitly describes
setup as a separate admin-gated flow. Therefore no setup button or invented route
is offered in this PR. The missing upgrade affordance remains a recorded product
gap, not a claimed delivery. This does not authorize key setup or an admin action.

## Round 2: absent apply outcome is not a permanent refusal

`approvalRefusal` now preserves `retryable: undefined` when a refusal has no
apply outcome. A transport deadline or pre-apply refusal cannot override the
stored retryable receipt. An explicit apply outcome with `retryable: false`
still overrides it. The targeted regression covers both no-outcome `store_busy`
and a local-deadline-shaped refusal alongside the old busy receipt.

The loopback HTTP lane additionally returns apply-route 409s with and without
`apply_outcome`, verifies the resulting gates and unchanged synthetic state, then
accepts a retry. No production signer/backend evidence is implied.

Selected serial runs (same 2 GiB / 120-second / concurrency-1 commands above):
- mesh-tab: tests 111, pass 111, fail 0.
- locale-parity: tests 44, pass 44, fail 0.

The first mesh invocation stopped before tests because esbuild encountered
transient package.json conflict markers in the dependency-donor worktree. This
worktree's symlink was switched to another existing tree with a byte-identical
lockfile; no dependencies were installed and no donor files were changed.

Spanish/French/Russian session-borrowing terminology and Hindi terminology/verb
agreement were corrected in this round. Existing audit A's receipts and ledger
commit remain intact; changed target bytes require a fresh independent delta
audit. No self-audit or stale receipt rebinding is claimed.
