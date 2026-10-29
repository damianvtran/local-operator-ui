"""Run `local-operator` from a WORKTREE source tree on the shared editable venv.

WHY THIS EXISTS. ~/local-operator/.venv is an editable install of the primary
checkout, wired through a `__editable__..._finder` MetaPathFinder. `PYTHONPATH`
alone does NOT beat it (measured: `import local_operator` still resolved to
/Users/damian/local-operator with the worktree first on PYTHONPATH). A QA lane
that wants the merged commit's code without duplicating the dependency tree
therefore drops the finder, puts the source tree at sys.path[0], and asserts
which tree actually got imported before handing control to the real CLI.

Usage: LO_SOURCE=<worktree> python run_source.py serve --host ... --port ...
"""

from __future__ import annotations

import os
import sys

src = os.environ["LO_SOURCE"]
sys.path.insert(0, src)
sys.meta_path = [
    finder
    for finder in sys.meta_path
    if "__editable__" not in getattr(finder, "__module__", "")
]
sys.path = [entry for entry in sys.path if "__editable__" not in str(entry)]

import local_operator  # noqa: E402

if not os.path.realpath(local_operator.__file__).startswith(
    os.path.realpath(src) + os.sep
):
    raise SystemExit(
        f"refusing to run: local_operator resolved to {local_operator.__file__}, "
        f"not {src}"
    )
print(f"[run_source] source={local_operator.__file__}", flush=True)

from local_operator.cli import main  # noqa: E402

sys.argv = ["local-operator", *sys.argv[1:]]
raise SystemExit(main() or 0)
