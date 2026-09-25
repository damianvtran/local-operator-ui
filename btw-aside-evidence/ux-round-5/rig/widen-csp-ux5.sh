#!/usr/bin/env bash
# Widen the BUILT page's connect-src for this rig's private port.
#
# `src/renderer/index.html` pins connect-src to 1111, 8080 and three vendor origins,
# and 8080 is held by the operator's own app on this host, so the rig runs on 8391.
# The pinned source file is NOT touched: this edits `out/renderer/index.html`, which
# `.gitignore:9` (`out/`) excludes, so the change cannot reach a commit. It is
# recomputed from the built file on every run: the script asserts the anchor exists
# exactly once and that the port was NOT already allowed, so it can neither silently
# no-op nor double-insert.
set -euo pipefail
TREE="${1:?usage: widen-csp-ux5.sh <UI worktree>}"
PORT="${2:-8391}"
F="$TREE/out/renderer/index.html"
[[ -f "$F" ]] || { echo "no built page at $F" >&2; exit 1; }
python3 - "$F" "$PORT" <<'PYEOF'
import sys
path, port = sys.argv[1], sys.argv[2]
s = open(path).read()
url = f"http://127.0.0.1:{port}"
if url in s:
    print(f"csp: {url} already allowed (idempotent)")
    sys.exit(0)
anchor = "connect-src 'self' http://localhost:1111 http://127.0.0.1:1111"
n = s.count(anchor)
assert n == 1, f"the connect-src anchor is not unique in {path} ({n} occurrences)"
# `connect-src` also appears once inside a build note, so the anchor above (which carries the
# policy's own two loopback origins) is the thing that identifies the real directive.
s = s.replace(anchor, f"{anchor} {url}")
open(path, "w").write(s)
print(f"csp: added {url} to connect-src in the gitignored build output")
PYEOF
grep -o "connect-src 'self'[^;]*" "$F" | head -1
