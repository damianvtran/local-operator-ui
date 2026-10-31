#!/usr/bin/env python3
"""Disposable Linux/Node22 retention experiment; never a suite runner or fix.

Only allowlisted structured evidence leaves a child. Raw stdout/stderr and Node
report environment/command fields may contain credentials, so neither is stored.
Identity-owned descendants across detached groups, not a name-pattern kill,
are the observation and cleanup boundary.
"""

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

REFS = {
    "avatar": "2c0f276d0ead12e6b8664f550468b8217bbe506d",
    "telemetry": "47cf454be2efe3a0c30e27063d57845ae5ba7171",
}
SINGLE = ["child-reader-foot-react"]
TRIO = ["run-child-reader", "ci-scope", "code-review-model"]
LIMIT = 300

# Synchronous, bounded per-PID files avoid test-runner stdout buffering. No
# timers are installed: observing retention must not itself retain the process.
HOOK = r'''
import { appendFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
const destination = join(process.env.PROBE_EVIDENCE, `node-${process.pid}.jsonl`);
// Atomic slots cap total artifact volume even if a fixture spawns many Nodes.
let admitted = existsSync(destination);
for (let slot = 0; !admitted && slot < 128; slot++) {
  try { mkdirSync(join(process.env.PROBE_EVIDENCE, `slot-${slot}`)); admitted = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
globalThis.__probe = (stage, fields = {}) => {
  if (!admitted) return;
  let size = 0;
  try { size = statSync(destination).size; } catch {}
  const line = JSON.stringify({stage, pid: process.pid,
    ppid: process.ppid, at: Date.now(), ...fields}) + '\n';
  if (size + Buffer.byteLength(line) > 262144) return;
  appendFileSync(destination, line);
};
const snapshot = (stage) => {
  const report = process.report.getReport();
  // Deliberately select fields: getReport includes environment and argv.
  globalThis.__probe(stage, {
    resources: process.getActiveResourcesInfo().slice(0, 128),
    report: {nodejsVersion: report.header.nodejsVersion,
      libuv: report.libuv.map(h => ({type: h.type,
        active: h.is_active, referenced: h.is_referenced})).slice(0, 128)}
  });
};
globalThis.__probe('preload', {file: basename(process.argv[1] || 'coordinator')});
process.on('SIGUSR2', () => snapshot('pre-reap-report'));
process.on('beforeExit', () => snapshot('before-exit-report'));
process.on('exit', (code) => globalThis.__probe('process-exit', {code}));
'''

REPORTER = r'''
import { pathToFileURL } from 'node:url';
// Node may evaluate reporters in a separate realm from --import. Explicitly
// load the same observer there too; otherwise all event markers silently fail.
await import(pathToFileURL(process.env.PROBE_EVIDENCE + '/preload.mjs').href);
export default async function* reporter(source) {
  for await (const {type, data} of source) {
    if (['test:enqueue', 'test:dequeue', 'test:start', 'test:pass', 'test:fail',
         'test:complete', 'test:summary'].includes(type)) {
      globalThis.__probe(type, {
        file: (data.file || '').split('/').at(-1),
        nesting: data.nesting, number: data.testNumber,
        // No test names, diagnostics or assertion payloads: these can contain
        // arbitrary source data. pass/fail are assertion-end markers, not exit.
        success: data.success, tests: data.counts?.tests,
        failed: data.counts?.failed
      });
    }
  }
}
'''


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def process_row(pid, include_zombie=False):
    """A PID alone is not ownership: start ticks distinguish recycled PIDs."""
    entry = Path('/proc') / str(pid)
    try:
        text = (entry / 'stat').read_text()
        fields = text[text.rfind(')') + 2:].split()
        if fields[0] == 'Z' and not include_zombie:
            return None
        return {'pid': pid, 'ppid': int(fields[1]), 'pgid': int(fields[2]),
                'zombie': fields[0] == 'Z',
                'start_id': int(fields[19]),
                'cpu_seconds': (int(fields[11]) + int(fields[12])) / os.sysconf('SC_CLK_TCK'),
                'rss_kib': int(fields[21]) * os.sysconf('SC_PAGE_SIZE') // 1024,
                'node': (entry / 'comm').read_text().strip() == 'node'}
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None


def process_table():
    return [row for entry in Path('/proc').iterdir() if entry.name.isdigit()
            if (row := process_row(int(entry.name))) is not None]


def signal_identity(row, sig):
    """Pin the kernel process before rechecking identity; never kill by name/group.

    Re-read AFTER pidfd_open: a PID reused between census and open cannot receive
    the signal. The pinned descriptor closes the remaining check/signal race.
    Linux support is mandatory; there is no unsafe bare-PID fallback.
    """
    try:
        fd = os.pidfd_open(row['pid'])
    except ProcessLookupError:
        return False
    try:
        current = process_row(row['pid'])
        if current and current['start_id'] == row['start_id']:
            try:
                signal.pidfd_send_signal(fd, sig)
                return True
            except ProcessLookupError:
                pass
    finally:
        os.close(fd)
    return False


def subreaper(enable):
    # A detached child can outlive/reparent away from its observed parent. Linux
    # adoption keeps that tree reachable even if the parent dies between scans.
    # Existing direct children are excluded separately, and the prior setting is
    # restored after this one invocation. Darwin test adapters do not claim this.
    if sys.platform != 'linux':
        return None
    libc = ctypes.CDLL(None, use_errno=True)
    previous = ctypes.c_int()
    if libc.prctl(37, ctypes.byref(previous), 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'PR_GET_CHILD_SUBREAPER')
    if libc.prctl(36, int(enable), 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), 'PR_SET_CHILD_SUBREAPER')
    return previous.value


class OwnedTree:
    """Retain ancestry ownership across setsid, reparenting and parent exit."""

    def __init__(self, root_pid, baseline, adopt):
        self.root_pid = root_pid
        self.baseline = {(r['pid'], r['start_id']) for r in baseline}
        self.adopt = adopt
        self.known = {}
        self.groups = set()
        root = process_row(root_pid)
        if root:
            self.known[(root_pid, root['start_id'])] = root

    def observe(self):
        table = process_table()
        live = {r['pid']: r for r in table}
        changed = True
        while changed:
            changed = False
            for row in table:
                identity = (row['pid'], row['start_id'])
                parent = live.get(row['ppid'])
                parent_owned = parent and (parent['pid'], parent['start_id']) in self.known
                adopted = (self.adopt and row['ppid'] == os.getpid()
                           and identity not in self.baseline)
                if identity not in self.known and (parent_owned or adopted):
                    self.known[identity] = row
                    changed = True
        rows = [r for r in table if (r['pid'], r['start_id']) in self.known]
        for row in rows:
            self.known[(row['pid'], row['start_id'])] = row
            self.groups.add(row['pgid'])
        return rows

    def signal(self, rows, sig):
        for row in reversed(rows):
            signal_identity(row, sig)

    def reap(self):
        if not self.adopt:
            return
        # Only our own identity-owned, adopted children; never waitpid(-1), which
        # could consume the Popen root's status or an unrelated caller's child.
        for pid, start in self.known:
            if pid == self.root_pid:
                continue
            current = process_row(pid, include_zombie=True)
            if not (current and current['start_id'] == start
                    and current.get('zombie') and current['ppid'] == os.getpid()):
                continue
            # An unreaped zombie cannot recycle its PID before this wait.
            try:
                os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                pass


def supervise(command, cwd, output, seconds=LIMIT):
    """Return timeout distinctly; budget the WHOLE call, including observation."""
    started = time.monotonic()
    deadline = started + seconds
    output.mkdir(parents=True)
    home = output / 'home'
    home.mkdir()
    hook = output / 'preload.mjs'
    hook.write_text(HOOK)
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CI': '1',
           'TERM': 'xterm-256color', 'LOCAL_OPERATOR_CONFIG_DIR': str(home / '.local-operator'),
           'PROBE_EVIDENCE': str(output), 'NODE_OPTIONS': f'--import={hook}'}
    # Fail before launch if Linux cannot provide identity-safe signaling.
    if sys.platform == 'linux' and not (
            hasattr(os, 'pidfd_open') and hasattr(signal, 'pidfd_send_signal')):
        raise RuntimeError('Linux pidfd support is required for safe ownership cleanup')
    if sys.platform == 'linux':
        # Attribute presence alone is not kernel/seccomp capability. Probe our
        # own identity with signal zero BEFORE starting a child we must reap.
        fd = os.pidfd_open(os.getpid())
        try:
            signal.pidfd_send_signal(fd, 0)
        finally:
            os.close(fd)
    before = time.monotonic()
    baseline = process_table()
    baseline_cost = time.monotonic() - before
    previous_subreaper = subreaper(True)
    # Observation and identity-safe signals are work, not free checks. Reserve
    # time BEFORE the deadline rather than scheduling serial reads/signals in
    # the final second. Short controls use the same policy as the 300s probe;
    # Linux's cheap procfs path normally reserves six seconds, not 75% of 300s.
    reserve = min(seconds * 0.75, max(6.0, baseline_cost * 12))
    report_at = deadline - reserve
    term_at = deadline - reserve * 0.8
    kill_at = deadline - reserve * 0.55
    costs = {'census_count': 1, 'census_total': baseline_cost,
             'census_max': baseline_cost, 'signal_count': 0,
             'signal_total': 0.0, 'signal_max': 0.0}

    def send(row, sig):
        before = time.monotonic()
        try:
            return signal_identity(row, sig)
        finally:
            duration = time.monotonic() - before
            costs['signal_count'] += 1
            costs['signal_total'] += duration
            costs['signal_max'] = max(costs['signal_max'], duration)

    def observe(tree):
        before = time.monotonic()
        try:
            return tree.observe()
        finally:
            duration = time.monotonic() - before
            costs['census_count'] += 1
            costs['census_total'] += duration
            costs['census_max'] = max(costs['census_max'], duration)
    # A nonblocking pipe drains even a deliberately noisy negative control without
    # keeping raw output on disk; only its byte count is retained below.
    read_fd, write_fd = os.pipe()
    os.set_blocking(read_fd, False)
    try:
        proc = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                                stdout=write_fd, stderr=write_fd)
    except BaseException:
        os.close(read_fd)
        os.close(write_fd)
        if previous_subreaper is not None:
            subreaper(previous_subreaper)
        raise
    os.close(write_fd)
    pgid = proc.pid
    tree = OwnedTree(proc.pid, baseline, previous_subreaper is not None)
    samples, total_bytes = [], 0
    requested = terminated = killed = timed_out = False
    report_requests, term_requests, kill_requests = set(), set(), set()
    last_rows = None
    last_sample = -2
    try:
        while True:
            elapsed = time.monotonic() - started
            # Bound each drain iteration so noise cannot starve the deadline.
            for _ in range(32):
                try:
                    block = os.read(read_fd, 65536)
                    if not block:
                        break
                    total_bytes += len(block)
                except BlockingIOError:
                    break
            rows = observe(tree)
            last_rows = rows
            tree.reap()
            elapsed = time.monotonic() - started
            if elapsed - last_sample >= 1 or not rows:
                samples.append({'seconds': round(elapsed, 3), 'members': rows})
                last_sample = elapsed
            rc = proc.poll()
            if rc is not None and not rows:
                break
            # Snapshot and cleanup time belong INSIDE the original cap. Re-scan
            # throughout teardown: a detached late child is still ours, not a
            # new independent group to ignore. Never depend on the keeper doing
            # our cleanup or on the outer coordinator's exit as proof of it.
            if time.monotonic() >= report_at:
                if not requested:
                    requested = True
                    samples.append({'seconds': round(elapsed, 3), 'pre_reap': rows})
                for row in rows:
                    identity = (row['pid'], row['start_id'])
                    if (identity not in report_requests and row['node']
                            and (output / f"node-{row['pid']}.jsonl").exists()):
                        if send(row, signal.SIGUSR2):
                            report_requests.add(identity)
            term_sent_this_scan = False
            if time.monotonic() >= term_at:
                terminated = timed_out = True
                for row in reversed(rows):
                    identity = (row['pid'], row['start_id'])
                    if identity not in term_requests:
                        send(row, signal.SIGTERM)
                        term_requests.add(identity)
                        term_sent_this_scan = True
            # TERM may have consumed the remaining grace period. Re-observe
            # before KILL instead of serially revalidating already-dead rows;
            # that same scan must discover children created by TERM handlers.
            if time.monotonic() >= kill_at and not term_sent_this_scan:
                killed = timed_out = True
                for row in reversed(rows):
                    identity = (row['pid'], row['start_id'])
                    if identity not in kill_requests:
                        send(row, signal.SIGKILL)
                        kill_requests.add(identity)
            # Leave a small reserve for the final all-owned-groups census and
            # serialization. There is deliberately no extra five-second wait.
            if time.monotonic() >= deadline - 0.2:
                timed_out = True
                break
            time.sleep(0.025)
    finally:
        # Cleanup must still run if a census itself failed. Every cached row is
        # revalidated through pidfd before signaling, never trusted as a PID.
        # A successful empty census already proves every owned group is gone:
        # re-signaling all historical PIDs would serially revalidate dead PIDs
        # and spend the cleanup reserve on work that cannot change the result.
        cleanup_rows = last_rows if last_rows is not None else list(tree.known.values())
        for row in reversed(cleanup_rows):
            identity = (row['pid'], row['start_id'])
            if identity not in kill_requests:
                send(row, signal.SIGKILL)
        while proc.poll() is None and time.monotonic() < deadline - 0.1:
            time.sleep(0.005)
        tree.reap()
        os.close(read_fd)
        if previous_subreaper is not None:
            subreaper(previous_subreaper)
    # A fresh final census also catches adoption/fork races at the last scan;
    # the reserve pays for it, rather than claiming an empty outer group is proof.
    survivors = observe(tree)
    tree.reap()
    owned_groups = sorted(tree.groups)
    result = {'status': 'timeout' if timed_out else 'completed',
              'exit_code': 124 if timed_out else proc.returncode,
              'seconds': round(time.monotonic() - started, 3),
              'pgid': pgid, 'discarded_output_bytes': total_bytes,
              'survivors': survivors, 'samples': samples,
              'owned_groups': owned_groups,
              'owned_identities': list(tree.known.values()),
              'report_requests': [{'pid': pid, 'start_id': start}
                                  for pid, start in sorted(report_requests)],
              'term_sent': terminated, 'kill_sent': killed,
              'deadline_seconds': seconds, 'cleanup_reserve': round(reserve, 3),
              'operation_costs': {key: round(value, 6) for key, value in costs.items()}}
    if survivors:
        result.update(status='cleanup-failure', exit_code=126)
    elif time.monotonic() >= deadline:
        result.update(status='deadline-failure', exit_code=127)
    write_json(output / 'result.json', result)
    return result


def instrument(root, names):
    """Fail closed if pinned fixtures no longer match the intended checkpoints."""
    for name in names:
        path = root / 'scripts' / f'{name}.test.mjs'
        source = path.read_text()
        prefix = f"globalThis.__probe('file-start', {{file: '{path.name}'}});\n"
        if name in ('child-reader-foot-react', 'run-child-reader'):
            old = 'import { renderToStaticMarkup } from "react-dom/server";'
            if source.count(old) != 1 or source.count('const bundle = await build({') != 1:
                raise RuntimeError('render/build checkpoint source mismatch')
            source = source.replace(old, old.replace('renderToStaticMarkup }', 'renderToStaticMarkup as originalRender }') + '''
function renderToStaticMarkup(...args) {
  globalThis.__probe('render-start');
  try { return originalRender(...args); }
  finally { globalThis.__probe('render-end'); }
}
''')
            source = source.replace('const bundle = await build({',
                                    "globalThis.__probe('build-start');\nconst bundle = await build({")
            anchor = 'const CACHE = join(' if name == 'child-reader-foot-react' else 'const bundlePath = new URL('
            if source.count(anchor) != 1:
                raise RuntimeError('build-end checkpoint source mismatch')
            source = source.replace(anchor, "globalThis.__probe('build-end');\n" + anchor)
            # Every dynamic import gets a start marker. A module-ready marker
            # after the last import discriminates an import stall from rendering.
            source = source.replace('await import(', "await (globalThis.__probe('import-start'), import(")
            # Both pinned fixtures have exactly these closing forms.
            if name == 'child-reader-foot-react':
                source = source.replace('pathToFileURL(bundlePath).href\n);', 'pathToFileURL(bundlePath).href\n));')
                source = source.replace('"@tanstack/react-query"\n);', '"@tanstack/react-query"\n));')
                ready = 'const h = React.createElement;'
            else:
                source = source.replace('import(bundlePath.href));', 'import(bundlePath.href)));')
                ready = 'const READ_ONLY_FOOTER ='
            if source.count(ready) != 1:
                raise RuntimeError('module-ready checkpoint source mismatch')
            source = source.replace(ready, "globalThis.__probe('imports-end');\n" + ready)
        path.write_text(prefix + source + "\nglobalThis.__probe('file-assertions-registered');\n")
        subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)


def identity_controls(signal_fn=signal_identity):
    """Synthetic PID reuse/ancestry negatives; no real external PID is signaled."""
    def row(pid, parent, group, start=1):
        return {'pid': pid, 'ppid': parent, 'pgid': group, 'start_id': start,
                'cpu_seconds': 0, 'rss_kib': 1, 'node': True}
    initial = [row(101, 99, 101), row(102, 101, 102), row(103, 102, 102),
               row(104, 101, 104), row(900, 99, 900)]
    with patch.dict(globals(), process_row=lambda pid: initial[0],
                    process_table=lambda: initial):
        tree = OwnedTree(101, [], False)
        assert {r['pid'] for r in tree.observe()} == {101, 102, 103, 104}
    # Parent exit/reparenting retains known identity; same PID with a new start
    # identity in an unrelated tree must never be claimed or signaled.
    later = [row(102, 1, 102), row(103, 999, 900, start=2), row(104, 1, 104)]
    with patch.dict(globals(), process_table=lambda: later):
        assert {r['pid'] for r in tree.observe()} == {102, 104}
    fd = os.open(os.devnull, os.O_RDONLY)
    with patch.object(os, 'pidfd_open', return_value=fd, create=True), \
            patch.dict(globals(), process_row=lambda pid: later[1]), \
            patch.object(signal, 'pidfd_send_signal', create=True) as send:
        assert not signal_fn(initial[2], signal.SIGKILL)
        send.assert_not_called()
    fd = os.open(os.devnull, os.O_RDONLY)
    with patch.object(os, 'pidfd_open', return_value=fd, create=True), \
            patch.dict(globals(), process_row=lambda pid: initial[2]), \
            patch.object(signal, 'pidfd_send_signal', create=True) as send:
        assert signal_fn(initial[2], signal.SIGUSR2)
        send.assert_called_once_with(fd, signal.SIGUSR2)
    print('PASS detached ancestry / reparenting / recycled-PID refusal / pinned signal', flush=True)


def control_run(command, root, output, seconds):
    # Result timestamps alone can hide setup/final-serialization cost. The
    # regression measures the whole public supervisor call from its caller.
    before = time.monotonic()
    result = supervise(command, root, output, seconds)
    result['whole_call_seconds'] = round(time.monotonic() - before, 6)
    write_json(output / 'result.json', result)
    assert result['whole_call_seconds'] <= seconds, result['whole_call_seconds']
    return result


def coordinator_controls(output, roots):
    """Run the real frozen topology, not a lookalike direct-child substitute."""
    # Built-in-only runtime closure, including the URL-based preloader/keeper
    # imports that a static `from` import walker alone would incorrectly omit.
    files = ['run-desktop-tests', 'desktop-test-keeper', 'no-hardlink-write-preload',
             'no-hardlink-write', 'desktop-test-concurrency', 'desktop-test-lane-bound',
             'desktop-test-memory-guard', 'notifications-off', 'telemetry-off']
    for source in roots:
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        label = next((name for name, ref in REFS.items() if ref == sha), None)
        if label is None:
            raise RuntimeError('coordinator regression requires an immutable target ref')
        root = output / f'coordinator-{label}'
        (root / 'scripts').mkdir(parents=True)
        hashes = {}
        for name in files:
            original = (source / 'scripts' / f'{name}.mjs').read_bytes()
            (root / 'scripts' / f'{name}.mjs').write_bytes(original)
            hashes[name] = hashlib.sha256(original).hexdigest()
        fixture = root / 'scripts' / 'retained-probe.test.mjs'
        fixture.write_text("import {test} from 'node:test'; import assert from 'node:assert/strict';\n"
                           "test('retained assertion',()=>{assert.equal(1,1);"
                           "globalThis.__probe('retained-worker');setInterval(()=>{},1000);});\n")
        reporter = root / 'reporter.mjs'
        reporter.write_text(REPORTER)
        evidence = output / f'retained-{label}'
        result = control_run(['node', 'scripts/run-desktop-tests.mjs', '--test-concurrency=1',
                            f'--test-reporter={reporter}', str(fixture)], root, evidence, 8)
        events = [json.loads(line) for path in evidence.glob('node-*.jsonl')
                  for line in path.read_text().splitlines()]
        workers = {e['pid'] for e in events if e['stage'] == 'retained-worker'}
        reported = {e['pid'] for e in events if e['stage'] == 'pre-reap-report'}
        sampled = {r['pid'] for sample in result['samples'] for r in sample.get('members', [])}
        passed = sum(e['stage'] == 'test:pass' for e in events)
        result.update(source_sha=sha, coordinator_sha256=hashes,
                      retained_worker_pids=sorted(workers), passed_assertions=passed,
                      worker_sampled=bool(workers and workers <= sampled),
                      worker_reported=bool(workers and workers <= reported))
        write_json(evidence / 'result.json', result)
        assert result['status'] == 'timeout' and result['exit_code'] == 124
        assert result['seconds'] <= 8 and not result['survivors']
        assert workers and workers <= reported and workers <= sampled and passed > 0
        assert len(result['owned_groups']) >= 3
        print(f'PASS frozen {label} retained assertion: worker sampled/reported, all owned groups reaped', flush=True)


def controls(output):
    if not Path('/proc/self/stat').exists():
        raise RuntimeError('probe requires Linux procfs; local macOS is syntax-only')
    output.mkdir(parents=True)
    identity_controls()
    with tempfile.TemporaryDirectory(dir=output) as temp:
        root = Path(temp)
        child = root / 'child.mjs'
        child.write_text("import {spawn} from 'node:child_process';\n"
                         "spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});\n"
                         "setInterval(()=>process.stdout.write('x'.repeat(16384)),1);\n")
        slow = control_run(['node', str(child)], root, output / 'slow-noisy', 4)
        ok = control_run(['node', '-e', 'console.log("natural completion")'], root, output / 'natural', 4)
        bad = control_run(['node', '-e', 'process.exitCode=7'], root, output / 'failure', 4)
        snapshots = list((output / 'slow-noisy').glob('node-*.jsonl'))
        reports = [line for path in snapshots for line in path.read_text().splitlines()
                   if json.loads(line)['stage'] == 'pre-reap-report']
        assert slow['status'] == 'timeout' and slow['exit_code'] == 124
        assert slow['whole_call_seconds'] <= 4 and slow['discarded_output_bytes'] > 65536
        assert not slow['survivors'] and len(reports) >= 2
        assert ok['status'] == 'completed' and ok['exit_code'] == 0
        assert bad['status'] == 'completed' and bad['exit_code'] == 7
        reporter = root / 'reporter.mjs'
        reporter.write_text(REPORTER)
        case = root / 'observer.test.mjs'
        case.write_text("import {test} from 'node:test';\n"
                        "globalThis.__probe('file-start', {file:'observer.test.mjs'});\n"
                        "test('control', () => {});\n")
        observed = control_run(['node', '--test', f'--test-reporter={reporter}', str(case)],
                             root, output / 'reporter', 8)
        events = [json.loads(line) for path in (output / 'reporter').glob('node-*.jsonl')
                  for line in path.read_text().splitlines()]
        assert observed['exit_code'] == 0
        assert any(e['stage'] == 'test:pass' and e.get('file') == case.name for e in events)
        assert all('environmentVariables' not in str(e) for e in events + reports)
        # Same late-detached-child topology as independent round-2 QA: TERM
        # creates a new process group, so stopping discovery at TERM is wrong.
        late_code = (
            "import {spawn} from 'node:child_process';"
            "process.on('SIGTERM',()=>{globalThis.__probe('late-parent');"
            "spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});"
            "globalThis.__probe('late-child');setInterval(()=>{},1000)\"],"
            "{detached:true,stdio:'ignore'});});setInterval(()=>{},1000)"
        )
        late_output = output / 'late-cleanup'
        late = control_run(['node', '--input-type=module', '-e', late_code],
                           root, late_output, 8)
        events = [json.loads(line) for path in late_output.glob('node-*.jsonl')
                  for line in path.read_text().splitlines()]
        children = {e['pid'] for e in events if e['stage'] == 'late-child'}
        reported = {e['pid'] for e in events if e['stage'] == 'pre-reap-report'}
        assert children and children <= reported
        assert children <= {row['pid'] for row in late['owned_identities']}
        assert late['exit_code'] == 124 and not late['survivors']
        assert len(late['owned_groups']) >= 2
        print('PASS whole-call bounds / noisy descendants / reporter / late detached child report and reap', flush=True)


def run(root, label, phase, output):
    if not Path('/proc/self/stat').exists():
        raise RuntimeError('hosted experiment requires Linux procfs')
    version = subprocess.check_output(['node', '--version'], text=True).strip()
    if not version.startswith('v22.'):
        raise RuntimeError('hosted experiment requires Node 22')
    expected = REFS[label]
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if actual != expected:
        raise RuntimeError('immutable source identity mismatch')
    names = SINGLE if phase == 'single' else TRIO
    instrument(root, names)
    reporter = output.parent / 'reporter.mjs'
    reporter.write_text(REPORTER)
    command = ['node', 'scripts/run-desktop-tests.mjs',
               f'--test-concurrency={1 if phase == "single" else 3}',
               f'--test-reporter={reporter}', *[f'scripts/{name}.test.mjs' for name in names]]
    result = supervise(command, root, output)
    events = [json.loads(line) for path in output.glob('node-*.jsonl')
              for line in path.read_text().splitlines()]
    coverage = {}
    for name in names:
        file = f'{name}.test.mjs'
        coverage[file] = {
            'started': any(e['stage'] == 'file-start' and e.get('file') == file for e in events),
            'passed_assertions': sum(e['stage'] == 'test:pass' and e.get('file') == file
                                     for e in events),
        }
    # Exit zero with no observed assertions is an instrument/setup failure,
    # never evidence that either single completed its intended cases.
    if result['exit_code'] == 0 and not all(
            item['started'] and item['passed_assertions'] > 0 for item in coverage.values()):
        result.update(status='observer-failure', exit_code=125)
    result.update({'coverage': coverage, 'label': label, 'phase': phase, 'source_sha': actual,
                   'probe_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   'node': subprocess.check_output(['node', '--version'], text=True).strip()})
    write_json(output / 'result.json', result)
    print(json.dumps({k: v for k, v in result.items() if k not in ('samples', 'survivors')}), flush=True)
    return result['exit_code']


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['self-test', 'run'])
    parser.add_argument('--root', type=Path)
    parser.add_argument('--label', choices=REFS)
    parser.add_argument('--phase', choices=['single', 'trio'])
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--coordinator-root', type=Path, action='append', default=[])
    args = parser.parse_args()
    args.output = args.output.resolve()
    if args.mode == 'self-test':
        controls(args.output)
        if {subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
                for root in args.coordinator_root} != set(REFS.values()):
            parser.error('self-test requires both immutable --coordinator-root checkouts')
        coordinator_controls(args.output, [root.resolve() for root in args.coordinator_root])
    else:
        if not all((args.root, args.label, args.phase)):
            parser.error('run requires root, label and phase')
        raise SystemExit(run(args.root.resolve(), args.label, args.phase, args.output))
