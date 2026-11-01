# Owner-audit read diagnostics (diagnostic only)

This instrumentation does **not** fix the reported first-open error. The actual
first rejected query exception has not yet been captured. Do not add automatic
retries or change the privacy/authority fences on the strength of the controlled
fixtures.

## Capture after installing a reviewed build containing this change

1. Confirm the running **desktop UI**, not `lop --version`, has restarted into
   the build containing this change. A version read from the disk app alone does
   not prove which renderer is running. Record the UI version and launch time.
2. Open Minerva / Team Bridge once and note the wall-clock time of the error.
   Press **Try again** once, then note whether it succeeds. Do not sign out,
   change credentials, clear caches, or repeatedly open the page for this capture.
3. Export only the `[owner-audit-read]` records from the desktop backend log,
   not the whole log. On macOS it is:
   `~/Library/Application Support/Local Operator/logs/backend-service.log`.
   The existing main-process `console-message` handler in `src/main/index.ts`
   forwards renderer warnings as `[renderer] ...` to that log. This patch uses
   that handler; it introduces no new telemetry endpoint, file or upload.

The logging path must be verified against a running candidate by independent QA
before requesting this capture from the operator. Source-level forwarding and a
hook test's captured `console.warn` are not proof that the packaged file exporter
received it. If the candidate produces no matching records, stop and report that
capture limitation rather than asking for a generic DevTools console dump.

A metadata-only export can be produced with this standard-library command after
that validation. It accepts only this diagnostic's typed schema and discards
unknown keys, arbitrary messages and unknown string values. It prints no raw
input lines, request URLs, identifiers, query keys, payloads, causes or stacks:

```sh
python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / 'Library/Application Support/Local Operator/logs/backend-service.log'
enums = {
    'operation': {'conversations', 'messages', 'replies'},
    'event': {'started', 'fulfilled', 'rejected'},
    'phase': {'before', 'read', 'request', 'settlement', 'after'},
    'category': {'cancelled', 'audit-owner', 'bridge-owner', 'bridge-authority',
                 'credential-authority', 'schema', 'desktop', 'other'},
    'errorClass': {'CancelledError', 'DesktopControlError', 'ZodError', 'Error', 'unknown'},
    'code': {'conversation_not_found', 'account_mismatch', 'expected_account_mismatch',
             'deadline_exceeded', 'owner_audit_unavailable', 'other'},
}
for line in p.open(errors='replace'):
    marker = '[renderer] [owner-audit-read] '
    if marker not in line:
        continue
    try:
        row = json.loads(line.split(marker, 1)[1])
    except (ValueError, TypeError):
        continue
    if not isinstance(row, dict):
        continue
    out = {k: v for k, v in row.items() if k in enums and isinstance(v, str) and v in enums[k]}
    for k in ('generation', 'attempt', 'elapsedMs'):
        v = row.get(k)
        if type(v) is int and v >= 0:
            out[k] = v
    v = row.get('status')
    if v is None or (type(v) is int and 100 <= v <= 599):
        out['status'] = v
    if type(row.get('epochChanged')) is bool:
        out['epochChanged'] = row['epochChanged']
    ready = row.get('readiness')
    if isinstance(ready, dict):
        out['readiness'] = {k: ready[k] for k in
            ('authMatches', 'statusPresent', 'statusMatches', 'ready', 'localEnabled', 'readOnly')
            if type(ready.get(k)) is bool}
    print(json.dumps(out, sort_keys=True))
PY
```

## Reading the records

- `generation` is an opaque, process-local incrementing counter. It is **not** an
  account/tenant hash, fingerprint or stable identifier. A scope change or remount
  gets a new generation. Correlate records only within one running renderer.
- `attempt` increments within a generation. The first read and manual Retry can
  be distinguished without logging the query key. Each of the first 20 attempts
  emits one `started` and one terminal `fulfilled` / `rejected` record. Later
  attempts still run normally but emit nothing. This is bounded local diagnosis,
  not a history of private-screen activity.
- `phase=before` is the audit hook's owner check; `read` is the shared fence's
  preflight; `request` is the API call (including its decoder); `settlement` is
  the shared post-read authority/credential fence; `after` is the mounted audit
  hook's final check. A cancellation is classified but rethrown unchanged.
- `category` and `errorClass` are authored enums. Unknown errors/codes become
  `other` / `unknown`, never arbitrary error prose. `status` is present only
  when the original error is a `DesktopControlError`; `null` is **not** proof
  that no HTTP request occurred (a post-200 schema/fence rejection also lacks a
  transport status). Correlate with narrow backend HTTP route/status metadata.
- `readiness` contains six booleans, never cached status data. `epochChanged`
  reports only whether the credential epoch changed during this attempt.
- No query retry, cache lifetime, request abort signal, authorization rule or
  user-visible UI is changed. Logger failure cannot replace a successful result
  or the original rejection. Do not interpret controlled schema/fence/cancel
  tests as a reproduction of the installed app's first-open failure.
