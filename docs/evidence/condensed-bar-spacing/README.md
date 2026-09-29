# The condensed bar's spacing and right edge — before/after, both brand palettes

**What these are.** The affected state of the operator's report (2026-09-29,
against the shipped v0.31.18 bar):

> PADDING: the condensed row ("Context compacted") hugs the summary row's rule
> too closely — wants more breathing room between the horizontal line and the row
> beneath it. CHEVRON ALIGNMENT: the chevron (">") doesn't reach the right end of
> the rule — the line currently extends past the row's right edge; align the
> row's right edge (chevron included) with the line's end, and check the
> timestamp spacing around it.

Both halves render the SAME story cell — `chat-turn-collapse--pinned-compaction`
(a durable compaction row kept below a collapsed bar) — through the repository's
own rig (`scripts/capture-evidence.mjs` against this tree's Storybook), in the two
`localOperator` palettes. PNG rather than WebP ON PURPOSE: `check-evidence.mjs`'s
frame walker counts `.webp` only, so this rig-driven pair cannot be mistaken for
frames a sweep produced and the capturer's own figures stay untouched (the
convention `docs/evidence/read-ack-notice/README.md` states).

| frame | state | what it shows |
| --- | --- | --- |
| `before/localOperatorDark.png`, `before/localOperatorLight.png` | the pre-fix rendering code (`origin/main` = `91617c21ec`), cell added on | the bar's rule runs past the chevron: the slot ends 16px short of the rule's end (21.25px at the ink), and "Context compacted" sits 2px under the rule |
| `before/*-crop.png` | the same frame, cropped to the bar + rule + row | the report's tight crop |
| `after/localOperatorDark.png`, `after/localOperatorLight.png` | this branch (`b0b3ffd250`, the fix commit) | the chevron slot right lands ON the rule's end (0.0px delta; ink 5.25px inside it — the glyph's own bearing, the same optical inset every lucide mark in the app carries), and the row beneath takes the 12px block step |
| `after/*-crop.png` | the same frame, cropped to the bar + rule + row | the report's tight crop |

The numbers behind the stills, read from the rendered DOM at both trees
(1280x900, both palettes — identical across palettes):

| reading | before | after |
| --- | --- | --- |
| chevron slot right − rule right | -16px | **0.0px** |
| chevron ink right − rule right | -21.25px | -5.25px (glyph bearing) |
| rule bottom → next row box top | 2px | **12px** |
| stamp right edge | 1009 | 1025 — rides with the slot, so stamp→chevron stays the row's own 6px (`gap-1.5`) |

## How to reproduce

Each half is the sweep's own `pinned-compaction` cell at its tree, decoded to PNG
(lossless), plus a crop of the frames' region `(220,196)-(1060,264)`:

```
node scripts/capture-evidence.mjs --only=chat-turn-collapse \
  --themes=localOperatorDark,localOperatorLight --allow-backend
# docs/evidence/chat-turn-collapse/pinned-compaction/<theme>.webp
```

The before half came from this worktree at `91617c21ec` (the base) with ONLY the
new story cell (and its sweep row) added — the cell is this change's own; the
rendering code is the base's. The after half is the fix commit `b0b3ffd250`. The
manifest's own record of the after pass is `partialCapture` in
`docs/evidence/manifest.json`.

## What this pair cannot see

It is a story render, not the live app: it photographs the bar's resting geometry
in the two `localOperator` palettes (the other ten themes share the ink and
spacing roles it judges). It does not photograph the hover ground, whose own
left-bleed geometry this change deliberately leaves as the disclosure ships it —
the report is about the chevron and the row beneath the rule.
