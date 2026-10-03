"""Seed the two projects the `project-inline-edit` scene drives into the
isolated daemon on 127.0.0.1:8080. The token is read from token.hex beside it;
nothing here touches the operator's own backend (1111) or config root.

The shape is the scene's precondition list, so a later round can reproduce it
exactly:

- `rig-inline`   the subject: a title (the conflict and key cases need one),
                 an owner, a start date, and ONE INCOMPLETE milestone (the
                 done-gate refusal). NO team, estimate or tags, so the
                 properties block's `+ Add` menu has fields left to open.
- `rig-inline-other`  a second row, so the duplicate-key refusal collides with
                 a name this daemon actually holds rather than an invented one.

IT RESETS FIRST, so it is re-runnable: the scene MUTATES the subject row
(title, dates, status, team/estimate/tags), and the run executes it once per
brand palette against one daemon, so the second pass must start from this
shape rather than from the first pass's leftovers (measured: the status pick
is a no-op on the second pass when the row already holds the picked status,
Radix never fires the change, and the editor stays open).
"""

import json
import pathlib
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"
TOKEN = pathlib.Path(__file__).parent.joinpath("token.hex").read_text().strip()


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {TOKEN}",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def reset(name):
    """Delete the row if it exists (DELETE echoes the name back as `confirm`).

    A 404 is fine and silent: the first run of a fresh daemon has nothing to
    delete, and `call` returns the code instead of raising.
    """
    call("DELETE", f"/v1/desktop/projects/{name}", {"confirm": name})


reset("rig-inline")
reset("rig-inline-other")

call(
    "POST",
    "/v1/desktop/projects",
    {
        "name": "rig-inline",
        "status": "active",
        "description": "The live-app rig for the inline editors.",
    },
)
call(
    "PATCH",
    "/v1/desktop/projects/rig-inline",
    {"title": "Rig inline", "owner": "atlas", "start_date": "2026-09-01"},
)
call(
    "POST",
    "/v1/desktop/projects/rig-inline/milestones",
    {"name": "rig milestone", "target_date": "2026-10-30"},
)
call(
    "POST",
    "/v1/desktop/projects",
    {"name": "rig-inline-other", "status": "planning"},
)
