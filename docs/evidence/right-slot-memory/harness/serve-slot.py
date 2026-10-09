#!/usr/bin/env python
"""Rig for the right slot's per-conversation memory frames (#894).

Derived from `docs/evidence/ask-open-default/harness/serve-open.py`, which is
itself the later revision of `ask-drawer-stuck`'s `serve-asks.py`: same two
modes, same shipping code, same isolation. What this set needs that neither
needed is small, and each piece is named where it is used:

  --mode routes   the serve daemon: the real app's routes on its own port.
  --mode owner    ONE session owned by this process: Session + ServingSessionHandle
                  + RuntimeServer, the exact shape `tests/e2e/test_desktop_sessions.py`
                  assembles in-process. One owner per process because each publishes
                  its own runtime record (run/mobile/<pid>.json).

WHAT IS CARRIED OVER UNCHANGED, AND WHY IT MATTERS HERE

* A SEED PER OWNER (`--ask`). The unit under test is the SLOT's occupant, so the
  two conversations have to be plainly different from each other and otherwise
  ordinary: distinct titles, distinct opening exchanges, and (on B only) a live
  queued-ask engine, which is what lets the asks drawer be opened by hand over a
  conversation that also remembers a panel. A has no ask engine at all, so its
  frames carry no ask chrome to argue about.
* A COMMAND CHANNEL (`<scratch>/cmd/<session_id>/*.json`). "An ask arrives after
  the view is up" can only be shown by raising one AFTER a view has mounted, and
  the owner is a separate process the driver cannot call. The driver drops a JSON
  file; the owner executes it on its own loop and writes `<name>.done.json`.
  Ops: `enqueue` (a queued ask), `answer`, `publish` (re-send the queue frame
  unchanged), `records` (the queue's own rows, so the driver can build the
  complete answers map for an ask it did not create) and `todos` (seed a phased
  plan, which is what gives the run panel a body to draw - a STAGED INPUT, on the
  app's own `restore_todos` + `refresh_frontend_state` pair, disclosed in the
  README rather than dressed up as a live run).
* A PROVIDER STUB. A raise inside the turn would leave a failed-turn banner in a
  frame, and the run panel's own arrival case needs a turn that can run at all.
  The stub answers every call with one short text turn and never calls a tool, so
  it can neither answer an ask nor withdraw one: whatever happens to a queued ask
  in this rig is the user's doing or the driver's.

Everything else is shipping code; no real provider is ever called. Isolation is
by construction: its own config root, own 32-byte bearer, OS-assigned ports. The
operator's own backend on 127.0.0.1:1111 is never addressed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import secrets
import socket
import sys
from pathlib import Path


# The plan the run panel's arrival frame draws. A STAGED INPUT (the README says so):
# it reaches the pane through the runtime's OWN `restore_todos`, so the wire shape the
# panel reads is the runtime's, but the plan itself is the rig's.
DEFAULT_TODO_PHASES = [
    {
        "name": "Ship the release",
        "items": [
            {"text": "Confirm the deploy target", "status": "done"},
            {"text": "Cut the candidate build", "status": "in_progress"},
            {"text": "Announce the window", "status": "pending"},
        ],
    }
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--mode", choices=["routes", "owner"], required=True)
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--title", default="")
    parser.add_argument(
        "--ask",
        action="store_true",
        # The ask engine is OFF by default: a conversation with no queued-ask
        # capability at all is the shape A has, and the arm that needs one names it.
        help="install the queued-ask host hook on this conversation",
    )
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
    # A parent `lop` exports two prefixes the CHILD product reads (AGENTS.md, core
    # repo, "Isolating a run"): CMUX_* renames the operator's real cmux workspaces,
    # and LOP_* picks a provider/model for a child runtime. `rig-up.sh` starts this
    # under `env -i`, so neither is present; this is the second line for a hand-run
    # of the script.
    for name in [key for key in os.environ if key.startswith(("CMUX_", "LOP_"))]:
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


class HoldStreamStart:
    """Hold the START of one session's desktop events stream while its hold file exists.

    WHY THIS EXISTS (design review round 1, D1). The run pane's arrival is a ~60 ms
    window - the flag projects at the bind, the pane draws when this stream's
    snapshot lands (its `runDetails` wait on the canonical frontend) - and the
    driver's shutter cannot be aimed at it: CDP `Page.captureScreenshot` paints /
    fetches a fresh surface, and a capture REQUEST inside the window was measured to
    produce a frame of the DRAWN pane (two DOM readings bracketing the request both
    showed the empty column; the frame did not). The design round's own approved
    remedy is to hold the frame response: with the snapshot held, the pane cannot
    draw, and the still photographs the state the app genuinely passes through (the
    flag projected, the pane not drawable yet) with its stay extended for the
    shutter. The extension is DISCLOSED in the set's README, and the unheld gate is
    recorded separately (the sampler's per-frame marks, which have no shutter to
    race).

    The driver writes `<scratch>/hold/<session_id>` before the held hop and removes
    it when the still is taken; the wait is bounded so a stray file cannot hang the
    rig. Only the stream's START is delayed - nothing else about the response or the
    daemon changes.
    """

    def __init__(self, app, scratch: Path):
        self.app = app
        self.hold_dir = scratch / "hold"

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http":
            match = re.match(
                r"^/v1/desktop/sessions/([a-f0-9]{12})/events$", scope.get("path", "")
            )
            if match:
                hold = self.hold_dir / match.group(1)
                if hold.exists():
                    loop = asyncio.get_running_loop()
                    deadline = loop.time() + 15.0
                    while hold.exists() and loop.time() < deadline:
                        await asyncio.sleep(0.02)
        await self.app(scope, receive, send)


def build_question(question_id: str, text: str, labels: list[str]):
    from local_operator.harness.types import AskOption, AskQuestion

    return AskQuestion(
        id=question_id,
        question=text,
        options=[AskOption(label=label) for label in labels],
    )


def seed_todos(session_id: str, phases=None) -> list[dict]:
    """Seed a phased plan on this session's own todo table.

    The run panel draws `frontend.todos` through `deriveRunDetails`, so a pane
    with a plan in it is a frame that says which pane it is. Reached through the
    runtime's OWN `restore_todos` (the resume path's function) rather than by
    writing the frontend frame directly, so the wire shape the panel reads is the
    runtime's.
    """
    from local_operator.tools.builtin import restore_todos

    if phases is None:
        phases = DEFAULT_TODO_PHASES
    restore_todos(session_id, list(phases))
    return list(phases)


async def run_commands(session, cmd_dir: Path) -> None:
    """Execute the driver's command files on THIS process's loop, in name order.

    A file is claimed by rename before it is read, so a command is executed once
    even if the driver is slow to notice the result; the result lands beside it as
    `<name>.done.json` and the driver deletes both. A command that raises writes
    the error as its result instead of killing the loop: the driver's `ok` check
    names it.
    """
    cmd_dir.mkdir(parents=True, exist_ok=True)
    while True:
        for path in sorted(cmd_dir.glob("*.json")):
            if path.name.endswith(".done.json") or path.name.endswith(".busy.json"):
                continue
            claimed = path.with_suffix(".busy.json")
            try:
                path.rename(claimed)
            except OSError:
                continue
            result: dict
            try:
                command = json.loads(claimed.read_text())
                result = {"ok": True, **execute(session, command)}
            except Exception as error:  # noqa: BLE001 - the driver reads this verbatim
                result = {"ok": False, "error": f"{type(error).__name__}: {error}"}
            claimed.unlink(missing_ok=True)
            path.with_suffix(".done.json").write_text(json.dumps(result))
        await asyncio.sleep(0.1)


def execute(session, command: dict) -> dict:
    op = command["op"]
    if op == "todos":
        phases = seed_todos(session.session_id, command.get("phases"))
        session.refresh_frontend_state()
        return {"phases": len(phases)}
    queue = session.ask_queue()
    if op == "enqueue":
        question = build_question(
            command.get("question_id", "followup"),
            command["question"],
            list(command.get("options") or ["Yes", "No"]),
        )
        receipt = session._enqueue_ask([question], command.get("timeout", 3600))
        if not receipt.get("ok"):
            raise RuntimeError(receipt.get("error", "enqueue refused"))
        return {"ask_id": receipt["details"]["ask_id"]}
    if op == "answer":
        outcome = session.respond_ask(
            command["ask_id"], command["answers"], by=command.get("by", "rig")
        )
        if not outcome.get("ok"):
            raise RuntimeError(outcome.get("error", "answer refused"))
        return {}
    if op == "publish":
        session.publish_ask_state()
        return {}
    if op == "records":
        return {
            "records": [
                {
                    "ask_id": row["ask_id"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                    # The question ids ride so the driver can build the COMPLETE
                    # answers map the queue demands (every question id present) for
                    # an ask it did not create itself.
                    "question_ids": [q["id"] for q in row.get("questions") or []],
                }
                for row in queue.records()
            ]
        }
    raise ValueError(f"unknown op {op!r}")


async def main() -> None:
    args = parse_args()
    scratch: Path = args.scratch
    prepare_env(scratch)

    if args.mode == "routes":
        from local_operator.server.app import app

        # The hold is this rig's own middleware (see HoldStreamStart): a monitor has no
        # lever for a 60 ms window, and the daemon is the one process that CAN hold the
        # frame response. It is inert unless `<scratch>/hold/<session>` exists.
        await serve_listener(
            HoldStreamStart(app, scratch), args.port, scratch / "routes-port"
        )
        return

    # ---- owner mode ----
    from local_operator.harness.types import (
        Message,
        ModelSpec,
        StreamEndEvent,
        StreamTextDelta,
        TextContent,
    )
    from local_operator.session.runtime.server import RuntimeServer
    from local_operator.session.runtime.serving import ServingSessionHandle
    from local_operator.session.session import Session
    from local_operator.session.transcript import Transcript
    from local_operator.variables import VariableStore

    session_id = args.session_id
    config_dir = scratch / "config"
    workspace = scratch / "workspace" / session_id
    workspace.mkdir(parents=True, exist_ok=True)
    session_dir = config_dir / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    def stub_stream(_request, _signal=None):
        """One short text turn for every call, and never a tool call (see the module note)."""

        async def events():
            yield StreamTextDelta(
                delta="Understood. I will carry on with the parts that do not depend on that."
            )
            yield StreamEndEvent(stop_reason="stop")

        return events()

    async def stub_ask_user(_questions):
        return None

    session = Session(
        model=ModelSpec(provider="test", model_id="slot-rig", context_window=100_000),
        stream_fn=stub_stream,
        tools=[],
        transcript=Transcript(session_dir),
        system_blocks_provider=lambda *_a: [],
        yolo=True,
        cwd=str(workspace),
        variables=VariableStore(cwd=str(workspace)),
    )
    if args.title:
        session.set_conversation_name(args.title, user_set=True)
    # THE HOST HOOK: without it `ask_queue()` is None and the ask tool does not
    # exist. A conversation WITHOUT it is the ordinary shape and is left that way.
    if args.ask:
        session.set_ask_handler(stub_ask_user)

    handle = ServingSessionHandle(session, asyncio.get_running_loop(), cwd=str(workspace))
    runtime = RuntimeServer(handle, kind="daemon")
    await runtime.start_in_process()
    (session_dir / ".session.pid").write_text(str(os.getpid()))

    async def append(role: str, text: str) -> None:
        await session.transcript.append_message(
            Message(role=role, content=[TextContent(text=text)])
        )
        session.transcript.flush()

    opening = (
        (
            "Deploy the release candidate when you are ready.",
            "The candidate is built and the checklist is green. Nothing is deployed yet.",
        )
        if args.title.startswith("Deploy")
        else (
            "Jot down the notes from the review call.",
            "Noted. The review call raised three follow-ups, none of them urgent.",
        )
    )
    await append("user", opening[0])
    await append("assistant", opening[1])

    if args.ask:
        # Touch the queue so the engine is live: `asks_open: 0` is published, which
        # is the live-but-empty shape (capability present, nothing queued). The
        # pending ask a case needs is raised LATER, through the command channel, so
        # every frame that shows one shows an ask that arrived while its view was up.
        session.ask_queue()
        session.publish_ask_state()
        # Publish once so the conversation's canonical frame exists before any page
        # opens it (the run panel's arrival case reads what the route can draw).
        session.refresh_frontend_state()

    asyncio.create_task(run_commands(session, scratch / "cmd" / session_id))
    (scratch / f"owner-{session_id}-ready").write_text("ready\n")
    print(f"OWNER session={session_id} pid={os.getpid()} record={runtime.record_path}", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
