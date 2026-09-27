# The route-owned leading column, and the lane's band

Evidence for `fix/leading-column-lane-band`. The frames are the app's own
`webContents.capturePage()`; the logs are `--scene route-tops`'s own records.

## The rig

Built app, `headless`, macOS integrated window, `devicePixelRatio` 2, against an
isolated `local-operator serve` this lane started on `127.0.0.1:8080` (scratch
HOME and config root, bearer in a 0600 file, reaped by exact pid) — so no frame
touches the operator's own backend on 1111, and the renderer was built with
`VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080` for the same reason.

```sh
node_modules/.bin/electron-vite build      # with VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080
node scripts/renderer-driver.mjs --scene route-tops \
  --backend http://127.0.0.1:8080 --backend-records <config>/run/serve \
  --seed-onboarding-complete --window-size 1380x900 --out <frames> [--run-label "-after"]
```

`before-1380x900/` and `after-1380x900/` are the two trees at the same size, the
before taken before any source was touched; `before-800x600/` and
`after-800x600/` are the same pair at the narrow size. `before-agents-detail/` is
one frame: the saved-agent route has no before of its own in the base set because
`/agents/<id>` was added to the scene by THIS change, so its before tree is the
head with that route's hand-over removed — which is the base behaviour for that
view (an unregistered column leaves the band at the sidebar's edge), and its log
carries the FAIL that says so.

## The mechanism, in numbers

The lane above the two shell columns is a mirror of the columns' grounds: it
painted the app sidebar's width in `surface` and the rest in `canvas`, because no
column can paint above its own top edge (the row that holds the columns is
`overflow: hidden`, and every route sits inside a second clipped column within
it). A route that draws a leading column of its own got the CONTENT ground across
it.

The band, read off the frames as tones (device row CSS y 20 = inside the lane,
CSS y 40 = the first content row below it):

| view | row | before | after |
| --- | --- | --- | --- |
| `/settings` | lane (y 20) | `surface` 0..260, `canvas` 260..1380 | `surface` 0..480, `canvas` 480..1380 |
| `/settings` | below (y 40) | `surface` 0..480 | `surface` 0..480 (identical) |
| `/agents` | lane (y 20) | `surface` 0..260, `canvas` 260..1380 | `surface` 0..516, `canvas` 516..1380 |
| `/agents` | below (y 40) | `surface` 0..516 | `surface` 0..516 (identical) |
| `/settings` at 800x600 | lane (y 20) | `surface` 0..56, `canvas` 56..800 | `surface` 0..104 (= 56px strip + 48px rail) |
| `/agents` at 800x600 | lane (y 20) | `surface` 0..56, `canvas` 56..800 | `surface` 0..312 (= 56 + 256) |

The second row of each pair is the control: the first content row's geometry is
unchanged by the fix, which is the operator's "keep the top row nav/icons in the
current alignment" half. The scene asserts it directly (`the route's own first box
starts on the lane's bottom edge (32px)`, and the app sidebar's row the same, on
every route).

## The scene's verdicts

`before-1380x900.log`: **6 FAIL / 33 PASS**, every FAIL one of the three
leading-column routes — `the route's leading column is handed to the shell` and
`the lane's band reaches the leading column's right edge` (the band stopped at 260
against a rail ending at 479 and a pane ending at 516).

`after-1380x900.log`: **45 PASS / 0 FAIL** at 1380x900; `after-800x600.log`: **35 PASS /
0 FAIL** (fewer checks there because the sidebar-relative ones stand down where the
dock collapses to the strip), and `before-800x600.log` the same 6 FAIL shape. The
before set is the six-route list - `/agents/<id>` was added to the scene by this
change - so that route's before frame and log line are in `before-agents-detail/`
(43 PASS / 2 FAIL: the hand-over and the band's reach). The control routes (`/chat`, `/agent-hub`,
`/schedules`) assert the band is exactly the app sidebar's own width, so this is
not a rule that quietly widens every band.

## What the frames are, and what they are not

They are the built app's own captures of a state the driver held still for, at two
sizes, before and after. They are not a claim about Windows or Linux: this host
renders the macOS integrated window, where the lane is the band, and the
Windows/Linux caption band is reasoned about in the source comments and pinned by
`scripts/titlebar-options.test.mjs` rather than photographed here.
