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

## The reading that discriminates, and the one that does not

**The scene does not discriminate this change, and the logs say so rather than
the README.** `route-tops` asserts the lane's stop list against each column's
*own* handed rung, so it passes on both trees: the rail is a leading column on
both, and the lane mirrors whichever rung the marker names (85 PASS / 0 FAIL at
1380x900, 58 / 0 at 800x600, on EVERY run of both trees). What it contributes
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
