# Mesh tab — the operator-report pair (`mesh-tab-before`)

The BEFORE half of a declared pair. `docs/evidence/mesh-tab/` carries the AFTER
frames of three states — `many-conversations`, `many-conversations-menu` and
`many-conversations-peer`, the device panel open over a catalogue page of
conversations — and this set carries **the same three states rendered by
`origin/main`'s two component files**, so a reviewer compares a frame with its
twin rather than a still with a memory.

**Why this set is supplementary rather than swept.** A sweep photographs the
tree it runs in; these frames deliberately do not (`mesh-card.tsx` and
`mesh-node.tsx` are at `origin/main`'s bytes under the same fixtures), so the
sweep cannot regenerate them and `manifest.json` declares them as a declared
set — the same treatment the other `-before` sets in this directory get.

**The defect the pair is about** (operator report, 2026-10-04): the panel's
conversation list escaped its own box and painted through the sections below it
— Network addresses, Status and Show in list interleaved line for line with the
rows — and the node chips read as tail fragments (`…BE-OK`, `…2E pull`) that
identify nothing. The fix is `mesh-card.tsx`'s `shrink-0` (the measured story is
in the comment beside it) and `mesh-node.tsx`'s head-truncation.

## What produced these frames

**Both halves of the pair:** one private headless Chrome per run through the
repository's own `scripts/chrome-keychain.mjs`, raw CDP at 1380x900,
`deviceScaleFactor: 1`, `Page.captureScreenshot` as webp at quality 88 — the
same encoding the set's swept frames carry. The AFTER half is the repo sweep's
own output (`scripts/capture-evidence.mjs`, committed in `../mesh-tab/`); the
BEFORE half was shot with the harness beside this file,
`harness/rendered-dom-audit.mjs`, on the same Storybook, the same story ids, the
same fixtures and the same viewport, with the two component files checked out to
`origin/main`'s bytes for the run (restored afterwards):

```sh
# Storybook up at the fix commit; the two component files at origin/main's bytes:
git checkout origin/main -- src/renderer/src/features/mesh/mesh-card.tsx src/renderer/src/features/mesh/mesh-node.tsx
for theme in localOperatorDark localOperatorLight; do
  node docs/evidence/mesh-tab-before/harness/rendered-dom-audit.mjs \
    --story mesh-tab--many-conversations --story mesh-tab--many-conversations-menu \
    --story mesh-tab--many-conversations-peer \
    --label before-$theme --theme $theme --dpr 1 --quality 88 --format webp \
    --wait-for '[data-mesh-panel]' --shot
done
git checkout HEAD -- src/renderer/src/features/mesh/mesh-card.tsx src/renderer/src/features/mesh/mesh-node.tsx
```

The same rig wrote the AFTER audit runs; `readings.json` beside this file is
its output (totals, the conversations section's own box against its content, and
the chip spans' visible px against the full string's width). The full per-run
JSON - every overlapping pair, rect and clipped string - lives in the lane's
session scratchpad; the command above regenerates it.

**Re-derived for design round 1 (2026-10-04), and the earlier readings
reproduced.** The round's D4 found the chip block blind: box width and full
text width are identical whichever end is kept, so the metric could not see the
change it was added to measure. The harness now records `side` (the end the
ellipsis leaves visible) and `kept` (the longest head/tail substring fitting
the box, canvas-measured) beside those two numbers, and `readings.json` was
regenerated from six fresh runs - before and after, both palettes, plus two
BOTTOM runs (`scrollTop = scrollHeight`; design round 1, D3(a)) - with the
earlier runs' totals reproduced exactly (24 / 24 / 18 in-flow, 3 / 3 / 3
container, section 166/6755 before, 6755/6755 after). The bottom state has no
BEFORE twin on purpose: at `origin/main`'s bytes the sections painted through
the list rather than sitting below it, and the three states above already
photograph that defect from the top.

## The numbers

| state | theme | before: in-flow overlaps / container overlaps | after: in-flow / container |
| --- | --- | --- | --- |
| `many-conversations` (201 rows) | both | **24 / 3** | **0 / 0** |
| `many-conversations-menu` (menu open) | both | **24 / 3** | **0 / 0** |
| `many-conversations-peer` (11 rows) | both | **18 / 3** | **0 / 0** |

The overlap is the **same with the menu closed as with it open** — that is the
reading that rules the popover out as the layer at fault, and why the fix is at
the container. The figure behind it: the conversations section measured
**6,755 px of content in a 166 px box** before (the panel's flex column held it
shrank while its `<ul>` kept its natural height and painted over every sibling
below — container-region intersections 26,281 px² and 19,560 px² against the
Network addresses and Status sections), and **6,755 px in 6,755 px** after, with
the aside's `scrollH` 7,028 → 7,307 — i.e. the panel scrolls its own column now:
scrolled to the bottom, the addresses, Status and Show in list sections stack
below the list with 0 overlaps (the state `../mesh-tab/many-conversations-bottom/`
photographs - design round 1, D3), and `readings.json`'s two bottom runs are the
numbers behind that frame. `side`/`kept` in the same file's chip block is where
the truncation flip reads as a measurement rather than an image: `tail` /
`obe OK` before, `head` / `Provisi` after.

**These frames therefore do NOT prove** that a live relay answers these
payloads or that a real mesh looks like this (the fixtures are invented; the
owner's real catalogue is not committed). They prove what the two source files
change about the same story, at the same size, in both brand palettes — which is
what a before/after pair is for.
