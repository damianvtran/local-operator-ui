# The project detail page, driven live: the sheet, the feed, quick-send and the start-session picker

Twelve frames from `scripts/renderer-driver.mjs`'s `project-detail` scene —
photographed through the app's own `capturePage()` in the `headless` window mode,
at 1380x900, six states in each brand palette (`dark/` = `localOperatorDark`,
`light/` = `localOperatorLight`). They are here rather than attached to the PR
because a committed frame is the one a later round can still read.

## What a story cannot photograph, and this scene can

The Storybook set (`docs/evidence/projects-tab/`) draws the same page with the
desktop bridge stubbed at its boundary. Two acts of this slice are not drawable
there, because their claim is about STATE the daemon keeps:

- **Quick-send.** A message typed into the strip is admitted through the chat's
  own `admitChatDraft` and then read back from the session's transcript over the
  daemon's `sessions/{id}/history` route. A screenshot of the optimistic echo
  would prove nothing — the echo paints before the owner sees anything — so the
  delivery assertion is the daemon read, with the frame as the UI half.
- **Start session.** The picker creates a session, auto-links it (the link is
  re-read from `projects.get`), and lands on that session's chat with the prompt
  PRE-FILLED and unsent (the composer's textarea is read, never acted on).

Both were run against an ISOLATED daemon this lane owned, on port 8080 (the port
the page's `connect-src` allows), seeded by the script below. The run closes its
own app and leaves nothing behind (`no process from this run outlived its boot`).

## The run, exactly

```sh
# 1. the app, built against the backend this run owns
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build

# 2. the daemon: a scratch config root, and the HOSTING written into it.
#    (A fresh config root holds no hosting, and every turn dies in
#    `HostingNotConfiguredError` without this file - see docs/agent-driver.md.)
mkdir -p "$ROOT" && printf 'values:\n  hosting: test\n  model_name: mock-model\n' > "$ROOT/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$ROOT" LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
  local-operator serve --port 8080 --hosting test --model mock-model

# 3. the seed: one project named `rig-detail` (title, owner/team, a progress
#    line, one milestone) and one linked session, all through the desktop routes.
python3 seed.py

# 4. the scene, once per palette (`--theme`), with the daemon's own record on
#    the run's scratch config root and the frames written where they live:
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat token.hex)" \
node scripts/renderer-driver.mjs --scene project-detail \
  --backend http://127.0.0.1:8080 \
  --backend-records "$ROOT/run/serve" \
  --project rig-detail \
  --out "$LOCAL_OPERATOR_SCRATCHPAD/frames" \
  --seed-onboarding-complete --window-size 1380x900
# ... and again with --theme localOperatorLight
```

## The states, and what each frame shows

| Frame | State |
| --- | --- |
| `sheet-*` | the page at rest: display title with the key secondary, the status chip, `Owner`/`Team` as Properties rows, the rendered markdown description, the milestone with its derived state, and the linked-sessions list with the quick-send strip under it |
| `quick-send-*` | the strip with the message typed, the target select on the linked session |
| `delivered-*` | the same message rendering in that session's conversation, after the daemon's `history` answered with it |
| `start-session-*` | the picker open on the sheet (team / agent / plain) |
| `composer-*` | the new session's chat: the prompt PRE-FILLED in the composer, unsent |
| `linked-*` | the sheet after the create: the linked-sessions list carrying the new row |

## The scene's checks, as the run printed them

All 21 PASS on both palettes, 0 FAIL:

```
the harness is driving the Electron this branch pins
the scratch backend port is dead
the armed launch said so on stdout
the app's logs went to this run's scratch tree, not the operator's
the app holds a connection to this run's backend (http://127.0.0.1:8080)
the app holds NO connection to the operator's own backend (http://localhost:1111)
window mode is headless and the window is never shown or focused
the seeded project exists on this run's daemon, with one linked session
the sheet draws the seeded project: title, key, owner/team rows, milestone and feed
the strip holds the typed message
pressing Enter admits the message (a pre-admission refusal is waited out and re-pressed)
the message is admitted into the linked session's transcript (daemon read)
the message renders in the linked session's conversation
a pointer press of Send admits the second message (the strip clears)
the pointer send hands the keyboard back to the strip (UX round 1, U2)
the second message is admitted into the transcript too (daemon read)
the picker's Start session control is on screen and was pressed
the started session lands on its chat with the prompt PRE-FILLED and unsent
the daemon holds one more linked session than before the create
the linked-sessions list draws a row for the new link too
no process from this run outlived its boot
```

The last three of the scene's own checks are the pointer leg (added by round-1
remediation, UX U2): one real `Input.dispatchMouseEvent` press of Send, then
the strip's own state, the daemon's transcript and `document.activeElement` -
the check that fails when the refocus regresses, measured with a trusted
pointer because a programmatic click would not have moved focus at all. The
scene exits non-zero on any FAIL (the negative run, refocus disabled, printed
`[FAIL] the pointer send hands the keyboard back to the strip` and rc=1).

## The seed

`seed.py` (the script the run used, reproduced here for a later round):

```python
"""Seed one project (with progress, a milestone and a linked session) into the
isolated daemon on 127.0.0.1:8080. The token is read from token.hex beside it;
nothing here touches the operator's own backend (1111) or config root."""
import json, pathlib, urllib.request, uuid

BASE = "http://127.0.0.1:8080"
TOKEN = pathlib.Path(__file__).parent.joinpath("token.hex").read_text().strip()

def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"content-type": "application/json",
                 "authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()

call("POST", "/v1/desktop/projects",
     {"name": "rig-detail", "status": "active",
      "description": ("The live-app rig for the project detail page.\n\n"
                      "**Scope**\n\n- the feed\n- quick-send\n"
                      "- the start-session picker")})
call("PATCH", "/v1/desktop/projects/rig-detail",
     {"title": "Rig detail", "owner": "atlas", "team": "platform",
      "progress": "Seeded by the evidence rig; the detail page reads it."})
call("POST", "/v1/desktop/projects/rig-detail/milestones",
     {"name": "rig milestone", "target_date": "2026-10-30"})
_, body = call("POST", "/v1/desktop/sessions",
               {"request_id": str(uuid.uuid4()), "cwd": "."})
call("POST", "/v1/desktop/projects/rig-detail/links",
     {"session_id": body["result"]["session_id"]})
```

The scene is re-runnable against the same daemon: the link checks assert the
DELTA (`+1`), not a fixed count, so a second palette pass on one seeded root
passes its own arithmetic.
