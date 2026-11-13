"""Exercise the controller's actual launcher values with a pip-free toy venv."""
import ast
import json
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
import uuid
import venv

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'music-serving-core-preflight.py'


def source_launchers(environment):
    # Execute only the real helper and launcher assignments, never controller
    # imports/main or its Core/bootstrap. This is the value seed Popen receives.
    tree = ast.parse(SOURCE.read_text())
    selected = [node for node in tree.body
                if isinstance(node, ast.FunctionDef) and node.name == 'configured_launcher'
                or isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                    and target.id in {'CORE', 'CORE_PYTHON'} for target in node.targets)]
    namespace = {'Path': Path, 'os': SimpleNamespace(environ=environment, access=os.access, X_OK=os.X_OK)}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), 'exec'), namespace)
    return namespace['CORE'], namespace['CORE_PYTHON']


class LauncherContracts(unittest.TestCase):
    def test_actual_controller_launcher_preserves_virtualenv_imports(self):
        with tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as directory:
            root = Path(directory).resolve()
            environment_root = root / 'toy-venv'
            # Standard library only, no pip, package install, Core or SDK import.
            venv.EnvBuilder(with_pip=False, symlinks=True).create(environment_root)
            launcher = environment_root / 'bin/python'
            self.assertTrue(launcher.is_symlink(), 'negative control requires a symlink venv')
            home = root / 'home';home.mkdir()
            environment = {'HOME': str(home), 'TMPDIR': str(root), 'PATH': str(environment_root/'bin'),
                           'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONNOUSERSITE': '1'}
            def run(executable, code):
                # subprocess.run always waits/reaps its own exact child, including
                # timeout escalation; no process/service outlives this fixture.
                return subprocess.run([str(executable), '-c', code], env=environment,
                                      cwd=home, capture_output=True, text=True, timeout=15)
            probe = run(launcher, 'import sysconfig;print(sysconfig.get_path("purelib"))')
            self.assertEqual(probe.returncode, 0, probe.stderr)
            packages = Path(probe.stdout.strip())
            self.assertTrue(packages.is_relative_to(environment_root))
            marker = '_music_toy_' + uuid.uuid4().hex
            (packages / (marker + '.py')).write_text('VALUE = "owned-toy-marker"\n')
            core, python = source_launchers({'LOCAL_OPERATOR_CORE_BIN': str(launcher),
                                            'LOCAL_OPERATOR_CORE_PYTHON': str(launcher)})
            self.assertEqual(core, launcher)
            self.assertEqual(python, launcher)
            code = f'import sys,json,{marker};print(json.dumps({{"prefix":sys.prefix,"marker":{marker}.VALUE}}))'
            actual = run(python, code)
            self.assertEqual(actual.returncode, 0, actual.stderr)
            facts = json.loads(actual.stdout)
            self.assertEqual(facts, {'prefix': str(environment_root), 'marker': 'owned-toy-marker'})
            # Reproduce the exact previous .resolve() semantics: execution of the
            # base interpreter loses this venv's toy package and has base prefix.
            negative = run(python.resolve(), code)
            self.assertNotEqual(negative.returncode, 0)
            self.assertIn('ModuleNotFoundError', negative.stderr)
            base = run(python.resolve(), 'import sys;print(sys.prefix)')
            self.assertEqual(base.returncode, 0, base.stderr)
            self.assertNotEqual(base.stdout.strip(), str(environment_root))
            print('PASS actual controller launcher: venv prefix and toy marker retained; resolved-base negative refuses marker')

    def test_configured_launcher_refuses_missing_nonexecutable_and_directory(self):
        with tempfile.TemporaryDirectory(dir=os.environ['LOCAL_OPERATOR_SCRATCHPAD']) as directory:
            root = Path(directory)
            plain = root/'not-executable';plain.write_text('not executable');plain.chmod(0o600)
            for invalid in (root/'missing', plain, root):
                with self.subTest(path=invalid), self.assertRaisesRegex(RuntimeError, 'Configured executable unavailable'):
                    source_launchers({'LOCAL_OPERATOR_CORE_BIN': str(invalid),
                                      'LOCAL_OPERATOR_CORE_PYTHON': str(invalid)})


if __name__ == '__main__':
    unittest.main()
