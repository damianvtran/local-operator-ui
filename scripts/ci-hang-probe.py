#!/usr/bin/env python3
"""Disposable Linux/Node22 retention experiment; never a suite runner or fix.

Only allowlisted structured evidence leaves a child. Raw stdout/stderr and Node
report environment/command fields may contain credentials, so neither is stored.
The supervisor's process group, not a name-pattern kill, bounds descendants too.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

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


def members(pgid):
    """Linux procfs is independent of a blocked ps subprocess; zombies are done."""
    rows = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            text = (entry / 'stat').read_text()
            fields = text[text.rfind(')') + 2:].split()
            if int(fields[2]) != pgid or fields[0] == 'Z':
                continue
            rss = int(fields[21]) * os.sysconf('SC_PAGE_SIZE') // 1024
            ticks = int(fields[11]) + int(fields[12])
            rows.append({'pid': int(entry.name), 'ppid': int(fields[1]),
                         'pgid': pgid, 'cpu_seconds': ticks / os.sysconf('SC_CLK_TCK'),
                         'rss_kib': rss, 'node': (entry / 'comm').read_text().strip() == 'node'})
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            continue
    return rows


def group_signal(pgid, sig):
    try:
        os.killpg(pgid, sig)
    except ProcessLookupError:
        pass


def supervise(command, cwd, output, seconds=LIMIT):
    """Return timeout distinctly; never force-exit a retained Node handle green."""
    output.mkdir(parents=True)
    home = output / 'home'
    home.mkdir()
    hook = output / 'preload.mjs'
    hook.write_text(HOOK)
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CI': '1',
           'TERM': 'xterm-256color', 'LOCAL_OPERATOR_CONFIG_DIR': str(home / '.local-operator'),
           'PROBE_EVIDENCE': str(output), 'NODE_OPTIONS': f'--import={hook}'}
    started = time.monotonic()
    # A nonblocking pipe drains even a deliberately noisy negative control without
    # keeping raw output on disk; only its byte count is retained below.
    read_fd, write_fd = os.pipe()
    os.set_blocking(read_fd, False)
    proc = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True,
                            stdout=write_fd, stderr=write_fd)
    os.close(write_fd)
    pgid = proc.pid
    samples, total_bytes = [], 0
    requested = terminated = timed_out = False
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
            rows = members(pgid)
            if elapsed - last_sample >= 2 or not rows:
                samples.append({'seconds': round(elapsed, 3), 'members': rows})
                last_sample = elapsed
            rc = proc.poll()
            if rc is not None and not rows:
                break
            if elapsed >= seconds - 2 and not requested:
                requested = True
                samples.append({'seconds': round(elapsed, 3), 'pre_reap': rows})
                for row in rows:
                    if row['node'] and (output / f"node-{row['pid']}.jsonl").exists():
                        # An unpreloaded Node has no observer signal handler;
                        # USR2 would terminate it rather than capture evidence.
                        try:
                            if os.getpgid(row['pid']) == pgid:
                                os.kill(row['pid'], signal.SIGUSR2)
                        except ProcessLookupError:
                            pass
            if elapsed >= seconds - 1 and not terminated:
                terminated = timed_out = True
                group_signal(pgid, signal.SIGTERM)
            if elapsed >= seconds:
                timed_out = True
                group_signal(pgid, signal.SIGKILL)
                break
            time.sleep(0.025)
    finally:
        group_signal(pgid, signal.SIGKILL)
        proc.wait(timeout=5)
        os.close(read_fd)
    survivors = members(pgid)
    result = {'status': 'timeout' if timed_out else 'completed',
              'exit_code': 124 if timed_out else proc.returncode,
              'seconds': round(time.monotonic() - started, 3),
              'pgid': pgid, 'discarded_output_bytes': total_bytes,
              'survivors': survivors, 'samples': samples}
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


def controls(output):
    if not Path('/proc/self/stat').exists():
        raise RuntimeError('probe requires Linux procfs; local macOS is syntax-only')
    output.mkdir(parents=True)
    with tempfile.TemporaryDirectory(dir=output) as temp:
        root = Path(temp)
        child = root / 'child.mjs'
        child.write_text("import {spawn} from 'node:child_process';\n"
                         "spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {stdio:'ignore'});\n"
                         "setInterval(()=>process.stdout.write('x'.repeat(16384)),1);\n")
        slow = supervise(['node', str(child)], root, output / 'slow-noisy', 4)
        ok = supervise(['node', '-e', 'console.log("natural completion")'], root, output / 'natural', 4)
        bad = supervise(['node', '-e', 'process.exitCode=7'], root, output / 'failure', 4)
        snapshots = list((output / 'slow-noisy').glob('node-*.jsonl'))
        reports = [line for path in snapshots for line in path.read_text().splitlines()
                   if json.loads(line)['stage'] == 'pre-reap-report']
        assert slow['status'] == 'timeout' and slow['exit_code'] == 124
        assert slow['seconds'] < 6 and slow['discarded_output_bytes'] > 65536
        assert not slow['survivors'] and len(reports) >= 2
        assert ok['status'] == 'completed' and ok['exit_code'] == 0
        assert bad['status'] == 'completed' and bad['exit_code'] == 7
        reporter = root / 'reporter.mjs'
        reporter.write_text(REPORTER)
        case = root / 'observer.test.mjs'
        case.write_text("import {test} from 'node:test';\n"
                        "globalThis.__probe('file-start', {file:'observer.test.mjs'});\n"
                        "test('control', () => {});\n")
        observed = supervise(['node', '--test', f'--test-reporter={reporter}', str(case)],
                             root, output / 'reporter', 8)
        events = [json.loads(line) for path in (output / 'reporter').glob('node-*.jsonl')
                  for line in path.read_text().splitlines()]
        assert observed['exit_code'] == 0
        assert any(e['stage'] == 'test:pass' and e.get('file') == case.name for e in events)
        assert all('environmentVariables' not in str(e) for e in events + reports)
        print('PASS bounded noisy descendant / pre-reap reports / natural exit / failure exit / reporter', flush=True)


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
    args = parser.parse_args()
    args.output = args.output.resolve()
    if args.mode == 'self-test':
        controls(args.output)
    else:
        if not all((args.root, args.label, args.phase)):
            parser.error('run requires root, label and phase')
        raise SystemExit(run(args.root.resolve(), args.label, args.phase, args.output))
