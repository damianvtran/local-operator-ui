# Currency and math in one message - the BEFORE half

The pair to [`../chat-math-currency/`](../chat-math-currency/), and the half
that makes the claim: the same four stories of `math-currency.stories.tsx`,
byte-identical fixture text, captured against the pre-change pipeline (the
renderer still wired to `remark-math`, no `markdown-math-guarded.ts` in the
tree).

**How they were taken.** With the fix not yet written, the story's title
temporarily suffixed `before` (so the ids land in this directory), and the
matching temporary STORIES rows added for the run - then both restored to the
committed head, the fix written, and the after frames re-read from the same
fixtures. The capture command is the after half's own with the id swapped
(`--only=chat-math-currency-before ... --allow-backend --theme-settle-ms=300000`;
see the after README for what those two flags are for), and the rig's theme and
paint guards ran over every frame. Captured with the change UNCOMMITTED in the
working tree - which is why `manifest.json`'s `dirtyWorkingTree` records that
capture as dirty - at `0f23c76de5`, the commit both runs ran at.

**What each frame shows, measured on this side.**

- `cost-report`: `Exact: an **11-call review = ` + KaTeX `0.0146 * (` + plain
  `291k input, 264k cached, 4k output)**` - the bold markers land inside and
  outside the formula - and bullet two's italicised, space-stripped run
  `light review 0.015 - 0.03 * *.typical0.03-0.05 . heavy ~0.07 - 0.09 ...`.
  The reported defect, reproduced.
- `pandoc-classic`: `It cost ` + KaTeX `20,000 and ` + `30,000 in total; ...`.
- `price-then-formula`: `pay ` + KaTeX `5 now, where ` + `x^2$ holds ...`.
- `genuine-math`: the same glyphs as the after frame - the control.

Pixel deltas against the after half, and the two-themes rationale, are in the
after README's table; the control's two frames are byte-identical (AE 0).
