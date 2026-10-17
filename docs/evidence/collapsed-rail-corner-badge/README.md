# The collapsed strip's nav count: a corner mark on its icon (#1083)

In the collapsed sidebar — the 56px icon strip — a nav row's count was drawn
BESIDE its icon: the count's wrapper was an in-flow flex sibling of the glyph,
so when collapsed (`ml-auto` drops away) `justify-center` centred the PAIR —
the icon sat left of the strip's centre line with the pill to its right. The
fix (PR #1117, `sidebar-navigation.tsx`, `renderNavItem`; collapsed only) pins
the count as an absolute corner mark (`-top-0.5 -right-0.5` of the glyph's 28px
`relative` box; 14px; the borderless `attentionQuiet` register #721 chose for
this rail), so the glyph is the button's only in-flow child and centres, and the
count sits on its top-right corner. Every counted row (Aida, Browser, Mesh)
shares this one path; the expanded row keeps its own in-flow trailing slot,
byte-identical to before.

## The trees, and the instrument

Two trees read by ONE instrument: base `origin/main` `16efda76b` and head
`3ec6814b` (PR #1117). Built app, `headless` window mode, no backend — the rail
is on every route, and the scene raises its approval requests through the app's
own loopback RPC, so the Browser row's count is a live count, not a stub:

    node scripts/renderer-driver.mjs --scene approval-badges --out <dir> --seed-onboarding-complete

## The readings (CSS px; the strip is 56px wide, centre line x=28)

| state (dark pass) | base `16efda76b` | head `3ec6814b` |
| --- | --- | --- |
| collapsed, count 2 — glyph | x8–24, centre **16** | x20–36, centre **28** |
| collapsed, count 2 — mark | pill x32–48, 16×16, y267, beside the glyph | corner mark x30–44, 14×14, y259, on the glyph's corner |
| collapsed, two digits (12) — glyph | x5–21, centre 13 | x20–36, centre 28 |
| collapsed, two digits — mark | x29–51, 22×16, clearance 5 | x24–44, 20×14, clearance 12 |
| collapsed, tooltip on focus — starts | x54 (6px right of the pill) | x48 (4px right of the mark, not under it) |
| register, both counts | borderless / ringless, 11px / 400, ink-dim on elevated | unchanged |
| control's accessible name | `Browser, 2 waiting` / `Browser, 12 waiting` | unchanged |

(`tooltip starts x57` on the base light pass, `x48` on the head light pass — the
dark-pass readings are the table's.)

## Scene totals — identical on both trees: 58 PASS / 3 FAIL

The same three checks fail on BOTH trees, so nothing here is this change's:

- `the expanded rail shows the true number, because the row has the width for it`
  — the light pass reads `"16"` (the queue cap, from the dark pass's leftovers)
  where its stale expectation is 13;
- `the collapsed rail still shows the true number rather than a cap` — the same reading;
- `with the number in the control's name, which is never capped` — the same.

They are the scene's own count bookkeeping (the approval queue caps at 16; the
light pass asks for ten more). Every check THIS change could move passes on the
head: the badge inside the 56px strip, the 30px row, the edge clearance, the
borderless/ringless register and its 11px/400 numeral, the two-digit mark's
clearance, and the count in the control's accessible name.

## What this set cannot show

- A true pointer (the driver has no pointer verb; the hover ground is asserted
  by the contrast contract, not a frame).
- `:focus-visible` paint (a headless window is never shown).
- Aida's row LIVE (it needs a real completion receipt from a backend) — her row
  shares the one `renderNavItem` path this change edits; the mount tests
  (`scripts/aida-rail-marks.test.mjs`, 28 pass / 0 fail on the head, and 1 fail
  for the new corner-mark case against the base tree) cover her row's markup.
- The busiest states of the other counted rows (Mesh) — the same code path.

## Supersession note

The committed `docs/evidence/browser-approval-badges/` set's collapsed frames
describe the mark of the change THEY were shot for (their README's own measured
numbers). This change moves that mark again, so those collapsed rows no longer
describe this head. This set re-shoots the collapsed states for this change; the
older set is not updated inside this PR — its refresh and re-stamp belong to the
evidence lane's next pass — recorded here rather than left silent.
