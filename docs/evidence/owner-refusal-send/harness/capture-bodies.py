#!/usr/bin/env python3
"""Capture the desktop ladder's OWN refusal bodies, so the stub beside this file
answers what the backend answers rather than what we assumed it answers.

Run it against a backend checkout (`local-operator`) with that checkout's venv and
this worktree nowhere in the picture:

    PYTHONPATH=<backend checkout> <backend checkout>/.venv/bin/python \
      docs/evidence/owner-refusal-send/harness/capture-bodies.py

It is a capture and not a reconstruction. A throwaway FastAPI app mounts the very
ladder every desktop control route runs inside
(`local_operator.server.routes.desktop_sessions.errors`) and raises each refusal
inside it, so the status, the body and the headers printed here are produced by
the shipping code - the same context manager, the same `HTTPException`, the same
`RUNTIME_*` and sentence constants. What it does not carry is the route around
the ladder (session lookup, the receipt journal, the bridge), which cannot change
what the ladder answers for a refusal raised inside it.

The bodies it printed for backend `origin/main` = `5bc34c90` (0.62.14) are quoted
in `stub-owner.mjs`'s header. The values to notice are the shapes, not just the
words: `runtime_retiring` arrives as a plain STRING `detail` with no `code` (the
ladder's coded arm does not cover `RuntimeRetiring`), while `runtime_busy` and
`runtime_unreachable` arrive coded, and the busy body's `message` is the shared
unreachable sentence on purpose.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, Request
from starlette.testclient import TestClient

from local_operator.server.routes import desktop_sessions as routes
from local_operator.session.attached import RuntimeUnresponsiveError
from local_operator.session.errors import RuntimeRetiring

app = FastAPI()


def _raise(kind: str) -> None:
    """Raise the refusal the ladder arm under test catches, and nothing else."""
    if kind == "retiring-unnamed":
        raise RuntimeRetiring()
    if kind == "retiring-build":
        # The departure the incident's drain is: a build handover.
        raise RuntimeRetiring(trigger=RuntimeRetiring.BUILD)
    if kind == "busy":
        raise RuntimeUnresponsiveError("the bind ran out of its envelope")
    if kind == "unreachable":
        raise ConnectionError("the owner socket was refused")


@app.post("/v1/desktop/sessions/{session_id}/messages")
async def messages(session_id: str, request: Request) -> Any:  # noqa: ANN401
    kind = request.headers.get("x-capture-kind", "retiring-build")
    async with routes.errors(request):
        _raise(kind)
    return {}


app.state.config_manager = type("Cfg", (), {"config_dir": "/tmp/owner-refusal-capture"})()

out = {}
with TestClient(app, raise_server_exceptions=False) as client:
    for kind in ("retiring-unnamed", "retiring-build", "busy", "unreachable"):
        response = client.post(
            "/v1/desktop/sessions/abc123def456/messages",
            headers={"x-capture-kind": kind},
        )
        out[kind] = {
            "status": response.status_code,
            "headers": {
                name: value
                for name, value in response.headers.items()
                if name.lower() in ("content-type", "retry-after")
            },
            "body": response.json(),
        }
print(json.dumps(out, indent=2, ensure_ascii=False))
