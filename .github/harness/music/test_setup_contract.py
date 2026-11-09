"""Hosted prerequisite contracts: real workflow parsing, pure tool stubs only."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
UI = HERE.parents[2]


class HostedSetupContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Reuse the repository's installed YAML parser; no dependency install.
        result = subprocess.run([shutil.which('node'), '-e',
            "const fs=require('fs'),yaml=require('yaml');console.log(JSON.stringify(yaml.parse(fs.readFileSync('.github/workflows/ci.yml','utf8'))));"],
            cwd=UI, capture_output=True, text=True, check=True)
        cls.workflow = json.loads(result.stdout)
        cls.steps = next(job['steps'] for job in cls.workflow['jobs'].values()
                         if any(step.get('name') == 'Prepare isolated music acceptance dependencies'
                                for step in job.get('steps', [])))

    def step(self, name):
        return next(step for step in self.steps if step.get('name') == name)

    def test_supported_python_and_failure_receipts_precede_dependencies(self):
        names = [step.get('name') for step in self.steps]
        init = self.step('Initialize owned music acceptance receipts')
        python = self.step('Set up supported music acceptance Python')
        dependencies = self.step('Prepare isolated music acceptance dependencies')
        self.assertLess(names.index(init['name']), names.index(python['name']))
        self.assertLess(names.index(python['name']), names.index(dependencies['name']))
        self.assertEqual(python['uses'], 'actions/setup-python@v7')
        self.assertEqual(python['with']['python-version'], '3.14')
        self.assertIn('music-acceptance-artifacts', init['run'])
        self.assertLess(init['run'].index('mkdir -p'), init['run'].index('git rev-parse'))
        self.assertLess(init['run'].index('LOCAL_OPERATOR_SCRATCHPAD='), init['run'].index('git rev-parse'))
        for receipt in ['ui-checkout.txt', 'ui-trees.txt', 'app-source-sha256.txt']:
            self.assertIn(receipt, init['run'])
        self.assertLess(dependencies['run'].index('sys.version_info'), dependencies['run'].index('python -m venv'))
        self.assertNotIn('python3 -m venv', dependencies['run'])
        self.assertNotIn('MUSIC_NATIVE_LEASE', json.dumps([init, python, dependencies]))
        # Evaluate the actual YAML predicates, including automatic/refused modes.
        for step in [init, python, dependencies]:
            for event, mode, os_name, expected in [('push','native','macOS',False),
                    ('workflow_dispatch','off','macOS',False),
                    ('workflow_dispatch','preflight','macOS',True),
                    ('workflow_dispatch','native','macOS',True),
                    ('workflow_dispatch','preflight','Linux',False)]:
                context = dict(runner=SimpleNamespace(os=os_name),
                    github=SimpleNamespace(event_name=event),
                    inputs=SimpleNamespace(music_acceptance_mode=mode))
                self.assertEqual(eval(step['if'].replace('&&','and'), {}, context), expected)

    def test_actual_ffmpeg_acquisition_branch_and_failure_controls(self):
        # Execute the actual dependency acquisition prefix, never brew/ffmpeg on
        # the operator host. A stub brew exposes a stub ffmpeg only on success.
        source = self.step('Prepare isolated music acceptance dependencies')['run']
        prefix = source.split('test "$(git', 1)[0]
        self.assertIn('if ! command -v ffmpeg; then', prefix)
        self.assertIn('brew install ffmpeg', prefix)
        self.assertIn('ffmpeg -version', prefix)
        for present, brew_code, probe_code, expected in [
                (False,0,0,['brew install ffmpeg','ffmpeg -version']),
                (True,0,0,['ffmpeg -version']),
                (False,1,0,['brew install ffmpeg']),
                (False,0,1,['brew install ffmpeg','ffmpeg -version'])]:
            with self.subTest(present=present, brew=brew_code, probe=probe_code), tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as directory:
                root = Path(directory); tools = root/'bin';tools.mkdir()
                probe = root/'probe'
                probe.write_text('#!/bin/bash\nprintf "ffmpeg %s\\n" "$*" >> "$TEST_LOG"\nexit "$PROBE_CODE"\n');probe.chmod(0o700)
                brew = tools/'brew'
                brew.write_text('#!/bin/bash\nprintf "brew %s\\n" "$*" >> "$TEST_LOG"\nif [[ "$BREW_CODE" != 0 ]]; then exit "$BREW_CODE"; fi\n/bin/ln -s "$FFMPEG_STUB" "$TEST_BIN/ffmpeg"\n');brew.chmod(0o700)
                if present:(tools/'ffmpeg').symlink_to(probe)
                log = root/'calls'
                env = dict(PATH=str(tools), HOME=str(root), TMPDIR=str(root),
                           TEST_BIN=str(tools), TEST_LOG=str(log), FFMPEG_STUB=str(probe),
                           BREW_CODE=str(brew_code), PROBE_CODE=str(probe_code))
                result = subprocess.run(['/bin/bash','-c',prefix], env=env, capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode == 0, brew_code == probe_code == 0, result.stderr)
                self.assertEqual(log.read_text().splitlines(), expected)


if __name__ == '__main__':
    unittest.main()
