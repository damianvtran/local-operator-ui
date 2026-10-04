# The top slot's failure copy, and the interval that stands in front of it

UX evidence for the older-history slot row on PR #811
(`fix(chat): settle scroll paging in painted rows, and close the wedge it left
open`).

## Provenance — read this before citing a frame

**Every frame in this directory was shot at `7c03e48911e5`**, the branch head
after the fold of `origin/main` (`2de4e2e9de7`). The round-one set was shot at
`bd292c51001` (`in-transcript-failed/`, `retry-recovery/`), and that is **not**
the head on the PR today.

The fold carried real code into this cell's import path, so the pixels had to be
re-taken rather than argued across it:

```sh
# 14 files under src/, 857 insertions, and ask-queue.ts is one of them
git diff --stat 96a9b09086a 7c03e48911e5 -- src/
#  .../chat/ask-queue.ts                     | 262 ++++++++++++++++--
#  14 files changed, 857 insertions(+), 80 deletions(-)

# and it is imported by the component that renders this cell
grep -n "ask-queue" src/renderer/src/features/chat/canonical/canonical-transcript.tsx
#  86:import { askResponseSummary, askTimeoutSummary } from "../ask-queue";
```

What did **not** move across the fold, and is therefore still citable as
behaviour: the three modules the lane pins are byte-identical across it.

```sh
git diff --stat 96a9b09086a 7c03e48911e5 -- \
  src/renderer/src/features/chat/canonical/scroll-paging.ts \
  src/renderer/src/features/chat/canonical/use-scroll-paging.ts \
  src/renderer/src/features/chat/canonical/canonical-transcript.tsx
# -> empty
```

`older-history-slot.tsx` moved by two lines in the fold and both are comments
(the `@container` note), `chat-measure.ts` likewise, and the stories file gained
caption prose — so the boards' captions in the frames below are the folded
prose, which is a second reason the old frames were not reusable.

Capture settings: Storybook 8.6.12 dev (`--ci --quiet`, port 6093) from the
branch worktree, and a second instance (port 6094) from a base worktree at
`origin/main` = `2de4e2e9de7`. ONE headless Chrome per arm (`--headless=new
--use-mock-keychain`, scratch `--user-data-dir` inside this session's
scratchpad), driven over raw CDP; every cell rendered through
`iframe.html?id=<story>&viewMode=story&args=theme:<theme>` with the repo
capturer's own theme guard (`document.documentElement.dataset.theme`) and its
animation/caret freeze. Each still directory carries a `capture-receipt.json`
with the per-theme settle it waited for.

## 1. The copy pair

The copy strings did **not** change in this PR — `older-history-slot.tsx`'s
sentences are byte-identical across the fold. What changed is **which state the
hook selects** for a dead backend:

| tree | `slotState` takes `failed` when |
| --- | --- |
| `origin/main` | `olderFailed && (exhaustedRetries \|\| hiddenRows === 0)` |
| this branch | `olderFailed && !failureSuperseded` |

So a reader whose asks are all failing **while rows are still held back** read a
gesture that cannot work (`windowed`: *"Earlier history above — scroll up to
load"*) on the base, and reads a recovery action (`failed`: *"Could not load
earlier messages* / *Try again"*) here.

All five cells are re-shot at this head, twelve themes each:

- **`every-state/`** — both copies in one frame. `windowed` reads *"Earlier
  history above — scroll up to load"*, `failed` reads *"Could not load earlier
  messages / Try again"*, and the lower rules hold one baseline across all five.
- **`app-minimum-width/`** — the same arms at the app's 800px minimum window
  content box (252px, and the 220px floor this board draws). The narrow
  spellings take over: *"Did not load"*, *"Scroll up for earlier"*,
  *"Start of conversation"*. The caption under the 252px block is the folded
  prose (`480px since §I`), which the pre-fold frame could not show.
- **`in-transcript-failed/`** — the state the PR registered and shot nobody: the
  head row through the production `CanonicalTranscript`.
- **`transport-down/`** — the failure that the reader cannot answer is not
  painted as one.
- **`windowed-sentence/`** — the windowed sentence alone, at a readable size.

Both arms rendered the failure arm identically in all twelve themes; no palette
defect was seen.

## 2. The driven interval, and the BASE ARM that attributes it

`retry-recovery/head/<cell>/` holds one frame per distinct visible state on
mount, and `readings.json` beside it holds the raw record: the compositor's
frame table, the in-page DOM transition log, and which mounts were kept.

**How a frame is named, which is what the round-one set got wrong.** The
round-one sampler named a frame after the read that **preceded** its shutter, and
a shutter is not instant. Measured on this rig:

| shutter requested | slot read at request | shutter completed | pixels in the file |
| --- | --- | --- | --- |
| 352 ms | `Could not load earlier messages` | 478 ms | `Loading earlier messages` |

So a `Page.captureScreenshot` cannot corroborate a state that lives for ~15 ms,
and the round-one set's directory held two different `seq-01` frames from two
runs plus a white Storybook loading page (`seq-00-t6ms`) inside a dark-theme
probe. This pass captures the **compositor's own frames**
(`Page.startScreencast`), names each by its pixels against settled reference
stills of the same states — nearest by **changed-cell count**, because a
whole-frame mean separates these states by 0.1 — and records the in-page DOM
transition log (a MutationObserver plus a rAF heartbeat) beside it as the check.
A frame that matches no state reference is recorded but **never committed**.

**`head/in-transcript-failed` — the row over time, and the frame the set was missing**

| t | state | why |
| --- | --- | --- |
| 64 ms | `blank` | the app ground, dark, before its rows paint |
| **220 ms** | **`failed`** | `Could not load earlier messages / Try again` — painted, 0 changed cells against the failure reference |
| 235 ms | `loading` | `Loading earlier messages` |
| 2,216 ms | `failed` | settled |

The failure row **is** painted before the reveal chain replaces it; that window
is ~15 ms on this run and is a race, so a mount that does not paint it is
retried and the attempts are recorded rather than dressed up.

**The base arm.** The same probe was run against a base worktree at
`origin/main` = `2de4e2e9de7`, after the same warm-up. Both trees hold
`in-transcript-idle`; only this branch has `in-transcript-failed`.

| cell | arm | `Loading earlier messages` hold |
| --- | --- | --- |
| `in-transcript-idle` | head `7c03e48911e5` | 382 ms → 2,381 ms = **1,999 ms** |
| `in-transcript-idle` | base `2de4e2e9de7` | 263 ms → 2,258 ms = **1,995 ms** |
| `in-transcript-failed` | head (no base equivalent) | 235 ms → 2,216 ms = **1,981 ms** |

**The same interval, to 0.2%, on both arms — so it pre-dates this diff.** The
round-one pass recorded ~9–10 s here; that figure is not reproduced, and it does
not track the branch. It tracks the **Vite dev server's module graph**, which the
reference builds show directly: the *same* cell's settled state took **7,301 ms**
to reach against a freshly-started base server and **2,601 ms** against the head
server that had already served the set. `use-scroll-paging.ts` is in the cell's
path, which is why the round-one pass declined to clear it; the base reading
clears it.

## 3. The retry control's states

`retry-recovery/retry-states/` is the settled failure row in `localOperatorDark`,
the theme the rest of this set uses. Each state sits in a directory named after
the frame's own stem, with the palette as the filename — the shape
`pnpm check-evidence` can read a ground out of (see §4):

- `retry-rest-localOperatorDark/localOperatorDark.webp`;
- `retry-hover-localOperatorDark/localOperatorDark.webp` — hover driven by a real
  `Input.dispatchMouseEvent`, and read back: `matches(':hover')` is `true` and the
  control takes a colour step (`background-color: rgb(22, 40, 29)`). It does not
  lift, scale or translate, which is the branding contract's rule;
- `retry-focus-visible-localOperatorDark/localOperatorDark.webp` — focus reached by **pressing
  Tab** (2 steps), not by calling `.focus()` and not by setting a class, so the
  browser's own `:focus-visible` heuristic applies. Read back: `focusVisible:
  true`, `outline: 2px solid rgb(56, 201, 106)` — an **outline**, not a
  box-shadow, which matters because this app is mostly scroll containers and
  box-shadow rings are clipped by `overflow: hidden`.

## 4. Where the frames live, and why `pnpm check-evidence` decides it

`pnpm check-evidence` derives a frame's expected ground **from its filename**: a
frame committed as `<dir>/<stem>.webp` fails `no palette named <stem>` however
the set is declared. The set as first committed named every frame after its own
state and timestamp, so the whole of `retry-recovery/` was outside the gate's
reach — 19 of the 20 findings the sweep reported on `main`, with the set's own
`supplementary` entry missing its `why` as the twentieth.

A frame's own pixels chose its disposition here, and neither disposition
deletes a frame or alters a pixel:

- **A frame that is a picture of the app** moved to `<cell>/<stem>/<theme>.webp`
  keeping its bytes, exactly as `manifest.paletteStemRenameNote` records for the
  same failure class — `localOperatorDark` is the palette every cell was shot on
  (`readings.json`'s `domTheme`, and the rig's `theme:` iframe arg). Fourteen
  frames: the eleven state frames the five cell directories hold — three each in
  `base/in-transcript-idle`, `head/in-transcript-idle` and
  `head/in-transcript-failed`, one each in `base/in-transcript-loading` and
  `head/in-transcript-loading`, which is the states that EXIST rather than a full
  5×3 grid — plus the three `retry-states` stills, all within ΔE00 0.78 of the
  `localOperatorDark` ground and none more uniform than 96.13%.
- **A frame that is not** is the five `--00-…-blank` frames: the compositor's
  pre-paint buffer, measured at **100.00% a single colour** (`#211F1B`, the
  `localOperatorDark` canvas). That is the one thing the uniformity ceiling
  exists to refuse, so renaming cannot make them app pictures. They are
  re-containered to PNG **in place**, pixels asserted identical on decode — the
  container this repository commits a rig frame the sweep cannot judge as a
  picture in (`chat-slash-enter-gestures`, `mcp-auth-complete`), because a
  `Page.screencast` frame is not a Storybook still. Being PNG is not what makes
  them invisible: the sweep JUDGES BY NAME (a theme-named frame is judged in any
  container), so what puts them outside the judgement is that they name no theme -
  and the manifest's `unjudgedFrames` counts them instead (five of them inside
  this set), so one cannot be added, moved or re-containered without a count the
  gate reads going stale. They are kept rather than dropped: each marks the
  pre-paint moment its cell's interval is measured from.

## Not captured, and why

- **A base pair for the failure row itself.** The discriminating cell exists only
  on this branch, so the flip from `windowed` to `failed` is evidenced by
  `slotState`'s precedence and by the frames here, not by two pictures of the
  same input.
- **The adversarial cases named in the brief** — a failure while the window is
  still expanding, and two failures where only the second succeeds — need
  `olderFailed` / `hiddenRows` to vary over time. The cell passes `olderFailed` as
  a **fixed prop** and its fixture holds no rows back, so they remain reachable
  only from `scripts/transcript-paging-hook.test.mjs`.
- **A screen reader.** The live region's text is read, not heard.
- **A real transport loss.** On this surface a killed backend never flips
  `status`, so the transport states are story-only (as the sibling lane records).

## Rig teardown

One Storybook per arm on a unique port (6093 branch, 6094 base), one Chrome per
arm (`--headless=new --use-mock-keychain`, `--user-data-dir` in this session's
scratchpad); no `CMUX_*` variable survives into either; each process group reaped
by exact pid and both ports confirmed closed. Both worktrees were removed after
the capture and the primary checkout was left untouched.
