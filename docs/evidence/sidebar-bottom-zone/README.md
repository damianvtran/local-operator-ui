# The sidebar's bottom zone — the space under the destinations, and the collapsed section's gap

The operator's report (2026-09-27) is three sentences, and this set measures all
of them:

> "Just the space between the bottom most nav button and the controls needs to be
> reduced." — the gap he called "a bunch of extra space", between the destinations
> (the last row of `Browser` / `Agent hub` / …) and the band, the chat view's
> control row (Search, View options, New agent or team).

> "I think maybe some reduction between the controls and the sections below them
> might make sense to be more compact." — the floated second half; the measurement
> below is why it stays at 12px (recorded, not taken).

> And, asked twice, from an earlier message: "shrink the gap between agents and
> teams headers when agents is collapsed, there's an extra gap wasting space
> there." — the conditional in the third section below.

## The two halves, and which tree each came from

| Half | Tree |
| --- | --- |
| `before/` | `origin/main` = `8b082c33d8` with only the scene added (commit `d39a76c21a`) — the state the report is against |
| `after/` | this change's own tree: commit `da29b42bfb` (the frames were taken from its working tree, byte-equal to what that commit carries) |

One launch per palette per half, `--window-size 1380x900`, `headless` (the driver
asserts the window is never shown and never focused), against the sidebar
row-space set's stand-in daemon
(`docs/evidence/sidebar-row-space/harness/stub-daemon.mjs --catalogue 120
--no-page`), reused rather than copied: it already serves the session catalogue
the band and the entity sections both gate on, with two agents, two teams and a
120-chat catalogue.

## What produced the frames

```
node scripts/renderer-driver.mjs --scene sidebar-bottom \
  --backend http://127.0.0.1:<port> --backend-records <dir> \
  --seed-onboarding-complete --theme localOperatorDark --expect <before|after> \
  --out <frames-dir> --window-size 1380x900
```

Each state is reached by PRESSING the real section headers — never by seeding —
and each press is asserted against the `aria-expanded` it moved. On the `after`
half the scene asserts this change's own claims (16 / 8 / 16); on the `before`
half it records the same readings without failing on them, because those claims
are the change and a pre-change tree failing them would only restate that it is
the pre-change tree.

## The numbers, from `measurements/`

One evaluate per state returns the boxes, and every figure below is a subtraction
over those boxes (`states.<label>.boxes` / `.gaps`), never a class name read
aloud. The gaps are in CSS px, identical in both palettes and across every state:

| gap (boxes subtracted) | before | after |
| --- | --- | --- |
| within the primary rows (`newChat` bottom → `searchRow` top) | 2 | 2 |
| primary rows → destinations (`searchRow` → `destinations`) | 8 | 8 |
| **destinations → band (`destinations` bottom → `[data-sidebar-band]` top)** | **24** | **16** |
| band → first section label (`band` → `Agents` heading) | 12 | 12 — the floated ask, recorded and left |
| section → section, `Agents` collapsed | **16** | **8** |
| section → section, `Agents` expanded | 16 | 16 — the shared value the conditional keeps |
| scroller bottom → foot box | 8 | 8 |
| foot box bottom → viewport bottom | 0 | 0 (the foot's own `pb-2` holds its row 8px off the edge) |

The reclaimed space is **8px** on the boundary the operator called out (24 → 16);
the collapsed-section gap is another 8px in the state his earlier report named
(16 → 8), and nothing else moves.

## The two halves of the report, and what happened to the second one

- **destinations → band, the definite change.** Three 8px steps were stacking on
  the one boundary — the destinations group's `pb-2`, the body's `mt-2` and the
  panel's own top inset — for 24px where the tier the design names between the
  destinations and the list below them is 16px (§B6). The `mt-2` is the step this
  column owns, so it goes; the rendered gap is 16px.
- **band → sections, the floated one, deliberately unchanged at 12px.** The only
  lever is the band's own trailing margin or the scroll box's top inset; the
  scroll box's inset is written against the sticky section labels' negative
  offset, and BOTH options move the pixels of every committed standalone sidebar
  frame (the band's 4px) — a re-capture pass of the whole `chat-sidebar-*` family
  rather than part of this change. The geometry records it at 12px so a later
  change cannot move it silently. If the second half is wanted, it belongs in a
  PR that also re-shoots that family.

## The collapsed-section gap, and the rule the after frames carry

The wrapper around the two entity sections carried `space-y-4`, so a collapsed
`Agents` still held a section rhythm's 16px under a heading that draws no rows.
The wrapper's `space-y-4` is gone and the `Teams` section takes its own
conditional: `mt-4` (16px) while the section above it draws rows — the value two
open sections need, which a shorter constant would tighten unasked — and `mt-2`
(8px, the list's own step) when it does not. A query force-opens the section, and
the condition reads the same gate the rows do.

Why the earlier attempt "did not take", stated because the request was a repeat:
the same conditional is what PR #569's story frames photograph at 360px (16.0 →
8.0), and that PR has not merged — so nothing had reached any app the operator
runs, and the shipped column still drew the 16px. The fix here is in the app
itself, for the column; whichever of the two lands second folds against the
other's identical values (`mt-4`/`mt-2`).

## What each frame shows

| label | what it is |
| --- | --- |
| `both-expanded/` | Both sections open — the control case: the headings' 16px does NOT move. |
| `agents-collapsed/` | `Agents` closed above `Teams` open — the state the first report named: 16 → 8. |
| `both-collapsed/` | Both closed — the section-with-no-rows case: 16 → 8, identical to the pair above, because the condition is "draws no rows" and not a count. |
| `strip/` | The column collapsed to the 56px strip — the variant this change does not move, photographed so "it does not move" is a pair of pictures rather than a sentence. |

## What these frames do NOT prove

- **Not the overlay sheet (windows under 1040px).** The sheet renders this same
  column — nothing in this change branches on the mode — and the strip is the
  variant photographed here.
- **Not focus-dependent rendering.** A headless window has no focus, so no
  `:focus-visible` ring is photographed; the presses the scene makes are asserted
  by `aria-expanded`, not by pixels.
- **Not a live daemon.** Every frame is the app against its own stand-in
  responder; the catalogue, the sections and the counts are that fixture's, not
  the operator's own machine.
- **Not `Mesh` as the bottom-most row.** The stand-in serves no mesh membership,
  so the bottom row in these frames is `Agent hub` where the operator's own
  screenshot ends at `Mesh`. The gap measured is the destinations LIST's own
  bottom to the band, which the name of the last row does not change.
- **Not a sweep.** This is a PNG set outside `check-evidence`'s WebP walk; it is
  declared by this file rather than by the manifest's counts, the same way
  `sidebar-row-space/`'s set is.
