"""Run a command in its own process group with a bound, and reap exactly that group.

QA r6 scratch. The team brief's rule: a kill must be scoped to pids this session
created; `os.killpg` on the pgid this script just made is exactly that scope, and it
covers the sweep's image child too (check-evidence's lease is held until the last
descriptor closes, so a surviving child would block every other agent's sweep).
"""
import os
import signal
import subprocess
import sys
import time

bound = int(sys.argv[1])
cwd = sys.argv[2]
cmd = sys.argv[3:]

t0 = time.time()
proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        start_new_session=True, text=True)
pgid = os.getpgid(proc.pid)
print(f"# pid {proc.pid} pgid {pgid} started at {time.strftime('%H:%M:%S')}", flush=True)
try:
    out, _ = proc.communicate(timeout=bound)
    rc = proc.returncode
    bounded = False
except subprocess.TimeoutExpired:
    bounded = True
    try:
        os.killpg(pgid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError) as e:
        print(f"# SIGTERM to pgid {pgid}: {e}")
    time.sleep(10)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError) as e:
        print(f"# SIGKILL to pgid {pgid}: {e} (group already gone)")
    out, _ = proc.communicate()
    rc = proc.returncode
elapsed = time.time() - t0
tail = "\n".join((out or "").splitlines()[-25:])
print(f"# rc={rc} bounded={bounded} elapsed={elapsed:.1f}s")
print(tail)
