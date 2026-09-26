# Sub-view top inset — before/after frames (PR: fix/subview-top-inset-318576ecda22)

The operator's report of 2026-09-26 — "for sub-views like the settings page, the
sidebar and view doesn't go all the way to the top — fix that across the views" — is
one y coordinate on every route the shell draws: where a column's own first box
begins. These are the frames and the readings for the fix.

## What produced these frames

The app's own harness, headless, photographed with its own
`webContents.capturePage()`: `scripts/renderer-driver.mjs --scene route-tops` (new in
this change), against an isolated `local-operator serve` on `:8080` that this lane
owned — a scratch `HOME`, `LOCAL_OPERATOR_CONFIG_DIR` and `LOCAL_OPERATOR_LOG_DIR`
outside the operator's state, the desktop token passed in the environment (never
argv), and the app asserted to hold no connection to the operator's own backend.

**Two daemons served the four runs, said plainly because the first two drafts of
this paragraph claimed otherwise (the second said "one daemon" for all four).** Run 1
(`runs/run-before-1380.log`) attached to the daemon the set's FIRST command started,
pid 48732, which then died. The set's SECOND command started a new one, pid 59837,
and the kill aimed at that command's launcher shell missed the child, so the
remaining three commands found `:8080` already answering and their own serve
attempts failed to bind - each failure is in `runs/daemon-*.log` - and their apps
attached to the survivor. It was reaped by exact pid once the four runs were done.
What "isolated" means here is the config root, the log directory and the bearer,
not a process per command; and each run's app was started and reaped by the driver
itself, by exact pid, when its command returned.

Four runs, two trees:

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
display: none}`. The app sidebar's own first row (`[data-sidebar-shell]`) reads 32 in both runs at
1380 — the control that never moved. At 800 the dock collapses to the 56px strip and
that marker is absent, so the sidebar check is skipped there (the route-top claim is
asserted at both widths) — a correction made in remediation round 1, R2: an earlier
draft said "all four runs", which was two.

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
| `frames/r1-1380/`, `frames/r1-800/` | the round 1 remediation head (`2bdd7a0541`): the same six routes again, after the band's block rule was made selector-exact |
| `runs/` | the four driver logs, including every `[note] the top of <route>` reading and the check verdicts, plus the three daemon logs whose `Address already in use` failures record the two-daemon shape above, plus the remediation round's own two driver and two daemon logs |

## Round 1 remediation (head `2bdd7a0541`)

Review round 1's R1 found that the band/lane complement held only by SOURCE ORDER: on
a leading layout both rules matched and `display: none` won by being later in the
file, so reordering the two blocks re-introduced the double inset with the suite
green. The fix moves the negative condition into the selectors
(`:not([data-chrome-leading="true"])` on each win/linux arm), so no state matches
both rules; the scene also refuses at argv time without `--backend` (R5), and the
pins are now split into three that discriminate against the replaced shape and four
that guard invariants (R4). Six more runs of the same scene re-verified the
rendering at that head:

| run | verdict |
| --- | --- |
| `runs/run-r1-1380.log` | 27 PASS / 0 FAIL - every route's first box at 32, band `display:none` |
| `runs/run-r1-800.log` | 21 PASS / 0 FAIL - the same at 800x600 |

Frames: `frames/r1-1380/`, `frames/r1-800/`. Unlike the original four runs, these two
each started and reaped their own daemon inside their own command
(`runs/daemon-r1-*.log`); the mutation matrix and the full finding-by-finding
answers are in the PR's remediation comments.
