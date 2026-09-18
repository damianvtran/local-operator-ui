SUPPORTING TRANSCRIPTS for the source-build update route.

Not frames: these are the command lines and their real output, kept beside the
frames the manifest tracks because the claim they back is about execution rather
than about pixels, and the frames cannot carry a process's stdout.

# 1. THE OPERATOR'S OWN `lop-update`, REFUSING (the U7 finding)

Driven in an ISOLATED repository so nothing on this machine is touched and no
build can start: `LOCAL_OPERATOR_REPO` points at a throwaway checkout whose
`main` is one commit behind its `origin/main`, which is the branch of the script
that refuses before it archives anything.

$ LOCAL_OPERATOR_REPO=/tmp/lo-refuse-demo/repo ~/.local/bin/lop-update main; echo "exit=$?"
exit=1
--- stderr ---
lop-update: warning: could not fetch origin (offline?); comparing against the last known state of origin/main
lop-update: REFUSING to release a stale ref.

  local  main          = 2a0b473
  remote origin/main = 4b32d95  (1 commit(s) ahead)

Local main is BEHIND origin/main, so installing it would publish code
older than what is merged -- and would report success while doing it.

Update the local ref first, then re-run:

  git -C /tmp/lo-refuse-demo/repo fetch origin
  git -C /tmp/lo-refuse-demo/repo update-ref refs/heads/main origin/main   # safe while another branch is checked out
  lop-update main

(If main is the checked-out branch, use 'git -C /tmp/lo-refuse-demo/repo merge --ff-only origin/main' instead.)

To install the local ref anyway: lop-update main --skip-remote-check

--- the selection the app makes from that text (`installDiagnosisLines`) ---
lop-update: warning: could not fetch origin (offline?); comparing against the last known state of origin/main
lop-update: REFUSING to release a stale ref.
local  main          = 2a0b473
remote origin/main = 4b32d95  (1 commit(s) ahead)
Local main is BEHIND origin/main, so installing it would publish code
older than what is merged -- and would report success while doing it.

WHAT A TAIL WOULD HAVE HANDED OVER INSTEAD (the last line of the same output):
To install the local ref anyway: lop-update main --skip-remote-check

# 2. THE REBUILD THE ROUTE RUNS, EXECUTED FOR REAL IN AN ISOLATED INSTALL

`lop-update main` with `HOME`, `UV_TOOL_DIR`, `UV_TOOL_BIN_DIR`, `TMPDIR` and
`UV_CACHE_DIR` all under /tmp: the operator's live install, their live sessions
and `~/.local/share/uv/tools/local-operator` are untouched. The checkout itself is
read only through `git fetch` and `git archive`, which is what `lop-update`
already does when the operator runs it by hand.

$ export HOME=/tmp/lo-rebuild-iso/home UV_TOOL_DIR=/tmp/lo-rebuild-iso/tools \
        UV_TOOL_BIN_DIR=/tmp/lo-rebuild-iso/bin TMPDIR=/tmp/lo-rebuild-iso/tmp
$ LOCAL_OPERATOR_REPO=/Users/damian/local-operator ~/.local/bin/lop-update main
=== uv tool dir -> /tmp/lo-rebuild-iso/tools ===
=== invoking: lop-update main (isolated HOME/UV_TOOL_DIR/UV_TOOL_BIN_DIR/TMPDIR) ===
lop-update: mobile web bundle: built
Resolved 55 packages in 1.25s
   Building local-operator @ file:///tmp/lo-rebuild-iso/tmp/lop-update.jegEuB
Downloading cryptography (3.8MiB)
Downloading pillow-heif (4.1MiB)
Downloading pydantic-core (1.8MiB)
Downloading pillow (4.6MiB)
Downloading pygments (1.2MiB)
 Downloaded pygments
 Downloaded pydantic-core
 Downloaded cryptography
 Downloaded pillow-heif
 Downloaded pillow
      Built local-operator @ file:///tmp/lo-rebuild-iso/tmp/lop-update.jegEuB
Prepared 55 packages in 12.67s
Installed 55 packages in 104ms
 + annotated-doc==0.0.5
 + annotated-types==0.8.0
 + anyio==4.15.1
 + apscheduler==3.11.3
 + attrs==26.1.0
 + certifi==2026.7.22
 + cffi==2.1.1
 + charset-normalizer==3.5.1
 + click==8.5.0
 + cryptography==50.0.1
 + dill==0.4.1
 + fastapi==0.141.1
 + h11==0.16.0
 + httpcore==1.0.9
 + httpcore2==2.13.0
 + httpx==0.28.1
 + httpx2==2.13.0
 + idna==3.19
 + jsonschema==4.26.0
 + jsonschema-specifications==2025.9.1
 + linkify-it-py==2.2.0
 + local-operator==0.56.10 (from file:///tmp/lo-rebuild-iso/tmp/lop-update.jegEuB)
 + markdown-it-py==4.2.0
 + mcp==2.2.0
 + mcp-types==2.2.0
 + mdit-py-plugins==0.6.1
 + mdurl==0.1.2
 + opentelemetry-api==1.44.0
 + pillow==12.3.0
 + pillow-heif==1.7.0
 + platformdirs==4.11.9
 + pycparser==3.0
 + pydantic==2.13.5
 + pydantic-core==2.46.5
 + pygments==2.21.0
 + pyjwt==2.14.0
 + python-dotenv==1.2.3
 + python-multipart==0.0.32
 + pyyaml==6.0.3
 + referencing==0.37.0
 + regex==2026.9.10
 + requests==2.34.2
 + rich==15.0.0
 + rpds-py==2026.6.3
 + sse-starlette==3.4.11
 + starlette==1.6.0
 + textual==8.2.8
 + tiktoken==0.14.0
 + truststore==0.10.4
 + typing-extensions==4.16.0
 + typing-inspection==0.4.4
 + tzlocal==5.4.4
 + urllib3==2.8.0
 + uvicorn==0.53.0
 + websockets==17.1
Installed 2 executables: local-operator, lop
warning: `/tmp/lo-rebuild-iso/bin` is not on your PATH. To use installed tools, run `export PATH="/tmp/lo-rebuild-iso/bin:$PATH"` or `uv tool update-shell`.
lop-update: installed local-operator 0.56.10 from main (d0601cfad)
lop-update: remote check: in sync with origin/main
=== lop-update exit=0 ===
=== the marker the app verifies, in the isolated install ===
-rw-r--r--@ 1 damian  wheel  46 Sep 17 09:36 /tmp/lo-rebuild-iso/tools/local-operator/.lop-source
d0601cfadaf6024503298ce452e18054a46dfac7 main
=== the console script uv installed there ===
total 0
drwxr-xr-x@ 4 damian  wheel  128 Sep 17 09:36 .
drwxr-xr-x@ 7 damian  wheel  224 Sep 17 09:35 ..
lrwxr-xr-x@ 1 damian  wheel   59 Sep 17 09:36 local-operator -> /tmp/lo-rebuild-iso/tools/local-operator/bin/local-operator
lrwxr-xr-x@ 1 damian  wheel   48 Sep 17 09:36 lop -> /tmp/lo-rebuild-iso/tools/local-operator/bin/lop
=== the version that install reports ===
v0.56.10
