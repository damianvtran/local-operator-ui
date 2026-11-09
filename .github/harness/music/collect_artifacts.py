"""Publish only owned receipts/frames, never AuthStore or Chromium profiles.

A failed setup still leaves an explicit artifact. Synthetic bearer values are
redacted using each owned run's private seed; those seed files are never copied.
This collector does not execute fixtures, import Core, or contact any service.
"""
import json
import shutil
import sys
from pathlib import Path


def collect(source: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    copied = []
    allowed = {
        'receipt.json', 'native-result.json', 'core.log', 'native.log', 'events.log',
        'ui-checkout.txt', 'ui-trees.txt', 'app-source-sha256.txt',
    }
    if source.exists():
        for path in source.rglob('*'):
            if not path.is_file() or path.is_symlink():
                continue
            frame = 'frames' in path.relative_to(source).parts
            text = path.name in allowed or path.name.startswith('bootstrap-') and path.suffix == '.jsonl' or path.name.startswith('resource-admission-') and path.suffix == '.json'
            if not text and not (frame and path.suffix in {'.png', '.json'}):
                continue
            relative = path.relative_to(source)
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if path.suffix == '.png':
                shutil.copyfile(path, target)
            else:
                content = path.read_text(errors='replace')
                # Each preflight owns a sibling seed; searches stop at source.
                parent = path.parent
                while parent.is_relative_to(source):
                    seed = parent / 'qa-secrets.json'
                    if seed.exists():
                        for value in json.loads(seed.read_text()).values():
                            content = content.replace(value, '[synthetic-redacted]')
                    if parent == source:
                        break
                    parent = parent.parent
                target.write_text(content)
            copied.append(str(relative))
    (output / 'artifact-index.json').write_text(json.dumps({
        'source_exists': source.exists(), 'files': sorted(copied),
        'excludes': ['AuthStore databases', 'Chromium profiles', 'private seeds'],
        'claim': 'Execution receipts only; inspect failures and BLOCKED rows, never infer acceptance from artifact presence',
    }, indent=2) + '\n')


if __name__ == '__main__':
    collect(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
