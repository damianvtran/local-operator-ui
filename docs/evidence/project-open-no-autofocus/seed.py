"""Seed the `--scene project-open` evidence pair's subject into the ISOLATED
daemon this pass owns on 127.0.0.1:8080. The token is read from token.hex
beside this script; nothing here touches the operator's own backend (1111) or
config root.

WHAT IT MUST PRODUCE, and why each piece is load-bearing:

- `rig-open`, a project whose DETAIL PAGE IS TALLER THAN THE WINDOW: a rendered
  title block, a description, four milestones and three multi-line progress
  updates above the quick-send strip, so the strip sits BELOW THE FOLD at
  scrollTop 0. That height is the defect's own precondition - a plain
  `focus()` cannot scroll a page that has nowhere to scroll to, and a seed
  that left the strip on screen would photograph a vacuous before/after pair
  (the scene checks `cardNaturalTop >= clientHeight` and fails by name).
- THREE distinct progress writes, because that is what makes the updates feed
  multi-line: `ProjectRegistry.update_project` appends ONE history entry per
  distinct (normalized) progress text and treats an identical re-send as a
  refresh, so three different texts are three feed rows.
- TWO linked sessions, because the scene switches the strip's Send-to target
  through the real Radix Select once and needs a second session to switch TO.
- A RESET FIRST (`DELETE` with the name as `confirm`), so a re-run starts from
  THIS shape rather than from the last run's leftovers - the scene runs once
  per brand palette against one daemon, and the second pass must find the same
  page it photographed the first time. A 404 from the reset is expected on a
  fresh root and is silent.

It prints the created row's key and its links' ids, which is what the README's
run recipe and the scene's `--project` flag quote.
"""

import json
import pathlib
import urllib.error
import urllib.request
import uuid

BASE = "http://127.0.0.1:8080"
PROJECT = "rig-open"
TOKEN = pathlib.Path(__file__).parent.joinpath("token.hex").read_text().strip()

#: Multi-line on purpose: each renders as paragraphs in the updates feed, and
#: three of them push the strip (and the linked-sessions list above it) under
#: the fold. The texts are stable so a re-run re-creates the same page.
UPDATES = [
    "Seeded by the evidence rig; the detail page reads it.\n\n"
    "This first line is short, and the paragraph under it is the second line "
    "of the same update - the feed row the frames carry.",
    "Second seeded update.\n\n"
    "Every distinct progress write appends one history entry, so three writes "
    "are three rows here rather than one row rewritten.",
    "Third seeded update.\n\n"
    "Its own paragraph too, so the deepest part of the page is multi-line and "
    "the quick-send strip stays under the fold at scrollTop 0.",
]

#: Four milestones: the milestone list sits above the updates feed, and four
#: rows (with derived state chips) are part of the page's height.
MILESTONES = [
    ("seed the project", "2026-10-10"),
    ("stand the daemon up", "2026-10-14"),
    ("photograph both halves", "2026-10-20"),
    ("fold the evidence in", "2026-10-30"),
]

DESCRIPTION = (
    "The live-app rig for the project page's composer autofocus.\n\n"
    "**Scope**\n\n"
    "- the page opens at scrollTop 0\n"
    "- the quick-send strip starts below the fold\n"
    "- two linked sessions, so the Send-to target can be switched once"
)


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
    """Delete the row if it exists (the DELETE echoes the name back as `confirm`)."""
    call("DELETE", f"/v1/desktop/projects/{name}", {"confirm": name})


reset(PROJECT)

status, created = call(
    "POST",
    "/v1/desktop/projects",
    {"name": PROJECT, "status": "active", "description": DESCRIPTION},
)
assert status == 200, (status, created)

status, _ = call(
    "PATCH",
    f"/v1/desktop/projects/{PROJECT}",
    {"title": "Rig open", "owner": "atlas", "team": "platform"},
)
assert status == 200, status

for text in UPDATES:
    status, _ = call("PATCH", f"/v1/desktop/projects/{PROJECT}", {"progress": text})
    assert status == 200, (status, text)

for name, target_date in MILESTONES:
    status, _ = call(
        "POST",
        f"/v1/desktop/projects/{PROJECT}/milestones",
        {"name": name, "target_date": target_date},
    )
    assert status == 200, (status, name)

links = []
for _ in range(2):
    status, session = call(
        "POST", "/v1/desktop/sessions", {"request_id": str(uuid.uuid4()), "cwd": "."}
    )
    assert status == 200, (status, session)
    session_id = session["result"]["session_id"]
    status, _ = call(
        "POST", f"/v1/desktop/projects/{PROJECT}/links", {"session_id": session_id}
    )
    assert status == 200, (status, session_id)
    links.append(session_id)

status, view = call("GET", f"/v1/desktop/projects/{PROJECT}")
assert status == 200, status
result = view["result"]
print(f"project: {PROJECT}")
print(
    "milestones:",
    [milestone["name"] for milestone in result.get("milestones", [])],
)
print("updates:", len(result.get("project", {}).get("updates", [])))
print("linked sessions:", [link["session_id"] for link in result.get("links", [])])
print("seeded links:", links)
