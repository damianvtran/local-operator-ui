"""R12-M1 regression: only the harness-prompted turn may emit a model command.

Why: a job's job_result follow-up turn starts after music/jobs.py journals
state=completed. If the harness has already written the next
model-command.json, that late (tool-bearing) turn used to emit it, parking a
write-tier command on its approval gate and blocking the harness's own
POST /messages (run 42675368995). The bootstrap now emits only when the
request's latest user message carries `MUSIC_QA_TOOL <that command's id>`.

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

    def test_latest_user_message_decides(self):
        pick = self.boot['prompted_command_id']
        self.assertEqual(pick([msg('user', 'MUSIC_QA_TOOL gen-1')]), 'gen-1')
        # Job follow-up: a later user message (job_result) without the marker.
        self.assertIsNone(pick([msg('user', 'MUSIC_QA_TOOL gen-1'), msg('assistant', 'ok'),
                                msg('user', 'job_result: completed')]))
        # Tool rows after the prompt do not hide the prompting user message.
        self.assertEqual(pick([msg('user', 'MUSIC_QA_TOOL gen-1'), msg('tool', 'x')]), 'gen-1')
        self.assertIsNone(pick([]))


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
    return ChatRequest(model=ModelSpec(provider='radient', model_id='m'), tools=[tool],
                       messages=[Message(role='user', content=[TextContent(text=t)]) for t in texts])
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
                                   'match': ['mod-2'], 'match_again': []})
            receipts = [json.loads(line) for f in root.glob('bootstrap-*.jsonl')
                        for line in f.read_text().splitlines()]
            skipped = [r for r in receipts if r['event'] == 'turn_without_marker']
            self.assertEqual([r['command_id'] for r in skipped], ['mod-2'] * 3)


if __name__ == '__main__':
    unittest.main()
