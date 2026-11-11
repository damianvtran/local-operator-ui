"""Cheap harness-only contracts; no Core, Electron, provider, or native execution."""
import ast
import importlib.util
import json
import os
import asyncio
import signal
import subprocess
import sys
import re
import shutil
from owned_cleanup import OwnedProcesses, cleanup_all, cancel_listener, run_signalled
from pathlib import Path
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
UI = HERE.parents[2]


class PortableContracts(unittest.TestCase):
    def test_portable_python_sources_parse_without_execution(self):
        for path in HERE.rglob('*.py'):
            text = path.read_text()
            self.assertNotIn('/' + 'Users' + '/', text)
            ast.parse(text, filename=str(path))

    def test_manual_mode_and_core_pin_are_explicit(self):
        text = (UI / '.github/workflows/ci.yml').read_text()
        self.assertIn("default: 'off'", text)
        self.assertIn("inputs.music_acceptance_mode == 'native'", text)
        self.assertIn("steps.music_core_preflight.outcome == 'success'", text)
        self.assertIn('859729bd322da793575527b264b69de0a2601d02', text)
        self.assertIn('--memory-mb 1536', text)
        self.assertIn('--native-after-preflight', text)

    def test_native_lease_is_step_local_and_reaches_controller(self):
        text = (UI / '.github/workflows/ci.yml').read_text()
        step = text.split('      - name: Execute one native music acceptance on the same serving graph', 1)[1].split('      - name:', 1)[0]
        self.assertEqual(text.count("MUSIC_NATIVE_LEASE: '1'"), 1)
        self.assertIn("github.event_name == 'workflow_dispatch'", step)
        self.assertIn("inputs.music_acceptance_mode == 'native'", step)
        self.assertIn("steps.music_core_preflight.outcome == 'success'", step)
        environment, command = step.split('        run:', 1)
        lease = re.search(r"^          MUSIC_NATIVE_LEASE: '([^']+)'$", environment, re.M).group(1)
        self.assertEqual(lease, '1')
        self.assertIn('music-serving-core-preflight.py --resource-lease --native-after-preflight', command)
        # Execute the actual controller admission expression with the environment
        # extracted from the actual step, then prove its no-lease negative.
        tree = ast.parse((HERE / 'music-serving-core-preflight.py').read_text())
        guards = [node for node in ast.walk(tree) if isinstance(node, ast.If)
                  and isinstance(node.test, ast.Compare)
                  and "MUSIC_NATIVE_LEASE" in ast.unparse(node.test)]
        self.assertEqual(len(guards), 1)
        code = compile(ast.Expression(guards[0].test), '<controller admission>', 'eval')
        from types import SimpleNamespace
        condition = re.search(r'^        if: (.+)$', step, re.M).group(1).replace('&&', 'and')
        for event, mode, success, expected in [('push','native','success',False), ('workflow_dispatch','off','success',False), ('workflow_dispatch','preflight','success',False), ('workflow_dispatch','native','failure',False), ('workflow_dispatch','native','success',True)]:
            context = dict(runner=SimpleNamespace(os='macOS'), github=SimpleNamespace(event_name=event), inputs=SimpleNamespace(music_acceptance_mode=mode), steps=SimpleNamespace(music_core_preflight=SimpleNamespace(outcome=success)))
            self.assertEqual(eval(condition, {}, context), expected)
        self.assertFalse(eval(code, {'os': SimpleNamespace(environ={'MUSIC_NATIVE_LEASE':lease})}))
        self.assertTrue(eval(code, {'os': SimpleNamespace(environ={})}))

    def test_listener_failure_does_not_skip_remaining_cleanup(self):
        async def exercise():
            events = []
            async def failed():
                raise RuntimeError('mock HTTP listener failure')
            listener = asyncio.create_task(failed())
            await asyncio.sleep(0)
            async def stopped(): events.append('server stopped')
            with self.assertRaises(BaseExceptionGroup):
                await cleanup_all([lambda:cancel_listener(listener), stopped])
            self.assertEqual(events, ['server stopped'])
        asyncio.run(exercise())

    def test_signals_and_cancellation_await_owned_child_cleanup(self):
        # Only synthetic Python sleepers, never Core, Electron or a live session.
        for sig in (signal.SIGTERM, signal.SIGINT, None):
            with self.subTest(signal=sig), tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as root:
                async def exercise():
                    owned = OwnedProcesses(root)
                    child = None
                    cleaned = False
                    async def work():
                        nonlocal child, cleaned
                        child = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(30)', root], start_new_session=True)
                        owned.seeds.add(child.pid);owned.observe()
                        try:
                            if sig is None:
                                asyncio.current_task().cancel()
                            else:
                                os.kill(os.getpid(), sig)
                            await asyncio.sleep(30)
                        finally:
                            await owned.stop()
                            await asyncio.to_thread(child.wait, 5)
                            cleaned = True
                    try:
                        with self.assertRaises(asyncio.CancelledError):
                            await run_signalled(work)
                        self.assertTrue(cleaned)
                        self.assertEqual(owned.observe(), {})
                        with self.assertRaises(ProcessLookupError): os.kill(child.pid, 0)
                    finally:
                        if child and child.poll() is None:
                            child.kill();child.wait()
                asyncio.run(exercise())

    def test_reparented_helper_retains_exact_identity_witness(self):
        async def exercise(root):
            owned = OwnedProcesses(root)
            code = "import subprocess,sys;p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True);print(p.pid,flush=True);sys.stdin.readline()"
            parent = subprocess.Popen([sys.executable,'-c',code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            helper = int(parent.stdout.readline())
            try:
                owned.seeds.add(parent.pid);owned.observe()
                self.assertIn(helper, owned.identities)
                parent.stdin.close();parent.wait(5)
                # The helper has no root marker and is no longer this child's
                # descendant: only the earlier exact identity authorizes its stop.
                self.assertNotEqual(owned.observe()[helper][0], parent.pid)
                await owned.stop()
                self.assertEqual(owned.observe(), {})
            finally:
                if parent.poll() is None:parent.kill();parent.wait()
                await owned.stop()
                parent.stdout.close()
        with tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as root:
            asyncio.run(exercise(root))

    def test_reused_pid_is_never_signalled(self):
        from unittest.mock import patch
        owned = OwnedProcesses('/synthetic-owned-root')
        pid = 987654
        with patch('owned_cleanup.process_rows', return_value={pid:(1,'original-start','synthetic child')}):
            owned.seeds.add(pid);owned.observe()
        with patch('owned_cleanup.process_rows', return_value={pid:(1,'new-start','unrelated child')}), patch('owned_cleanup.os.kill') as kill:
            asyncio.run(owned.stop())
            kill.assert_not_called()

    def test_native_behavior_contracts(self):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'node required for cheap native predicate tests')
        result = subprocess.run([node, str(HERE/'test_native_contracts.mjs')], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        self.assertIn('PASS native contracts', result.stdout)

    def test_native_linkage_uses_real_inventory_and_driver_actions(self):
        source = (HERE / 'music-native-serving-consumer.mjs').read_text()
        self.assertNotIn('panelIdentityAssertionsReady=false', source)
        self.assertIn('signalCleanup(cleanup,', source)
        self.assertIn('d.drainLiveBoots({why:', source)
        self.assertIn('strict:true', source)
        self.assertIn('await reaper.stop()', source)
        self.assertIn('safeCancel({', source)
        self.assertIn('assertNoAutoplay(await d.verb', source)
        self.assertNotIn("d.verb(cdp,'openCanvasDocument'", source)
        for contract in ["control('inspect_links')", "R.ref", "data-file-id", "aria-controls", "indexed_canvas_digest_playback", "same_turn_highlight_digest_playback", "producing_call_id"]:
            self.assertIn(contract.replace('R.ref', 'r.ref'), source)

    def test_producing_call_and_late_result_follow_the_pinned_music_card(self):
        # Since 230bede the detached music call is pinned OUT of its turn's
        # summary bar, so a lookup through [data-turn-summary][data-run-ids]
        # can never find it (run 42779240064: actual_producing_run absent).
        # The late result is polled, not raced with a fixed pause, and its
        # card outcome is asserted (finished-after-cancel vs cancelled).
        source = (HERE / 'music-native-serving-consumer.mjs').read_text()
        self.assertNotIn("querySelectorAll('[data-turn-summary][data-run-ids]')", source)
        self.assertIn("const pendingCard='[data-music-generating='+JSON.stringify(pending.job)+']'", source)
        self.assertIn("closest('[data-record-id]')", source)
        self.assertIn("producingRecord.includes(pending.producing_call_id)", source)
        self.assertNotIn("await pause(1500);await frame('music-late-result')", source)
        self.assertIn("observed('late_result_visible'", source)
        self.assertIn("'finished_after_cancel':'cancelled'", source)
        self.assertIn("x=>x.track&&x.card===lateOutcome,10000)", source)

    def test_canvas_tabpanel_visibility_is_measured_on_its_player(self):
        # Run 42940060308 timed out at associated_audio_tabpanel with the canvas
        # player on screen: TabPanel renders `display: contents`
        # (src/renderer/src/shared/components/ui/tabs.tsx), so the panel's own
        # rect is always 0x0. The relationship stays asserted both ways and the
        # visibility predicate moves to the player inside the panel.
        source = (HERE / 'music-native-serving-consumer.mjs').read_text()
        self.assertNotIn("r=p?.getBoundingClientRect()", source)
        self.assertIn("s=p?.querySelector('[data-sound-player]'),r=s?.getBoundingClientRect()", source)
        self.assertIn("p?.getAttribute('role')==='tabpanel'", source)
        self.assertIn("p.getAttribute('aria-labelledby')===tab.id", source)
        self.assertIn("r.width>0&&r.height>0)return id", source)
        tabs = (HERE.parents[2] / 'src/renderer/src/shared/components/ui/tabs.tsx').read_text()
        self.assertIn('className="contents"\n\t\trole="tabpanel"', tabs)

    def test_late_result_failure_records_evidence_without_loosening(self):
        # Run 42849428922 failed late_result_visible with nothing recorded. The
        # poll must leave its last value, a ~500 ms timeline, a diagnostic 30 s
        # first-seen watch and a failure frame -- while the 10 s assertion stays.
        source = (HERE / 'music-native-serving-consumer.mjs').read_text()
        self.assertIn("note(label+'_timeout',{last,elapsed_ms:", source)
        self.assertIn("observed('late_result_visible',lateRead,x=>x.track&&x.card===lateOutcome,10000)", source)
        self.assertIn("note('late_result_timeline'", source)
        self.assertIn("t-lastSample>=500", source)
        self.assertIn("Date.now()-lateStarted<30000", source)
        self.assertIn("note('late_result_extended'", source)
        self.assertIn("throw e;", source)
        self.assertIn("frame('music-failure-final')", source)
        preflight = (HERE / 'music-serving-core-preflight.py').read_text()
        self.assertIn("client.get(target+'/history')", preflight)
        self.assertIn("(ROOT/'session-history.json').write_text(json.dumps(scrub(", preflight)

    def test_collector_keeps_history_and_text_logs_only(self):
        spec = importlib.util.spec_from_file_location('music_collector', HERE / 'collect_artifacts.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as directory:
            root = Path(directory)
            run = root / 'source' / 'serving-core-test'
            (run / 'logs').mkdir(parents=True)
            (run / 'qa-secrets.json').write_text(json.dumps({'desktop': 'own-test-bearer', 'upstream': 'up-key'}))
            (run / 'session-history.json').write_text('{"h": "Bearer own-test-bearer"}')
            (run / 'logs' / 'worker.log').write_text('key=up-key')
            (run / 'logs' / 'auth.db').write_bytes(b'not-an-artifact')
            output = root / 'output'
            module.collect(root / 'source', output)
            self.assertEqual((output / 'serving-core-test/session-history.json').read_text(), '{"h": "Bearer [synthetic-redacted]"}')
            self.assertEqual((output / 'serving-core-test/logs/worker.log').read_text(), 'key=[synthetic-redacted]')
            self.assertFalse((output / 'serving-core-test/logs/auth.db').exists())

    def test_collector_excludes_auth_profiles_and_redacts_owned_tokens(self):
        spec = importlib.util.spec_from_file_location('music_collector', HERE / 'collect_artifacts.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as directory:
            root = Path(directory)
            source = root / 'source'
            run = source / 'serving-core-test'
            run.mkdir(parents=True)
            (run / 'qa-secrets.json').write_text(json.dumps({'desktop': 'own-test-bearer'}))
            (run / 'core.log').write_text('Bearer own-test-bearer')
            (run / 'auth.db').write_bytes(b'not-an-artifact')
            (run / 'Cookies').write_bytes(b'not-an-artifact')
            output = root / 'output'
            module.collect(source, output)
            self.assertEqual((output / 'serving-core-test/core.log').read_text(), 'Bearer [synthetic-redacted]')
            self.assertFalse((output / 'serving-core-test/auth.db').exists())
            self.assertFalse((output / 'serving-core-test/qa-secrets.json').exists())
            self.assertFalse((output / 'serving-core-test/Cookies').exists())


if __name__ == '__main__':
    unittest.main()
