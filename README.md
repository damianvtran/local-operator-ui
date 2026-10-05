# PR #835 — remediation frames (round 2)

The strict before/after pair for the all-asks entry-point remediation, captured
from the SHIPPED STORYBOOK STORIES at fixed story ids, in both brand palettes.

- **before**: base `be8acfbfe28` (this PR's merge base, and `origin/main` at the
  time of capture)
- **after**: head `4b821c542d2`

## Why this pair is strict

`src/renderer/src/features/chat/components/asks/ask-drawer.stories.tsx` is
byte-identical between the two refs (`git diff --stat be8acfbfe28..4b821c542d2`
on that path prints nothing), so the fixture cannot differ by accident — which is
what round 1 found wrong with the first pair (2 options on one card before, 3
after). `strict-pair-gate.txt` is the machine check: per story, the ask cards
(status + option-row count) are equal on both sides, e.g.
`expanded-several → [["open",2],["timed_out",3]]` on both.

Both sides are clipped to the story's own root element at the story's own 560px
width (the drawer's 560x640 decorator box; the header's 560x84 band), read off the
rendered element and asserted, rather than cropped by hand. The six
`header-asks-*` stories exist only on the head — the control did not exist before
— and are recorded as such rather than faked.

## Files

| frame | before | after |
| --- | --- | --- |
| drawer, empty queue | `before-drawer-empty--*.png` | `after-drawer-empty--*.png` |
| drawer, populated | `before-drawer-expanded-several--*.png` | `after-drawer-expanded-several--*.png` |
| drawer, settled history | `before-drawer-settled-section--*.png` | `after-drawer-settled-section--*.png` |
| drawer, `Settled · 0` pressed | (no filter existed) | `after-drawer-expanded-single--*--filter-settled.png` |
| drawer, `Settled · 3` pressed | (no filter existed) | `after-drawer-settled-section--*--filter-settled.png` |
| header cluster | `before-header-no-approval--*.png` (no asks control anywhere) | `after-header-no-approval--*.png`, `after-header-asks-quiet--*.png`, `after-header-asks-waiting--*.png`, `after-header-asks-fleet--*.png` |

Each name carries its palette (`localOperatorLight` / `localOperatorDark`).

`geometry-before.json` / `geometry-after.json` are the readback from the same run:
for every frame, the story box, the filter control's buttons and their labels, the
settled boundary label, the ask cards with their per-card option-row counts, and
the header's buttons with their accessible names, scopes and glyph classes.

## How they were taken

One private headless Chrome over raw CDP (`--use-mock-keychain`, reaped by process
group), one Storybook dev server at a time, both killed afterwards; frames written
outside the repository and post-processed nowhere. The rig is a scratch script,
not a repo one — `scripts/capture-evidence.mjs` writes into `docs/evidence/` and
rewrites the manifest, which this PR deliberately keeps out of the tree.
