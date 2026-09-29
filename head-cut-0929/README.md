# Head-cut condensation — the repro's before/after frames

Operator report this set photographs, verbatim: *"condensation doesn't handle
the case where the previous message is a few chunk loads up — i.e. when it
isn't loaded yet due to transcript lazy-loading, the turn 'doesn't condense
properly'."*

## How the frames were taken

- Branch: `fix/condense-unloaded-ea851b` (fix commit `126265f240`; the
  `before/` set is that tree's renderer built WITHOUT the fix, the `after/`
  set with it — same rig, same daemon, same probe, run twice).
- Seeded conversation: 8 turns, 444–604 rows each, written by
  `seed-long-turns.mjs` (included) into an isolated config dir.
- An isolated `local-operator serve` on 127.0.0.1:8080 serving that config;
  the app driven headless over CDP by `scripts/renderer-driver.mjs` plus a
  scratchpad-only scene (`--scene head-cut-probe`) that presses the real
  sidebar row, the real rail ticks, and dispatches REAL wheel events. The
  driver's own checks passed, including "window mode is headless and the
  window is never shown or focused".
- PNGs are 2x of a 1380x900 window (2760x1800).

## The pairs

| frame | before | after |
|---|---|---|
| `headcut-open-settled` | Opening the conversation renders the newest turn (604 rows) RAW: 60 mounted rows of "Step 292 of 300..." and ZERO bars; both bounded align fetches are spent on the open (`"earlier": "239 earlier"` = 299 loaded rows of 604) and the head is 594 rows above the window top. | The same turn is ONE bar — "49 actions" + the closing answer under it — with NO `Took`: the head is not loaded, so the duration is refused rather than fabricated. |
| `headcut-jump-t7` | A rail jump to turn 7's completion (~7 pages back) leaves the LANDED turn raw ("Step 214 of 220…" … "Turn 7 settled", "Worked · 30 actions") while turn 8 below shows its bar; no further fetch fires (the open spent the budget). | The landed turn renders as its answer with its folded bar above it; the live region states the settle — `"Turn condensed: 22 actions."` — and turn 8's bar (head loaded by the widened window) reads "Took 20m30s · 300 actions". |
| `headcut-pull8` | After 8 manual wheel pulls the loaded set moved ONE page (697→797 rows) and the head is still ~250 rows up; still no bar. | Turns 4–8 are all folded: turn 4's bar (head still cut) reads "91 actions" with NO `Took`; turns 5–8 (heads loaded) carry `Took` — the honest half of the rule, in one frame. |

`headcut-jump-t8user` and `headcut-pull4` are the same contrast at the other
two probe legs (a warm jump to turn 8's own user row; four pulls rather than
eight).

## The probe's key readings (trimmed; the `runIds` arrays elided)

BEFORE (fix absent):

```
A open-settled      {"mountedRows":60,"bars":[],"earlier":"239 earlier","scrollTop":0}
B jump-t7-settled   {"bars":[{"text":"Took 20m30s·300 actions","took":true,"top":693}],
                     "firstRows":[{"id":"ap0007191","top":-1449}],"earlier":"34 earlier"}
C after-8-pulls     {"scrollTop":-4000,"earlier":"40 earlier","lastMarks":[{"rows":757}]}
```

AFTER (fix present):

```
A open-settled      {"mountedRows":2,"bars":[{"text":"49 actions","took":false,"top":144}],
                     "firstRows":[{"id":"ap0008252"},{"id":"an0008"}],"earlier":"200 earlier"}
B jump-t7-settled   {"bars":[…,"Took 20m30s·300 actions"…],"liveRegions":["Turn condensed: 22 actions."],
                     "lastMarks":[{"rows":2191}]}
```

The trimmed fields are the whole claim: before, `bars` is empty (or misses the
landed turn) while its rows are raw; after, the same turn is a bar whose text
carries only what is loaded (no `Took` when the head is not), and the settle
is announced once.

## Reproduce

```
# 1. seed (writes <dir>/sessions/<id>/transcript.jsonl)
node seed-long-turns.mjs <config-dir>
# 2. serve it (isolated; needs the desktop token env var the driver's launch
#    will present)
LOCAL_OPERATOR_CONFIG_DIR=<config-dir> local-operator serve --host 127.0.0.1 --port 8080
# 3. drive it (worktree build of the branch; the scene is scratchpad-only and
#    not part of the repo)
node scripts/renderer-driver.mjs --scene head-cut-probe \
  --backend http://127.0.0.1:8080 --backend-records <config-dir>/run/serve \
  --seed-onboarding-complete --out <frames-dir>
```
