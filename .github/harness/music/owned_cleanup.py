"""Small CI-only owned-process witness; never signal a PID without identity proof."""
import asyncio
import os
import signal
import subprocess


def process_rows():
    result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,lstart=,command='],
                            capture_output=True, text=True, check=True)
    rows = {}
    for line in result.stdout.splitlines():
        fields = line.split(None, 7)
        if len(fields) == 8:
            pid, parent = map(int, fields[:2])
            rows[pid] = (parent, ' '.join(fields[2:7]), fields[7])
    return rows


class OwnedProcesses:
    def __init__(self, root):
        self.root = str(root)
        self.seeds = set()
        self.identities = {}

    def observe(self):
        rows = process_rows()
        owned = set(self.seeds) | {pid for pid, row in rows.items()
                                   if self.identities.get(pid) == row[1:]}
        # Root witnesses also discover worker helpers after reparenting. A fresh
        # task root cannot be confused with a different session's configuration.
        owned.update(pid for pid, row in rows.items()
                     if any(token == self.root or token.startswith(self.root + '/')
                            or token.endswith('=' + self.root)
                            or ('=' + self.root + '/') in token
                            for token in row[2].split()))
        owned.discard(os.getpid())
        while True:
            children = {pid for pid, row in rows.items() if row[0] in owned}
            if children <= owned:
                break
            owned.update(children)
        for pid in owned:
            if pid in rows:
                self.identities.setdefault(pid, rows[pid][1:])
        self.seeds.clear()
        return {pid: row for pid, row in rows.items()
                if self.identities.get(pid) == row[1:] and '<defunct>' not in row[2]}

    async def watch(self):
        while True:
            self.observe()
            await asyncio.sleep(.1)

    async def stop(self):
        for sig in (signal.SIGTERM, signal.SIGKILL):
            for pid in self.observe():
                # Recheck immediately before each exact-PID signal; a reused PID
                # is not our child even if it occupies a previously owned slot.
                if pid in self.observe():
                    try:
                        os.kill(pid, sig)
                    except ProcessLookupError:
                        pass
            for _ in range(50):
                if not self.observe():
                    return
                await asyncio.sleep(.1)
        if self.observe():
            raise RuntimeError('Owned process cleanup not proven')


async def cleanup_all(actions):
    """A failed listener must not short-circuit server/process teardown."""
    errors = []
    for action in actions:
        try:
            await action()
        except BaseException as error:
            errors.append(error)
    if errors:
        raise BaseExceptionGroup('Owned cleanup failed', errors)


async def cancel_listener(listener):
    if listener:
        listener.cancel()
        try:
            await listener
        except asyncio.CancelledError:
            pass


async def run_signalled(work):
    """SIGTERM/SIGINT cancel once, letting the coroutine await its finally."""
    task = asyncio.create_task(work())
    loop = asyncio.get_running_loop()
    interrupted = False
    def interrupt():
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            task.cancel()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, interrupt)
    try:
        return await task
    finally:
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.remove_signal_handler(sig)
