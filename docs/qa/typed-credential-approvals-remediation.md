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

## Unified QA/design/UX remediation

The decision hook now uses an exported options factory with `retry: false`.
A regression constructs a QueryClient with the production defaults (mutations
retry once), executes those exact options against a signed-but-unapplied answer,
and checks that the original apply outcome survives with only one request. A
negative control removing the retry override failed that selected test (1 fail).
The override was restored before the final runs.

Signed approved/failed credential cards remain in the live list with a separate
needs-attention count. Their outcome stays inside the card, while terminal
records retain the closed settled section and a visible Shared count. Credential
success reads Shared, not Connected. Consent-critical scope, lifetime and future
sign-in facts are visible before Approve. Every card uses the same Answer within
request-deadline wording, distinct from share lifetime.

Exact signed JSON is inside a nested, initially collapsed technical disclosure,
bounded to a scrolling area. Codes are inside Details only. Cancel sharing has a
visible explanation (stops this request, does not revoke existing access). File
key notes distinguish unsigned assurance facts from signed records. File-only
pending copy says Signing and applying, not that a Touch ID prompt is open.

Decision controls describe their card with aria-describedby. Focus handoff now
covers Approve and Try again as well as Deny, waits for the invalidated row or
refusal, and does not steal focus if the operator moved elsewhere. A semantic
output with polite live updates announces success/attention counts and outcomes.
These source paths still require the manager-scheduled real keyboard/browser
and assistive-technology checks; source pins are not rendered or focus proof.

Capture stories retain pending/inheritance summaries, Details with technical
content closed and open, retryable/permanent failure outcomes in the live list,
approve/retry success, and narrow Details. Fixture apply reasons/remedies use the
backend approval_copy sentences, not invented stand-ins. A separate localized
hint explicitly points to the Try again button without rewriting server copy.

Final selected serial runs (2 GiB, timeout 120s, concurrency 1): mesh-tab tests
113/pass 113/fail 0; locale-parity tests 44/pass 44/fail 0. No full suite, build or
browser launched in this pass. Fifteen new catalogue keys and modified assurance/
account copy are translated into all seven supported locales with English context;
keys regenerated. Fresh independent semantic audits and ledger refresh are needed;
no self-audit or historical receipt rebinding is claimed.


## Pre-capture follow-ups (agent review round 4 / translation round 3)

Updated the legacy approved/settled story assertions, restored the untyped
approved-card Details hint, and kept answer deadlines visible on needs-attention
cards. The polite status now announces counts only; focus announces the refusal,
so its sentence is no longer repeated in the atomic region. Named refusals format
locale-authored punctuation with placeholder tokens, then insert actual request/
reason strings into separate bdi elements. Input tokens cannot become template
fields because input is inserted only after splitting. Standalone backend refusal
sentences are isolated too. Real RTL/AT rendering remains manager-scheduled.

Removed the unused old expiry helper and five obsolete keys (and context) after
checking production call sites; expiry tests now exercise the unified answer
window helper. The restored legacy apply hint keys remain, because they are used.
Applied the translation audit punctuation/quotation/agreement nits without
claiming self-audit. Fresh independent audits are required for changed namespaces.

Selected tests, serially with 2 GiB / 120s / concurrency 1: mesh-tab 114 pass,
0 fail; locale-parity 44 pass, 0 fail. No build/browser/full suite run here.

### Exact catalogue delta for independent auditors

- **en changed:** none.
- **es changed:** `ui.mesh.approval.file_key_disclosure`, `ui.mesh.approval.answer_window`, `ui.mesh.approval.file_key_recorded`, `ui.mesh.approval.named_refusal`.
- **fr changed:** `ui.mesh.approval.shared`, `ui.mesh.approval.result_status`, `ui.mesh.approval.named_refusal`.
- **ru changed:** `ui.mesh.approval.named_refusal`.
- **hi changed:** `ui.mesh.approval.result_status`, `ui.mesh.approval.retry_hint`, `ui.mesh.approval.named_refusal`.
- **ur changed:** `ui.mesh.approval.result_status`, `ui.mesh.approval.retry_hint`, `ui.mesh.approval.named_refusal`.
- **vi changed:** `ui.mesh.approval.cancel_hint`, `ui.mesh.approval.named_refusal`.
- **zh-CN changed:** `ui.mesh.approval.head_inheritance`, `ui.mesh.approval.file_key_disclosure`, `ui.mesh.approval.result_status`.
- **Removed in all eight catalogues:** `ui.mesh.mesh_approvals.expires_in_under_a_minute`, `ui.mesh.mesh_approvals.expires_minutes`, `ui.mesh.mesh_approvals.expires_hours`, `ui.mesh.approval.approved_pending_apply`, `ui.mesh.approval.request_window`.
- **English context updated:** `ui.mesh.approval.result_status`, `ui.mesh.approval.named_refusal`; removed contexts for the same five obsolete keys.
