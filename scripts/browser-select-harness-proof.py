"""Run the actual harness selection renderer/transport against the live app.

Args: config root, tab, selector, requested label. Python comes from the harness
worktree's existing venv; cwd/PYTHONPATH pins that source. No installation and no
live profile. No submit: only selects an option and reads the DOM back.
"""
import asyncio
import json
import sys
from pathlib import Path
from local_operator.harness.types import BrowserSurface
from local_operator.tools import builtin
from local_operator.ui_browser.backend import UiHostClient

async def main():
    root, tab, selector, label = sys.argv[1:]
    client = UiHostClient(Path(root))
    state = BrowserSurface()
    state.surface_id = tab
    result = await builtin._bridge_action("select-proof", state, "select", builtin.BrowserParams(action="select", selector=selector, options=[label]), None, client=client)
    print(json.dumps({"is_error": result.is_error, "text": result.text, "details": result.details}, default=str))
    if result.is_error:
        raise SystemExit(1)
    facts = await client.call("styles", {"tab": tab, "selector": selector})
    print(json.dumps({"read_back_styles": facts}))
asyncio.run(main())
