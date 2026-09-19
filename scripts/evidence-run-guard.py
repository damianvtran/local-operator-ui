#!/usr/bin/env python3
"""Non-waiting POSIX admission for the evidence sweep, with no PID-based lease.

The lock file is permanent: unlinking even a dead holder's file permits two
contenders to lock different inodes. The kernel releases flock when the last
inherited descriptor closes, including after SIGKILL. PID metadata is only
diagnostic, so stale files and PID reuse never authorize stealing a live lock.

Usage: evidence-run-guard.py LOCK_PATH COMMAND [ARG ...]
The command inherits the lease on fd 3 and holds it for as long as it runs.
It is not passed to a child: the sweep decodes each frame in its own process
(scripts/check-evidence.mjs), so the descriptor's job is to keep admission
occupied for exactly as long as this process lives.
The production caller uses one fixed /tmp path, not HOME/TMPDIR or the
checkout. An explicit path here lets subprocess tests use an isolated lease,
never the operator's production lock. This is macOS/Linux developer tooling;
missing Python/POSIX locking must fail closed, not run an unbounded fallback,
and it must say so in those terms - `fcntl` is not something to install.
"""

import errno
import os
import stat
import sys


def main():
    try:
        import fcntl
    except ImportError as error:
        # The one failure here that is about the HOST rather than about this
        # admission, and therefore the only one that can name a recovery.
        # `fcntl` is a POSIX-only stdlib module with no wheel to install, so a
        # reader told only its name goes looking for one (design round 1, D1).
        # Nothing has been opened or locked on this path, so the message may
        # and must say that no frames were checked.
        print(
            "Evidence check BLOCKED: Python 3 with POSIX locking is required "
            "(macOS/Linux). No frames checked. Use a supported environment, "
            f"then rerun `pnpm check-evidence`. Detail: {error}",
            file=sys.stderr,
        )
        return 1

    try:
        path, command, *args = sys.argv[1:]
        fd = os.open(
            path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600
        )
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise OSError("the admission path must be a single regular file")
        if info.st_uid != os.getuid():
            raise OSError("the admission file belongs to another user")
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN):
                raise
            print(
                "Evidence check DEFERRED: another sweep holds the machine "
                "lease; retry after it finishes. "
                "No frames checked. Do not delete the lock file.",
                file=sys.stderr,
            )
            return 75

        # A killed launcher must not free capacity while its own decoding
        # continues: exec keeps the lease open across the handoff, and the
        # sweeping process holds it - with no child of its own to inherit it -
        # until it exits.
        os.dup2(fd, 3, inheritable=True)
        # dup2(fd, fd) is a no-op on POSIX, including its close-on-exec bit.
        os.set_inheritable(3, True)
        if fd != 3:
            os.close(fd)
        os.ftruncate(3, 0)
        os.write(3, f"pid={os.getpid()} (diagnostic only)\n".encode())
        try:
            os.setpriority(
                os.PRIO_PROCESS, 0, max(10, os.getpriority(os.PRIO_PROCESS, 0))
            )
        except OSError as error:
            print(
                f"Evidence check: could not lower priority: {error}",
                file=sys.stderr,
            )
        os.execvp(command, [command, *args])
    except (OSError, ValueError, AttributeError) as error:
        print(
            f"Evidence check BLOCKED: admission unavailable: {error}",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
