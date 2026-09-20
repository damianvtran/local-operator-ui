#!/usr/bin/env python
"""
Hold a REAL pending ``ask`` gate open for the click proof.

    python serve-gate.py --port 14391 --scratch /tmp/ask-gate-rig \
        --token-file /tmp/ask-gate-rig/token --result-file /tmp/ask-gate-rig/owner-answer.json

``--answer-delay-ms N`` holds each answer's RESPONSE for N ms after the route has
run, which is how the losing order — the owner's own state push clearing the card
before the answer's response arrives — is FORCED instead of waited for. See
``RigControl``'s notes for why that is the honest way to get it.

This is the backend half of ``scripts/click-proof.mjs``. It exists so the live
frames in this directory are reproducible from the repository rather than from
whatever happened to be in a ``/tmp`` directory when they were taken: the round
1 QA pass could not re-derive them, which was a finding in its own right.

WHAT IS REAL, and why it matters here: uvicorn, the app's own bearer/origin
gate, the ``desktop_sessions`` routes, a real ``Session`` over a real transcript
directory on disk, a real ``ServingSessionHandle``, a real ``RuntimeServer``, and
a real ``_ask_gate`` — the same seam ``tests/e2e/test_desktop_sessions.py``
uses. The gate the browser answers is the one the harness would raise, with the
same ``_shape`` rotation of the recommended option, so what the page renders and
what ``/answers`` validates are the shipping code paths.

WHAT IS NOT: the provider stream. Nothing here starts a turn — the gate is armed
on a standalone task that only records its answers — so the stream function is
never called. It is deliberately a raise rather than a canned reply: a harness
that silently answers a provider call it was never meant to make would make
"no model was involved" an assumption instead of a failure.

Isolation is by construction and is the point: its own config root and its own
32-byte bearer under ``--scratch``, OS-chosen by being written to files there,
and the operator's own backend on 127.0.0.1:1111 is never addressed. Nothing
under the operator's real config or ``~/local-operator`` is written.
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
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="0 (the default) lets the OS choose, which is the isolation the rig claims",
    )
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--session-id", default="a1a1a1a1a1a1")
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--result-file", type=Path, required=True)
    parser.add_argument(
        "--answer-delay-ms",
        type=int,
        default=0,
        help=(
            "Hold every answer route's RESPONSE this long AFTER the route itself "
            "has run, so the owner's own state push (a websocket frame) reaches the "
            "page before the answer's HTTP response does. See `RigControl.answer` "
            "for why the ordering is the whole point and why it is forced here "
            "rather than left to chance."
        ),
    )
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    scratch: Path = args.scratch
    config_dir = scratch / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    (config_dir / "config.yml").write_text(
        "version: 0.0.0\nvalues:\n  hosting: test\n  model_name: mock\n"
    )
    # Set BEFORE `local_operator` is imported: the config root is resolved at
    # import time from these variables, which is exactly why the operator's own
    # environment must not be inherited into the import.
    os.environ["LOCAL_OPERATOR_CONFIG_DIR"] = str(config_dir)
    os.environ["LOCAL_OPERATOR_HOME"] = str(scratch)
    os.environ["LOCAL_OPERATOR_NO_NOTIFICATIONS"] = "1"
    os.environ["LOCAL_OPERATOR_NO_TERMINAL_TITLE"] = "1"
    os.environ.pop("NO_COLOR", None)
    for name in [key for key in os.environ if key.startswith("CMUX_")]:
        # An inherited CMUX_* variable has renamed a real workspace from an
        # earlier headless run in this repository.
        os.environ.pop(name, None)

    token = secrets.token_hex(32)
    os.environ["LOCAL_OPERATOR_DESKTOP_TOKEN"] = token
    os.environ.pop("LOCAL_OPERATOR_DESKTOP_ORIGINS", None)
    # Written 0600 rather than printed: the Vite dev server needs the same
    # bearer, and it is never an argument or a log line.
    args.token_file.write_text(token)
    args.token_file.chmod(0o600)

    import uvicorn
    from local_operator.harness.types import (
        AskOption,
        AskQuestion,
        Message,
        TextContent,
    )
    from local_operator.server.app import app
    from local_operator.session.runtime.server import RuntimeServer
    from local_operator.session.runtime.serving import ServingSessionHandle
    from local_operator.session.session import Session
    from local_operator.session.transcript import Transcript
    from local_operator.variables import VariableStore

    watching = asyncio.Event()
    armed = asyncio.Event()

    class RigControl:
        """Arm the card on request, note when a surface attaches, and record the
        answer traffic.

        ``ServingSessionHandle._gate_timeout_s`` denies an unanswered gate
        after ``PENDING_REQUEST_TIMEOUT_S`` (30s) when nothing can present it —
        and this host has no control-socket registrant, so that is the timeout
        in force here. So the card is armed when the thing that will answer it
        says it is ready: `/rig-arm`, which `scripts/click-proof.mjs` calls
        once the app shell has painted. Arming at startup instead spends the
        30 seconds on the app's own boot (measured: 15-25s here) and the card
        is denied, as ``None``, before it can be clicked — which is a timeout
        masquerading as an escape in the result.

        `.../watch` is recorded as well, because "a surface can present the
        card" is the fact the timeout policy reads and it is worth having in
        the log.

        ## Why an answer's RESPONSE can be HELD, and what an answer log buys

        Whether a press became the gate's answer is decided from two channels
        that have no ordering between them: the answer's HTTP response, and the
        owner's own state push, which is what clears the card. A run that needs
        the interesting order — push first, so the card is already gone when the
        response lands — cannot wait for a busy turn to produce it: the measured
        margin is ~76 ms (a POST response at 124 ms against a card clearing at
        200 ms), so whether a run proves anything would be a coin flip.

        `--answer-delay-ms` forces that order, and forces it HONESTLY. The
        request is delivered and the route runs untouched — the owner resolves
        the gate and pushes state at its normal time, and `answeredAt` below is
        that real moment — and only the DELIVERY of the response the route
        already produced is held back. The answer itself is unchanged; its
        response arrives late, which is exactly what a busy turn does to it.

        `/rig-state` is the record of that: one entry per answer request, with
        the epoch-ms timings a reader needs to see which channel landed first
        and the status the route chose. The driver reads it instead of sleeping
        and hoping, so a run that produced the wrong ordering can say so rather
        than photographing whatever happened to be on screen.
        """

        def __init__(self, inner: object, delay_ms: int = 0) -> None:
            self._inner = inner
            self._delay_s = max(0.0, delay_ms / 1000.0)
            self._answers: list[dict[str, object]] = []

        async def __call__(self, scope, receive, send):
            path = str(scope.get("path", ""))
            if scope["type"] == "http" and path == "/rig-arm":
                armed.set()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 200,
                        "headers": [(b"content-type", b"application/json")],
                    }
                )
                await send(
                    {"type": "http.response.body", "body": b'{"armed":true}'}
                )
                return
            if scope["type"] == "http" and path == "/rig-state":
                body = json.dumps({"answers": self._answers}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 200,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
            if scope["type"] == "http" and path.endswith("/watch"):
                watching.set()
            if (
                scope["type"] == "http"
                and scope.get("method") == "POST"
                and path.endswith("/answers")
            ):
                await self.answer(scope, receive, send)
                return
            await self._inner(scope, receive, send)

        async def answer(self, scope, receive, send) -> None:
            """Run the answer route, record it, then hold its response.

            Public and named rather than inlined into `__call__` so the three
            moments this rig is read against are one object per request: when
            the request arrived, when the route answered (the owner's own
            resolution), and when the response was actually delivered.
            """
            entry: dict[str, object] = {
                "path": str(scope.get("path", "")),
                "requestedAt": time.time() * 1000.0,
            }
            self._answers.append(entry)

            async def held(message):
                if message["type"] == "http.response.start":
                    entry["status"] = message["status"]
                    entry["answeredAt"] = time.time() * 1000.0
                    if self._delay_s:
                        await asyncio.sleep(self._delay_s)
                await send(message)
                if message["type"] == "http.response.body" and not message.get(
                    "more_body"
                ):
                    entry["deliveredAt"] = time.time() * 1000.0

            await self._inner(scope, receive, held)

    session_id = args.session_id
    workspace = scratch / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    session_dir = config_dir / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    def never_called(*_args, **_kwargs):  # pragma: no cover - see the docstring
        raise AssertionError(
            "the provider stream was called: this rig arms a gate and never "
            "starts a turn, so a model call means the setup is wrong"
        )

    session = Session(
        model=_test_model(),
        stream_fn=never_called,
        tools=[],
        transcript=Transcript(session_dir),
        system_blocks_provider=lambda *_args: [],
        yolo=True,
        cwd=str(workspace),
        variables=VariableStore(cwd=str(workspace)),
    )
    session.set_conversation_name("Ask-gate click proof", user_set=True)
    handle = ServingSessionHandle(session, asyncio.get_running_loop(), cwd=str(workspace))
    runtime = RuntimeServer(handle, kind="daemon")
    await runtime.start_in_process()
    (session_dir / ".session.pid").write_text(str(os.getpid()))

    listener = socket.socket()
    # Port 0 means the OS picks one, which is the isolation this rig claims:
    # nothing can collide with the operator's own backend or with a peer's rig.
    listener.bind(("127.0.0.1", args.port))
    server = uvicorn.Server(
        uvicorn.Config(
            RigControl(app, delay_ms=args.answer_delay_ms), log_level="error"
        )
    )
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    for _ in range(20_000):
        if server.started:
            break
        if serving.done():
            await serving
        await asyncio.sleep(0)
    if not server.started:
        raise SystemExit("uvicorn did not start")

    # Wait for the driver to say the app shell is up before arming. See
    # `RigControl`.
    # The port is written to a file and printed as soon as it is known, because
    # with `--port 0` the OS chose it and the Vite dev server has to be pointed
    # at the same one before the page can watch.
    chosen = listener.getsockname()[1]
    (scratch / "port").write_text(f"{chosen}\n")

    # The turn that provoked the question, written BEFORE the driver is allowed
    # to arm and therefore before the page has ever asked for its history.
    #
    # Not decoration, and the ordering is the whole point. `CanonicalTranscript`
    # collapses itself to `h-0 overflow-hidden` when it holds no records — the
    # stories record the same trap — so a gate fixtured against an empty
    # transcript has nothing to paint into: measured on the running app the
    # option buttons existed with a rect at `top: -30` inside a zero-height
    # scroller, which is a card nobody can see or hit-test.
    #
    # This used to run after `/rig-arm` (i.e. after `watching_surfaces()` went
    # non-empty), which is one page-load too late: the durable row was appended
    # after the app's history request had already been answered, and the row
    # never reached the transcript — the app rendered `rows=0` and the driver
    # failed with `no fieldset`. That is the real reason the committed pair could
    # not be re-derived (QA round 2's Q1 read it as the driver being unable to
    # aim; the driver was fine, the fixture was unarmed). Written here, the
    # history request sees it and the gate follows it, which is also how the app
    # always reaches this state: a question follows the turn that provoked it.
    await session.transcript.append_message(
        Message(
            role="user",
            content=[
                TextContent(
                    text="Pair the browser extension so you can drive my browser."
                )
            ],
        )
    )
    session.transcript.flush()

    print(
        f"SERVING port={chosen} session={session_id} "
        "(waiting for /rig-arm before arming the card)",
        flush=True,
    )
    await asyncio.wait_for(armed.wait(), timeout=600.0)
    print(
        f"ARMED watching={sorted(runtime.watching_surfaces())}",
        flush=True,
    )

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
        # Non-zero on purpose: `_shape` hoists the recommended option to the
        # front before the wire sees it, so a rig that asked for index 0 would
        # not exercise the rotation the frames are read against, and a click on
        # the first row would be an index-0 accident.
        recommended=1,
    )
    asking = asyncio.create_task(handle._ask_gate([question]))

    async def record() -> None:
        answers = await asking
        args.result_file.write_text(json.dumps(answers, indent=2) + "\n")
        print(f"ANSWERED {json.dumps(answers)}", flush=True)

    asyncio.create_task(record())

    # The line an operator waits for: the card is armed and answerable.
    print(f"READY port={chosen} session={session_id}", flush=True)
    await serving


def _test_model():
    """A model spec no provider is ever asked about; see the docstring."""
    from local_operator.harness.types import ModelSpec

    return ModelSpec(provider="test", model_id="ask-gate-rig", context_window=100_000)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
