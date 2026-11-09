"""Cheap harness-only contracts; no Core, Electron, provider, or native execution."""
import ast
import importlib.util
import json
import os
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
