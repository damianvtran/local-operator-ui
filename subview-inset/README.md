# Sub-view top inset — before/after frames (PR: fix/subview-top-inset-318576ecda22)

The operator's report of 2026-09-26 — "for sub-views like the settings page, the
sidebar and view doesn't go all the way to the top — fix that across the views" — is
one y coordinate on every route the shell draws: where a column's own first box
begins. These are the frames and the readings for the fix.

## What produced these frames

The app's own harness, headless, photographed with its own
`webContents.capturePage()`: `scripts/renderer-driver.mjs --scene route-tops` (new in
this change), against an isolated `local-operator serve` the run owned on `:8080`,
with scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_LOG_DIR`, the
desktop token passed in the environment (never argv), and both app and daemon reaped
by exact pid when the command returned. Four runs, two trees:

```sh
# The diorama, as it stood on origin/main (44ae98286e) with only the new scene added:
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 \
  npx dotenv-cli -e ~/local-operator-ui/.env -- pnpm build

# one run per size, 1380x900 and 800x600:
LOCAL_OPERATOR_DESKTOP_TOKEN=<token> node scripts/renderer-driver.mjs \
  --scene route-tops --backend http://127.0.0.1:8080 \
  --backend-records <scratch>/config/run/serve --seed-onboarding-complete \
  --window-size 1380x900 --run-label -1380 --out frames/before-1380
```

The daemon for each run:

```sh
env -i HOME=<scratch>/home PATH=/usr/bin:/bin TERM=xterm-256color \
  LOCAL_OPERATOR_CONFIG_DIR=<scratch>/config LOCAL_OPERATOR_LOG_DIR=<scratch>/logs \
  LOCAL_OPERATOR_DESKTOP_TOKEN=<token> \
  local-operator serve --host 127.0.0.1 --port 8080
```

The scene photographs `/chat` (the control route this change does not touch) plus
`/settings`, `/settings?section=integrations`, `/agents`, `/agent-hub` and
`/schedules`, and reads each route's first box off the live DOM.

## The numbers (read from the runs; `runs/*.log` carries every reading)

Route's own first box, CSS px from the window's top edge, macOS integrated window
(the 32px lane ends at 32 on every route in every run):

| Route | before @1380 | after @1380 | before @800 | after @800 |
| --- | --- | --- | --- | --- |
| `/chat` (control) | 32 | 32 | 32 | 32 |
| `/settings` | 62.86 | **32** | 62.3 | **32** |
| `/settings?section=integrations` | 62.86 | **32** | 62.3 | **32** |
| `/agents` | 62.86 | **32** | 62.3 | **32** |
| `/agent-hub` | 62.8 | **32** | 62.15 | **32** |
| `/schedules` | 62.8 | **32** | 62.15 | **32** |

The band itself (`[data-chrome-route-band]`), same runs: before
`{top: 32, height: 30.86, display: block}`; after `{top: 0, height: 0,
display: none}`. The app sidebar's own first row (`[data-sidebar-shell]`, docked at
1380) reads 32 in all runs — the control that never moved.

The settings rail (`nav[aria-label="Settings sections"]`) and the settings content
column (`[data-settings-content]`) are the two boxes the report names, and both read
exactly the route's number above (they are the page's own first children).

## The runs' own verdicts

| Run | Result |
| --- | --- |
| `run-before-1380.log` | 22 PASS / 5 FAIL — "5 CHECK(S) FAILED", one per non-chat route |
| `run-before-800.log` | 16 PASS / 5 FAIL — same five |
| `run-after-1380.log` | 27 PASS / 0 FAIL — "ALL CHECKS PASSED" |
| `run-after-800.log` | 21 PASS / 0 FAIL — "ALL CHECKS PASSED" |

The before runs fail exactly the claim the fix makes (and nothing else: the harness's
own isolation, window-mode, frame-size and leftover-process checks pass in both), so
the check is the defect measured, not a green suite with the defect in it.

## What these frames do not prove

- **The traffic lights are not in any frame** — `capturePage()` photographs the
  renderer, and on macOS the lights are AppKit's own views above it. What the frames
  show is the shell's 32px lane kept on every route; nothing was moved into it.
- **Windows and Linux were not run on this host.** The band's rules and their pins
  (`scripts/titlebar-options.test.mjs`, mutation-tested) are the local verification
  for those platforms; the Windows/Linux answer is deliberately unchanged (the band
  keeps its selector and its `env(titlebar-area-height)` height there).
- **The 800-wide runs carry no sidebar-control reading**: at that width the sidebar
  is the 56px strip and `[data-sidebar-shell]` is the docked column's marker, so the
  control clause is asserted at 1380 only. The route-top claim is asserted at both.

## Frame inventory

| Directory | What it is |
| --- | --- |
| `frames/before-1380/`, `frames/before-800/` | origin/main's rendering: `route-tops-<route>-<size>.png`, the band above the settings rail and every non-chat route's first box at ~62 |
| `frames/after-1380/`, `frames/after-800/` | the fix: `route-tops-<route>-after-<size>.png`, every route's first box on the lane's bottom edge at 32 |
| `runs/` | the four driver logs, including every `[note] the top of <route>` reading and the check verdicts |
