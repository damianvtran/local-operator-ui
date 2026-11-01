# Owner-audit read diagnostics (diagnostic only)

This instrumentation does **not** fix the reported first-open error. The actual
first rejected query exception has not yet been captured. The merged bounded
recovery policy remains unchanged; diagnostics must not add retries or change
privacy/authority fences on the strength of controlled fixtures.

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
Only operation and status class are accepted; duplicate keys and all additional
fields are rejected. No prose, stacks, codes, bodies, IDs or tokens are exported.

```sh
python3 - <<'PY'
import json
from pathlib import Path
p = Path.home() / 'Library/Application Support/Local Operator/logs/backend-service.log'
MAX_INPUT_BYTES, MAX_LINE_BYTES = 1048576, 8192
MAX_RECORDS, MAX_OUTPUT_BYTES = 200, 65536
enums = {
    'operation': {'conversations', 'messages', 'replies'},
    'statusClass': {'1xx', '2xx', '3xx', '4xx', '5xx', 'unknown'},
}
def valid(row):
    return (isinstance(row, dict) and set(row) == set(enums)
            and all(type(row[k]) is str and row[k] in values
                    for k, values in enums.items()))
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

- Each rejection emits only `operation` (`conversations`, `messages`, `replies`)
  and `statusClass` (`1xx` through `5xx`, or `unknown`). Successful reads emit nothing.
- `unknown` includes schema and authority-fence failures, not just transport errors;
  it is not proof that no HTTP request occurred. No code or exact status is logged.
- At most 20 refusals are logged per mounted scope/operation; authority rebinds
  retain the budget. Scope IDs are never included, hashed, or fingerprinted.
- The classifier remains internal. Its taxonomy, error class, codes, and status
  do not cross the logging boundary. No error prose, stacks, bodies, IDs or tokens
  can appear in the diagnostic record.
- Logger failure cannot replace the original rejection or interfere with recovery.
  Retry, authority rebind, cache lifetime and authorization remain main's policy.
- These hook tests do not prove packaged log forwarding or reproduce the installed
  app's original first-open exception. Independent candidate QA remains required.
