# Head-cut condensation — the repro's before/after frames

Operator report this set photographs, verbatim: *"condensation doesn't handle
the case where the previous message is a few chunk loads up — i.e. when it
isn't loaded yet due to transcript lazy-loading, the turn 'doesn't condense
properly'."*

## How the frames were taken

- Branch: `fix/condense-unloaded-ea851b`. `before/` and `before-light/` are the
  tree at `91617c21ec` (the fix absent) built and driven; `after/` and
  `after-light/` are the FOLDED remediation head `83500a06bd` (fix present,
  with main's #638/#637/#617 merges behind it) built and driven — same rig,
  same daemon, same probe, one run per half; the folded re-shoot's readings
  are identical to the pre-fold run's (checked field by field), so the pair
  is content-stable across the fold.
- Seeded conversation: 8 turns, 444–604 rows each, written by
  `seed-long-turns.mjs` (included). Session id `be1a9fef00a1`, deterministic.
- An isolated `local-operator serve` on 127.0.0.1:8080 serving that config;
  the app driven headless over CDP by `scripts/renderer-driver.mjs` plus a
  scratchpad-only scene (`--scene head-cut-probe`) that presses the real
  sidebar row, the real rail ticks, and dispatches REAL wheel events. The
  driver's own checks passed, including "window mode is headless and the
  window is never shown or focused".
- Palettes: `localOperatorDark` (default) and `localOperatorLight`
  (`--theme localOperatorLight`) — the set carries both.
- PNGs are 2x of a 1380x900 window (2760x1800).

## The pairs

| frame | before | after |
|---|---|---|
| `headcut-open-settled` | Opening the conversation renders the newest turn (604 rows) RAW: 60 mounted rows of "Step 292 of 300..." and ZERO bars; both bounded align fetches are spent on the open (`"earlier": "239 earlier"` = 299 loaded rows of 604) and the head is 594 rows above the window top. | The same turn is ONE bar — "49 actions" + the closing answer under it — with NO `Took`: the head is not loaded, so the duration is refused rather than fabricated. Measured: content 113px against a 694px pane (see the blank-space note). |
| `headcut-jump-t7` | A rail jump to turn 7's completion (~7 pages back) leaves the LANDED turn raw ("Step 214 of 220…" … "Turn 7 settled", "Worked · 30 actions") while turn 8 below shows its bar; no further fetch fires (the open spent the budget). | The landed turn is folded FROM ITS OWN BAR: the re-capture reveals the run's bar first (design round 1, D1 — the bar stands at the run's first hidden row and sat **72px above** the tick-centred viewport: `B2 jump-t7-bar-reveal {found:true, delta:72}`), so the frame carries `[bar "8 actions"][answer][stamp]` plus turn 8's bar ("Took 20m30s · 300 actions"). No announcement fires for this reveal — a window-entered bar is not a settle (review round 1, MAJOR-1). |
| `headcut-pull8` | After 8 manual wheel pulls the loaded set moved ONE page (697→797 rows) and the head is still ~250 rows up; still no bar. | Turns 4–8 are all folded: turn 4's bar (head still cut) reads "91 actions" with NO `Took`; turns 5–8 (heads loaded) carry `Took` — the honest half of the rule, in one frame. |

`headcut-jump-t8user` and `headcut-pull4` are the same contrast at the other
two probe legs (a warm jump to turn 8's own user row; four pulls rather than
eight).

## The blank space under the folded strips (design round 1, D2)

The settled frames read mostly empty because the folded conversation IS
shorter than the pane: with every completed turn standing as one bar, the
content column measures **113px (open) / 277px (jump) against a 694px pane**
(the `geometry` field of each state reading in the run logs) and the column
packs to the top when it fits. The blank is the pane's leftover height; the
same frame's bar counts state what is not on screen.

## The probe's key readings (trimmed; the `runIds` arrays elided)

BEFORE (fix absent; identical in the dark and light halves):

```
A open-settled      {"mountedRows":60,"bars":[],"firstRows":[{"id":"tool:at0008271","top":-1251}],
                     "geometry":{"content":2057,"pane":694},"earlier":"239 earlier"}
B jump-t7-settled   {"mountedRows":64,"bars":[{"text":"Took 20m30s·300 actions","took":true}],
                     "firstRows":[{"id":"ap0007191","top":-1449}],"earlier":"34 earlier"}
B2 bar-reveal       {"found":false}   <- the landed run has NO folded bar to reveal
C after-8-pulls     {"mountedRows":158,"bars":[turn 8's only],"scrollTop":-4000,
                     "earlier":"40 earlier"}
```

AFTER (fix present; the folded remediation head `83500a06bd`):

```
A open-settled      {"mountedRows":2,"bars":[{"text":"49 actions","took":false}],
                     "geometry":{"content":113,"pane":694},"earlier":"200 earlier"}
B jump-t7-settled   {"bars":[{"text":"8 actions","took":false},
                     {"text":"Took 20m30s·300 actions","took":true}],"liveRegions":[],
                     "geometry":{"content":277,"pane":694}}
B2 bar-reveal       {"found":true,"delta":72,"text":"8 actionsJun 3, 1:24 PM"}
C after-8-pulls     {"bars":[4 folds, turn 4 "91 actions" no Took],"liveRegions":[],"scrollTop":-93}
```

The two `B2` rows are the D1 pair: the pre-fix landed turn has no bar at all
(`found:false`), and the fixed one's bar sits 72px above the tick-centred
viewport the capture would otherwise have framed (`delta:72`). `liveRegions`
is empty in every after row — reveals are silent (review round 1, MAJOR-1);
the pre-fix runs also show empty regions here because their announcements, when
they happened, were of reveals and are exactly what the review removed.

## Reproduce

```
# 1. seed (writes <dir>/sessions/be1a9fef00a1/transcript.jsonl)
node seed-long-turns.mjs <config-dir>
# 2. serve it (isolated; needs the desktop token env var the driver's launch
#    will present)
LOCAL_OPERATOR_CONFIG_DIR=<config-dir> local-operator serve --host 127.0.0.1 --port 8080
# 3. drive it (worktree build of the branch under test; the scene is
#    scratchpad-only and not part of the repo)
# --theme takes localOperatorDark (default) or localOperatorLight
node scripts/renderer-driver.mjs --scene head-cut-probe \
  --theme localOperatorDark \
  --backend http://127.0.0.1:8080 --backend-records <config-dir>/run/serve \
  --seed-onboarding-complete --out <frames-dir>
```
