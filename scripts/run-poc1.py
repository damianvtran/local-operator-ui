#!/usr/bin/env python3
"""Serial source-only POC, no process-group signaling, native app or journals.

Run --selftest first. Node's no-isolation mode avoids a forked test worker.
Only the exact fresh Popen child may be signaled while alive with its recorded
start identity. Descendants are NOT signaled: esbuild.stop handles normal exit;
a forced timeout cannot promise descendant cleanup and stops all dispatch.
"""
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile


def identity(pid):
    return subprocess.check_output(["ps", "-p", str(pid), "-o", "lstart="], text=True).strip()


def run(command, *, env, cwd, timeout):
    process = subprocess.Popen(command, cwd=cwd, env=env)
    started = identity(process.pid)

    def signal_owned(sig):
        if process.poll() is None:
            assert started and identity(process.pid) == started, "child identity changed; refusing signal"
            process.send_signal(sig)

    try:
        return process.wait(timeout=timeout), False
    except subprocess.TimeoutExpired:
        signal_owned(signal.SIGTERM)
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            signal_owned(signal.SIGKILL)
            process.wait()
        print("Deadline: exact child reaped; descendant cleanup NOT guaranteed", flush=True)
        return 124, True


def main():
    root = Path(__file__).resolve().parents[1]
    scratch = Path(os.environ["LOCAL_OPERATOR_SCRATCHPAD"])
    if sys.argv[1:] == ["--selftest"]:
        code, timed_out = run([sys.executable, "-c", "import time; time.sleep(60)"],
                              env=os.environ.copy(), cwd=root, timeout=0.2)
        assert code == 124 and timed_out
        print("PASS timeout=124; exact live child identity checked and reaped; no group signals")
        (scratch / "poc1-wrapper-preflight.pass").write_text(Path(__file__).read_text())
        return 0
    assert (scratch / "poc1-wrapper-preflight.pass").read_text() == Path(__file__).read_text(), "run --selftest after wrapper changes"
    home = Path(tempfile.mkdtemp(prefix="poc1-home-", dir=scratch))
    output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else scratch / "poc1-evidence"
    env = {k: v for k, v in os.environ.items() if not k.startswith("CMUX_") and k not in {"XPC_FLAGS", "LOP_POC1_CELL"}}
    env.update(HOME=str(home), LOCAL_OPERATOR_CONFIG_DIR=str(home / "config"),
               GIT_CONFIG_SYSTEM="/dev/null", GIT_TERMINAL_PROMPT="0", GIT_ASKPASS="/bin/false",
               LOP_POC1="1", LOP_POC1_OUTPUT=str(output))
    command = ["node", "--test", "--experimental-test-isolation=none", "--test-concurrency=1", "--test-timeout=60000",
               "--test-name-pattern=POC1", "scripts/session-load-sequence.test.mjs"]
    print("Source-rig only:", " ".join(command), flush=True)
    code, _ = run(command, cwd=root, env=env, timeout=300)
    return code


if __name__ == "__main__":
    sys.exit(main())
