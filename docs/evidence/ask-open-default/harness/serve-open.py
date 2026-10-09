#!/usr/bin/env python
"""Rig for the asks-open-by-default frames. Derived from the ask-drawer-stuck set's
`serve-asks.py` (same two modes, same shipping code, same isolation), with the three
things that set's rig did not need and this one does.

  --mode routes   the serve daemon: the real app's routes on its own port.
  --mode owner    ONE session owned by this process: Session + ServingSessionHandle
                  + RuntimeServer, the exact shape tests/e2e/test_desktop_sessions.py
                  assembles in-process. One owner per process because each publishes
                  its own runtime record (run/mobile/<pid>.json).

WHAT THIS ADDS TO THAT RIG, AND WHY EACH IS NEEDED

1. A SEED PER OWNER (`--seed`). The open policy is a decision about what a conversation
   holds WHEN IT IS OPENED, so the four states of the matrix need four conversations
   whose queues are in four known shapes before any page exists:
     pending   one queued ask, created at start - so it EXISTED BEFORE any view of it
               (the policy's "pending on open" is measured against that instant);
     empty     a live queue with nothing in it (`asks` absent, `asks_open: 0`);
     settled   one ask queued and then answered - every ask already addressed.
     none      NO QUEUED-ASK ENGINE: the host never installs its ask handler, so the
               session has no `ask_queue()` and its frame publishes neither `asks` nor
               `asks_open`. That is the "unsupported / unpublished" shape of rule 5 - the
               one a policy must read as "nothing to open", not as "no asks".
2. A COMMAND CHANNEL (`<scratch>/cmd/<session_id>/*.json`). "A new ask arriving later
   does not force the surface open" can only be shown by raising an ask AFTER a view has
   mounted, and the owner is a separate process the driver cannot call. The driver drops
   a JSON file; the owner executes it on its own loop and writes `<name>.done.json`.
   Ops: `enqueue` (a new queued ask), `answer`, `publish` (re-send the queue frame
   unchanged - a queue REFRESH with no change in content) and `records`.
3. A PROVIDER STUB. The other rig never started a turn, so its stream raised if called.
   The row "type and send a normal message from the main composer" starts a turn, and a
   raising stream would leave a failed-turn banner in the frame. The stub answers every
   call with one short text turn and never calls a tool, so it can neither answer an
   ask nor withdraw one: whatever happens to an ask in this rig is the user's doing or
   the driver's.

Everything else is shipping code; no real provider is ever called. Isolation is by
construction: its own config root, own 32-byte bearer, OS-assigned ports. The
operator's own backend on 127.0.0.1:1111 is never addressed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
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
    parser.add_argument(
        "--seed", choices=["pending", "empty", "settled", "none"], default="empty"
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
    # A parent `lop` exports two prefixes the CHILD product reads (AGENTS.md, core repo,
    # "Isolating a run"): CMUX_* renames the operator's real cmux workspaces, and LOP_*
    # picks a provider/model for a child runtime. `rig-up.sh` starts this under `env -i`,
    # so neither is present; this is the second line for a hand-run of the script.
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


def build_question(question_id: str, text: str, labels: list[str]):
    from local_operator.harness.types import AskOption, AskQuestion

    return AskQuestion(
        id=question_id,
        question=text,
        options=[AskOption(label=label) for label in labels],
    )


async def run_commands(session, cmd_dir: Path) -> None:
    """Execute the driver's command files on THIS process's loop, in name order.

    A file is claimed by rename before it is read, so a command is executed once even
    if the driver is slow to notice the result; the result lands beside it as
    `<name>.done.json` and the driver deletes both. A command that raises writes the
    error as its result instead of killing the loop: the driver's `ok` check names it.
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
                    # The question ids ride so the driver can build the COMPLETE answers map
                    # the queue demands (every question id present) for an ask it did not
                    # create itself: the seeded one, or one read back off the page.
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

        await serve_listener(app, args.port, scratch / "routes-port")
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
    workspace = scratch / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    session_dir = config_dir / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    def stub_stream(_request, _signal=None):
        """One short text turn for every call, and never a tool call (see the module note)."""

        async def events():
            yield StreamTextDelta(
                delta="Noted. I will carry on with the parts that do not depend on that answer."
            )
            yield StreamEndEvent(stop_reason="stop")

        return events()

    async def stub_ask_user(_questions):
        return None

    session = Session(
        model=ModelSpec(provider="test", model_id="asks-rig", context_window=100_000),
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
    # THE HOST HOOK: without it `ask_queue()` is None and the ask tool does not exist.
    # The `none` seed leaves it out ON PURPOSE: that absence is the shape it exists to show.
    if args.seed != "none":
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

    opening = {
        "pending": (
            "Deploy the release candidate when you are ready.",
            "Before I deploy that one, I need one decision from you.",
        ),
        "settled": (
            "Export last month's invoices to CSV.",
            "Done - the export is in the workspace. You picked the staging bucket for it.",
        ),
        "empty": (
            "Jot down the notes from the review call.",
            "Noted. Nothing else is waiting on you here.",
        ),
        "none": (
            "Check which runtime this conversation is on.",
            "This one runs without the queued-ask engine, so nothing here can be asked.",
        ),
    }[args.seed]
    await append("user", opening[0])
    await append("assistant", opening[1])

    # The ask is queued HERE, before the ready marker, so by the time any page opens this
    # conversation its `created_at` is seconds to minutes older than the view: that gap is
    # what the policy's "existed before the view" test reads.
    if args.seed in ("pending", "settled"):
        question = build_question(
            "deploy-target",
            "Which environment should I deploy the release candidate to?"
            if args.seed == "pending"
            else "Which bucket should the invoice export go to?",
            ["Staging", "Production", "Hold off"],
        )
        receipt = session._enqueue_ask([question], 3600)
        print(f"ENQUEUED {receipt}", flush=True)
        if args.seed == "settled":
            ask_id = receipt["details"]["ask_id"]
            outcome = session.respond_ask(ask_id, {"deploy-target": ["Staging"]}, by="rig-seed")
            print(f"ANSWERED {outcome}", flush=True)
    elif args.seed == "empty":
        # Touch the queue so the engine is live: `asks_open: 0` is published, which is the
        # live-but-empty shape (capability present, nothing queued).
        session.ask_queue()
        session.publish_ask_state()
    # `none`: deliberately nothing. No engine means no queue to touch and no frame field.

    asyncio.create_task(run_commands(session, scratch / "cmd" / session_id))
    (scratch / f"owner-{session_id}-ready").write_text("ready\n")
    print(f"OWNER session={session_id} pid={os.getpid()} record={runtime.record_path}", flush=True)
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
