# Currency and math in one message - the fix

The pair to [`../chat-math-currency-before/`](../chat-math-currency-before/),
and the half that claims the fix. The operator's report (2026-09-27): cost
reports rendered as mangled italics and raw LaTeX fragments - `$0.30/M` and the
bold markers around a price pulled into an `inlineMath` span - instead of the
clean prices the agent wrote. The cause is at parse time: `remark-math`'s
single-dollar syntax has no adjacency rules, so once the math pipeline is on
for a message, the `$` of one price and the `$` of a later one become an inline
formula and everything between them is typeset by KaTeX.

The fix replaces that tokenizer with a guarded one (pandoc's documented
adjacency rules; `src/renderer/src/features/chat/components/markdown-math-guarded.ts`),
leaving upstream's `$$` display and `mathFromMarkdown` untouched. This set is
its pixels; `scripts/currency-math.test.mjs` is the executable half.

## What each frame shows

| Story | What it is evidence of |
|---|---|
| `cost-report` | The reported frame, reproduced: the screenshot's two bullets - `**11-call review = $0.0146 * ($291k input, 264k cached, 4k output)**` and `**light review $0.015-0.03**` + `**(My earlier estimate of $0.09 ...)**` - render with their bold intact and every amount literal, while the trailing formula `$c = a n^2$` still typesets. In the before half the same document renders `11-call review = ` + KaTeX `0.0146 * (` + plain `291k input, ...`, and bullet two's bold is split across `inlineMath` boundaries. |
| `pandoc-classic` | `It cost $20,000 and $30,000 in total; the published ratio is $x/y$.` - pandoc's own example ("`$20,000 and $30,000` won't parse as math") stays literal while the formula after it typesets. Before: `inlineMath("20,000 and ")` + `text("30,000 in total; ...")`. |
| `price-then-formula` | `pay $5 now, where $x^2$ holds` - the price stays literal AND the later genuine span still parses. Before: `inlineMath("5 now, where ")` + literal `x^2$ holds` - the price stole the formula's opener. |
| `genuine-math` | The control, formulas only: `$x^2 + y^2 = z^2$`, `$a$`, `$b$`, `$c^2 = a^2 + b^2$`. Its two frames are **byte-identical** across the halves (AE 0, both themes) - the guards moved nothing they were not aimed at. |

## The measured pair

Every figure re-derived from the committed frames with `magick compare`, at
1024 wide and each frame's own height (380 for `cost-report`, 300 for the other
three):

| state | AE dark | AE light | RMSE (dark) |
|---|---|---|---|
| `cost-report` | 57,131 of 389,120 | 45,498 | 0.0926 |
| `pandoc-classic` | 6,824 of 307,200 | 9,571 | 0.0420 |
| `price-then-formula` | 4,754 of 307,200 | 4,208 | 0.0366 |
| `genuine-math` | **0** | **0** | 0 |

**Two themes, not twelve.** The claim is text SHAPE - which glyphs are bold,
which spans KaTeX took - and no palette moves a glyph run; the sweep's twelve
would photograph the same shapes in different ink. `localOperatorDark` is the
default brand palette and `localOperatorLight` its light counterpart, so the
pair still shows the fix in both ink ramps.

**Each message carries a formula, and that is the reproduction's design.** The
pipeline is per message (`containsRenderableMath` reads the whole document) and
a cost report's own dollar signs do not turn it on - every `$` in `$0.30/M` is
followed by a digit, which the gate's own `\$…\$` heuristic refuses. The defect
needs the pipeline ON with a currency pair in the same message, so each fixture
pairs the reported text with one genuine formula, which is the state the
operator's message was in.

**How they were taken.**

```sh
node_modules/.bin/storybook dev -p 6188 --no-open --quiet
node scripts/capture-evidence.mjs http://localhost:6188 \
  --only=chat-math-currency --themes=localOperatorDark,localOperatorLight \
  --allow-backend --theme-settle-ms=300000
```

Storybook 8.6.12 driving `math-currency.stories.tsx` through the real
`CanonicalTranscript`, headless Chrome as the rig always runs it. `--allow-backend`
because the operator's live daemon answers on :1111 and must not be stopped for
a capture, and this story is a static fixture (`frontend={null} gate={null}`)
that never contacts the backend, so the guard's concern - surfaces that render
a server's replies - does not apply; the rig's own theme and paint guards ran
over every frame. `--theme-settle-ms` because this host is loaded. The before
half's own README records how that side was taken.

**What this set is NOT.** Component-level frames from Storybook, not the whole
app: no sidebar and no composer are in them. It does not photograph the two
accepted deviations - spaced `$ x + y = z $` and digit-led `$2^n - 1$` no
longer render as math (both stay literal) - because a frame cannot say "this is
deliberately unchanged-looking elsewhere"; those are pinned as deviations in
`scripts/currency-math.test.mjs` instead. These frames contain no data from any
machine.
