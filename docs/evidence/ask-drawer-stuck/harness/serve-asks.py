#!/usr/bin/env python
"""Repro rig for the asks-canvas stuck-open bug. Two modes:

  --mode routes   the serve daemon: the real app's routes on its own port.
  --mode owner    ONE session owned by this process: Session + ServingSessionHandle
                  + RuntimeServer, the exact shape tests/e2e/test_desktop_sessions.py
                  assembles in-process. Owners each publish their own runtime record
                  (run/mobile/<pid>.json — one record per PROCESS, which is why the
                  sessions cannot share a process).

The owner of session A can enqueue a REAL queued ask through the session's own
engine (`--ask`); session B is live with an EMPTY queue (the empty wire shape).

Everything is shipping code; the provider stream is never called. Isolation is by
construction: its own config root, own 32-byte bearer, OS-assigned ports. The
operator's own backend on 127.0.0.1:1111 is never addressed.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import secrets
import socket
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--mode", choices=["routes", "owner"], required=True)
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--title", default="")
    parser.add_argument("--ask", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    return parser.parse_args()


def prepare_env(scratch: Path) -> None:
    config_dir = scratch / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    cfg = config_dir / "config.yml"
    if not cfg.exists():
        cfg.write_text("version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n")
    os.environ["LOCAL_OPERATOR_CONFIG_DIR"] = str(config_dir)
    os.environ["LOCAL_OPERATOR_HOME"] = str(scratch)
    os.environ["LOCAL_OPERATOR_NO_NOTIFICATIONS"] = "1"
    os.environ["LOCAL_OPERATOR_NO_TERMINAL_TITLE"] = "1"
    os.environ.pop("NO_COLOR", None)
    for name in [key for key in os.environ if key.startswith("CMUX_")]:
        os.environ.pop(name, None)

    token_file = scratch / "token"
    if not token_file.exists():
        token_file.write_text(secrets.token_hex(32))
        token_file.chmod(0o600)
    os.environ["LOCAL_OPERATOR_DESKTOP_TOKEN"] = token_file.read_text().strip()
    os.environ.pop("LOCAL_OPERATOR_DESKTOP_ORIGINS", None)


async def serve_listener(app, port: int, ready_file: Path) -> None:
    import uvicorn

    listener = socket.socket()
    listener.bind(("127.0.0.1", port))
    server = uvicorn.Server(uvicorn.Config(app, log_level="error"))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    for _ in range(40_000):
        if server.started:
            break
        if serving.done():
            await serving
        await asyncio.sleep(0)
    if not server.started:
        raise SystemExit("uvicorn did not start")
    chosen = listener.getsockname()[1]
    ready_file.write_text(f"{chosen}\n")
    print(f"READY port={chosen}", flush=True)
    await serving


async def main() -> None:
    args = parse_args()
    scratch: Path = args.scratch
    prepare_env(scratch)

    if args.mode == "routes":
        from local_operator.server.app import app

        await serve_listener(app, args.port, scratch / "routes-port")
        return

    # ---- owner mode ----
    from local_operator.harness.types import (
        AskOption,
        AskQuestion,
        Message,
        TextContent,
    )
    from local_operator.session.runtime.server import RuntimeServer
    from local_operator.session.runtime.serving import ServingSessionHandle
    from local_operator.session.session import Session
    from local_operator.session.transcript import Transcript
    from local_operator.variables import VariableStore

    session_id = args.session_id
    config_dir = scratch / "config"
    workspace = scratch / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    session_dir = config_dir / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    def never_called(*_a, **_k):  # pragma: no cover
        raise AssertionError("provider stream called; this rig starts no turns")

    async def stub_ask_user(_questions):
        return None

    from local_operator.harness.types import ModelSpec

    session = Session(
        model=ModelSpec(provider="test", model_id="asks-rig", context_window=100_000),
        stream_fn=never_called,
        tools=[],
        transcript=Transcript(session_dir),
        system_blocks_provider=lambda *_a: [],
        yolo=True,
        cwd=str(workspace),
        variables=VariableStore(cwd=str(workspace)),
    )
    if args.title:
        session.set_conversation_name(args.title, user_set=True)
    # THE HOST HOOK: without it `ask_queue()` is None and the ask tool does not exist.
    session.set_ask_handler(stub_ask_user)

    handle = ServingSessionHandle(
        session, asyncio.get_running_loop(), cwd=str(workspace)
    )
    runtime = RuntimeServer(handle, kind="daemon")
    await runtime.start_in_process()
    (session_dir / ".session.pid").write_text(str(os.getpid()))

    async def append(role: str, text: str) -> None:
        await session.transcript.append_message(
            Message(role=role, content=[TextContent(text=text)])
        )
        session.transcript.flush()

    if args.ask:
        await append("user", "Deploy the release candidate when you are ready.")
        await append(
            "assistant",
            "Before I deploy that one, I need one decision from you.",
        )
    else:
        await append("user", "Jot down the notes from the review call.")

    marker = scratch / f"owner-{session_id}-ready"
    marker.write_text("ready\n")

    if args.ask:
        question = AskQuestion(
            id="deploy-target",
            question="Which environment should I deploy the release candidate to?",
            options=[
                AskOption(label="Staging", description="Ship it to staging and report back."),
                AskOption(
                    label="Production",
                    description="Go straight to production after the smoke tests.",
                ),
                AskOption(label="Hold off"),
            ],
        )
        receipt = session._enqueue_ask([question], 3600)
        print(f"ENQUEUED {receipt}", flush=True)

    print(
        f"OWNER session={session_id} pid={os.getpid()} record={runtime.record_path}",
        flush=True,
    )
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
