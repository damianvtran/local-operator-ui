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

The complete candidate app logging path must be verified against a running candidate by independent QA
before requesting this capture from the operator. Source-level forwarding and a
hook test's captured `console.warn` are not proof that the packaged file exporter
received it. If the candidate produces no matching records, stop and report that
capture limitation rather than asking for a generic DevTools console dump.

A metadata-only export can be produced with this standard-library command after
that validation. It accepts only this diagnostic's typed schema and discards
unknown/incomplete rows, arbitrary messages and unknown string values. It scans
only the final 1 MiB (discarding a partial first line), skips lines over 8 KiB,
and emits the first valid records in that tail until 200 records or 64 KiB,
whichever comes first. Truncation is silent: no raw rejection prose is printed.
Generation must be 1–2^53−1, attempt 1–20, elapsed time 0–24 hours, and the
readiness object must contain exactly six booleans. Duplicate keys are rejected. It prints no raw
input lines, request URLs, identifiers, query keys, payloads, causes or stacks:

```sh
python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / 'Library/Application Support/Local Operator/logs/backend-service.log'
MAX_INPUT_BYTES, MAX_LINE_BYTES = 1048576, 8192
MAX_RECORDS, MAX_OUTPUT_BYTES = 200, 65536
MAX_SAFE_INT, MAX_ELAPSED_MS = 9007199254740991, 86400000
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
base = {'operation', 'event', 'phase', 'generation', 'attempt', 'elapsedMs',
        'epochChanged', 'readiness'}
failure = {'category', 'errorClass', 'status', 'code'}
ready_keys = {'authMatches', 'statusPresent', 'statusMatches', 'ready', 'localEnabled', 'readOnly'}
def integer(v, low, high):
    return type(v) is int and low <= v <= high
def valid(row):
    if not isinstance(row, dict):
        return False
    rejected = row.get('event') == 'rejected'
    if set(row) != (base | failure if rejected else base):
        return False
    for k in ('operation', 'event', 'phase'):
        if type(row[k]) is not str or row[k] not in enums[k]:
            return False
    if not (integer(row['generation'], 1, MAX_SAFE_INT)
            and integer(row['attempt'], 1, 20)
            and integer(row['elapsedMs'], 0, MAX_ELAPSED_MS)
            and type(row['epochChanged']) is bool):
        return False
    ready = row['readiness']
    if not (isinstance(ready, dict) and set(ready) == ready_keys
            and all(type(v) is bool for v in ready.values())):
        return False
    if rejected:
        for k in ('category', 'errorClass'):
            if type(row[k]) is not str or row[k] not in enums[k]:
                return False
        if row['code'] is not None and (type(row['code']) is not str or row['code'] not in enums['code']):
            return False
        if row['status'] is not None and not integer(row['status'], 100, 599):
            return False
    return True
def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate')
        result[key] = value
    return result
records = output_bytes = 0
marker = b'[renderer] [owner-audit-read] '
with p.open('rb') as stream:
    size = stream.seek(0, 2)
    if size > MAX_INPUT_BYTES:
        stream.seek(size - MAX_INPUT_BYTES)
        stream.readline(MAX_INPUT_BYTES)  # discard the possibly partial first line
    else:
        stream.seek(0)
    remaining = size - stream.tell()  # ignore bytes appended after this snapshot
    oversized = False
    while records < MAX_RECORDS and remaining > 0:
        line = stream.readline(min(MAX_LINE_BYTES + 1, remaining))
        remaining -= len(line)
        if not line:
            break
        too_long = len(line) > MAX_LINE_BYTES
        if oversized or too_long:
            oversized = not line.endswith(b'\n')
            continue
        if marker not in line:
            continue
        try:
            row = json.loads(line.split(marker, 1)[1].decode('utf-8'), object_pairs_hook=unique)
        except (ValueError, TypeError, UnicodeError, RecursionError):
            continue
        if not valid(row):
            continue
        text = json.dumps(row, sort_keys=True, separators=(',', ':')) + '\n'
        length = len(text.encode('utf-8'))
        if output_bytes + length > MAX_OUTPUT_BYTES:
            break
        print(text, end='')
        records += 1
        output_bytes += length
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
