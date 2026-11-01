#!/usr/bin/env python3
"""Source-only serial POC. Requires existing dependencies and session scratch.

Run --selftest before dispatch. A fresh Popen session owns each process group;
never derive ownership from an aged PID, process name, or shared service.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile


def run(command, *, env, cwd, timeout):
    process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
    timed_out = False
    try:
        code = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        code = 124
    finally:
        # Node forks a worker and an esbuild service. The fresh, exclusively
        # owned group is the teardown unit, including after its leader exits.
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        try:
            os.killpg(process.pid, 0)
        except ProcessLookupError:
            pass
        else:
            os.killpg(process.pid, signal.SIGKILL)
    return code, timed_out


def main():
    root = Path(__file__).resolve().parents[1]
    scratch = Path(os.environ["LOCAL_OPERATOR_SCRATCHPAD"])
    if sys.argv[1:] == ["--selftest"]:
        # The negative arm uses the SAME timeout/teardown path with a child
        # process, not a report inferred from elapsed time or source inspection.
        proof = scratch / "poc1-reaping-proof.txt"
        probe = """
import os, signal, subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
with open(sys.argv[1], 'w') as out:
    out.write(str(child.pid))
def stop(*_):
    child.wait(timeout=2)
    sys.exit(0)
signal.signal(signal.SIGTERM, stop)
time.sleep(60)
"""
        code, timed_out = run([sys.executable, "-c", probe, str(proof)],
                              env=os.environ.copy(), cwd=root, timeout=0.5)
        assert code == 124 and timed_out
        child_pid = int(proof.read_text())
        try:
            os.kill(child_pid, 0)
        except ProcessLookupError:
            print("PASS timeout=124; synthetic child reaped; shared teardown path")
        else:
            raise RuntimeError("setup leak: synthetic child survived; STOP dispatch")
        (scratch / "poc1-wrapper-preflight.pass").write_text(Path(__file__).read_text())
        return 0
    assert (scratch / "poc1-wrapper-preflight.pass").read_text() == Path(__file__).read_text(), "run --selftest after wrapper changes"
    home = Path(tempfile.mkdtemp(prefix="poc1-home-", dir=scratch))
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else scratch / "poc1-evidence"
    env = {k: v for k, v in os.environ.items() if not k.startswith("CMUX_") and k not in {"XPC_FLAGS", "LOP_POC1_CELL"}}
    env.update(HOME=str(home), LOCAL_OPERATOR_CONFIG_DIR=str(home / "config"),
               GIT_CONFIG_SYSTEM="/dev/null", GIT_TERMINAL_PROMPT="0", GIT_ASKPASS="/bin/false",
               LOP_POC1="1", LOP_POC1_OUTPUT=str(output))
    command = ["node", "--test", "--test-concurrency=1", "--test-timeout=60000",
               "--test-name-pattern=POC1", "scripts/session-load-sequence.test.mjs"]
    print("Source-rig only:", " ".join(command), flush=True)
    code, _ = run(command, cwd=root, env=env, timeout=300)
    return code


if __name__ == "__main__":
    sys.exit(main())
