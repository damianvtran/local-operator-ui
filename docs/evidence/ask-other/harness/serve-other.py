#!/usr/bin/env python
"""Backend half of the `ask-other` evidence rig. Two modes:

  --mode routes   the serve daemon: the real app's routes on their own port.
  --mode owner    ONE session owned by this process: Session + ServingSessionHandle
                  + RuntimeServer, the shape tests/e2e/test_desktop_sessions.py
                  assembles in-process (one runtime record per PROCESS, which is why
                  two sessions cannot share a process).

`--role asks` owns the session whose drawer the matrix drives. `--role gate` owns a
second session that holds the LEGACY BLOCKING ask (`ServingSessionHandle._ask_gate`),
the regression neighbour the change must not move.

WHAT IS SHIPPING CODE: uvicorn, the app's own bearer/origin gate, the
`desktop_sessions` routes, a real `Session` over a real transcript directory, a real
`ServingSessionHandle`, a real `RuntimeServer`, and the real `AskQueue` (its append-only
`asks.jsonl` is the truth the driver reads back). Isolation is by construction: its own
config root, own 32-byte bearer, OS-assigned ports; the operator's own backend on
127.0.0.1:1111 is never addressed.

WHAT THIS RIG ADDS, and why each is disclosed rather than hidden:

1. A RECORDING PROVIDER STREAM instead of a stream that raises. The composer-send row
   has to prove a normal chat message reaches the agent as a plain user message, and
   the only honest witness is the provider call itself. Every call is appended to
   `provider-calls-<session>.jsonl` with the user-role texts the model was handed; the
   reply is a fixed one-line acknowledgement. It never calls a tool, so it never calls
   `ask_withdraw`: whether an ask stays open after a chat send is the UI's doing here,
   not the model's.

2. SCENARIOS ON DEMAND, by marker file. The drawer lists every settled ask beneath the
   pending one, so enqueuing all of the matrix's asks up front would put six cards in
   one 560px pane and make every frame (and every geometry number) a function of how
   many came before. The driver touches `triggers/enqueue-<name>` and this process
   enqueues exactly that ask through the session's own `_enqueue_ask`, the call the
   `ask` tool makes, then writes `triggers/enqueued-<name>.json` with the receipt.

3. ONE QUESTION THE REAL TOOL CANNOT PRODUCE: the free-text-only question.
   `AskQuestion` refuses a non-secret question with fewer than two options ("at least
   two answers to pick from"), so no model can emit one today. The wire contract
   (`PendingAskQuestion.options` is optional) and the card both carry the shape, an
   older or other producer can send it, and the card used to draw a bare input for it.
   `AskQueue.enqueue` takes plain mappings and does not run that validator, so the rig
   enqueues it as a plain dict. Every other scenario goes through `AskQuestion`.

4. A HELD DELIVERY, for the change-before-delivery window. `delivered` flips when the
   answer's response row is durably appended, which is milliseconds after an answer, so
   the card's `Change answer` window is never on screen long enough to photograph. While
   `triggers/hold-delivery` exists this process defers `Session.deliver_ask_messages`
   (and nothing else), then delivers normally when the marker is removed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import socket
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--mode", choices=["routes", "owner"], required=True)
    parser.add_argument("--role", choices=["asks", "gate"], default="asks")
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--title", default="")
    parser.add_argument("--port", type=int, default=0)
    return parser.parse_args()


def prepare_env(scratch: Path) -> None:
    config_dir = scratch / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    cfg = config_dir / "config.yml"
    if not cfg.exists():
        cfg.write_text("version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n")
    # Set BEFORE `local_operator` is imported: the config root is resolved at import
    # time, which is exactly why the operator's own environment must not leak in.
    os.environ["LOCAL_OPERATOR_CONFIG_DIR"] = str(config_dir)
    os.environ["LOCAL_OPERATOR_HOME"] = str(scratch)
    os.environ["LOCAL_OPERATOR_NO_NOTIFICATIONS"] = "1"
    os.environ["LOCAL_OPERATOR_NO_TERMINAL_TITLE"] = "1"
    os.environ.pop("NO_COLOR", None)
    for name in [key for key in os.environ if key.startswith("CMUX_")]:
        # An inherited CMUX_* variable has renamed a real workspace from an earlier
        # headless run in this repository.
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
    triggers = scratch / "triggers"
    triggers.mkdir(parents=True, exist_ok=True)

    class RecordingStream:
        """A provider that records what it was asked and answers in one line."""

        def __init__(self, path: Path) -> None:
            self.path = path
            self.calls = 0

        def __call__(self, request, signal):
            self.calls += 1
            users = []
            for message in request.messages:
                if message.role != "user":
                    continue
                users.append(
                    "".join(getattr(part, "text", "") or "" for part in message.content)
                )
            with self.path.open("a") as handle:
                handle.write(
                    json.dumps(
                        {
                            "call": self.calls,
                            "at_ms": int(time.time() * 1000),
                            "messages": len(request.messages),
                            # The tail, not the whole history: the last user-role
                            # rows are what the model was just handed.
                            "user_tail": [text[:400] for text in users[-4:]],
                        }
                    )
                    + "\n"
                )

            async def events():
                yield StreamTextDelta(delta="Noted. I will carry on with that.")
                yield StreamEndEvent(stop_reason="stop")

            return events()

    stream = RecordingStream(scratch / f"provider-calls-{session_id}.jsonl")
    session = Session(
        model=ModelSpec(provider="test", model_id="ask-other-rig", context_window=100_000),
        stream_fn=stream,
        tools=[],
        transcript=Transcript(session_dir),
        system_blocks_provider=lambda *_a: [],
        yolo=True,
        cwd=str(workspace),
        variables=VariableStore(cwd=str(workspace)),
    )
    # NAMED UP FRONT: an unnamed session fires the one-shot auto-naming errand, which is
    # a real provider call and would be recorded (and answered) as if it were a turn.
    session.set_conversation_name(args.title or "Ask rig", user_set=True)
    handle = ServingSessionHandle(session, asyncio.get_running_loop(), cwd=str(workspace))
    runtime = RuntimeServer(handle, kind="daemon")
    await runtime.start_in_process()
    (session_dir / ".session.pid").write_text(str(os.getpid()))
    if args.role == "asks":
        assert session.ask_queue() is not None, "the handle did not install the ask engine"

    async def append(role: str, text: str) -> None:
        await session.transcript.append_message(
            Message(role=role, content=[TextContent(text=text)])
        )
        session.transcript.flush()

    # The turn that provoked the question, written BEFORE the page ever asks for history:
    # a transcript with no records collapses to zero height, and a card painted into it
    # is one nobody can see or hit-test.
    if args.role == "asks":
        await append("user", "Deploy the release candidate when you are ready.")
        await append("assistant", "Before I deploy that one, I need a few decisions from you.")
    else:
        await append("user", "Pair the browser extension so you can drive my browser.")

    (scratch / f"owner-{session_id}-ready").write_text("ready\n")
    print(f"OWNER role={args.role} session={session_id} pid={os.getpid()}", flush=True)

    # ------------------------------------------------------------ the legacy gate ----
    if args.role == "gate":
        while not (triggers / "arm-gate").exists():
            await asyncio.sleep(0.2)
        question = AskQuestion(
            id="PAIRING",
            question="Is the extension popup open?",
            options=[
                AskOption(
                    label="Popup is open - generate the pairing code",
                    description="I will read the code back to you.",
                ),
                AskOption(
                    label="Popup is not open",
                    description="Walk me through opening it first.",
                ),
                AskOption(label="Something else"),
            ],
            recommended=1,
        )
        answers = await handle._ask_gate([question])
        (scratch / "gate-answer.json").write_text(json.dumps(answers, indent=2) + "\n")
        print(f"GATE ANSWERED {json.dumps(answers)}", flush=True)
        await asyncio.Event().wait()
        return

    # --------------------------------------------------------- the scenario asks ----
    def build(name: str):
        if name == "region":
            return [
                AskQuestion(
                    id="region",
                    question="Which region should the canary run in?",
                    options=[
                        AskOption(label="eu-west"),
                        AskOption(label="us-east"),
                        AskOption(label="ap-south"),
                    ],
                )
            ]
        if name == "deploy-target":
            return [
                AskQuestion(
                    id="deploy-target",
                    question="Which environment should I deploy the release candidate to?",
                    options=[
                        AskOption(
                            label="Staging", description="Ship it to staging and report back."
                        ),
                        AskOption(
                            label="Production",
                            description="Go straight to production after the smoke tests.",
                        ),
                        AskOption(label="Hold off"),
                    ],
                    recommended=1,
                )
            ]
        if name == "checks":
            return [
                AskQuestion(
                    id="checks",
                    question="Which checks should run before the deploy?",
                    multi=True,
                    options=[
                        AskOption(label="Unit tests"),
                        AskOption(label="Integration tests"),
                        AskOption(label="Smoke tests"),
                    ],
                )
            ]
        if name == "release-name":
            # THE ONE PLAIN DICT: see the module note, item 3.
            return [
                {
                    "id": "release-name",
                    "question": "What should the release be called?",
                    "options": [],
                    "multi": False,
                    "recommended": None,
                    "secret": False,
                    "persist": False,
                }
            ]
        if name == "deploy_key":
            return [
                AskQuestion(
                    id="deploy_key",
                    question="Paste the deploy key so I can sign the release.",
                    secret=True,
                )
            ]
        if name == "rotate":
            return [
                AskQuestion(
                    id="rotate",
                    question="Should I rotate the API keys before the deploy?",
                    options=[
                        AskOption(label="Yes, rotate them now"),
                        AskOption(label="No, leave them as they are"),
                    ],
                )
            ]
        if name in ("change", "change-other"):
            return [
                AskQuestion(
                    id=name,
                    question=(
                        "Which environment should the first deploy go to?"
                        if name == "change"
                        else "Which build should the canary start from?"
                    ),
                    options=[
                        AskOption(label="Staging"),
                        AskOption(label="Production"),
                        AskOption(label="Hold off"),
                    ],
                )
            ]
        raise KeyError(name)

    # THE HELD DELIVERY (module note, item 4). An attribute on the INSTANCE: the queue
    # reaches the session through `self._session.deliver_ask_messages`, so this wraps
    # exactly that one call and nothing else about delivery.
    #
    # DEFERRED, NEVER BLOCKED. The answer route awaits the reconcile that calls this, so
    # a wrapper that WAITED here would hold the answer's own HTTP response too, and the
    # card would sit in its `answering` state with `Change answer` disabled - a frame of
    # a rig artifact, not of the product (measured: the first full run of this rig). The
    # delivery is instead handed to a background task that waits for the marker to go,
    # so the answer returns at once, the ask is `answered` and `delivered: false` (the
    # flag is the durable append of the response row, which has not happened yet), and
    # the row lands when the hold lifts.
    original_deliver = session.deliver_ask_messages
    deferred: set[asyncio.Task] = set()

    async def held_deliver(messages):
        hold = triggers / "hold-delivery"
        if not hold.exists():
            await original_deliver(messages)
            return

        async def later() -> None:
            started = time.time()
            while hold.exists() and time.time() - started < 240:
                await asyncio.sleep(0.1)
            with (scratch / "delivery-log.jsonl").open("a") as log:
                log.write(
                    json.dumps(
                        {
                            "rows": len(messages),
                            "held_ms": int((time.time() - started) * 1000),
                            "at_ms": int(time.time() * 1000),
                        }
                    )
                    + "\n"
                )
            await original_deliver(messages)

        task = asyncio.create_task(later())
        deferred.add(task)  # a strong reference: an unreferenced task can be collected
        task.add_done_callback(deferred.discard)

    session.deliver_ask_messages = held_deliver  # type: ignore[method-assign]

    while True:
        for marker in sorted(triggers.glob("enqueue-*")):
            name = marker.name[len("enqueue-") :]
            try:
                receipt = session._enqueue_ask(build(name), 3600)
            except Exception as error:  # noqa: BLE001 - reported to the driver verbatim
                receipt = {"ok": False, "error": f"{type(error).__name__}: {error}"}
            (triggers / f"enqueued-{name}.json").write_text(json.dumps(receipt) + "\n")
            marker.unlink()
            print(f"ENQUEUED {name} ok={receipt.get('ok')}", flush=True)
        await asyncio.sleep(0.2)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
