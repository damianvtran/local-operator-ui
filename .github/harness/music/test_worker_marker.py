"""R12-M1 regression: only the harness-prompted turn may emit a model command.

Why: a job's job_result follow-up turn starts after music/jobs.py journals
state=completed. If the harness has already written the next
model-command.json, that late (tool-bearing) turn used to emit it, parking a
write-tier command on its approval gate and blocking the harness's own
POST /messages (run 42675368995). The bootstrap now emits only when a user
row of the CURRENT turn (after the last assistant message) carries
`MUSIC_QA_TOOL <that command's id>` -- not merely the latest user row, which
Core's appended [session-state] can displace (R18, run 42727770460).

Two layers:
- pure helpers with duck-typed messages, so CI's plain python3 always runs it;
- the REAL OwnedModelBoundary driven with Core's own ChatRequest/Message types,
  in a subprocess under LOCAL_OPERATOR_CORE_PYTHON (skipped when unset).
"""
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import types
import unittest

HERE = Path(__file__).resolve().parent
BOOT = HERE / 'music_worker_bootstrap' / 'sitecustomize.py'


def msg(role, text):
    return types.SimpleNamespace(role=role, content=[types.SimpleNamespace(type='text', text=text)])


class MarkerHelpersTest(unittest.TestCase):
    def setUp(self):
        saved = os.environ.pop('MUSIC_QA_ROOT', None)
        self.addCleanup(lambda: saved is not None and os.environ.__setitem__('MUSIC_QA_ROOT', saved))
        self.boot = runpy.run_path(str(BOOT))

    def test_current_turn_user_rows_decide(self):
        pick = self.boot['prompted_command_ids']
        self.assertEqual(pick([msg('user', 'MUSIC_QA_TOOL gen-1')]), ['gen-1'])
        # Job follow-up: the marker prompt was answered by an assistant message,
        # so only the job_result row belongs to this turn.
        self.assertEqual(pick([msg('user', 'MUSIC_QA_TOOL gen-1'), msg('assistant', 'ok'),
                               msg('user', 'job_result: completed')]), [])
        # Tool rows after the prompt do not hide the prompting user message.
        self.assertEqual(pick([msg('user', 'MUSIC_QA_TOOL gen-1'), msg('tool', 'x')]), ['gen-1'])
        self.assertEqual(pick([]), [])

    def test_session_state_after_prompt_keeps_marker(self):
        # R18 regression (run 42727770460): Core's _commit_system_state appended
        # a [session-state] row AFTER the status-cancel prompt; it renders as a
        # user turn, so the latest-user-message rule skipped the harness's own
        # prompted turn and the command never emitted.
        rows = [msg('user', 'MUSIC_QA_TOOL old'), msg('assistant', 'done'),
                msg('user', 'MUSIC_QA_TOOL status-2'), msg('user', '[session-state]\n## Jobs\n- running')]
        self.assertEqual(self.boot['prompted_command_ids'](rows), ['status-2'])
        self.assertEqual(self.boot['turn_shape'](rows), ['MUSIC_QA_TOOL', '[session-state]'])

    def test_exact_ids_only(self):
        pick = self.boot['prompted_command_ids']
        self.assertNotIn('mod-2', pick([msg('user', 'MUSIC_QA_TOOL mod-2x')]))


DRIVER = r'''
import asyncio, json, os, runpy, sys
from pathlib import Path
root = Path(sys.argv[1]); boot = sys.argv[2]
runpy.run_path(boot)
from local_operator.model import configure
from local_operator.harness.types import (AgentTool, ChatRequest, Message, ModelSpec,
                                          StreamToolCallDelta, TextContent)
boundary = configure.create_stream_fn()
async def noop(*a, **k): return None
tool = AgentTool(name='modify_music', description='d', parameters={'type': 'object'}, execute=noop)
def req(*texts):
    # 'A:' prefix = assistant row; everything else is a user row.
    rows = [Message(role='assistant', content=[TextContent(text=t[2:])]) if t.startswith('A:')
            else Message(role='user', content=[TextContent(text=t)]) for t in texts]
    return ChatRequest(model=ModelSpec(provider='radient', model_id='m'), tools=[tool], messages=rows)
(root / 'model-command.json').write_text(json.dumps({'id': 'mod-2', 'tool': 'modify_music', 'args': {}}))
async def emits(request):
    return [e.id for e in [e async for e in boundary(request)] if isinstance(e, StreamToolCallDelta)]
async def main():
    out = {}
    out['followup'] = await emits(req('MUSIC_QA_TOOL gen-1', 'job_result: generate_music completed'))
    out['other_id'] = await emits(req('MUSIC_QA_TOOL gen-1'))
    out['prefix_id'] = await emits(req('MUSIC_QA_TOOL mod-2x'))
    out['match'] = await emits(req('MUSIC_QA_TOOL mod-2'))
    out['match_again'] = await emits(req('MUSIC_QA_TOOL mod-2'))
    # R18: Core's [session-state] row after the prompt must not hide its marker,
    # while a follow-up whose marker prompt was already answered still skips.
    (root / 'model-command.json').write_text(json.dumps({'id': 'mod-3', 'tool': 'modify_music', 'args': {}}))
    out['answered_followup'] = await emits(req('MUSIC_QA_TOOL mod-3', 'A:done', '[session-state] jobs'))
    out['state_after_marker'] = await emits(req('A:prior', 'MUSIC_QA_TOOL mod-3', '[session-state] jobs'))
    print(json.dumps(out))
asyncio.run(main())
'''


@unittest.skipUnless(os.environ.get('LOCAL_OPERATOR_CORE_PYTHON'), 'needs Core interpreter')
class RealBoundaryTest(unittest.TestCase):
    def test_only_matching_marker_emits_once(self):
        core = os.environ['LOCAL_OPERATOR_CORE_PYTHON']
        module = subprocess.run([core, '-c', 'import local_operator;print(local_operator.__file__)'],
                                capture_output=True, text=True, check=True).stdout.strip()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            env = {k: v for k, v in os.environ.items() if not k.startswith('CMUX_')}
            env.update(MUSIC_QA_ROOT=str(root), MUSIC_QA_ALLOWED_ROOT=str(root),
                       LOCAL_OPERATOR_CONFIG_DIR=str(root / 'config'), HOME=str(root / 'home'),
                       RADIENT_API_BASE_URL='http://127.0.0.1:9/v1', MUSIC_QA_CORE_MODULE=module)
            run = subprocess.run([core, '-c', DRIVER, str(root), str(BOOT)], env=env,
                                 capture_output=True, text=True, timeout=120)
            self.assertEqual(run.returncode, 0, run.stderr[-2000:])
            out = json.loads(run.stdout.strip().splitlines()[-1])
            self.assertEqual(out, {'followup': [], 'other_id': [], 'prefix_id': [],
                                   'match': ['mod-2'], 'match_again': [],
                                   'answered_followup': [], 'state_after_marker': ['mod-3']})
            receipts = [json.loads(line) for f in root.glob('bootstrap-*.jsonl')
                        for line in f.read_text().splitlines()]
            skipped = [r for r in receipts if r['event'] == 'turn_without_marker']
            self.assertEqual([r['command_id'] for r in skipped], ['mod-2'] * 3 + ['mod-3'])
            self.assertEqual(skipped[-1]['turn_user_rows'], ['[session-state]'])


if __name__ == '__main__':
    unittest.main()
