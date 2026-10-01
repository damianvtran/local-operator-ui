# The settings rail, re-grounded flat

Evidence for `fix/settings-rail-color-0930`. The frames are the app's own
`webContents.capturePage()`; the logs are `--scene route-tops`'s own records,
copied here whole.

The operator's report (2026-09-30, via Aida): *"the buttons/tabs are not the same
color as the background on the settings left sidebar - fix that."* The rail's
root was `elevated` and each group's `<ul>` carried `surface` (the split that let
the rail keep a rung while its rows stayed on the plane they were authored
against, taken on 2026-09-27). Every group therefore read as a panel of a
different tone inside the rail.

## The rig

Built app, `headless`, macOS integrated window, `devicePixelRatio` 2, against an
isolated `local-operator serve` this lane started on `127.0.0.1:8080` (scratch
HOME, scratch config root with `hosting: test` / `model_name: mock-model`
written before the daemon started, bearer in a 0600 file, reaped by exact pid) -
so no frame touches the operator's own backend on 1111, and the renderer was
built with `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080` for the same
reason. 8080 and 1111 are the only two ports `src/renderer/index.html`'s
`connect-src` allows.

```sh
VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080 pnpm build
node scripts/renderer-driver.mjs --scene route-tops \
  --backend http://127.0.0.1:8080 --backend-records <config>/run/serve \
  --seed-onboarding-complete --theme <palette> --window-size <size> \
  --out <frames> --run-label -before-dark
```

`before-*` is the tree at `4ea1635904` (this branch's base, before any source was
touched) with the pristine build; `after-*` is the branch head rebuilt against
the same URL. Eight runs, one Electron boot each, sequential.

## The folds, and what these frames do and do not span

This branch folded `origin/main` twice after the frames were shot: onto
`99acc92f93` (#721, the app sidebar's badge restyle; #722, the fold-media train,
commits `e57ee3e358` merge and `a9e44baee1` stamps) and then onto `1bf8373292`
(#713, the scrollbar fade; #723, the evidence-record-clear train, commits
`988e514919` merge and `5178ad0e21` stamps, plus `fa581b55f2` for the round-1
re-stamp the fold sits on top of).

The `after-*` frames above were taken at the pre-fold head `40db48225a`, so the
before/after pair spans both folds as well as the change. What the folds move
inside these frames: the app sidebar's counted mark (`attention` ->
`attentionQuiet`, a variant swap inside the sidebar's own column) and the type
token it uses, and - with #713 - the scrollbar chrome, which the right edge of
every frame renders. Neither touches a ground anywhere in `src/` between
`4ea1635904` and `1bf8373292`, which is what the comparison below rests on: the
region this change is about (the rail, its rows, the rail|sidebar join) is
untouched by either fold, and the sampled tones are read frame-to-frame.

The `after-*` set was not re-shot over the folds, and this is the disclosure
rather than a claim that it was. Two reasons, recorded in order: the earlier
fold's only visible delta in these frames is the sidebar's badge variant, and
re-shooting needs the single CSP-allowed rig port (`8080`), which other lanes'
active `local-operator serve` instances held for the whole of this pass's
remaining windows (isolated rigs of their own - not ones to reap). The `before-*`
frames are unaffected either way: they are the pristine base tree.

A future re-shoot of this set would therefore differ from these frames at the
sidebar's badge if the head is past #721, and along the right-edge scrollbar if
it is past #713. Neither difference is a reading this set supports.

## The reading that discriminates, and the one that does not

**The scene does not discriminate this change, and the logs say so rather than
the README.** `route-tops` asserts the lane's stop list against each column's
*own* handed rung, so it passes on both trees: the rail is a leading column on
both, and the lane mirrors whichever rung the marker names (84 checks passed / 0
FAIL at 1380x900, 57 / 0 at 800x600, on EVERY run of both trees; the scene closes
with its own `ALL CHECKS PASSED` line, which is why a bare `grep -c PASS` reads
one more - corrected here as review round 1's R1-3). What it contributes
here is the geometry instrument.

**Geometry is identical, route for route, at both sizes** - 9 of 9 readings
byte-equal before/after in both palettes (`python3 -c` over the JSON lines in the
logs, comparing lane / sidebar / route / leadingColumn / settingsRail /
settingsContent / registeredColumn / band). Every column top is 32, the sidebar
is 260 wide, the rail column is 220 wide at `left 260`, the settings content is
900 wide at `left 480`, and no rule is painted in the lane on either tree.

**What discriminates is the tone.** Sampled from the frames with
`magick -crop 1xN +repage txt:-` across the sidebar|rail join and through an
inactive settings row (scanline `y=698` of the 2760x1800 source, the height of
the "Backend settings" row):

| | app sidebar (x 380-519) | rail's own width (520-535) | list block (536-579) |
| --- | --- | --- | --- |
| before, `localOperatorDark` | `#2A2722` | `#312D23` | `#2A2722` |
| after, `localOperatorDark` | `#2A2722` | `#2A2722` | `#2A2722` |
| before, `localOperatorLight` | `#F7F5EF` | `#FEFDFA` | `#F7F5EF` |
| after, `localOperatorLight` | `#F7F5EF` | `#F7F5EF` | `#F7F5EF` |

The palette's own values behind those bytes are `surface` `#2b2721` / `elevated`
`#322D22` (dark) and `surface` `#f7f5ee` / `elevated` `#fefdfa` (light); the
frames render about a step off the token in both palettes, which is why the
comparison above is frame-to-frame rather than frame-to-token.

So: before, the rail stepped to a different tone for its own width and stepped
back to `surface` for every list - two boundaries per group, at 16px and 16px.
After, the joined run is one value across the sidebar, the rail and the rows: the
rail is `surface`, the lists carry nothing, and the only remaining boundary is
the surface-to-`canvas` step at the content's left edge, which was always there.

The lane's resolved stops show the same thing from the shell's side
(`laneStops` in the logs): `/settings` before is `surface` 260 / `elevated`
260-480 / `canvas` 480 +, and after is `surface` 0-480 / `canvas` 480 +.

## The frames

| Set | Frames | What it shows |
| --- | --- | --- |
| `before-1380x900`, `before-light-1380x900` | 9 each | The reported state: the group lists read as panels inside the rail. |
| `after-1380x900`, `after-light-1380x900` | 9 each | The rail is flat; the current row ("General settings") keeps its own fill and every other row sits on the rail's ground. |
| `before-800x600`, `before-light-800x600` | 9 each | The same at the collapsed 48px icon rail. |
| `after-800x600`, `after-light-800x600` | 9 each | The icon rail, flat, with the current section's tile the only fill. |

The `/chat`, `/agents`, `/agent-hub`, `/schedules` and `/projects` frames are in
the sets because the change moves the shell's lane gradient for `/settings`, and
those routes are the neighbours a lane change could have moved. None of them
moved; their readings are in the same logs.

## Limits

- The scene's own assertions pass on the before tree too. The claim this set
  supports is the sampled tone and the frame pair, not a scene check that fails
  without the change.
- Headless only; no window was shown, and no process from any run outlived its
  boot (the scene asserts it, and the log line is in each log).
- Two palettes, `localOperatorDark` and `localOperatorLight`, at two sizes. The
  change is class-level, so the other 57 themes are covered by
  `scripts/chat-sidebar-selection.test.mjs`'s ground resolution rather than by
  frames.
