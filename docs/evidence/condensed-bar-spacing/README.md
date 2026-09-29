# The condensed bar's rule, its chevron, and the rows it leaves below — before/after, both brand palettes

**What these are.** The affected state of the operator's second report on the condensed bar (2026-09-29, against the shipped v0.31.18 bar and this branch's first round):

> SPACING BOTH SIDES OF THE RULE: the space above AND below the rule is "still off — needs
> proper breathing room on both sides, not just the row's internal padding". Audit the
> summary-row→rule and rule→row gaps AS A PAIR and give both sides deliberate, balanced spacing.
> CHEVRON ALIGNMENT DATUM: "the chevron's LEADING edge must align with the END of the line on
> the right (the hairline's right terminus) — treat the rule's endpoint as the alignment datum,
> and the time reads to its left".
> INCIDENT ROW BELOW THE LINE: the "session incident: …" row beneath sits too tight to the line
> — the below-line gap fix must cover the incident-row class (like the compaction row).

**The pair's subject is the incident state** — `chat-turn-collapse--pinned-incident` (a turn
that died after its compaction; the memory statement and the incident reason are the rows the
collapsed bar leaves below its rule) — rendered through the repository's own rig
(`scripts/capture-evidence.mjs` against this tree's Storybook), in the two `localOperator`
palettes. PNG rather than WebP ON PURPOSE: `check-evidence.mjs`'s frame walker counts `.webp`
only, so this rig-driven pair cannot be mistaken for frames a sweep produced and the capturer's
own figures stay untouched (the convention `docs/evidence/read-ack-notice/README.md` states).

| frame | state | what it shows |
| --- | --- | --- |
| `before-incident/localOperatorDark.png`, `before-incident/localOperatorLight.png` | `0f3f13892d` (the head the report was filed against) with ONLY the new story cell and its sweep row added | the bar's text 5px of ink above the rule, and the incident 2px under the memory statement — the two hugs the report names; the chevron's leading ink at x1036, well inside the rule's end |
| `before-incident/*-crop.png` | the same frame, cropped to `(220,196)-(1060,332)` | the report's state, tight crop |
| `after-incident/localOperatorDark.png`, `after-incident/localOperatorLight.png` | this branch's second-round fix | 17px of ink above the rule against 15px below (the stated convention; icon register 16, boxes 12 either side), the incident at the item step, and the chevron's leading ink on the rule's last pixel |
| `after-incident/*-crop.png` | the same frame, the same crop | the report's state, tight crop |

**The round-1 pair rides re-based rather than stale.** `before/` is the original report's base
(`origin/main` = `91617c21ec`, the `chat-turn-collapse--pinned-compaction` cell added on);
`after/` is the SAME cell re-shot at this round's head, so both halves read true against the
final code — the first round's own after (`b0b3ffd250`) is superseded by the second round's
geometry and lives in the PR thread's first remediation comment.

The numbers behind the stills, read from the rendered DOM and the rastered frames at both
trees (1280x900, `localOperator` palettes — identical across palettes):

**The convention these numbers use: INK-EDGE TO RULE-EDGE, text register.** Above = the
bar text's ink bottom to the rule's first pixel row; below = the rule's last pixel row to the
next row's cap/ascender ink top (the `Context compacted` `C`). The same geometry reads
differently in other registers, which is why the rounds argued: the ICON register (`ⓘ`) below
is 16px, and a looser ink threshold reads 19 — all three sit inside the ~3px spread this
geometry produced, and none of them is the number above the table unless it says so.

| reading | before | after |
| --- | --- | --- |
| bar text ink → rule | 5px | **17px** (`pb-3`: the bar block's own 12px — the same step the row below sits at, so the rule divides 12px of box either side) |
| rule → first row ink | 15px | **15px** text (16px to the `ⓘ` icon; the item step's 12px box plus that row's own leading — the below side never moved) |
| chevron ink leading edge (abs x) | 1036 | **1044** — the rule's last pixel; its terminus edge is 1045, so the glyph starts on the datum |
| chevron slot box (abs x) | 1031–1045 | 1039–1053 (`-mr-6`: 24px of pull measured from the trigger's 16px right shortfall) |
| stamp box right (abs x) | 1025 | 1033 — rides with the slot, so stamp→chevron stays the row's own 6px (`gap-1.5`) |
| memory statement ink → incident ink | 15px | **25px** (the walk re-tiers every visible group after a bar, not only the first) |

## How to reproduce

Each half is the sweep's own cell at its tree, decoded to PNG (lossless), plus a crop of the
frames' region `(220,196)-(1060,332)`:

```
node scripts/capture-evidence.mjs --only=chat-turn-collapse \
  --themes=localOperatorDark,localOperatorLight --allow-backend
# docs/evidence/chat-turn-collapse/pinned-incident/<theme>.webp   (and pinned-compaction)
```

The before halves came from this worktree at their heads with ONLY the new story cell (and its
sweep row) added — the cell is this change's own; the rendering code is the base's per half
(`91617c21ec` for round 1, `0f3f13892d` for round 2). The after halves are this branch's
second-round fix. The manifest's own record of the passes is `partialCapture` in
`docs/evidence/manifest.json`; the second round's record is `condensedBarRoundTwoNote`.

## What this pair cannot see

It is a story render, not the live app: it photographs the bar's resting geometry in the two
`localOperator` palettes (the other ten themes share the ink and spacing roles it judges). It
does not photograph the hover ground — the sweep's own `collapsed-hover` cell carries that
state (re-shot for design round 1 D1's extension of the wash to the rule's end, and again for
this round: the ground's width/padding pair was extended a second time (to `pr-6`), so the
wash now covers the chevron's WHOLE layout box — its right edge at 1052/1053 against the glyph's ink
ending at 1047 (dark-theme frame diff; the light palette's row-hover tint is subtler than the diff
threshold, its geometry identical), with the rule's end 8px inside it. No part of the glyph overhangs
unwashed ground, which was design r2's D2 and reviewer r3's MINOR-1). The report is about the rule's two
sides, the chevron's leading edge and the rows beneath the rule.
