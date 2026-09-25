# Design round 5 frames: PR #482 at f105c9953

A **delta-confirmation** pass, not a new full round. The delta is commit
`5ee9c68f6` ("fix(aside): derive the exchange cap from the question's measured
box") inside design round 4's approved head `ba98e4fdc` → this head, and its only
other rendered change is the exchange region's always-on scrollbar gutter.

- **Reviewer:** design subagent (Local Operator `designer` role), model
  **`deepseek/deepseek-flash`**. **Mid-round failover, disclosed:** this session
  began as `anthropic/claude-opus-5-5` and the provider ran out (0% remaining)
  before any reading was taken, so every number and frame here is
  `deepseek/deepseek-flash`'s. I wrote no commit on the PR branch and cannot
  edit, push, merge or approve it.
- **App:** the renderer built at `f105c9953` in a session-unique detached
  worktree, with `VITE_LOCAL_OPERATOR_API_URL=http://127.0.0.1:8080`. The app
  source is unmodified. It ran `--window-mode=headless` through a COPY of
  `scripts/renderer-driver.mjs` (`rig/patch-driver-d5.sh`) with rounds 1–5's
  helper layer and scenes, design round 3's scene, design round 4's scene and
  round 5's own scene (`rig/scene-d5.js`) appended.
- **Backend:** the REAL daemon from local-operator `origin/main` (tree at
  `1f3ee080c`, version 0.62.31) in an existing main-commit worktree and its own
  `uv` venv; `local_operator.__file__` was asserted inside that worktree. The
  venv's tree contains design round 4's own daemon commit (`c7af37c57`) as an
  ancestor, so it is newer than the daemon round 4 drove. Every 200, 409,
  `aside_delta` and adopt in the logs is the daemon's own response.
- **Stub:** design round 4's scripted OpenAI-compatible provider, unchanged
  (`rig/stub-d5.py`), plus round 3's `NLINES`/`LONGSLOW` and round 4's
  `PARAGRID`/`*EDGE` markers. The stub is a scratch copy; no product file knows
  it exists.
- **Isolation:** `env -i`, scratch `HOME`/`TMPDIR`/`LOCAL_OPERATOR_CONFIG_DIR`,
  `GIT_CONFIG_SYSTEM=/dev/null`, no `CMUX_*`/`LOP_*`; every pid reaped by exact
  pid inside the capture script, and the run asserts the app holds a connection
  to this run's backend and **no** connection to the operator's own at 1111.
  `1111` was never bound.

## Ports

This round took the **shared 8080** and the shared lock
(`<scratchpad>/port8080.lock`), as the coordinator's rules ask. 8080 was
verified free immediately before the bind, held for the length of each pass, and
released by the rig's own trap before each command returned (`port8080.lock
released`, `8080 released before this command returned` in every pass log). 8080
is also the one port `src/renderer/index.html`'s `connect-src` already pins
beside 1111, so **no CSP surgery was needed** — the rig never edited
`out/renderer/index.html`, and no `src/` file was touched.

## Passes

| pass | width | theme | scene | cases | result |
| --- | --- | --- | --- | --- | --- |
| `narrow-d5` | 800x900 | dark | round 5's | cap, gutter, d10 | 26 PASS / 1 FAIL¹ |
| `wide-d5` | 1380x900 | dark | round 5's | cap, gutter, d10 | 26 PASS / 1 FAIL¹ |
| `wide-d5-cap2` | 1380x900 | dark | round 5's | cap | 18 PASS / 0 FAIL⁵ |
| `wide-d5-light` | 1380x900 | light | round 5's | cap, gutter | 21 PASS / 0 FAIL |
| `narrow-d5-gutter` | 800x900 | dark | round 5's | gutter | 8 PASS / 0 FAIL |
| `narrow-d5-staged3` | 800x900 | dark | round 5's | staged | 11 PASS / 1 FAIL² |
| `wide-d5-staged2` | 1380x900 | dark | round 5's | staged | 11 PASS / 1 FAIL² |
| `narrow-d4r5` | 800x900 | dark | design round 4's | its default set | 11 PASS / 1 FAIL³ |
| `wide-d4r5` | 1380x900 | dark | design round 4's | its default set | 12 PASS / 0 FAIL |
| `narrow-r3d5` | 800x900 | dark | design round 3's | its default set | 16 PASS / 1 FAIL⁴ |
| `narrow-qad5` | 800x900 | dark | QA round 4's | its default set | 41 PASS / 0 FAIL |
| `wide-qad5` | 1380x900 | dark | QA round 4's | its default set | 41 PASS / 0 FAIL |

¹ the old-shape classic-scrollbar twin assertion in this round's own **first**
probe build (it measured only the overflowing state, so it read 15/15 and could
not tell "reserved" from "a scrollbar that is there anyway"). The probe was
rewritten to measure the fitting and overflowing states separately and every
later pass is green; the numbers below are the rewritten ones.

² the `staged` case's second check is **mis-designed and disclosed**: it reads
the edge on the third turn of that panel, where the newest answer's top is below
the region's clip (rowsToEdge −13.3 narrow, −8.4 wide), so its precondition is
not met. The first check in the same case — the cap's `Q` term equals the newest
question's own measured box — **passes** in both passes.

³ `F the ceiling steps by the quote block` asserts the **retired** per-quote
constant (`afterCap − beforeCap === 27.5`). At wide it happens to hold (the
wire carried the quote and `Q` went 19.5 → 47); at narrow it fails because the
rig's own staging did not put a quote in that message at all (`reply-to=0` on
the wire) — see "What this round did not reach".

⁴ `r3 D6: the region moved exactly once` fails **identically at round 4's head**
(byte-identical distinct-scroll list `[1842,1843,1864,1885,1955,1980,2025,2030.5]`
in `design-round-4/logs/narrow-r3design-driver.log.txt`), so it is not this
delta's.

⁵ the wide quoted rows in the **first** wide dark pass (`wide-d5`) are vacuous:
`r3StageQuote` never found the Quote control in that pass (`pressed=0` for every
quoted subject), so those four rows measured an unquoted question and their
PASSes are not evidence. `wide-d5-cap2` is that pass re-run and is where the wide
dark quoted rows above come from; the wide light pass staged them first time.
That is a rig-reliability limit — the transcript's Quote toolkit does not always
appear for a synthetic selection — not a product observation.

## 1. The amended rule, measured on the rendered surface

`cap = 10 × 1.6 × fontSize + Q + 4px`, `Q` the newest question paragraph's own
measured box. The claim is the **edge** (`rowsToEdge` = (region clip − answer
top) / line box) is exactly 10.0 with **no row cut** (`crossing` empty). Both
widths, dark; the light pass repeats the set.

| subject (staged before the panel opened) | width | Q box | cap | answer top | line box | edge | rows cut |
| --- | --- | --- | --- | --- | --- | --- | --- |
| no quote, `PARAGRID5` | narrow | 19.5 | 231.5 | 23.5 | 20.8 | **10.0** | **0** |
| one single-line quote | narrow | 66.5 | 278.5 | 70.5 | 20.8 | **10.0** | **0** |
| two quotes | narrow | 94.0 | 306.0 | 98.0 | 20.8 | **10.0** | **0** |
| wrapping quote (7 quote rows at narrow) | narrow | 164.0 | 376.0 | 168.0 | 20.8 | **10.0** | **0** |
| multi-line question (8 question rows) | narrow | 117.0 | 329.0 | 121.0 | 20.8 | **10.0** | **0** |
| no quote, `PARAGRID5` | wide | 19.5 | 247.5 | 23.5 | 22.4 | **10.0** | **0** |
| one single-line quote | wide | 47.0 | 275.0 | 51.0 | 22.4 | **10.0** | **0** |
| two quotes | wide | 74.5 | 302.5 | 78.5 | 22.4 | **10.0** | **0** |
| wrapping quote (2 quote rows at 790px) | wide | 66.5 | 294.5 | 70.5 | 22.4 | **10.0** | **0** |
| multi-line question | wide | 39.0 | 267.0 | 43.0 | 22.4 | **10.0** | **0** |

Every cap is exactly `10 × lineBox + Q + 4` (208/224 + Q + 4 at 13px/14px), and
every row was measured at `k = 1` and `k = 5` (the table above shows one row per
subject; the logs carry both). **The px cut is 0 everywhere** — no `p` row
straddles the clip in any of the 16 dark subject runs or the light pass's 8.

Round 4's readings against the rule it replaced, for comparison:

| case | round 4 (narrow) | this head (narrow) |
| --- | --- | --- |
| one ordinary 44-character quote (2 rendered rows at narrow) | cap 259, top 70.5, edge **9.1** | cap 278.5, top 70.5, edge **10.0** |
| two quotes, the first wrapping | cap 286.5, top 98, edge **9.1** | cap 306, top 98, edge **10.0** |
| a 7-row quote | cap 259, top 168, edge **4.4** (a `p` row 5.3 visible / 9.7 hidden) | cap 376, top 168, edge **10.0**, 0 cut |
| a multi-row question | cap 231.5, top 121, edge **5.3** (4.5 / 10.5 hidden) | cap 329, top 121, edge **10.0**, 0 cut |
| a 2-row question (wide) | cap 247.5, top 43, edge **9.2** (a 0.9 px sliver) | cap 267, top 43, edge **10.0**, 0 cut |

The two numbers round 4 reported for a single quote (259 narrow / 275 wide)
survive here as two different subjects, exactly as the rule predicts: at narrow
that quote is **two** rows (Q 66.5 → 278.5, the number the old arithmetic could
not reach) and at wide it is one (Q 47 → 275).

## 2. Nothing earlier rounds approved regressed

- **D11** — a long follow-up lands with its question at the region's top
  (`questionTopInRegion` −0.2 wide / +0.2 narrow, identical to round 4) and its
  first answer row in view (`answerTopInRegion` 23.3 wide / 43.2 narrow, both
  inside a 248/251 px client height), 2 turns. `E D11` PASS at both widths;
  design round 3's own `D6` question-in-view check PASSes as well.
- **R6-4's cases** — the one- and two-quote cases are now at exactly 10.0 (they
  were the defect), and the paragraph-break case (`D12`) holds at 10.0 with 0
  rows cut for `k = 1,3,5,7,9` at both widths; the paragraph gap renders at
  20.8 px narrow / 22.4 px wide = one line box.
- **D10** — 9- and 10-line answers show no scrollbar (`maxScroll` 0, client
  height 211/231 narrow, 225/247 wide against a 231.5/247.5 cap), an 11-line
  answer overflows by 20 px (narrow) / 22 px (wide) with **0 rows cut** and 10
  whole rows visible; design round 3's own three `D10` checks PASS at narrow.
- **D7, D8, D13, D14, U9, U6, U11, U16** — design round 3's scene at narrow
  PASSes its `D7` (a new aside retires the composer's refusal line), `U9`
  (the settling adopt names its reason via `aria-describedby`) and both `U6`
  focus checks; QA round 4's scene PASSes **41/41** at wide, which is where its
  `Q24`…`Q31d` checks for `D8`/`D13`/`D14` and the composer state matrix live.
- **U9's `thinking` state, D11's long follow-up, the 11-line answer** are all in
  the frames list below.

## 3. The exchange region's always-on gutter (R8-4)

The region is `overflow-y-auto [scrollbar-gutter:stable]`. Measured, both
widths, dark and light, and against a **detached twin pair** in the same engine
so "this platform reserves nothing for the property" can be told apart from "the
declaration is not taking effect":

| reading | narrow | wide |
| --- | --- | --- |
| region `offsetWidth` − `clientWidth` − borders, exchange **short** (no scrollbar) | **8 px** | **8 px** |
| the same, exchange **overflowing** | **8 px** | **8 px** |
| region `clientWidth`, short vs overflowing | 226 = 226 | 790 = 790 |
| platform twin: `scrollbar-gutter:auto`, content **fits** | 0 px | 0 px |
| platform twin: `stable`, content **fits** | 8 px | 8 px |
| platform twin: `auto`, content **overflows** | 8 px | 8 px |
| classic-scrollbar twin (15 px `::-webkit-scrollbar`): `auto` fits / `stable` fits / `auto` overflows | 0 / 15 / 15 | 0 / 15 / 15 |

Two things follow, and the first corrects R8-4's own premise:

1. **On this platform the reserve is not a no-op.** `overflow-y: auto` lays out
   an 8 px **layout-taking** scrollbar in this Electron/Chromium build (twin:
   `auto` takes 0 px when the content fits and 8 px when it overflows), so
   without the declaration the region's measure would drop by 8 px at the exact
   moment the answer outgrows the cap — the re-wrap round 4's ruling named, and
   the cap grows with `Q`, so the pair would move together. The declaration is
   what makes the measurement independent of the cap. On a classic-scrollbar
   platform the same jump is 15 px (measured on the styled twin).
2. **It does not read as dead space at either width.** 8 px of a 226 px measure
   is 3.5 % at narrow and 8 px of 790 px is 1.0 % at wide, and it sits inside a
   right inset the panel already carries (the frames
   `d5-narrow-gutter-short.png` / `d5-wide-gutter-short.png` show a short,
   non-overflowing exchange: no band, no rule, no mark, nothing that reads as an
   empty column — the text's own inset is many times 8 px). The cost is bounded,
   fixed, and paid only once per region rather than as a reflow.

**Judgement: keep it; no fix wanted.** The alternative is a gutter that appears
with the overflow, which is the toggle the declaration exists to prevent, and
the trade this app already makes in the sidebar, the picker host and the TUI.

## 4. D17 — the answer's own blocks at the edge

Still present at this head, unchanged by the delta, with the cap's own promise
(`rowsToEdge` 10.0) holding in every block case:

| block at the edge (round 4's sweep offsets) | narrow | wide |
| --- | --- | --- |
| bullet list (`LISTEDGE4`) | clean | clean |
| heading (`HEADEDGE3`) | clean | clean |
| fenced code (`CODEEDGE3`) | a `pre` row **6.8 px visible / 10.2 px hidden** | a `pre` row **13.2 px visible / 3.8 px hidden** |
| blockquote (`QUOTEEDGE3`) | a `p` row **10.3 px visible / 4.7 px hidden** | clean |

**It is now the last visual item of this family**, and the owner's rule is:
*the cap promises the edge lands on a whole line box of the answer's paragraph
grid; a block whose own box metrics are not multiples of the line box (`pre`,
`li`, blockquote, heading margins) can still end inside the clip.* No
derivation of the cap reaches it — the blocks are inside the answer and their
line boxes are their own — so a fix is a measurement of the answer's own rows at
the edge (or snapping those blocks to the grid), not another term. Not gating
and not this round's.

## 5. R8-1 / R8-3 / R8-5 (and R8-2): none of them bites the rendered surface

All three are non-visual, and this round found nothing in the frames either way:
R8-1 is a comment naming the states with no answered turn (the visible behaviour
— Esc releases nothing and the panel still closes — carries no discard promise on
screen, so no copy contradicts it); R8-3 is the adopt-confirm floor against the
platform's double-click window, a gesture-timing trade whose on-screen surface
(the confirm and its copy) this delta does not touch; R8-5 is the shape of the
evidence-manifest stamp note. Left to the code stream.

**R8-2** (the floor reached only when the measurement is `null`, so a subtree
that lays out at `0` writes `0`) cannot bite a laid-out panel — the region is
only painted when the panel is, and the observer re-measures on reveal. The
claim in the same paragraph of that review — *"a quote staged after the answer
cannot leave the cap stale: sending creates a new turn → new `lastTurnId` →
re-attach + re-measure"* — **is now driven, not just reasoned**: with a quote
really on the wire (`reply-to=1`) the cap followed the new turn's own box
(`Q` 19.5 → 47 → cap 275 at wide, edge 10.0, no cut), and on a third turn the
cap's `Q` term equalled the DOM's measured box at both widths.

## What this round did not reach (hand-over)

- **The quote staged against an OPEN panel, at narrow, is un-driven.** The
  staging helper presses the Quote control's centre point, and at narrow with
  the panel up that point is covered by another node in the same box
  (`elementFromPoint` → `time.shrink-0 …`, `underThePanel: false`), so the press
  does not take: the message goes out with **no quote at all** (`reply-to=0` on
  the proxy's own record), and the panel then paints a question with no quote
  block and a cap that matches it (Q 39 → cap 251 → edge 10.0, 0 cut — correct
  for what is painted). The same order at wide does carry the quote, which is
  where the reading above comes from. **Design round 4's own narrow pass failed
  the identical assertion with byte-identical numbers**
  (`design-round-4/logs/narrow-d4b-driver.log.txt`), so this predates the delta.
  I did not establish whether a real user's click at that point is obstructed —
  the press is synthetic and the toolkit is not this delta's surface — so I am
  reporting the DOM fact and not claiming a defect.
- The `staged` case's append variant (stage, then type without clearing) lost
  the quote too, at both widths, and its reading is taken with the newest answer
  out of view; it is disclosed above rather than counted.
- **Lists/headings/code sweeps** were run at one offset per block type
  (round 4's default set), not the nine-offset sweep; the two offsets that cut a
  row are the two in the table.

## Frames

`d5-narrow-*.png` / `d5-wide-*.png` are round 5's scene; `d4-*.png` are design
round 4's scene re-driven on this head; `r3-*.png` and `qa4-*.png` are design
round 3's and QA round 4's scenes, unchanged.

| file | what it shows |
| --- | --- |
| `d5-narrow-one-quote-k5.png` | R6-4's case at narrow: a 2-row quote, the answer's last visible row complete, the edge below it (round 4 read 9.1 here) |
| `d5-narrow-two-quote-k5.png` | two quotes, first wrapping |
| `d5-narrow-cap-wrapquote-k1.png` | the 7-row quote that round 4 read at 4.4 |
| `d5-narrow-cap-wrapq-k1.png` | the multi-row question round 4 read at 5.3 |
| `d5-narrow-no-quote-k5.png` | no quote, paragraph grid at the edge |
| `d5-narrow-d10-11-lines.png` | 11 lines: overflow with no row cut |
| `d5-narrow-gutter-short.png` / `d5-narrow-gutter-overflow.png` | the same panel short (no scrollbar) and overflowing: the measure does not change |
| `d5-wide-one-quote-k5.png` / `d5-wide-two-quote-k5.png` | the wide cases green |
| `d5-wide-cap-wrapq-k1.png` / `d5-wide-cap-wrapquote-k1.png` | the wide wrapping cases (round 4 read a 0.9 px sliver on the first) |
| `d5-wide-light-two-quote-k5.png` | the light pass reads as the dark one |
| `d5-wide-staged-open-panel-quoted-followup.png` | a quote staged against an **open** panel at wide: quote on the wire, `Q` followed, edge 10.0, no cut |
| `d5-narrow-staged-open-panel-no-quote.png` | the same order at narrow, where the rig's press does not take: no quote painted, cap correct for what is painted |
| `d4-narrow-paragraph-break-k5.png`, `d4-wide-d11-*.png` | D12 at the cap; D11's follow-up landed |
| `d5-narrow-code-edge.png`, `d5-wide-code-edge.png`, `d5-narrow-list-edge.png` | D17's class on this head |
| `r3-narrow-d10-11-line.png`, `r3-narrow-d7-new-aside-retires-line.png` | design round 3's re-driven checks |
| `qa4-*-q29-d11-question-at-top.png`, `qa4-*-q31c-d14-off-panel-short-form.png`, `qa4-narrow-q31d-u14-quote-rendered.png` | QA round 4's scene re-driven at both widths, 41/41 each |

## Logs and rig

`logs/*.out` are each pass's full driver log (PASS/FAIL lines, the rig's own
notes, and the proxy's recorded requests and aside posts). `rig/` is the scene,
the capture/run scripts, the driver assembly script and the stub. The stub
markers (`PARAGRID5`, `NLINES12`, `LISTEDGE4`, `CODEEDGE3`, `LONGSLOW`, …) are
the rig's, not product copy.
