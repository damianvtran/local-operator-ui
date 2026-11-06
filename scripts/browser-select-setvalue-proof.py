#!/usr/bin/env python3
"""The real-path evidence rig for `select`/`setvalue` against the BUILT app.

WHY THIS IS COMMITTED: a browser-host claim that cannot be re-run is a claim, not
evidence. This boots whatever `out/` holds — a bytecode build is the point, since
that is the transport that shipped `select` broken — serves
`browser-setvalue-fixture.html` on loopback, and drives the cells through the
harness's own Python surface (`builtin._bridge_action` + `UiHostClient`), which is
the same client a session's `browser` tool uses. `open` goes over that client's
wire call, as this repo's JS evidence rigs do, because the tool's own `open` body
is cmux-shaped.

ISOLATION (every piece is load-bearing): HOME, LOCAL_OPERATOR_CONFIG_DIR,
LOCAL_OPERATOR_LOG_DIR and the Chromium profile all sit under one scratch dir; the
child's environment is BUILT rather than inherited, so no CMUX_*/LOP_* leaks in;
the app runs `--window-mode=headless`, `--use-mock-keychain` and a scratch
`--user-data-dir`, so it never takes the operator's focus and never reaches his
profile or his keychain; the process starts in its own session and is reaped by
exact process group at the end. The loopback origin is pre-approved in that
scratch profile's `approvals.json`, because the consent bar is UI chrome a
headless rig has no renderer for.

USAGE (one app run at a time machine-wide; take the build lock around build+run):

    UI_WORKTREE=<built app worktree> \
    LO_WORKTREE=<local_operator tree with the same wire> \
    LO_SETVALUE_SCRATCH=<scratch dir> \
    PYTHONPATH=$LO_WORKTREE <a venv python> scripts/browser-select-setvalue-proof.py <label>

Prints one JSON document: the rows, each with the call and the page's own
read-back. Exit status is that of the run, not of the cells — read the JSON.
"""
from __future__ import annotations

import asyncio
import functools
import http.server
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

# Paths come from the environment so the script is re-runnable from a checkout:
# UI_WORKTREE is the built app tree, LO_WORKTREE a local_operator tree whose
# `builtin`/`ui_browser` speak the same wire (its own venv supplies the deps).
SCRATCH = Path(os.environ["LO_SETVALUE_SCRATCH"])
WORKTREE = Path(os.environ["UI_WORKTREE"])
ELECTRON = WORKTREE / "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
FIXTURE = "browser-setvalue-fixture.html"
PAGE_DIR = Path(__file__).parent  # the fixture travels beside this script
RUN = SCRATCH / "run"  # recreated per run: home, config, logs, profile, tmp
HOME_DIR = RUN / "home"
CONFIG_DIR = RUN / "config"
LOG_DIR = RUN / "logs"
PROFILE_DIR = RUN / "profile"
TMP_DIR = RUN / "tmp"

sys.path.insert(0, os.environ["LO_WORKTREE"])


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def serve(port: int) -> http.server.ThreadingHTTPServer:
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler, directory=str(PAGE_DIR)
    )
    # Quiet: the page's own requests are not evidence.
    handler.log_message = lambda *a, **k: None  # type: ignore[assignment]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def seed_origin(origin: str) -> None:
    """Pre-approve the loopback origin in the scratch profile's store.

    The consent bar is UI chrome answered by the renderer; a headless rig answers
    it the way the persisted store already allows — one exact-origin allow, in a
    profile that exists only for this run.
    """
    store_dir = PROFILE_DIR / "browser"
    store_dir.mkdir(parents=True, exist_ok=True)
    (store_dir / "approvals.json").write_text(
        json.dumps(
            {
                "version": 1,
                "origins": {origin: "allow"},
                "siteGrants": {"version": 1, "grants": {}},
                "records": [
                    {
                        "origin": origin,
                        "scope": "origin",
                        "requester": "evidence-rig",
                        "grantedAt": int(time.time() * 1000),
                    }
                ],
            }
        ),
        encoding="utf-8",
    )


def launch() -> subprocess.Popen:
    env = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(HOME_DIR),
        "TMPDIR": str(TMP_DIR),
        "LANG": "en_US.UTF-8",
        "LOCAL_OPERATOR_CONFIG_DIR": str(CONFIG_DIR),
        "LOCAL_OPERATOR_LOG_DIR": str(LOG_DIR),
        "LOCAL_OPERATOR_UI_WINDOW_MODE": "headless",
        "LOCAL_OPERATOR_NO_NOTIFICATIONS": "1",
        "LOCAL_OPERATOR_UI_TELEMETRY": "off",
        "VITE_DISABLE_BACKEND_MANAGER": "true",
    }
    log = (SCRATCH / "app.log").open("ab")
    return subprocess.Popen(
        [
            str(ELECTRON),
            ".",
            "--window-mode=headless",
            f"--user-data-dir={PROFILE_DIR}",
            "--use-mock-keychain",
            "--password-store=basic",
            f"--remote-debugging-port={free_port()}",
        ],
        cwd=str(WORKTREE),
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,  # its own process group, reaped by exact group
    )


def wait_host(pid: int, timeout_s: float = 180.0) -> dict:
    path = CONFIG_DIR / "run" / "ui-browser" / "host.json"
    started = time.time()
    while time.time() - started < timeout_s:
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            with urllib.request.urlopen(f"http://127.0.0.1:{record['port']}/health", timeout=2) as r:
                body = json.loads(r.read())
            if body.get("pid") == record["pid"] == pid:
                return record
        except Exception:
            pass
        time.sleep(0.25)
    raise SystemExit(f"no live host at {path} for pid {pid} (see {SCRATCH / 'app.log'})")


async def cells(url: str, phase: str) -> list[dict]:
    from local_operator.harness.types import BrowserSurface
    from local_operator.tools import builtin
    from local_operator.browser_bridge.backend import BridgeError, BridgeUnreachable
    from local_operator.ui_browser.backend import UiHostClient

    client = UiHostClient(CONFIG_DIR)
    state = BrowserSurface()
    state.surface_id = ""
    rows: list[dict] = []

    async def wire(method: str, **fields):
        try:
            return {"ok": True, "result": await client.call(method, fields)}
        except (BridgeError, BridgeUnreachable) as exc:
            return {
                "ok": False,
                "code": getattr(getattr(exc, "code", None), "value", None)
                or type(exc).__name__,
                "message": str(exc),
                "data": getattr(exc, "data", None),
            }

    # `open` is the wire call the tool issues for a fresh tab; the JS evidence
    # rigs do the same, because the tool's own `open` body is cmux-shaped.
    opened = await wire("open", url=url, requester="session:evidence", tab="")
    rows.append({"cell": "open the stand-in page", "actual": opened})
    tab = (opened.get("result") or {}).get("tab") or ""
    state.surface_id = tab
    if not tab:
        return rows

    async def act(action: str, **fields):
        params = builtin.BrowserParams(action=action, **fields)
        state.surface_id = tab
        result = await builtin._bridge_action(
            f"ev-{action}", state, action, params, None, client=client
        )
        return {"is_error": result.is_error, "text": result.text, "details": result.details}

    async def page_read(selector: str) -> str:
        row = await act("read", selector=selector)
        return row["text"].split("\n\n", 1)[-1].strip() if not row["is_error"] else row["text"]

    # -- the cells ---------------------------------------------------------
    rows.append({"cell": "read env echo before", "actual": await page_read("#env-echo")})
    rows.append(
        {
            "cell": "select #env -> Sandbox (python tool surface)",
            "actual": await act("select", selector="#env", options=["Sandbox"]),
            "page_after": {
                "env_echo": await page_read("#env-echo"),
                "events": await page_read("#events"),
            },
        }
    )
    rows.append(
        {
            "cell": "setvalue #when (input[type=date]) = 2026-11-06",
            "actual": await wire("setvalue", tab=tab, selector="#when", text="2026-11-06"),
            "page_after": {"when_echo": await page_read("#when-echo")},
        }
    )
    rows.append(
        {
            "cell": "setvalue #name (react-shaped controlled input) = Damian",
            "actual": await wire("setvalue", tab=tab, selector="#name", text="Damian"),
            "page_after": {
                "name_echo": await page_read("#name-echo"),
                "events": await page_read("#events"),
            },
        }
    )
    rows.append(
        {
            "cell": "setvalue #locked (disabled) -> typed refusal",
            "actual": await wire("setvalue", tab=tab, selector="#locked", text="nope"),
        }
    )
    rows.append(
        {
            "cell": "setvalue #pick (ARIA combobox widget) -> typed refusal",
            "actual": await wire("setvalue", tab=tab, selector="#pick", text="Red"),
        }
    )
    rows.append({"cell": "final page reading", "actual": await page_read("#events")})
    return rows


def main() -> int:
    phase = sys.argv[1]
    if RUN.exists():
        shutil.rmtree(RUN)
    for path in (HOME_DIR, CONFIG_DIR, LOG_DIR, PROFILE_DIR, TMP_DIR):
        path.mkdir(parents=True, exist_ok=True)
    port = free_port()
    origin = f"http://127.0.0.1:{port}"
    url = f"{origin}/{FIXTURE}"
    seed_origin(origin)
    server = serve(port)
    app = launch()
    print(json.dumps({"rig": "booted", "pid": app.pid, "url": url}), flush=True)
    try:
        record = wait_host(app.pid)
        print(json.dumps({"rig": "host", "port": record.get("port"), "pid": record["pid"]}), flush=True)
        rows = asyncio.run(cells(url, phase))
        print(json.dumps({"phase": phase, "rows": rows}, indent=1, default=str))
    finally:
        try:
            os.killpg(os.getpgid(app.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            app.wait(timeout=10)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(os.getpgid(app.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
            app.wait(timeout=10)
        server.shutdown()
        print(json.dumps({"rig": "reaped", "pid": app.pid, "exit": app.returncode}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
