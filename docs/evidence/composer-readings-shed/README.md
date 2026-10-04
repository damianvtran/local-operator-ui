# The composer row's readings strip against its controls — the running-state shed (issue #788)

The composer row is one `flex-nowrap` line at every width: `[attach][cwd chip]
[readings][mic][send or Stop]`. The active-time reading is the one reading with a
shed rule, and that rule is a container query —
`@min-[750px]/chatcol:@max-[860px]/chatcol:hidden` — derived against the **idle**
controls group, mic + Send. While a turn runs the group carries a **third** 32px
box (the danger Stop square, `32·3 + 4·2 = 104px` against the 68px the band was
derived from), and the window after a turn ends reserves that same box invisibly
through its grace. So above the band's upper edge the reading came back into a row
with 36px less room than the threshold assumed, and it overran the controls.

This set is the before/after pair for that, and the numbers that say **why** the
fix is a state rather than a wider band.

## How to re-run it

One rig, both trees — the pair is only a controlled comparison if both halves come
from the same script, the same fixtures and the same widths. The five harness
files are copied verbatim into the base worktree, so nothing about the rig differs
between the halves.

```sh
# in the base worktree (77444ffb36f) and in the branch's worktree
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=idle-plain,idle-fullest --widths=700,860,908,1024 --out=<dir> --label=<tree>
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=running-plain,running-issue --widths=908,1024 --out=<dir> --label=<tree>
node scripts/composer-readings-geometry.mjs --port=5434 --themes=both \
  --only=running-fullest --widths=700,860,908,1024,1200 --out=<dir> --label=<tree>
```

The rig starts the harness's own Vite dev server (it kills what it starts), drives
`scripts/composer-readings-geometry.html` over raw CDP in **one** private headless
Chrome per run — launched through the repo's `scripts/chrome-keychain.mjs`, killed
by exact pid on exit — and writes one row-sized crop per case per theme plus the
`numbers.json` this README's table is read from. `--json` prints the same records
to stdout.

## The two trees

| | |
| --- | --- |
| `before/` | the base worktree at `77444ffb36ff8c97e0ec0a3b76730f4f7057b7cb`, with the five rig files copied in and nothing else touched |
| `after/` | this branch at `dbfc6f9b712`, the source commit the frames were taken on (the rig is that commit's too, so its tree is clean) |
| themes | `localOperatorDark` and `localOperatorLight`, both sides |
| cases | 17 per side (`numbers.json` carries one record per case per theme) |

## The numbers behind the frames

Read out of the live DOM at capture time (`getBoundingClientRect` on the same
layout the crop was scanned from), both themes; the dark theme's rows are below and
the light theme's are identical in every column.

- **`col`** the chat column the harness sizes · **`qcw`** what the container query
  actually resolves against · **`row`** the row's own width · **`cluster`** the
  readings strip's box · **`ctl`** the controls group · **`model`** the model
  reading's box (its floor is 56px) · **`dur`** whether the active-time reading is
  laid out · **`edge`** the rightmost **reading** box minus the controls' left
  edge — **positive is the defect**, the two overlap.

| case | col | qcw | row | cluster | ctl | model | before dur | before edge | after dur | after edge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `idle-fullest-700` | 700 | 652 | 620 | 244 | 68 | 56 | yes | 129.2 | yes | 129.2 |
| `idle-fullest-860` | 860 | 812 | 778 | 401.6 | 68 | 120.1 | no | -2.4 | no | -2.4 |
| `idle-fullest-908` | 908 | 860 | 778 | 402 | 68 | 82.8 | yes | -2 | yes | -2 |
| `idle-fullest-1024` | 1024 | 976 | 778 | 401 | 68 | 81.8 | yes | -2 | yes | -2 |
| `idle-plain-700` | 700 | 652 | 620 | 244 | 68 | 56 | yes | 89.1 | yes | 89.1 |
| `idle-plain-860` | 860 | 812 | 778 | 299.8 | 68 | 72.9 | no | -104.2 | no | -104.2 |
| `idle-plain-908` | 908 | 860 | 778 | 352 | 68 | 72.9 | yes | -52 | yes | -52 |
| `idle-plain-1024` | 1024 | 976 | 778 | 352 | 68 | 72.9 | yes | -51.1 | yes | -51.1 |
| `running-fullest-700` | 700 | 652 | 620 | 208 | 104 | 56 | yes | 165.2 | no | 127.5 |
| `running-fullest-860` | 860 | 812 | 778 | 366 | 104 | 84.5 | no | -2 | no | -2 |
| `running-fullest-908` | 908 | 860 | 778 | 366 | 104 | 56 | **yes** | **7.2** | no | -2 |
| `running-fullest-1024` | 1024 | 976 | 778 | 365 | 104 | 56 | **yes** | **8.2** | no | -2 |
| `running-fullest-1200` | 1200 | 1152 | 778 | 365 | 104 | 56 | **yes** | **8.2** | no | -2 |
| `running-issue-908` | 908 | 860 | 778 | 366 | 104 | 108.6 | yes | -2 | no | -28.2 |
| `running-issue-1024` | 1024 | 976 | 778 | 365 | 104 | 107.6 | yes | -2 | no | -27.2 |
| `running-plain-908` | 908 | 860 | 778 | 352 | 104 | 72.9 | yes | -16 | no | -68.2 |
| `running-plain-1024` | 1024 | 976 | 778 | 352 | 104 | 72.9 | yes | -15.1 | no | -67.2 |

## What the numbers say

1. **The overrun is the running state's, and it is not an edge effect.** With the
   fullest cluster and a running turn, the last reading ends **7.2px past** the
   controls' left edge at a 908px column and **8.2px** at 1024 and 1200 — with the
   model name already at its 56px floor (`claud…` in the frame). It is not a
   band-edge artefact: it holds at every width above the band.
2. **There is no width that fixes it.** The row is **778px at every column from
   858 up** (`row` is 778 at 908, 1024, 1200 and 1600 alike) because the composer
   box is capped at `--lo-chat-measure`, 810px shipped. The cluster therefore gains
   nothing from a wider window past the cap, so no upper band edge exists at which
   the running row fits the fullest cluster — the shed has to be on the state.
3. **The band's upper edge is a 908px COLUMN, not 860.** `CHAT_COLUMN_CONTAINER` is
   applied on the composer band as well as on the chat column, and the *nearest*
   ancestor of that name wins, so the query sees the band's **content** box: the
   column less its `px-6` inset (48). Confirm it on the frames — the reading is
   drawn at column 908 (`qcw` 860) and not at 900 (`qcw` 852). The band's lower
   edge is correspondingly a 798px column.
4. **The idle row at the same widths is 2px CLEAR** (`idle-fullest-908`), which is
   why 860 remains the right upper edge for the two-box row and the band is not
   changed: the only thing widened is the state.
5. **The idle cases are byte-identical between the trees**, in both themes — the
   control that says the change is scoped to the state.

## What this set cannot show, and what it does not claim

- **The post-stop grace window is not a state a mount can hold.** The reservation
  opens on a TRANSITION (the Stop control leaving the tree), not on a render, so
  the harness cannot photograph it; what it can say is that the reserved box is the
  Stop's own markup drawn `visibility: hidden`, so its geometry is the `running`
  row's, one edge later. The window's own transition is exercised against the live
  app in `docs/evidence/interrupt-live/`, not here.
- **The recording composition is not mounted.** While `isRecording` the group draws
  `[Confirm][Cancel]` plus the reserved slot rather than `[mic][Stop][Send]`; it is
  three boxes either way, and the shed predicate is computed from the same terms
  the slot is mounted on, so the case is covered by the predicate the change
  threads rather than by a fourth state. Forcing a live recorder needs the Radient
  credential path this harness does not arm.
- **The narrow row is not fixed here, and these frames show it is not.**
  `running-fullest-700` is still `+127.5px` after the change (from `+165.2`), and
  its idle twin is `+129.2` **before and after** — the cluster overflows its own
  line at a 700px column in the idle state as much as the running one, because the
  chip group plus three `shrink-0` readings exceed the width. That is a defect of
  this row in both states and is not #788's subject; the frames are in the set so a
  reviewer can see the change did not silently claim it.
- **It is a harness, not the app.** It mounts the shipped `MessageInput` with the
  app's own stylesheet and fixtures, inside a `justify-end` column so the row sits
  at the band's bottom edge as it does in the app — but the transcript beside it,
  the app shell and the real desktop bridge are absent, so nothing here is evidence
  about them (see `docs/evidence/composer-readings/` for the live-app counterpart
  of this same row).
