# The project update asset grid, driven live

The project detail Updates feed renders one grid per update: pictures, a sound,
a clip and plain files, all through the chat view's own attachment components,
with one shared lightbox walking that update's media. The Storybook set
(`projects.stories.tsx`'s `with-assets`, `lightbox-open`, `lightbox-video`,
`many-updates`) photographs the states with the file bridge stubbed. This
directory holds the LIVE rig that proves the other half: the app reading the
seeded files over IPC and painting them.

## What a story cannot photograph

- The grid's tiles resolve their bytes through `window.api.readFileBytes`. A
  stubbed bridge can show a picture; only a live run shows that the app can
  open the STORE's copies and decode them.
- The markdown preview calls `window.api.readFile` and renders the result with
  `ProjectMarkdown`. The live scene asserts the seed's own heading inside the
  dialog, so a preview reading a fixture or the wrong file fails.
- The lightbox's Next/filmstrip walk moves between the update's actual
  attachments. The scene reads the painted `src` (and the media kind) off the
  shared `ImageLightbox` frame, which is why the frame alone is not the claim.

## The seed

`seed.py` writes through the real store, not JSON: it imports
`local_operator.projects` from the local-operator checkout under test and calls
`ProjectRegistry.create_project` / `update_project(..., attachments=[…])`, the
same path the `project` tool and the desktop routes use. It generates:

- `dashboard-cutover.png` — a 240x150 RGB gradient;
- `parity.png` — a 180x180 gradient with a different structure;
- `standup.wav` — 0.4 s of a 440 Hz tone;
- `release-notes.md` — the note whose heading (`Rig evidence note`) the driver
  asserts in the in-app reader;
- `standup.mp4` — a one-second 320x180 clip when a real `ffmpeg` is reachable
  (Homebrew's, or a bundled one that answers `-version`). The seed still
  succeeds without it; the grid then has no video tile, and the scene does not
  assert one.

The project receives TWO updates: the first text-only, the second carrying the
generated files. That is what puts the grid under the newest entry.

## The run, exactly

```sh
# 0. scratch roots: the daemon's config, and the driver's frames.
ROOT="$LOCAL_OPERATOR_SCRATCHPAD/project-update-assets"
mkdir -p "$ROOT/config" "$ROOT/frames"
head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$ROOT/token.hex"

# 1. the app, built against the backend this run owns (the port the page's
#    connect-src allows). Any of the other build-time IDs may be dummy values.
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  VITE_GOOGLE_CLIENT_ID=rig VITE_GOOGLE_CLIENT_SECRET=rig \
  VITE_MICROSOFT_CLIENT_ID=rig VITE_MICROSOFT_TENANT_ID=rig \
  pnpm build

# 2. the isolated daemon. The HOSTING has to be written into the scratch root:
#    a fresh config holds none, and every turn dies in
#    HostingNotConfiguredError without it (docs/agent-driver.md).
printf 'values:\n  hosting: test\n  model_name: mock-model\n' \
  > "$ROOT/config/config.yml"
LOCAL_OPERATOR_CONFIG_DIR="$ROOT/config" \
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$ROOT/token.hex")" \
  local-operator serve --port 8080 --hosting test --model mock-model &

# 3. the seed, through the backend's own store. PYTHONPATH names the
#    local-operator worktree the branch under test was built against, and the
#    interpreter is that checkout's venv (it owns pydantic).
LOCAL_OPERATOR_CONFIG_DIR="$ROOT/config" \
PYTHONPATH=<local-operator-worktree> \
  <local-operator-worktree>/.venv/bin/python \
  docs/evidence/project-update-assets/seed.py --config-dir "$ROOT/config"

# 4. the scene, once per palette. The driver boots its own headless Electron
#    from the build above, navigates to /projects/rig-assets and writes frames
#    with captureSettled.
LOCAL_OPERATOR_DESKTOP_TOKEN="$(cat "$ROOT/token.hex")" \
node scripts/renderer-driver.mjs --scene project-update-assets \
  --backend http://127.0.0.1:8080 \
  --backend-records "$ROOT/config/run/serve" \
  --project rig-assets \
  --out "$ROOT/frames" \
  --seed-onboarding-complete --window-size 1380x900
# ... and again with --theme localOperatorLight
```

## The states, and what each frame shows

| Frame (`dark/`, `light/`) | State |
| --- | --- |
| `grid.png` | the newest update's grid at rest: four 117px columns — two picture tiles and the compact sound player (two columns) on the first row, the clip and the markdown note's file tile on the second — with the update's text above them |
| `lightbox.png` | the shared `ImageLightbox` over the update's media set, opened from the first picture, filmstrip along the bottom |
| `next.png` | after Next: the gallery is on the second picture, the filmstrip mark moved with it |
| `filmstrip.png` | after a filmstrip jump back to the first slot |
| `preview.png` | the markdown note in the in-app reader: the seeded heading and list rendered as prose by `ProjectMarkdown`, never handed to the OS application |

## The scene's checks, as the run printed them

All 18 PASS on both palettes, 0 FAIL:

```
the harness is driving the Electron this branch pins
the scratch backend port is dead
the armed launch said so on stdout
the app's logs went to this run's scratch tree, not the operator's
the app holds a connection to this run's backend
the app holds NO connection to the operator's own backend (http://localhost:1111)
window mode is headless and the window is never shown or focused
the seeded project exists and carries the evidence attachments
the update renders its asset grid: two pictures, a sound and a note
the lazy picture tile mounts its control once the slot is in view
pressing the first picture opens the shared lightbox on an image slide
Next moves the gallery to the update's second picture
the filmstrip lists the update's media set
a filmstrip tile jumps the gallery to the slot it names
Escape closes the lightbox
the seed carries a markdown attachment
the markdown note opens in the in-app preview, rendered as prose
no process from this run outlived its boot
```

The connection line in the captured run names `http://[::1]:8080`: another
session's daemon already held `127.0.0.1:8080` and the browser's CSP allows only
that port, so the run bound the daemon to IPv6 loopback (`--host ::1`), built
with `VITE_LOCAL_OPERATOR_API_URL=http://localhost:8080` (which resolves to
`::1` first on this host) and passed `--backend http://[::1]:8080`. On a free
port the commands above are the whole recipe; the app and driver must agree on
the same host spelling either way.

The scene exits non-zero on any FAIL. It reads the project back from
`/v1/desktop/projects/<key>` first, so a seed that did not write the four
attachments is a refused precondition rather than a photographed empty feed.

## The capture in this branch

Captured 2026-10-20 at 1380x900 through the app's own `capturePage()` in
`headless` mode, against the isolated daemon on `[::1]:8080` described above,
seeded by `seed.py`. `dark/` is `localOperatorDark`, `light/` is
`localOperatorLight`; five frames each (`grid`, `lightbox`, `next`,
`filmstrip`, `preview`). The run reported 18 PASS, 0 FAIL on each palette, and
`no process from this run outlived its boot`.
