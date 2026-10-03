# The top slot's failure copy, and the interval that stands in front of it

UX review evidence for the older-history slot row on PR #811
(`fix/chat): settle scroll paging in painted rows, and close the wedge it left
open`).

## Provenance — read this before citing a frame

**`in-transcript-failed/` and `retry-recovery/` were shot at `bd292c51001`.**
That is not the head on the PR today: a fold landed `origin/main` into the
branch afterwards, moving it to `30f88e78cd1`, and the fold carried **28 files
under `src/`** (2,378 insertions) — at least four of them in this cell's import
graph (`chat-page.tsx`, `message-input.tsx`, `canonical-sessions-store.ts`,
`shared/desktop-contract.ts`). **A re-shoot on `30f88e78cd1` is owed before
these pixels are cited as the shipped rendering.**

What survives the fold untouched is the behaviour, and that is checkable:

```sh
# the four modules under test are byte-identical across the fold
git diff --stat bd292c51001 30f88e78cd1 -- \
  src/renderer/src/features/chat/canonical/scroll-paging.ts \
  src/renderer/src/features/chat/canonical/use-scroll-paging.ts \
  src/renderer/src/features/chat/canonical/canonical-transcript.tsx \
  src/renderer/src/features/chat/canonical/older-history-slot.stories.tsx
# -> empty

# and they are exactly this branch's src delta against main
git diff --name-only 30f88e78cd1 origin/main -- src/
# -> those four files, and nothing else
```

So `retry-recovery/measurements.json` — the driven interval — is produced by
code that did not move across the fold and is valid on both heads. The frames
are not.

Capture settings: Storybook 8.6.12 dev (`--ci --quiet --no-open`, port 6091)
from the branch worktree; ONE headless Chrome (`--headless=new
--use-mock-keychain`, scratch `--user-data-dir`), driven over raw CDP with the
repo's own module graph; every cell rendered through
`iframe.html?id=<story>&viewMode=story&args=theme:<theme>`.
`in-transcript-failed/capture-receipt.json` carries the per-theme settle that
each frame waited for.

## 1. The copy pair

The copy strings themselves did **not** change in this PR — `older-history-slot.tsx`
is byte-identical across the fold. What changed is **which state the hook
selects** for a dead backend:

| tree | `slotState` takes `failed` when |
| --- | --- |
| `origin/main` | `olderFailed && (exhaustedRetries \|\| hiddenRows === 0)` |
| this branch | `olderFailed && !failureSuperseded` |

So a reader whose asks are all failing **while rows are still held back** reads
a gesture that cannot work (`windowed`: *"Earlier history above — scroll up to
load"*) on the base, and a recovery action (`failed`: *"Could not load earlier
messages* / *Try again"*) here.

**`in-transcript-failed/` (12 themes)** is the state the PR registered and shot
nobody — the head row `chat-older-history-slot--in-transcript-failed`, rendered
through the production `CanonicalTranscript`, settled on the failure copy.

**Both copies in one frame**: `docs/evidence/chat-older-history-slot/every-state/`
(the committed board, unchanged by this branch) stacks all five arms between
rules — `windowed` reads *"Earlier history above — scroll up to load"* and
`failed` reads *"Could not load earlier messages / Try again"*, and the lower
rules hold one baseline across all five. At the app's 800px minimum window the
same two rows take their short spellings — *"Scroll up for earlier"* and
*"Did not load"* — in the committed `app-minimum-width/` board (252px and
220px), which is why the narrow treatment is cited from that set rather than
re-shot here.

No frame in this directory is a base capture, and none is presented as one: the
discriminating cell exists only on this branch, and the base's rendering of the
same input cannot be produced without a second Storybook (out of this window's
budget). The base semantics above are the **code path**, not a picture.

## 2. The driven interval

`retry-recovery/measurements.json` is the raw per-sample record; the frames
beside it are one per distinct visible slot-row reading. Sampled every 120 ms
for 14 s from `Page.navigate`, on the head, `localOperatorDark`, 900x520.

**`in-transcript-failed` — the row over time**

| t | visible slot row | rows | slot h |
| --- | --- | --- | --- |
| 6 ms | *(blank)* | 0 | – |
| **374 ms** | `Could not load earlier messages` + `Try again` | 3 | 28 px |
| **626 ms** | `Loading earlier messages` | 3 | 28 px |
| **9,620 ms** | `Could not load earlier messages` + `Try again` | 3 | 28 px |

The failure row paints, is **replaced by a loading row for ~9.0 s**, and only
then returns. The row count below the slot never moves (3 throughout) and the
slot's control never changes height (28 px throughout) — the fixed-height
invariant holds across the swap.

**`in-transcript-idle` — the same shape, and this is the control that matters**

| t | visible slot row |
| --- | --- |
| 574 ms | `Loading earlier messages` |
| 10,108 ms | `Load earlier messages` |

**`in-transcript-loading`** holds `Loading earlier messages` for the whole 14 s
window, as that story should.

**The retry holds still.** Clicking `Try again` on the settled failure row
(n=20 samples at 100 ms):

- row text: `Loading earlier messages` for all 20 samples (2.0 s), so the click
  gives immediate feedback and the recovery affordance does not re-appear
  instantly;
- `scrollTop`: **0 before, 0 after, for every sample** — one value, no writes
  observed on the element the probe resolved;
- first row below the slot: **y = 60 px before, 60 px after, every sample —
  0.0 px drift**, matching the QA pass's 0.0 px reading;
- slot control height: **28 px, every sample**.

**What this rig could not settle, stated plainly.** The ~9–10 s
`Loading earlier messages` interval appears on **both** the changed
(`in-transcript-failed`) and the untouched (`in-transcript-idle`) cells, at a
remarkably constant magnitude (9.6 s and 10.1 s across independent navigations,
and 8.7–11.2 s across 24 themed stills). Two explanations fit and **this rig
does not separate them**: (a) the transcript's reveal chain taking seconds to
settle in a 3-row, non-scrollable story fixture, or (b) the Vite dev server
compiling the cell's module graph per navigation. Either way it is **bigger than
this diff** — but note that `in-transcript-idle` renders through
`use-scroll-paging.ts`, which this PR *does* change, so the interval **cannot be
called pre-existing without a base capture**. It is the one reading in this set
that a base Storybook would settle, and it is recorded as open rather than as a
finding against this diff.

**Also not captured**, and why:

- the adversarial cases the brief named — *a failure while the window is still
  expanding*, and *two failures where only the second succeeds* — need
  `olderFailed`/`hiddenRows` to vary over time. The story cell passes
  `olderFailed` as a fixed prop and its fixture holds no rows back (the cell's
  own docstring says so: *"the `windowed` contrast lives in the assertion, not
  in this board"*). Storybook has no play-function or args surface for it, so
  these are reachable today only from `scripts/transcript-paging-hook.test.mjs`;
- a real transport loss, for the reason the sibling lane already records
  (`docs/evidence/transcript-scroll-paging/README.md` § *Still open*): on this
  surface a killed backend never flips `status`, so the transport states are
  story-only;
- palettes beyond the twelve in `scripts/capture-evidence.mjs`'s `THEMES`.
