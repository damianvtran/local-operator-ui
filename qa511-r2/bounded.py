#!/usr/bin/env python3
"""Run one command in its OWN process group under a wall-clock bound, and reap that group.

    bounded.py <seconds> <cwd> <cmd> [args...]

Exit code is the command's own, or 124 when the bound fired (and then the group this
script created is SIGTERM'd, given two seconds, and SIGKILL'd). Nothing is ever killed by
name: the pgid is the one `start_new_session=True` created for this child. Written for the
QA rigs on this host, where a wrapper's node/esbuild child has outlived its parent before.
"""
import os
import signal
import subprocess
import sys
import time


def reap(pgid: int, grace: float = 2.0) -> None:
    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        return
    time.sleep(grace)
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def main() -> int:
    if len(sys.argv) < 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    bound = float(sys.argv[1])
    cwd = sys.argv[2]
    argv = sys.argv[3:]
    started = time.time()
    p = subprocess.Popen(argv, cwd=cwd, start_new_session=True)
    try:
        rc = p.wait(timeout=bound)
    except subprocess.TimeoutExpired:
        print(f"# bounded.py: bound {bound:g}s fired for pid {p.pid}; reaping pgid {p.pid}", flush=True)
        reap(p.pid)
        p.wait()
        print(f"# bounded.py: elapsed {time.time() - started:.1f}s rc=124", flush=True)
        return 124
    print(f"# bounded.py: rc={rc} elapsed {time.time() - started:.1f}s", flush=True)
    # The group may still hold stragglers (a service child that outlived its parent); they
    # are this script's own, and reaping them is the whole point of the wrapper.
    reap(p.pid, grace=0.5)
    return rc


if __name__ == "__main__":
    sys.exit(main())
