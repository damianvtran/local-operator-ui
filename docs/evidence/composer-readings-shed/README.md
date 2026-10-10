# The readings strip against its controls — the running-state shed (#788) and the narrow-row ladder (#918)

The composer row's readings strip, photographed against its controls at chosen
column widths in both states, both themes, before and after the fix for
issue #918 — **54 frames per side, 27 cases**, and this file is the record
the frames describe.

Two defects live on this one row and the set covers both:

1. **#788, the running-state overrun** (fixed by #828): the active-time
   reading's shed band was derived against the idle controls group (mic +
   Send, 68px), while a running turn draws a THIRD 32px box
   (`[mic][Stop][Send]` = 104px). Above the band's upper edge the reading
   came back into a row with 36px less room and overran the controls —
   `running-fullest-908/1024/1200` end 7.2 and 8.2px past them.
2. **#918, the narrow-row overrun** (fixed here): below the band's lower
   edge the cluster carried every reading into a row that could not hold
   them, in BOTH states — measured before the fix below, `+201.5px` of
   reading-over-control at a 480px column (idle; `+195.8` running),
   `+129.2/+127.5` at 700. #828's own README recorded this case as out of
   scope ("The narrow row is not fixed here"); this is the set after #918
   fixes it.

## Where the frames came from

One worktree (`~/local-operator-ui/.worktrees/composer-readings-narrow`) run
twice, by the same rig, with the tree clean at each run:

- **before** — the branch's pristine base, `404f27fdf86`, captured *before
  any edit of this change* (the run's log records a clean tree). #788's own
  pair shipped from `77444ffb36f`; this pair re-shoots from the branch's
  current base so both halves name revisions this change can be held to.
- **after** — the fix commit `ca30eb0a310`, the source commit the after
  frames were taken on.

Both passes ran on 2026-10-10, five runs each, in the order the commands
below list.

So each half is a named revision rather than a working-tree state, and there
is no second checkout or copied rig involved. The rig differs between the
halves by **one comment** inside its probe (a docs pointer that the same
change updates; no expression altered) — the before frames were taken with
the base revision's rig, the after frames with the fix's.

The command, per tree — five rig runs, so each run's Chrome is one launch
(the rig starts one vite and one private headless Chrome per RUN through the
repo's own `scripts/chrome-keychain.mjs`, and kills both by pid on exit):

```sh
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=idle-fullest,running-fullest --widths=480,560,640,700,798,860,908,1024 \
  --out=<tree-dir>/<side> --label=<side>
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=running-fullest --widths=1200 --out=<tree-dir>/<side> --label=<side>
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=running-issue --widths=700,798,908,1024 --out=<tree-dir>/<side> --label=<side>
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=idle-plain --widths=700,860,908,1024 --out=<tree-dir>/<side> --label=<side>
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=running-plain --widths=908,1024 --out=<tree-dir>/<side> --label=<side>
```

The rig writes row-sized PNGs at 2x plus `numbers.json` beside them; the
committed frames are those PNGs converted with
`cwebp -q 88 -m 6 <png> -o <case>/<theme>.webp`, one pass per side (the rig
never writes the `.webp` names itself).

What each fixture is, and why the rig exists at all rather than a live-app
capture, is in `scripts/composer-readings-geometry.tsx`'s own docblock — the
short form: `idle` is the settled row on a `session_interrupt` backend,
`running` is the same row with the third danger Square drawn, and the cluster
runs one of three fixtures (`plain`, `issue` = the #788 reporter's own state,
`fullest` = `issue` plus the context reading's `estimate` word, the widest
state the strip's own comment names).

## The numbers behind the frames

Read out of the live DOM at capture time (`getBoundingClientRect`, same
layout the crop was scanned from), dark theme; the light theme's edges are
identical to within 0.05px on every case in both trees.

- **`col`** the chat column the harness sizes · **`qcw`** what the container
  query actually resolves against (the column less the band's 48px inset) ·
  **`row`** the row's own width · **`ctl`** the controls group · **`dur`**
  whether the active-time reading is laid out · **`edge`** the rightmost
  **reading** box minus the controls' left edge — **positive is the defect**,
  the two overlap · **`cluster`/`chip`** the readings strip's and the cwd
  chip's boxes, after.

| case | col | qcw | row | ctl | before dur | before edge | after dur | after edge | after cluster | after chip |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `idle-fullest-480` | 480 | 432 | 416 | 60 | yes | +201.5 | no | -53.7 | 120.1 | 140.3 |
| `idle-fullest-560` | 560 | 512 | 480 | 68 | yes | +149.5 | no | -105.7 | 120.1 | 140.3 |
| `idle-fullest-640` | 640 | 592 | 560 | 68 | yes | +69.5 | no | -185.7 | 120.1 | 140.3 |
| `idle-fullest-700` | 700 | 652 | 620 | 68 | yes | +129.2 | no | -2.0 | 244 | 260 |
| `idle-fullest-798` | 798 | 750 | 718 | 68 | no | -2.0 | no | -2.0 | 342 | 260 |
| `idle-fullest-860` | 860 | 812 | 778 | 68 | no | -2.4 | no | -2.4 | 401.6 | 260 |
| `idle-fullest-908` | 908 | 860 | 778 | 68 | yes | -2.0 | yes | -2.0 | 402 | 260 |
| `idle-fullest-1024` | 1024 | 976 | 778 | 68 | yes | -2.0 | yes | -2.0 | 401 | 261 |
| `idle-plain-700` | 700 | 652 | 620 | 68 | yes | +89.1 | no | -64.9 | 181.1 | 260 |
| `idle-plain-860` | 860 | 812 | 778 | 68 | no | -104.2 | no | -104.2 | 299.8 | 260 |
| `idle-plain-908` | 908 | 860 | 778 | 68 | yes | -52.0 | yes | -52.0 | 352 | 260 |
| `idle-plain-1024` | 1024 | 976 | 778 | 68 | yes | -51.1 | yes | -51.1 | 352 | 261 |
| `running-fullest-480` | 480 | 432 | 416 | 92 | no | +195.8 | no | -21.7 | 120.1 | 140.3 |
| `running-fullest-560` | 560 | 512 | 480 | 104 | no | +147.8 | no | -69.7 | 120.1 | 140.3 |
| `running-fullest-640` | 640 | 592 | 560 | 104 | no | +67.8 | no | -149.7 | 120.1 | 140.3 |
| `running-fullest-700` | 700 | 652 | 620 | 104 | no | +127.5 | no | -89.9 | 120.1 | 260 |
| `running-fullest-798` | 798 | 750 | 718 | 104 | no | +29.5 | no | -2.0 | 306 | 260 |
| `running-fullest-860` | 860 | 812 | 778 | 104 | no | -2.0 | no | -2.0 | 366 | 260 |
| `running-fullest-908` | 908 | 860 | 778 | 104 | no | -2.0 | no | -2.0 | 366 | 260 |
| `running-fullest-1024` | 1024 | 976 | 778 | 104 | no | -2.0 | no | -2.0 | 365 | 261 |
| `running-fullest-1200` | 1200 | 1152 | 778 | 104 | no | -2.0 | no | -2.0 | 365 | 261 |
| `running-issue-700` | 700 | 652 | 620 | 104 | no | +65.7 | no | -89.9 | 120.1 | 260 |
| `running-issue-798` | 798 | 750 | 718 | 104 | no | -2.0 | no | -13.1 | 294.9 | 260 |
| `running-issue-908` | 908 | 860 | 778 | 104 | no | -28.2 | no | -28.2 | 339.8 | 260 |
| `running-issue-1024` | 1024 | 976 | 778 | 104 | no | -27.2 | no | -27.2 | 339.8 | 261 |
| `running-plain-908` | 908 | 860 | 778 | 104 | no | -68.2 | no | -68.2 | 299.8 | 260 |
| `running-plain-1024` | 1024 | 976 | 778 | 104 | no | -67.2 | no | -67.2 | 299.8 | 261 |

## What the numbers say

1. **The narrow defect was real in both states, and it is gone.** Before,
   every column from 480 to 700 overran the controls — idle and running
   alike, `+69.5` at its narrowest squeeze and `+201.5` at its worst. After,
   **every case in the band clears the controls**; the two fullest cells sit
   at the row's 2px cushion (`idle-fullest-700`, `running-fullest-798`),
   which is the same clearance the wide row has always rested at
   (`idle-fullest-908`: -2.0 both sides).
2. **The wider cases are untouched, byte for byte.** Every cell at or above
   the band's upper edge — `idle-fullest-798/860/908/1024`, `running-fullest-860/908/1024/1200`,
   `running-issue-908/1024`, `running-plain-908/1024`, `idle-plain-860/908/1024`
   — is **byte-identical between the two trees in both themes** (15 of the 27
   cases; sha256 over the `.webp`s). The change is scoped to the narrow side.
3. **The band's lower edge was drawing active time into a row that could
   not hold it.** `idle-fullest-798` is the band's lower edge: `qcw` 750 is
   where `@min-[750px]` started matching, so the reading was SHED there and
   drawn at 797 — where the row is 3px narrower, and the arithmetic the
   measured cells calibrate puts the overrun at ~32px. The fix retires the
   `@min-[750px]` half entirely: below
   container 860 the reading is shed at every narrower column, and the
   narrow side is covered by the ladder below.
4. **The ladder's thresholds are fit points, measured.** Each reading gives
   way when the row can no longer hold it *plus everything kept longer than
   it*. The fit points below are `numbers.json` arithmetic on the fullest
   fixture (the set must fit within the cluster's box plus its 2px cushion),
   converted to container values; each rung sits at the nearest whole
   container value above its fit, and one 36px step earlier while the third
   control box is drawn (the #788 state half):

   | rung (shed order) | the rung returns when the row holds | two-box fit (col) | two-box rung | third-box fit (col) | third-box rung |
   | --- | --- | --- | --- | --- | --- |
   | duration | all five readings | 829.2 | c860 (the band's, kept) | — | always shed |
   | effort | model · effort · context · cost | 791.5 | c750 (col 798) | 827.5 | c780 (col 828) |
   | cost | model · context · cost | 746.6 | c705 (col 753) | 782.6 | c740 (col 788) |
   | context | model · context | 680 | c640 (col 688) | 716 | c675 (col 723) |

   The duration's rung is the band's own 860, not re-derived: it is the
   value #788 settled for the third-box row, and the two-box row's fit
   (container 781) is narrower, so one value serves both.
5. **Why every rung below the duration's is a step coarser than the reading
   alone would need.** The cwd chip carries its `Working directory:` label
   from container 620 (`directory-indicator.tsx`, `CHIP_LABEL`), and that
   label costs the row ~120px of chip width (140.3 → 260, measured). Every
   narrow rung has to clear the LOWER of the two zones the same class can
   land in, and the labelled zone's fit point is always the lower one, so
   each rung is set there: context returns at a 688px column (723 running)
   where the two-reading set would fit from ~560 (596) in the unlabelled
   zone, and cost at 753 (788) where three readings fit from ~627 (663).
   A container query cannot ask what the chip is wearing, and a rung that
   tracked the label would be a finer rule than this row has ever carried;
   the cost is recorded here the way the state half's cost is (below).
6. **The model reading takes the freed width.** With the value readings
   given up, the model chip — the only reading that may truncate — expands
   into the row: at 480/560/640 it draws its whole name (120.1px, where the
   fullest states used to crush it to a 56px `claud…`), at `idle-fullest-700`
   it runs 74px beside a whole context reading, and the two 2px-cushion
   cases are the row exactly full.
7. **The state's +36px is still the whole reason for the state half of each
   rung.** Between otherwise identical cases the third box moves every fit
   point by exactly 36px (827.5 - 791.5, 782.6 - 746.6, 716 - 680), which is
   why each rung is declared twice — once per state — rather than being a
   single width.

## What this set cannot show, and what it does not claim

- **The post-stop grace window is not a state a mount can hold.** The
  reservation opens on a TRANSITION (the Stop control leaving the tree), not
  on a render, so the harness cannot photograph it; what it can say is that
  the reserved box is the Stop's own markup drawn `visibility: hidden`, so
  its geometry is the `running` row's, one edge later. The window's own
  transition is exercised against the live app in `docs/evidence/interrupt-live/`,
  not here.
- **The recording composition is not mounted.** While `isRecording` the
  group draws `[Confirm][Cancel]` plus the reserved slot rather than
  `[mic][Stop][Send]`; it is three boxes either way, and the shed predicate
  is computed from the same terms the slot is mounted on, so the case is
  covered by the predicate the change threads rather than by a fourth state.
  Forcing a live recorder needs the Radient credential path this harness
  does not arm.
- **It is a harness, not the app.** It mounts the shipped `MessageInput`
  with the app's own stylesheet and fixtures, inside a `justify-end` column
  so the row sits at the band's bottom edge as it does in the app — but the
  transcript beside it, the app shell and the real desktop bridge are
  absent, so nothing here is evidence about them (see
  `docs/evidence/composer-readings/` for the live-app counterpart of this
  same row).
- **The shed's cost is not overstated anywhere, and this set is where that
  was corrected (design round 1, D1).** The desktop renderer has exactly ONE
  active-time renderer and it is the strip's: no other module reads
  `active_duration_s`, `useActiveSeconds` or `session-duration` (the
  transcript's own clocks measure the turn or the phase, a different
  number). So while a turn runs the session's active time is shown nowhere
  in this app, and it returns by itself at turn end — and, since #918, at
  every column below container 860 it is not drawn in the idle state either,
  returning with width rather than with a press. There is no press that
  brings it back.
- **The ladder is coarser than the defect needs, measured rather than
  claimed — the same trade the state half already carries (design round 1,
  D2 for #788).** Each rung hides its reading for the whole span below its
  fit point (the numbers are in point 5 above), and it is written for the
  FULLEST fixture, so narrower states lose the reading while they still have
  room: `running-issue-798` drops effort at -13.1px where the four-reading
  set fitted at -2.0 before, and the state half's own examples stand —
  `running-plain-908` ends **68.2px** clear and `running-issue-908`
  **28.2px** clear, against 16.0 and 2.0 before #788's fix. A width-aware
  rule would have to measure the cluster's own width, which CSS cannot do
  here; a compacted spelling was the alternative and is rejected because the
  ladder reaches a clean row without it, and a compact value is a second
  voice for a number the tooltip states in full.
- **The turn boundary reflows the cluster, and no frame can show it (design
  round 1, D3).** A shed frees width at the very instant a control box
  appears or a rung steps, so the model chip expands into it — 56px → 84.5px
  at a 908px column — and the readings downstream shift; both move back when
  the state does. Derived from `numbers.json`, not observed: this rig mounts
  one state and cannot hold a transition.
- **The model readings at 480-640 are full names, and that is the harness's
  fixture** (`claude-sonnet-4-5`, ~120px). A longer real-world name truncates
  to its 56px floor instead; the floor is what fits there, and the frame
  showing the full name is showing the model chip that would render if the
  name were short.
- **A fourth row-budget state is not covered by this shed (agent review
  round 1, R1-2).** While the composer is acquiring the recorder
  (`isPreparing`) the controls group grows a caption — `Starting recording`,
  `shrink-0`, measured 112.6x19.5px in `docs/evidence/stt-instant-ack`. The
  group's growth there is TEXT, not a box, so no third 32px box is drawn and
  `controlsThirdBox` is false. It is pre-existing: the caption is on the
  base tree, the base carries the same overlap, and the caption's own
  evidence set photographed a composer with no readings cluster at all.
