#!/usr/bin/env python3
"""Disposable Linux/Node22 retention experiment; never a suite runner or fix.

Only allowlisted structured evidence leaves a child. Raw stdout/stderr and Node
report environment/command fields may contain credentials, so neither is stored.
Identity-owned descendants across detached groups, not a name-pattern kill,
are the observation and cleanup boundary.
"""

import argparse
from collections import deque
from contextlib import redirect_stdout
import ctypes
import hashlib
import shlex
import io
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
from unittest.mock import patch

REFS = {
    "avatar": "2c0f276d0ead12e6b8664f550468b8217bbe506d",
    "telemetry": "47cf454be2efe3a0c30e27063d57845ae5ba7171",
}
# This is the actual adjacent trio from the timed-out CI tail. The earlier
# run-child-reader trio was different coverage, not a successful test of this set.
TARGETS = ["child-reader-foot-react", "ci-scope", "code-review-model"]
LIMIT = 300  # Historical isolated-trio controls; not a full-suite budget.
HISTORY_HEAD = REFS['avatar']
HISTORY_INDEX = 3
HISTORY_TOTAL = 656
HISTORY_COUNT = 164
HISTORY_DIGEST = '67cb42902bb14a6328b7c43347e23f19870b3fe0362f23c408900c11945a46e6'
HISTORY_LIMIT = 600
HISTORY_MEMORY_MB = 9728
COORDINATOR_FILES = ['run-desktop-tests', 'desktop-test-keeper', 'no-hardlink-write-preload',
                     'no-hardlink-write', 'desktop-test-concurrency', 'desktop-test-lane-bound',
                     'desktop-test-memory-guard', 'notifications-off', 'telemetry-off']

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


class TapSummary:
    """Bounded structural spool: never retain test names/diagnostics/raw output."""

    def __init__(self):
        self.pending = b''
        self.dropping = False
        self.counts = {'tests': None, 'pass': None, 'fail': None,
                       'cancelled': None, 'skipped': None, 'todo': None}
        self.records = deque(maxlen=128)
        self.ok_events = self.not_ok_events = 0
        self.runner_files, self.runner_widths = [], []

    def feed(self, data):
        parts = data.split(b'\n')
        for index, part in enumerate(parts):
            if not self.dropping:
                if len(self.pending) + len(part) > 4096:
                    self.pending = b''
                    self.dropping = True
                else:
                    self.pending += part
            if index == len(parts) - 1:
                continue
            if not self.dropping:
                line = self.pending.decode('ascii', errors='ignore').strip()
                runner = re.match(r'^desktop tests: ([0-9]{1,6}) files?, concurrency ([0-9]{1,3})(?: |$)', line)
                if runner and len(self.runner_files) < 4:
                    self.runner_files.append(int(runner[1]))
                    self.runner_widths.append(int(runner[2]))
                count = re.fullmatch(r'# (tests|pass|fail|cancelled|skipped|todo) ([0-9]{1,9})', line)
                event = re.fullmatch(r'(not ok|ok) ([0-9]{1,9})(?: - .*|)', line)
                if count:
                    self.counts[count[1]] = int(count[2])
                elif event:
                    self.records.append({'kind': event[1], 'number': int(event[2])})
                    if event[1] == 'ok':
                        self.ok_events += 1
                    else:
                        self.not_ok_events += 1
            self.pending = b''
            self.dropping = False

    def summary(self):
        return {**self.counts, 'ok_events': self.ok_events,
                'not_ok_events': self.not_ok_events, 'records': list(self.records),
                'runner_files': self.runner_files, 'runner_widths': self.runner_widths}


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


def external_environment(home):
    # Intentionally NO diagnostic NODE_OPTIONS, PROBE_EVIDENCE or report flags.
    # The existing runner still supplies its production hardlink/lane/memory guards.
    return {'PATH': os.environ['PATH'], 'HOME': str(home), 'CI': '1',
            'TERM': 'xterm-256color', 'LOCAL_OPERATOR_CONFIG_DIR': str(home / '.local-operator'),
            'LOCAL_OPERATOR_UI_TEST_CONCURRENCY': '3',
            'LOCAL_OPERATOR_UI_TEST_MEMORY_BUDGET_MB': str(HISTORY_MEMORY_MB)}


def cmdline_tokens(pid):
    try:
        with (Path('/proc') / str(pid) / 'cmdline').open('rb') as stream:
            raw = stream.read(65537)
    except (FileNotFoundError, ProcessLookupError):
        return []
    if len(raw) > 65536:
        return None  # Unknown/truncated, never a partial-token file match.
    return [part.decode('utf-8', errors='replace') for part in raw.split(b'\0') if part]


def require_external_procfs():
    if (sys.platform != 'linux' or not Path('/proc/self/stat').exists()
            or process_row(os.getpid()) is None or not cmdline_tokens(os.getpid())):
        raise RuntimeError('external observation requires live native Linux procfs')


def memory_charge(row):
    # RSS alone misses swapped ownership. Charge conservatively against both
    # RSS and PSS+SwapPSS; never publish smaps text, paths or environment.
    values = {}
    try:
        with (Path('/proc') / str(row['pid']) / 'smaps_rollup').open() as stream:
            for line in stream:
                name, _, value = line.partition(':')
                if name in ('Pss', 'SwapPss'):
                    values[name] = int(value.split()[0])
    except (FileNotFoundError, ProcessLookupError):
        return row['rss_kib']  # Process may disappear between the two reads.
    if set(values) != {'Pss', 'SwapPss'}:
        raise RuntimeError('owned process memory accounting unavailable')
    return max(row['rss_kib'], values['Pss'] + values['SwapPss'])


def charged_memory(rows):
    observer = process_row(os.getpid())
    measured = list(rows)
    if observer and not any(row['pid'] == observer['pid'] for row in rows):
        measured.append(observer)
    return sum(memory_charge(row) for row in measured)


class WorkerHistory:
    """External observations, NOT exits/passes; ownership is kept by OwnedTree."""

    def __init__(self, root, files, output, max_events=4096):
        self.root, self.files, self.output = root, tuple(files), output
        self.lookup = {token: file for file in files for token in (file, str(root / file))}
        self.max_events = max_events
        self.workers, self.coordinators, self.owner = {}, set(), {}
        self.present, self.seen_files = set(), set()
        self.events = self.bytes = self.dropped = 0
        self.saturated = self.mapping_saturated = self.argv_saturated = False
        self.last_scan = None
        self.max_gap = self.scan_seconds = self.max_scan_seconds = self.write_seconds = 0.0
        self.scans = self.unclassified_nodes = 0
        self.before_stop = None

    @staticmethod
    def script_token(tokens):
        if not tokens or Path(tokens[0]).name != 'node':
            return None
        skip = False
        for token in tokens[1:]:
            if skip:
                skip = False
                continue
            if token in ('-e', '--eval', '-p', '--print', '-') or token.startswith(('--eval=', '--print=')):
                return None
            if token in ('--import', '--require', '-r', '--loader', '--conditions'):
                skip = True
            elif token == '--':
                continue
            elif not token.startswith('-'):
                return token
        return None

    @staticmethod
    def coordinator(tokens):
        return ('--test' in tokens and not any(token in ('-e', '--eval', '-p', '--print')
                or token.startswith(('--eval=', '--print=')) for token in tokens))

    def emit(self, value):
        line = json.dumps(value, separators=(',', ':')) + '\n'
        size = len(line.encode())
        if self.events >= self.max_events or self.bytes + size > 4 * 1024 * 1024:
            self.saturated = True
            self.dropped += 1
            return
        before = time.monotonic()
        with (self.output / 'worker-history.jsonl').open('a') as stream:
            stream.write(line)
        self.write_seconds += time.monotonic() - before
        self.events += 1
        self.bytes += size

    def scan(self, rows, elapsed):
        before = time.monotonic()
        if self.last_scan is not None:
            self.max_gap = max(self.max_gap, elapsed - self.last_scan)
        self.last_scan = elapsed
        self.scans += 1
        live = {row['pid']: row for row in rows}
        tokens = {}
        for row in rows:
            key = (row['pid'], row['start_id'])
            if row['node'] and key not in self.workers:
                argv = cmdline_tokens(row['pid'])
                if argv is None:
                    self.argv_saturated = True
                    argv = []
                tokens[key] = argv
                if self.coordinator(argv):
                    if len(self.coordinators) < 4096:
                        self.coordinators.add(key)
                    else:
                        self.mapping_saturated = True
                else:
                    self.coordinators.discard(key)
        for row in rows:
            key = (row['pid'], row['start_id'])
            if key in self.workers:
                continue
            argv = tokens.get(key, [])
            parent = live.get(row['ppid'])
            parent_key = (parent['pid'], parent['start_id']) if parent else None
            file = self.lookup.get(self.script_token(argv))
            matches = {self.lookup[token] for token in argv if token in self.lookup}
            if file and len(matches) == 1 and not self.coordinator(argv) and parent_key in self.coordinators:
                if len(self.workers) >= 1024:
                    self.mapping_saturated = True
                    continue
                self.workers[key] = {'file': file, 'row': row, 'last_emit': -2.0, 'cpu': 0.0}
                self.owner[key] = key
                self.seen_files.add(file)
            elif row['node'] and key not in self.coordinators:
                self.unclassified_nodes += 1
        # Keep descendant association after reparenting; current ancestry is used
        # only to admit a NEW identity, never to transfer a recycled PID.
        changed = True
        while changed:
            changed = False
            for row in rows:
                key = (row['pid'], row['start_id'])
                parent = live.get(row['ppid'])
                parent_key = (parent['pid'], parent['start_id']) if parent else None
                if key not in self.owner and parent_key in self.owner:
                    if len(self.owner) >= 32768:
                        self.mapping_saturated = True
                        continue
                    self.owner[key] = self.owner[parent_key]
                    changed = True
        present = {(row['pid'], row['start_id']) for row in rows}
        for key, worker in self.workers.items():
            current = next((row for row in rows if (row['pid'], row['start_id']) == key), None)
            family = [row for row in rows if self.owner.get((row['pid'], row['start_id'])) == key]
            disappeared = key in self.present and key not in present
            first = worker['last_emit'] < 0
            if not (first or disappeared or (family and elapsed - worker['last_emit'] >= 1)):
                continue
            row = current or worker['row']
            cpu = sum(item['cpu_seconds'] for item in family)
            self.emit({'event': 'FIRSTSEEN' if first else 'DISAPPEARED' if disappeared else 'LIVE',
                       'monotonic_seconds': round(elapsed, 6), 'file': worker['file'],
                       'pid': key[0], 'start_id': key[1], 'ppid': row['ppid'], 'pgid': row['pgid'],
                       'worker_present': current is not None, 'descendants': len(family) - int(current is not None),
                       'cpu_seconds': row['cpu_seconds'], 'family_cpu_seconds': cpu,
                       'cpu_delta_seconds': 0 if first else max(0, cpu - worker['cpu']),
                       'rss_kib': row['rss_kib'], 'family_rss_kib': sum(item['rss_kib'] for item in family),
                       'disappearance_is_not_exit_or_pass': True})
            worker.update(last_emit=elapsed, cpu=cpu, row=row)
        self.present = present
        duration = time.monotonic() - before
        self.scan_seconds += duration
        self.max_scan_seconds = max(self.max_scan_seconds, duration)

    def capture_stop(self, reason, elapsed, tap):
        if self.before_stop is None:
            candidates = [{'file': worker['file'], 'pid': key[0], 'start_id': key[1],
                           'last_checkpoint_age_seconds': max(0, elapsed - worker['last_emit'])}
                          for key, worker in self.workers.items() if key in self.present]
            self.before_stop = {'reason': reason, 'monotonic_seconds': elapsed,
                                'live_worker_candidates': candidates[:128],
                                'candidate_list_truncated': len(candidates) > 128,
                                'tap_ok_events': tap.ok_events, 'candidates_are_not_causes': True}

    def summary(self):
        return {'files_seen': sorted(self.seen_files), 'selected_count': len(self.files),
                'unseen_selected': sorted(set(self.files) - self.seen_files),
                'short_workers_may_be_missed': True, 'disappearance_is_not_exit_or_pass': True,
                'checkpoint_saturated': self.saturated, 'mapping_saturated': self.mapping_saturated,
                'argv_observation_saturated': self.argv_saturated,
                'checkpoints': self.events, 'dropped_checkpoints': self.dropped,
                'checkpoint_bytes': self.bytes, 'observation_count': self.scans,
                'max_sampling_gap_seconds': self.max_gap, 'unclassified_node_observations': self.unclassified_nodes,
                'observer_scan_seconds': self.scan_seconds, 'max_observer_scan_seconds': self.max_scan_seconds,
                'checkpoint_write_seconds': self.write_seconds, 'nonzero_observer_perturbation': True,
                'before_observer_stop': self.before_stop,
                'unseen_reparenting_ancestry_cannot_be_attributed': True}


def supervise(command, cwd, output, seconds=LIMIT, history=None, memory_mb=None,
              absolute_deadline=None, capture=None):
    """Return timeout distinctly; budget the WHOLE call, including observation."""
    started = time.monotonic()
    deadline = min(started + seconds, absolute_deadline) if absolute_deadline is not None else started + seconds
    seconds = deadline - started
    if seconds < 0.3:
        raise TimeoutError('insufficient bounded process/cleanup budget; STOP before launch')
    output.mkdir(parents=True)
    home = output / 'home'
    home.mkdir()
    if history is not None:
        require_external_procfs()  # Refuse before any child if observation is unavailable.
        env = external_environment(home)
    else:
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
             'signal_total': 0.0, 'signal_max': 0.0,
             'memory_count': 0, 'memory_total': 0.0, 'memory_max': 0.0}

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
    tap = TapSummary()

    def drain():
        nonlocal total_bytes
        # Bound each drain so noise cannot starve the deadline. Parse only TAP
        # structure; a final drain must see summaries written during census.
        for _ in range(32):
            try:
                block = os.read(read_fd, 65536)
                if not block:
                    break
                total_bytes += len(block)
                if capture is not None:
                    # Private return buffer for metadata only; NEVER serialized.
                    capture.extend(block[:max(0, 1048576 - len(capture))])
                tap.feed(block)
            except BlockingIOError:
                break

    requested = terminated = killed = timed_out = False
    report_requests, term_requests, kill_requests = set(), set(), set()
    last_rows = None
    last_sample = -2
    peak_memory_kib = 0
    memory_tripped = False
    sample_frames_dropped = sample_rows_dropped = 0
    try:
        while True:
            elapsed = time.monotonic() - started
            drain()
            rows = observe(tree)
            last_rows = rows
            tree.reap()
            elapsed = time.monotonic() - started
            if history is not None:
                history.scan(rows, elapsed)
            if memory_mb is not None:
                memory_before = time.monotonic()
                try:
                    peak_memory_kib = max(peak_memory_kib, charged_memory(rows))
                finally:
                    memory_duration = time.monotonic() - memory_before
                    costs['memory_count'] += 1
                    costs['memory_total'] += memory_duration
                    costs['memory_max'] = max(costs['memory_max'], memory_duration)
                if peak_memory_kib >= memory_mb * 1024:
                    memory_tripped = True
                    if history is not None:
                        history.capture_stop('memory-limit', elapsed, tap)
                    for row in reversed(rows):
                        identity = (row['pid'], row['start_id'])
                        if identity not in kill_requests and send(row, signal.SIGKILL):
                            killed = True
                            kill_requests.add(identity)
                    break
            if elapsed - last_sample >= 1 or not rows:
                sampled = rows if history is None else rows[:128]
                samples.append({'seconds': round(elapsed, 3), 'members': sampled})
                if history is not None:
                    sample_rows_dropped += max(0, len(rows) - 128)
                    if len(samples) > 256:
                        samples.pop(0)
                        sample_frames_dropped += 1
                last_sample = elapsed
            rc = proc.poll()
            if rc is not None and not rows:
                break
            # Snapshot and cleanup time belong INSIDE the original cap. Re-scan
            # throughout teardown: a detached late child is still ours, not a
            # new independent group to ignore. Never depend on the keeper doing
            # our cleanup or on the outer coordinator's exit as proof of it.
            if history is None and time.monotonic() >= report_at:
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
                if history is not None:
                    history.capture_stop('ceiling', elapsed, tap)
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
        drain()
        os.close(read_fd)
        if previous_subreaper is not None:
            subreaper(previous_subreaper)
    # A fresh final census also catches adoption/fork races at the last scan;
    # the reserve pays for it, rather than claiming an empty outer group is proof.
    survivors = observe(tree)
    tree.reap()
    if history is not None:
        history.scan(survivors, time.monotonic() - started)
    owned_groups = sorted(tree.groups)
    result = {'status': 'timeout' if timed_out else 'completed',
              'exit_code': 124 if timed_out else proc.returncode,
              'root_process_returncode': proc.returncode,  # Never a per-file worker exit claim.
              'seconds': round(time.monotonic() - started, 3),
              'pgid': pgid, 'discarded_output_bytes': total_bytes,
              'tap': tap.summary(),
              'survivors': survivors if history is None else survivors[:128], 'samples': samples,
              'owned_groups': owned_groups,
              'owned_identities': list(tree.known.values()) if history is None else list(tree.known.values())[:4096],
              'report_requests': [{'pid': pid, 'start_id': start}
                                  for pid, start in sorted(report_requests)],
              'term_sent': terminated, 'kill_sent': killed,
              'deadline_seconds': seconds, 'cleanup_reserve': round(reserve, 3),
              'operation_costs': {key: round(value, 6) for key, value in costs.items()}}
    if history is not None:
        result.update(external_history=history.summary(), diagnostic_preloads=False,
                      diagnostic_report_signals=False, peak_charged_memory_kib=peak_memory_kib,
                      memory_limit_mb=memory_mb, sample_frames_dropped=sample_frames_dropped,
                      sample_rows_dropped=sample_rows_dropped,
                      owned_identity_records_truncated=max(0, len(tree.known) - 4096),
                      survivors_count=len(survivors), survivor_records_truncated=max(0, len(survivors) - 128))
    if memory_tripped:
        result.update(status='memory-limit', exit_code=137)
    if survivors:
        result.update(status='cleanup-failure', exit_code=126)
    elif time.monotonic() >= deadline:
        result.update(status='deadline-failure', exit_code=127)
    write_json(output / 'result.json', result)
    return result


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


def plan_controls(output):
    """Decision/redaction negatives only; these mocks never execute target files."""
    output.mkdir(parents=True)
    reporter = Path('/synthetic/reporter.mjs')
    pristine = target_command('pristine', reporter)
    custom = target_command('custom', reporter)
    assert [arg for arg in custom if not arg.startswith('--test-reporter=')] == pristine
    assert not any('--test-reporter' in arg for arg in pristine)
    assert [arg for arg in pristine if arg.endswith('.test.mjs')] == [
        'scripts/child-reader-foot-react.test.mjs', 'scripts/ci-scope.test.mjs',
        'scripts/code-review-model.test.mjs']
    scenarios = [('both-pass', [0, 0], ['pristine', 'pristine'], 0),
                 ('timeout', [124, 0, 0, 0], ['pristine', 'pristine', 'custom', 'custom'], 124)]
    scenarios += [(f'failure-{code}', [code], ['pristine'], code) for code in (1, 125, 126, 127)]
    scenarios.append(('natural-124', [124], ['pristine'], 124))
    for name, codes, expected_phases, expected_exit in scenarios:
        calls = []
        returns = iter(codes)

        def fake(root, label, phase, out):
            calls.append(phase)
            code = next(returns)
            return {'label': label, 'phase': phase, 'exit_code': code,
                    'status': 'timeout' if code == 124 and name != 'natural-124' else 'completed'}

        # Synthetic gate outcomes are not real target NOT_REPRODUCED results.
        # Keep them out of native-job stdout; the parent proof labels them mocks.
        with patch.dict(globals(), run=fake), redirect_stdout(io.StringIO()):
            code = compare({'avatar': output, 'telemetry': output}, output / name)
        assert calls == expected_phases and code == expected_exit
        summary_path = output / name / 'comparison.json'
        summary = json.loads(summary_path.read_text())
        summary.update(synthetic_plan_control=True, target_execution=False)
        write_json(summary_path, summary)
    tap = TapSummary()
    for _ in range(2000):
        tap.feed(b'ok 1 - SYNTHETIC_SECRET_PAYLOAD\n')
    tap.feed(b'x' * 1000000 + b'\n# tests 3\n# pass 3\n# fail 0\n')
    summary = tap.summary()
    assert summary['tests'] == 3 and summary['pass'] == 3 and summary['fail'] == 0
    assert len(summary['records']) <= 128 and len(tap.pending) <= 4096
    assert 'SYNTHETIC_SECRET' not in json.dumps(summary)
    ticks = iter([0.0, 8.25])
    rejected = False
    # Mock only the boundary/clock object, never the real shared system clock.
    # This negative must fail the exact caller-bound check without a child.
    with patch.dict(globals(), time=SimpleNamespace(monotonic=lambda: next(ticks)),
                    supervise=lambda *args: {'exit_code': 124}, write_json=lambda *args: None):
        try:
            control_run([], output, output / 'overrun', 8)
        except AssertionError:
            rejected = True
    assert rejected
    write_json(output / 'result.json', {'plan_negatives': 'PASS', 'tap_redaction': 'PASS',
                                       'whole_call_overrun_refused': True,
                                       'target_argv': pristine, 'target_execution': False})
    print('PASS exact-trio / no-extra-arm / timeout-only gate / bounded redacted TAP spool', flush=True)


def coordinator_controls(output, roots):
    """Actual frozen worker positive/negative controls for BOTH reporters first."""
    for source in roots:
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        label = next((name for name, ref in REFS.items() if ref == sha), None)
        if label is None:
            raise RuntimeError('coordinator regression requires an immutable target ref')
        root = output / f'coordinator-{label}'
        (root / 'scripts').mkdir(parents=True)
        hashes = {}
        for name in COORDINATOR_FILES:
            file = f'scripts/{name}.mjs'
            original = (source / file).read_bytes()
            if original != subprocess.check_output(['git', 'show', f'{sha}:{file}'], cwd=source):
                raise RuntimeError('frozen coordinator source mismatch')
            (root / file).write_bytes(original)
            hashes[name] = hashlib.sha256(original).hexdigest()
        reporter = root / 'reporter.mjs'
        reporter.write_text(REPORTER)
        for phase in ('pristine', 'custom'):
            for case in ('retained', 'natural', 'failure'):
                fixture = root / 'scripts' / f'{case}-probe.test.mjs'
                # These are synthetic controls, NOT rewrites of target files.
                assertion = ('assert.equal(1,1);globalThis.__probe("retained-worker");'
                             'setInterval(()=>{},1000);' if case == 'retained' else
                             'assert.equal(1,1);globalThis.__probe("natural-worker");' if case == 'natural' else
                             'globalThis.__probe("failure-worker");assert.equal(1,2);')
                fixture.write_text("import {test} from 'node:test'; import assert from 'node:assert/strict';\n"
                                   f"test('SYNTHETIC_SECRET_PAYLOAD {case}',()=>{{{assertion}}});\n")
                command = ['node', 'scripts/run-desktop-tests.mjs', '--test-concurrency=1']
                if phase == 'custom':
                    command.append(f'--test-reporter={reporter}')
                command.append(str(fixture))
                evidence = output / f'{label}-{phase}-{case}'
                result = control_run(command, root, evidence, 8)
                events = read_events(evidence)
                assert 'SYNTHETIC_SECRET' not in json.dumps([result, events])
                workers = {e['pid'] for e in events if e['stage'] == f'{case}-worker'}
                reported = {e['pid'] for e in events if e['stage'] == 'pre-reap-report'}
                sampled = {r['pid'] for sample in result['samples'] for r in sample.get('members', [])}
                custom_pass = sum(e['stage'] == 'test:pass' for e in events)
                custom_fail = sum(e['stage'] == 'test:fail' for e in events)
                result.update(source_sha=sha, coordinator_sha256=hashes, reporter=phase,
                              actual_worker_pids=sorted(workers),
                              custom_passed_assertions=custom_pass, custom_failed_assertions=custom_fail,
                              worker_sampled=bool(workers and workers <= sampled),
                              worker_reported=bool(workers and workers <= reported))
                write_json(evidence / 'result.json', result)
                assert workers and not result['survivors']
                if case == 'retained':
                    assert result['status'] == 'timeout' and result['exit_code'] == 124
                    assert workers <= reported and workers <= sampled
                    assert len(result['owned_groups']) >= 3
                    # TAP may buffer file completion. The worker's marker is
                    # AFTER the real assertion; do not invent TAP progress.
                    if phase == 'custom':
                        assert custom_pass > 0
                elif case == 'natural':
                    assert result['exit_code'] == 0
                    assert custom_pass > 0 if phase == 'custom' else (
                        result['tap']['pass'] == 1 and result['tap']['fail'] == 0)
                else:
                    assert result['exit_code'] == 1
                    assert custom_fail > 0 if phase == 'custom' else result['tap']['fail'] == 1
                print(f'PASS frozen {label} {phase} actual-worker {case} control', flush=True)


def controls(output):
    if not Path('/proc/self/stat').exists():
        raise RuntimeError('probe requires Linux procfs; local macOS is syntax-only')
    output.mkdir(parents=True)
    identity_controls()
    plan_controls(output / 'plan-controls')
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


def target_command(phase, reporter):
    if phase not in ('pristine', 'custom'):
        raise ValueError('only pristine/default-TAP and matched custom arms are supported')
    command = ['node', 'scripts/run-desktop-tests.mjs', '--test-concurrency=3']
    if phase == 'custom':
        command.append(f'--test-reporter={reporter}')
    return command + [f'scripts/{name}.test.mjs' for name in TARGETS]


def source_manifest(root, sha):
    # Target fixtures and their runtime coordinator stay byte-pristine. Also
    # refuse any tracked app/script edits, not merely a matching HEAD label.
    subprocess.run(['git', 'diff', '--exit-code', '--quiet', 'HEAD', '--', 'src', 'scripts'],
                   cwd=root, check=True, capture_output=True)
    files = [f'scripts/{name}.test.mjs' for name in TARGETS]
    files += [f'scripts/{name}.mjs' for name in COORDINATOR_FILES]
    hashes = {}
    for file in files:
        expected = subprocess.check_output(['git', 'show', f'{sha}:{file}'], cwd=root)
        actual = (root / file).read_bytes()
        if actual != expected:
            raise RuntimeError(f'immutable source mismatch: {file}')
        hashes[file] = hashlib.sha256(actual).hexdigest()
    return hashes


def read_events(output):
    return [json.loads(line) for path in output.glob('node-*.jsonl')
            for line in path.read_text().splitlines()]


def run(root, label, phase, output):
    if not Path('/proc/self/stat').exists():
        raise RuntimeError('hosted experiment requires Linux procfs')
    version = subprocess.check_output(['node', '--version'], text=True).strip()
    if not version.startswith('v22.'):
        raise RuntimeError('hosted experiment requires Node 22')
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if actual != REFS[label]:
        raise RuntimeError('immutable source identity mismatch')
    before = source_manifest(root, actual)
    reporter = output.parent / 'reporter.mjs'
    if phase == 'custom':
        reporter.write_text(REPORTER)
    command = target_command(phase, reporter)
    # Both arms use the SAME reviewed observer preload. Only this explicit
    # reporter argument changes; no instrument() call or fixture writes occur.
    result = supervise(command, root, output)
    after = source_manifest(root, actual)
    if before != after:
        raise RuntimeError('target source changed during arm')
    events = read_events(output)
    coverage = {}
    for name in TARGETS:
        file = f'{name}.test.mjs'
        pids = {e['pid'] for e in events if e['stage'] == 'preload' and e.get('file') == file}
        coverage[file] = {
            'worker_pids': sorted(pids),
            'natural_zero_exit': any(e['stage'] == 'process-exit' and e['pid'] in pids
                                     and e.get('code') == 0 for e in events),
            'custom_passed_assertions': sum(e['stage'] == 'test:pass' and e.get('file') == file
                                            for e in events),
        }
    if phase == 'pristine':
        assertion_evidence = (result['tap']['tests'] is not None and result['tap']['tests'] > 0
                              and result['tap']['pass'] is not None and result['tap']['pass'] > 0
                              and result['tap']['fail'] == 0)
    else:
        assertion_evidence = all(item['custom_passed_assertions'] > 0 for item in coverage.values())
    if result['exit_code'] == 0 and not (
            assertion_evidence and all(item['worker_pids'] and item['natural_zero_exit']
                                       for item in coverage.values())):
        result.update(status='observer-failure', exit_code=125)
    result.update({'coverage': coverage, 'label': label, 'phase': phase, 'source_sha': actual,
                   'source_sha256_before': before, 'source_sha256_after': after,
                   'fixture_instrumentation': False, 'argv': command,
                   'reporter': 'default-TAP' if phase == 'pristine' else 'custom',
                   'observer_preload_sha256': hashlib.sha256(HOOK.encode()).hexdigest(),
                   'environment': {'PATH': '<runner PATH>', 'HOME': '<arm>/home', 'CI': '1',
                       'TERM': 'xterm-256color', 'LOCAL_OPERATOR_CONFIG_DIR': '<arm>/home/.local-operator',
                       'PROBE_EVIDENCE': '<arm>', 'NODE_OPTIONS': '--import=<arm>/preload.mjs'},
                   'extra_node_report_flags': [],
                   'probe_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'node': version})
    write_json(output / 'result.json', result)
    print(json.dumps({key: result[key] for key in ('label', 'phase', 'status', 'exit_code', 'seconds')}), flush=True)
    return result


def compare(roots, output):
    if set(roots) != set(REFS):
        raise ValueError('exactly the two immutable roots are required')
    output.mkdir(parents=True)
    results = []

    def finish(outcome, code):
        summary = {'outcome': outcome, 'exit_code': code,
                   'custom_ran': any(row['phase'] == 'custom' for row in results),
                   'results': [{key: row[key] for key in ('label', 'phase', 'status', 'exit_code')} for row in results],
                   'limitation': 'observer preload and pipe draining perturb scheduling; no full-CI equivalence'}
        write_json(output / 'comparison.json', summary)
        print(json.dumps(summary), flush=True)
        return code

    # No name-pattern filters, singles, alternative third file, instrumentation
    # or speculative extra arm. A timeout is preserved, never reported green.
    for label in REFS:
        result = run(roots[label], label, 'pristine', output / f'{label}-pristine')
        results.append(result)
        if not ((result['exit_code'] == 0 and result['status'] == 'completed') or
                (result['exit_code'] == 124 and result['status'] == 'timeout')):
            # A child can naturally exit 124. That is not an observed deadline
            # stall and must not authorize a speculative reporter arm.
            return finish('PRISTINE_FAILURE', result['exit_code'] or 125)
    if all(row['exit_code'] == 0 for row in results):
        return finish('NOT_REPRODUCED', 0)
    for label in REFS:
        result = run(roots[label], label, 'custom', output / f'{label}-custom')
        results.append(result)
        if not ((result['exit_code'] == 0 and result['status'] == 'completed') or
                (result['exit_code'] == 124 and result['status'] == 'timeout')):
            return finish('CUSTOM_FAILURE', result['exit_code'] or 125)
    return finish('TIMED_OUT_MATCHED_COMPARISON', 124)


def validate_history_plan(plan):
    files = plan.get('files', [])
    if (plan.get('head') != HISTORY_HEAD or plan.get('checkout') != HISTORY_HEAD
            or plan.get('total') != HISTORY_TOTAL or plan.get('count') != 4
            or len(files) != HISTORY_TOTAL or files != sorted(set(files))
            or plan.get('shards') != [files[index::4] for index in range(4)]):
        raise RuntimeError('pinned partition inventory mapping mismatch; STOP')
    selected = plan['shards'][HISTORY_INDEX]
    digest = hashlib.sha256(('\n'.join(selected) + '\n').encode()).hexdigest()
    if len(selected) != HISTORY_COUNT or digest != HISTORY_DIGEST:
        raise RuntimeError('pinned selected newline digest mismatch; STOP')
    return selected


class ValidationBudget:
    """One absolute caller clock; reuse the identity-owned process supervisor.

    Metadata is not harmless setup: Git/Node/hash helpers can hang or fork too.
    Captured bytes stay private and bounded; only sanitized supervisor receipts
    are durable. No timeout fallback launches another diagnostic or target.
    """
    def __init__(self, deadline, output):
        self.deadline, self.output, self.sequence = deadline, output, 0

    def remaining(self):
        left = self.deadline - time.monotonic()
        if left < 0.4:
            raise TimeoutError('whole-history validation deadline exhausted; STOP')
        return left

    def run(self, command, root):
        left = self.remaining()
        self.sequence += 1
        output = self.output / f'{self.sequence:03d}-metadata'
        captured = bytearray()
        result = supervise(command, root, output, min(30, left - 0.1),
                           history=WorkerHistory(root, [], output),
                           memory_mb=HISTORY_MEMORY_MB, absolute_deadline=self.deadline,
                           capture=captured)
        self.remaining()
        if result['exit_code'] != 0 or result['survivors']:
            raise TimeoutError('bounded metadata failed or timed out; STOP')
        if result['discarded_output_bytes'] > 1048576:
            raise RuntimeError('metadata output exceeded private capture bound; STOP')
        return bytes(captured)


def history_plan(root, budget):
    if budget.run(['git', 'rev-parse', 'HEAD'], root).decode().strip() != HISTORY_HEAD:
        raise RuntimeError('history root is not the one authorized immutable avatar ref')
    budget.run(['git', 'diff', '--no-ext-diff', '--exit-code', '--quiet', 'HEAD', '--',
                'src', 'scripts', 'package.json', 'pnpm-lock.yaml'], root)
    version = budget.run(['node', '--version'], root).decode().strip()
    if not version.startswith('v22.'):
        raise RuntimeError('history requires actual Node22')
    plan = json.loads(budget.run([
        'node', 'scripts/desktop-test-shards.mjs', 'plan', '--head', HISTORY_HEAD,
        '--checkout', HISTORY_HEAD], root))
    budget.remaining()
    return plan, validate_history_plan(plan)


# Hashing also lives inside the same owned subprocess boundary: a stalled read
# must not hold the parent beyond its deadline. Check the shared monotonic clock
# between files/chunks as well; no source file is modified or imported.
HASH_MANIFEST = r"""
import hashlib,json,sys,time
from pathlib import Path
root=Path(sys.argv[1]); paths=json.loads(sys.argv[2]); deadline=float(sys.argv[3]); result={}
for name in paths:
    digest=hashlib.sha256()
    with (root/name).open('rb') as stream:
        while True:
            if time.monotonic() >= deadline:
                raise TimeoutError('manifest deadline')
            chunk=stream.read(65536)
            if not chunk: break
            digest.update(chunk)
    result[name]=digest.hexdigest()
print(json.dumps(result),flush=True)
"""


def history_manifest(root, files, budget):
    paths = sorted(set(files + [f'scripts/{name}.mjs' for name in COORDINATOR_FILES] + [
        'scripts/desktop-test-shards.mjs', 'scripts/entry-point.mjs', 'package.json', 'pnpm-lock.yaml']))
    budget.run(['git', 'diff', '--no-ext-diff', '--exit-code', '--quiet', 'HEAD', '--',
                'src', 'scripts', 'package.json', 'pnpm-lock.yaml'], root)
    result = json.loads(budget.run([sys.executable, '-c', HASH_MANIFEST, str(root),
                                   json.dumps(paths), str(budget.deadline)], root))
    budget.remaining()
    if sorted(result) != paths:
        raise RuntimeError('incomplete bounded source manifest')
    return result


def run_history(root, output):
    began = time.monotonic()
    budget = ValidationBudget(began + HISTORY_LIMIT, output / 'validation')
    plan, selected = history_plan(root, budget)
    before = history_manifest(root, selected, budget)
    output.mkdir(parents=True, exist_ok=True)
    write_json(output / 'source-before.json', {'source_sha': HISTORY_HEAD, 'sha256': before})
    write_json(output / 'selection.json', {**plan, 'selected_index': HISTORY_INDEX,
               'selected_count': HISTORY_COUNT, 'selected_newline_sha256': HISTORY_DIGEST,
               'selection_is_not_completion': True})
    # Reserve post-validation/serialization time within the SAME 600s call.
    remaining = budget.remaining() - min(8, HISTORY_LIMIT * 0.2)
    if remaining < 1:
        raise RuntimeError('history setup consumed the bounded call; STOP')
    arm = output / 'avatar-index3'
    history = WorkerHistory(root, selected, arm)
    command = ['node', 'scripts/desktop-test-shards.mjs', 'run', '--head', HISTORY_HEAD,
               '--checkout', HISTORY_HEAD, '--index', str(HISTORY_INDEX)]
    result = supervise(command, root, arm, remaining, history=history, memory_mb=HISTORY_MEMORY_MB,
                       absolute_deadline=budget.deadline)
    try:
        after_plan, after_selected = history_plan(root, budget)
        after = history_manifest(root, selected, budget)
        if before != after or selected != after_selected or plan != after_plan:
            raise RuntimeError('pinned history inventory/source changed during call')
        write_json(output / 'source-after.json', {'source_sha': HISTORY_HEAD, 'sha256': after})
    except Exception:
        result.update(source_sha256_before=before, source_after_verified=False,
                      status='history-proof-failure', exit_code=125,
                      outcome='POST_VALIDATION_FAILED_NO_COMPLETION_CLAIM')
        write_json(arm / 'result.json', result)
        raise
    if result['exit_code'] == 0:
        tap = result['tap']
        if not (tap['pass'] is not None and tap['pass'] >= 60 and tap['fail'] == 0
                and tap['tests'] is not None and tap['tests'] >= tap['pass']
                and tap['cancelled'] == 0 and tap['not_ok_events'] == 0
                and tap['runner_files'] == [HISTORY_COUNT] and tap['runner_widths'] == [3]):
            result.update(status='history-proof-failure', exit_code=125)
    result.update(source_sha=HISTORY_HEAD, argv=command, source_sha256_before=before,
                  source_sha256_after=after, selected_count=HISTORY_COUNT,
                  selected_newline_sha256=HISTORY_DIGEST,
                  selection_is_not_completion=True, no_automatic_followup=True,
                  whole_history_seconds=round(time.monotonic() - began, 6),
                  outcome=('NOT_REPRODUCED_SELECTED_PARTITION' if result['exit_code'] == 0 else
                           'CEILING_REACHED_NOT_A_HANG_PROOF' if result['status'] == 'timeout' else
                           'PARTITION_OR_OBSERVER_FAILURE'),
                  interpretation='worker candidates are not causes; disappearance is not exit/pass; no full-suite claim')
    if time.monotonic() - began >= HISTORY_LIMIT:
        result.update(status='deadline-failure', exit_code=127, outcome='PARTITION_OR_OBSERVER_FAILURE')
    write_json(arm / 'result.json', result)
    print(json.dumps({key: result[key] for key in ('source_sha', 'selected_count', 'status', 'exit_code',
                     'outcome', 'whole_history_seconds')}), flush=True)
    return result['exit_code']


def validation_controls(output, plan):
    """Real slow/stuck metadata processes: no mocked subprocess timeouts.

    Only the target call is a stand-in: no selected test fixture is imported.
    The SAME Git/Node/manifest and owned-cleanup paths run under a scaled clock.
    """
    output.mkdir(parents=True)
    root = output / 'metadata-fixture'
    binary = root / 'bin'
    binary.mkdir(parents=True)
    (root / 'plan.json').write_text(json.dumps(plan))
    helper = r"""
import json,os,signal,subprocess,sys,time
from pathlib import Path
root=Path(__file__).resolve().parent.parent
role=sys.argv.pop(1)
if len(sys.argv)>1 and sys.argv[1] in ('child','grandchild'):
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    with (root/'pids').open('a') as stream: stream.write(str(os.getpid())+'\n')
    if sys.argv[1]=='child': subprocess.Popen([sys.executable,__file__,'node','grandchild'],start_new_session=True)
    while True: time.sleep(.02)
if role=='git':
    if sys.argv[1]=='rev-parse': print(json.loads((root/'plan.json').read_text())['head'])
    sys.exit(0)
config=json.loads((root/'config.json').read_text())
blocked=config['phase']=='setup' or (root/'post-enabled').exists()
if blocked and '--version' in sys.argv:
    (root/'fault-entered').write_text('actual blocked metadata subprocess')
    if config['kind']=='slow': time.sleep(5)
    else:
        signal.signal(signal.SIGTERM,signal.SIG_IGN)
        with (root/'pids').open('a') as stream: stream.write(str(os.getpid())+'\n')
        subprocess.Popen([sys.executable,__file__,'node','child'],start_new_session=True)
        while True: time.sleep(.02)
if '--version' in sys.argv: print('v22.18.0')
else: print((root/'plan.json').read_text())
"""
    helper_path = binary / 'metadata-helper.py'
    helper_path.write_text(helper)
    for name in ('git', 'node'):
        script = binary / name
        # The desktop Python executable can contain spaces: a raw shebang
        # splits it. Quote argv in a shell carrier, never weaken the test.
        script.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' +
                          shlex.quote(str(helper_path)) + ' ' + name + ' "$@"\n')
        script.chmod(0o755)
    native_supervise, native_plan = supervise, history_plan
    receipts = []
    for phase in ('setup', 'post'):
        for kind in ('slow', 'stuck'):
            for name in ('post-enabled', 'pids', 'fault-entered'):
                (root / name).unlink(missing_ok=True)
            (root / 'config.json').write_text(json.dumps({'phase': phase, 'kind': kind}))
            calls = []

            def target_or_metadata(command, cwd, arm, seconds, **kwargs):
                if command[:3] != ['node', 'scripts/desktop-test-shards.mjs', 'run']:
                    return native_supervise(command, cwd, arm, seconds, **kwargs)
                calls.append(command)
                arm.mkdir(parents=True)
                (root / 'post-enabled').write_text('synthetic post-validation fault')
                return {'exit_code': 0, 'status': 'completed', 'tap': {
                    'tests': 100, 'pass': 100, 'fail': 0, 'cancelled': 0, 'not_ok_events': 0,
                    'runner_files': [164], 'runner_widths': [3]}}

            def setup_or_post_plan(cwd, budget):
                # Post faults start with a supplied known plan to leave the
                # SAME two-second clock for the discriminating post process.
                # Setup faults and ALL blocking post validation remain real.
                if phase == 'post' and not (root / 'post-enabled').exists():
                    return plan, validate_history_plan(plan)
                return native_plan(cwd, budget)

            # A real hash subprocess, not a mocked manifest, but only bounded
            # synthetic files are hashed. Source verification does not import UI.
            def synthetic_manifest(cwd, selected, budget):
                return json.loads(budget.run([sys.executable, '-c', HASH_MANIFEST,
                    str(root), json.dumps(['plan.json']), str(budget.deadline)], root))

            began = time.monotonic()
            rejected = False
            with patch.dict(os.environ, PATH=str(binary) + os.pathsep + os.environ['PATH']), \
                    patch.dict(globals(), HISTORY_LIMIT=2, supervise=target_or_metadata,
                               history_plan=setup_or_post_plan, history_manifest=synthetic_manifest):
                try:
                    run_history(root, output / f'{phase}-{kind}')
                except (TimeoutError, RuntimeError):
                    rejected = True
            elapsed = time.monotonic() - began
            assert rejected and elapsed <= 2, (phase, kind, elapsed)
            assert (root / 'fault-entered').exists(), ('wrong failure surface', phase, kind)
            assert len(calls) == (1 if phase == 'post' else 0), calls
            pids = [int(pid) for pid in (root / 'pids').read_text().splitlines()] if (root / 'pids').exists() else []
            if kind == 'stuck':
                assert len(pids) >= 3, ('did not exercise actual child/grandchild', pids)
            assert not [pid for pid in pids if process_row(pid) is not None], pids
            receipts.append({'phase': phase, 'kind': kind, 'whole_seconds': elapsed,
                             'limit_seconds': 2, 'stand_in_target_calls': len(calls),
                             'actual_partition_execution': False, 'pids': pids, 'survivors': []})
    # Same tiny reviewer clock: refuse BEFORE any validator/target launch, not
    # merely check elapsed after an unbounded subprocess has returned.
    began = time.monotonic()
    with patch.dict(globals(), HISTORY_LIMIT=.05):
        try:
            run_history(root, output / 'tiny-clock')
        except TimeoutError:
            pass
        else:
            raise AssertionError('tiny deadline did not stop setup')
    assert time.monotonic() - began <= .05
    write_json(output / 'result.json', {'synthetic_validation_controls': True,
               'actual_partition_execution': False, 'cases': receipts,
               'tiny_clock_seconds': time.monotonic() - began})
    print('PASS actual slow/stuck setup+post metadata deadlines and owned descendant cleanup', flush=True)


def history_controls(source, output):
    """SMALL external-only controls, never the selected partition itself."""
    require_external_procfs()
    output.mkdir(parents=True)
    validation = ValidationBudget(time.monotonic() + 60, output / 'validation')
    plan, selected = history_plan(source, validation)  # Metadata only, never target fixtures.
    root = output / 'fixture-root'
    (root / 'scripts').mkdir(parents=True)
    for name in COORDINATOR_FILES:
        file = f'scripts/{name}.mjs'
        data = (source / file).read_bytes()
        if data != validation.run(['git', 'show', f'{HISTORY_HEAD}:{file}'], source):
            raise RuntimeError('external preflight coordinator is not immutable')
        (root / file).write_bytes(data)
    (root / 'controls').mkdir()
    file = 'controls/retained.test.mjs'
    # These markers/handlers are synthetic controls ONLY. No target source or
    # worker is instrumented. The outer proxy deliberately withholds default TAP.
    (root / file).write_text("import {test} from 'node:test';import assert from 'node:assert/strict';"
        "import {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';"
        "spawn(process.execPath,['-e','setInterval(()=>{},1000)','controls/decoy.test.mjs'],"
        "{detached:true,stdio:'ignore'});let spawned=false;"
        "process.on('SIGTERM',()=>{if(!spawned){spawned=true;const c=spawn(process.execPath,"
        "['-e','process.on(\"SIGTERM\",()=>{});setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});"
        "writeFileSync('late.pid',String(c.pid));}});"
        "test('SYNTHETIC_SECRET buffered',()=>{assert.equal(1,1);writeFileSync('assertion.marker','asserted');"
        "setInterval(()=>{},1000);});")
    proxy = ("const {spawn}=require('node:child_process');const c=spawn(process.execPath,"
             "['scripts/run-desktop-tests.mjs',process.argv[1]],{stdio:['ignore','pipe','pipe']});"
             "c.stdout.on('data',()=>{});c.stderr.on('data',()=>{});"
             "c.on('exit',code=>{process.exitCode=code||0});")
    arm = output / 'buffered-retained'
    tracker = WorkerHistory(root, [file, 'controls/decoy.test.mjs'], arm)
    began = time.monotonic()
    result = supervise(['node', '-e', proxy, file], root, arm, 8, history=tracker,
                       memory_mb=HISTORY_MEMORY_MB)
    whole = time.monotonic() - began
    events = [json.loads(line) for line in (arm / 'worker-history.jsonl').read_text().splitlines()]
    assert whole <= 8 and result['exit_code'] == 124 and not result['survivors']
    assert result['tap']['tests'] is None and result['tap']['ok_events'] == 0
    assert not set(tracker.workers).intersection(tracker.coordinators)
    assert (root / 'assertion.marker').read_text() == 'asserted'
    assert tracker.summary()['files_seen'] == [file]  # Root/coordinator/decoy excluded.
    first = next(event for event in events if event['event'] == 'FIRSTSEEN')
    assert any(event['pid'] == first['pid'] and event['ppid'] != first['ppid'] for event in events)
    saturation_dir = output / 'checkpoint-saturation'
    saturation_dir.mkdir()
    saturated = WorkerHistory(root, [file], saturation_dir, max_events=1)
    saturated.emit(events[0])
    saturated.emit(events[-1])
    assert saturated.summary()['checkpoint_saturated'] and saturated.summary()['dropped_checkpoints'] == 1
    write_json(saturation_dir / 'result.json', {'synthetic_fault_injection': True,
               'actual_partition_execution': False, 'checkpoint_saturated': True,
               'dropped_checkpoints': saturated.dropped})
    assert result['report_requests'] == [] and not (arm / 'preload.mjs').exists()
    assert not list(arm.glob('node-*.jsonl'))
    assert 'SYNTHETIC_SECRET' not in json.dumps([result, events])
    late = int((root / 'late.pid').read_text())
    assert late in {row['pid'] for row in result['owned_identities']}
    assert process_row(late) is None
    result.update(synthetic_control=True, actual_partition_execution=False, whole_control_seconds=whole,
                  late_child_owned_and_reaped=True, buffered_tap=True)
    write_json(arm / 'result.json', result)
    # A non-buffered ordinary worker proves disappearance has no pass/exit claim.
    natural = 'controls/natural.test.mjs'
    (root / natural).write_text("import {test} from 'node:test';test('natural',async()=>{"
                               "await new Promise(r=>setTimeout(r,600));});")
    arm = output / 'natural'
    trace = WorkerHistory(root, [natural], arm)
    result = supervise(['node','scripts/run-desktop-tests.mjs',natural],root,arm,8,
                       history=trace,memory_mb=HISTORY_MEMORY_MB)
    assert result['exit_code'] == 0 and result['tap']['pass'] == 1 and not result['survivors']
    assert trace.summary()['files_seen'] == [natural]
    events = [json.loads(line) for line in (arm / 'worker-history.jsonl').read_text().splitlines()]
    assert any(event['event'] == 'DISAPPEARED' for event in events)
    failure = 'controls/failure.test.mjs'
    (root / failure).write_text("import {test} from 'node:test';import assert from 'node:assert/strict';"
                               "test('SYNTHETIC_SECRET failure',()=>assert.equal(1,2));")
    arm = output / 'assertion-failure'
    result = supervise(['node','scripts/run-desktop-tests.mjs',failure],root,arm,8,
                       history=WorkerHistory(root,[failure],arm),memory_mb=HISTORY_MEMORY_MB)
    assert result['exit_code'] == 1 and result['tap']['fail'] == 1 and not result['survivors']
    assert 'SYNTHETIC_SECRET' not in json.dumps(result)
    # Real noisy child exercises bounded drain; memory allocation is <100MiB.
    arm = output / 'noisy'
    result = supervise(['node','-e',"setInterval(()=>process.stdout.write('x'.repeat(16384)),1)"],
                       root,arm,4,history=WorkerHistory(root,[],arm),memory_mb=HISTORY_MEMORY_MB)
    assert result['exit_code'] == 124 and result['discarded_output_bytes'] > 65536 and not result['survivors']
    observer_mb = int(memory_charge(process_row(os.getpid())) / 1024)
    arm = output / 'memory'
    result = supervise(['node','-e',"setTimeout(()=>{globalThis.keep=Buffer.alloc(96*1024*1024,1)},500);setInterval(()=>{},1000)"],
                       root,arm,8,history=WorkerHistory(root,[],arm),memory_mb=observer_mb + 80)
    assert result['exit_code'] == 137 and not result['survivors']
    assert result['kill_sent'] and result['operation_costs']['signal_count'] > 0
    assert result['operation_costs']['memory_count'] > 0 and result['operation_costs']['memory_total'] > 0
    # Missing procfs must stop BEFORE launch; this is an explicit fault injection.
    def absent():
        raise RuntimeError('synthetic procfs unavailable')
    with patch.dict(globals(), require_external_procfs=absent), patch.object(subprocess,'Popen') as launch:
        try:
            supervise(['node','-e','0'],root,output/'missing-procfs',8,
                      history=WorkerHistory(root,[],output/'missing-procfs'),memory_mb=HISTORY_MEMORY_MB)
        except RuntimeError:
            pass
        else:
            raise AssertionError('missing procfs did not fail closed')
        launch.assert_not_called()
    identity_controls()
    validation_controls(output / 'deadline-controls', plan)
    for record in output.glob('*/result.json'):
        data = json.loads(record.read_text())
        data.update(synthetic_control=True, actual_partition_execution=False)
        if 'report_requests' in data:
            assert data['report_requests'] == [] and data['diagnostic_preloads'] is False
            assert data['diagnostic_report_signals'] is False
        write_json(record, data)
    write_json(output / 'preflight.json', {'synthetic_only':True, 'native_linux':sys.platform=='linux',
               'selected_mapping_count':len(selected), 'target_execution':False,
               'cases':['buffered-retained-worker','coordinator-and-argv-decoy','late-detached-owned-reaped',
                        'natural-worker-disappearance','real-assertion-failure','noisy-drain','memory-limit','missing-procfs',
                        'checkpoint-saturation','pid-reuse-and-deadline'], 'result':'PASS'})
    print('PASS SMALL external-only history preflight; target partition not executed',flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['history-self-test', 'history'])
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if args.mode == 'history-self-test':
        history_controls(args.root.resolve(), args.output.resolve())
    else:
        require_external_procfs()
        raise SystemExit(run_history(args.root.resolve(), args.output.resolve()))
