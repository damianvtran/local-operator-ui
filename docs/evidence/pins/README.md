# Pinned chats — durable conversation pinning, shared with the terminal

Hovering a conversation row in the chats sidebar reveals a pin control; pressing it
pins the conversation, and pinned conversations are drawn in a `Pinned chats` section
above the rest. The state is the BACKEND's: the same `sidebar-pins.json` the terminal's
`f10` writes, in the config root the daemon serves, so a pin made in the app is a pin the
TUI shows and the other way round.

The backend half of this feature is a sibling pull request
(`feat/desktop-session-pins`). These frames were taken against
**`b1dc21980e65d620a5a51e2efd73296adc386855`** of that branch, booted as a real uvicorn
daemon with its own venv, on an isolated `HOME` and `LOCAL_OPERATOR_CONFIG_DIR` under
`/tmp`, with `LOCAL_OPERATOR_DESKTOP_TOKEN` in its environment. The UI tree's head is named
in the pull request, not here, because a frame's own commit moves with every rebase.

They were **re-shot after `origin/main` (`62c673adb`) was merged into this branch**, so every
committed frame is a picture of the code that ships. The fold moved six of the thirteen
frames' bytes by exactly 33,490 pixels (0.7%) in one `1663x209+1049+1087` box — the
conversation tag chip's **focus ring** in the chat pane, drawn in the second run and not the
first. That is focus-dependent rendering in a window that is never shown (the class
`AGENTS.md` names for headless runs), it is not something the fold moved, and it touches no
claim here: the three frames taken before any conversation was opened
(`pins-unpinned-dark`, `pins-hover-dark`, `pins-populated-dark`) are byte-identical across
the two runs, and every claim below is about the sidebar.

## The frames

Thirteen frames in this directory, from one run of `--scene pins`, plus the four frames of
the capability-withdrawn pair. The window is `1380x900` in `--window-mode=headless` (a
1380x868 CSS viewport, `devicePixelRatio` 2, so the PNGs are 2760x1736), never shown and
never focused: the run asserts both from main's own window facts before it takes a frame.

| Frame | State | The claim it is evidence for |
| --- | --- | --- |
| [`pins-unpinned-dark`](pins-unpinned-dark.png) ([light](pins-unpinned-light.png)) | four conversations, nothing pinned | **Zero pins renders no heading and no section** — the panel is the panel it was before this feature, plus nothing |
| [`pins-hover-dark`](pins-hover-dark.png) ([light](pins-hover-light.png)) | the pointer genuinely over an unpinned row | **The reveal**: the pin control becomes visible *under the pointer*, and only on that row |
| [`pins-populated-dark`](pins-populated-dark.png) ([light](pins-populated-light.png)) | one conversation pinned | **The section**: `Pinned chats (1)` above `All chats` / `New chat` / `Active chats` / `Previous chats`, and the pinned row is *not* in `Previous chats` — a partition, not a copy |
| [`pins-selected-dark`](pins-selected-dark.png) ([light](pins-selected-light.png)) | the pinned conversation is also the current one | **Drawn once**, in the Pinned section, carrying `aria-current="page"` |
| [`pins-filter-dark`](pins-filter-dark.png) ([light](pins-filter-light.png)) | a query matching only the pinned conversation | **The filter**: the Pinned section is `matching ∩ pinned`; the other sections empty rather than keeping rows "because they are pinned" |
| [`pins-flat-dark`](pins-flat-dark.png) ([light](pins-flat-light.png)) | the panel in `All chats` (flat) mode | **Both modes**: the section is drawn in the flat list too, at the same place, above it |
| [`pins-from-tui-dark`](pins-from-tui-dark.png) | a pin written by the **terminal's own store** | **The round trip, TUI to app**: no manual refresh, no focus, no reload |
| [`pins-withdrawn-dark`](pins-withdrawn-dark.png) ([light](pins-withdrawn-light.png)) | a backend whose capabilities omit `session_pins` | **Fail-closed**: no affordance anywhere |
| [`pins-withdrawn-main-dark`](pins-withdrawn-main-dark.png) ([light](pins-withdrawn-main-light.png)) | the same backend, driven by the **same scene on `origin/main`** | **...byte-identical to the pre-change panel** — see below |

Two things are worth reading off the file set rather than per frame:

* **`pins-withdrawn-{dark,light}.png` and `pins-withdrawn-main-{dark,light}.png` are
  byte-identical** (`cmp` prints nothing for both pairs; sha256 `505e0c608…` and
  `13bc1a1dd…`). The `main` halves come from a second worktree at `origin/main`
  (`013aad424`) running the *same* scene against the *same* daemon, so what the pair
  compares is the two trees and nothing else. Nothing main moved between `013aad424` and
  `62c673adb` renders in them — the files it moved are the transcript's message items and an
  image lightbox, none of which is on screen in a panel with no messages — which is why
  those four frames are re-stamped rather than re-shot. This is the claim the design states
  as "the row is byte-identical to the pre-change frame", and it is a measurement rather
  than an assertion.
* **`pins-withdrawn-dark.png` is also byte-identical to `pins-unpinned-dark.png`**, which
  is a second, independent statement: with the capability present and nothing pinned, the
  panel paints exactly what it paints with the capability absent. The reserved 24px slot
  and the hover wrapper cost no pixel at rest, which is what makes the reveal unable to
  reflow a row.

## How these were taken

One daemon, one isolated config root, two trees. `harness/seed-store.mjs` writes the
catalogue (`transcript.jsonl`, `title.json`, `created_at.json` and the desktop marker per
session — the shape `scripts/seed-paging-session.mjs` establishes), then:

```sh
# the pins daemon, on an isolated root
env -i HOME=$SCRATCH/backend-home PATH=/usr/bin:/bin \
  LOCAL_OPERATOR_CONFIG_DIR=$SCRATCH/backend-config \
  LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN \
  ~/local-operator-worktrees/desktop-pins/.venv/bin/python -m local_operator.cli serve \
    --host 127.0.0.1 --port 8977

# the app, built against that daemon's URL
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8977 VITE_GOOGLE_CLIENT_ID=<inert> … pnpm build

# the scene
LOCAL_OPERATOR_DESKTOP_TOKEN=$TOKEN node scripts/renderer-driver.mjs --scene pins \
  --backend http://127.0.0.1:8977 \
  --backend-records $SCRATCH/backend-config/run/serve \
  --seed-onboarding-complete \
  --tui-python ~/local-operator-worktrees/desktop-pins/.venv/bin/python \
  --tui-config $SCRATCH/backend-config \
  --out /tmp/pins-frames
```

The `VITE_GOOGLE_*`/`VITE_MICROSOFT_*` values are inert build fixtures
(`pins-build-only-not-a-credential`); no credential file was read and no sign-in is
claimed. The scene prints `[PASS]`/`[FAIL]` for every assertion it makes — 65 checks in
the pins run, 18 in each withdrawn run, all passing on the head these frames were taken at
— and it refuses to run at all without `--backend`, because a run with no catalogue has no
row to pin and every frame it could write would be a picture of an empty panel.

The withdrawn pair is the same scene against a daemon checked out at
`feat/desktop-session-pins^` (Ben's `feat/sidebar-pins-and-chips` head, `6ac627b39`),
where `capabilities.features.session_pins` is genuinely absent — the same server minus
this feature, rather than a client told to pretend.

## The round trip, measured

Both directions were measured inside the pins run, against the same file:

* **app → terminal.** After the press, the scene asks the terminal's own store what it
  holds, by importing `local_operator.tui.sidebar_pins.read_pins` — the function the TUI's
  sidebar calls — in a real interpreter against the daemon's config root. It contains the
  id of the conversation this app just pinned (`[PASS] a pin made in this app is in the
  store the terminal reads`).
* **terminal → app.** The scene runs `sidebar_pins.toggle_pin` — the function the
  terminal's `f10` calls (`action_toggle_pin` hands it to a thread) — against the daemon's
  config root, then watches the panel with nobody touching the window. The frame
  `pins-from-tui-dark` is the panel after that write, and the measured latency was
  **206 ms** on the merged tree (950 ms, 534 ms, 413 ms and 217 ms in the four runs before
  it, on the same box). The design's bound is ~1.5 s: the feed's 1 Hz catalogue probe
  fires on the pins file's own fingerprint, the renderer refetches once on that frame, and
  the panel's 30 s safety poll sits behind it as drift insurance.

The TUI *surface* (a real terminal with `f10` pressed) is not driven here: that leg lives
in the backend pull request's own pilot, where the terminal app and the route are in one
process tree.

## What these frames do not show

* **A pin made on a delegated run.** The desktop catalogue is built with
  `include_subagents=False`, so a run with no desktop row cannot be pinned *to* anything
  visible: the terminal can pin it and its own `★ Pinned` section will show it, while the
  app has no row to draw. Documented rather than papered over (design §9.2); the UI must not
  silently under-report a pinned set, which is why the TUI keeps its `pinned_hidden_ids`
  exemption and this panel does not claim to.
* **Cross-host pairing.** The shared pin store is the file in the config root the
  *daemon* serves. Pair the app to a daemon on another machine and the app and the terminal
  on this one stop sharing pins — a property of the architecture, not of this change
  (design §9.1).
* **Where the section sits.** The frames show the `Pinned chats` section at the top of the
  chats scroll region, above the `All chats` row, in both modes. The design flags that
  placement as a rendered decision for the design round to overrule; the flat-mode frame is
  there to judge it from, because in flat mode there is no `Active chats` anchor for the
  section to sit above at all.
* **The 51st pin.** No rank or position travels on the wire (deliberately: the TUI's
  `★ Pinned` is drawn in the catalogue's order, so a rank would make two surfaces order one
  list two ways). The consequence is that pinning the 51st conversation drops the oldest
  server-side while that row keeps a stale `pinned` until the next catalogue read, which is
  closed by the same ~1 s doorbell. It needs 51 pins on one machine to observe and is not
  photographed.
