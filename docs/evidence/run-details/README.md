# Run details — the header popover, as a design proposal

`docs/run-details.md` specifies a header button that opens a popover over the
session's subagent roster and its to-do plan. Nothing in the application is wired
to it yet: this is a design proposal, and these frames are how it was judged.

The frames render the **real `ChatHeader`** — the production component, with its
own action cluster, its own 32px controls and its own `!isCanvasOpen` gate — with
a fixture `runDetails` inside a chat-column ground, and the popover opened by
clicking the real button. The panel is Radix's own portal, so a frame is a picture
of the product's surface rather than a reproduction of it.

## The capture

```
# Storybook walks forward when a port is taken, so read the port off the banner
# rather than assuming it: an earlier round found 6017 held and bound 6018, and
# the attempt before that landed on 6019. This round found 6017 free.
pnpm storybook --port 6017 --no-open

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=run-details \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend

pnpm check-evidence
```

**Why narrowed rather than swept.** A full sweep is 514 frames and about half an
hour, and it DELETES the set before re-taking it — so a sweep to add eighteen
frames rewrites 514 nobody reviewed and buries the eighteen that changed. `--only`
plus `--themes` switches `capture-evidence.mjs` to append mode: nothing is swept,
and `manifest.json`'s `partialCapture` records that this surface arrived outside
the sweep (it is also why `frames`/`surfaces` had to be raised by hand, which is
the same step the front-end tool-rows round took).

**Why `--allow-backend`.** These stories render from fixture state and never call
out, which is what that flag asserts. A backend on the configured port otherwise
fails the run because a captured frame must be a function of the tree.

**Two of the twelve themes.** The other ten are covered numerically by
`pnpm check-themes` (1910 assertions across all twelve palettes); these frames
cover the two palettes that *are* the brand.

## What each frame shows

| Frame | What it shows |
| --- | --- |
| [`both-in-flight`](both-in-flight/) | Both sections and the hairline between them. Two children at work — a long label truncating with an ellipsis while the numbers run (`reviewer · 1m12s · 46% · $0.31`) stays whole, and an activity line indented under its label — over a phased plan with a blocked item and its reason. |
| [`subagents-only`](subagents-only/) | One section only, no empty `To-dos` heading. Three children in priority order: queued first, then running, then settled. The queued row carries **no numbers at all** — no clock, no context, no cost — which is the omission rule, visible. The settled row shows no role (`agent_role` is the default `task`) and no second line. |
| [`todos-only`](todos-only/) | One section only: fourteen items over three phases, capped at ten with the four hidden rows disclosed **inside the phase that lost them** — `Reconcile` keeps its header and its one open item, then says `+4 more` under it. Every item state in one plan — pending, done (struck, `ink-dim`), dropped (struck, `— dropped`, tag not struck), blocked (full `ink`, the loudest row, its `— blocked: <reason>` on its own indented line beneath it, complete rather than cut mid-word) — and the flat/headerless path is in `failure` rather than here. The tallies read in one grammar: `10 of 14 resolved · 1 dropped` for the section, `Reconcile · 4/5 resolved` and `Verify · 4/5 resolved` for the phases, where `resolved` is done **or** dropped. The plan's roster-order is visible too: the shed rows are the OLDEST, so `Verify` keeps `Re-run the totals` and its dropped row while `Reconcile`'s four finished rows are the ones disclosed. |
| [`failure`](failure/) | The only colour the panel spends: the cross on the failed row, `danger`. Its second line is the first line of `error_text`, in monospace and allowed to wrap to two lines — the frame reads `FileNotFoundError: [Errno 2] No such file or` / `directory: 'ledger/q1.csv'`, so the identifier survives where a one-line head-truncation kept the exception's preamble and cut it. Nothing else on the row is red. Beside it a settled child with its role suppressed and no activity line. Below: the **flat single-phase plan**, rendering headerless with no `Todos · 0/3` it does not need. |
| [`failure-unseen`](failure-unseen/) | The state the `danger` dot exists for, photographed OPEN: the ONLY reason this run has a trigger is a failure nobody has read — both children have settled and every to-do is closed. Opening the panel acknowledges the failure in the same commit that shows it, and the panel stays — which is the whole point of the frame: against a trigger gated on `hasRunDetails` alone, this frame has no panel in it at all. It shows both halves of the second-line fix as well: the monospace exception wrapped to two lines with `'ledger/q1.csv'` intact, and the trigger's own tally reading `1 failed · 1 done`. |
| [`crowded`](crowded/) | Both overflows. Six rows, then `+3 more`, in the priority order (running, queued, failed, paused, interrupted, settled; ties newest to oldest). The tally has shed whole segments down to `2 running · 1 queued · 1 failed · 1 paused`. Below, the plan starts and the panel stops at its own ceiling — **with its scrollbar thumb painted at the right edge**, which is the frame's other subject: the thumb spans y≈52..379 of the panel's ≈478px viewport (≈330px of 478), so the content is roughly 1.4 viewports tall (≈690px) and ≈210px of it scrolls. The row sliced at the bottom is now visibly "more below" rather than damage. |
| [`settled`](settled/) | Everything settled and nothing unseen, so **there is no run-details button** in the header. `§3.3`: settled work alone does not raise the trigger, because a finished roster is history and history lives in the transcript. |
| [`header-trigger`](header-trigger/) | The same ground with work in flight: the button is present, at the end of the bar beside the canvas button, in the cluster that took over `ml-auto`. Diff `settled` against this one — the fixtures are the only difference. |
| [`header-trigger-failed`](header-trigger-failed/) | The unseen failure: an 8px `danger` dot on the button's top-right corner. It is not a count; it says a child failed and nobody has looked, and the trigger clears it when the panel opens. |

## Geometry, measured from the frames

| What | Value | Where it comes from |
| --- | --- | --- |
| Panel width | 384px (`w-96`) | 377px of unbroken `elevated` on a text-free row, plus the two 1px hairline edges: x≈119..503. Outside it the one shadow, measured from the hairline out to the canvas ground ≈20px away — the focus ring that used to sit at x≈505 is gone (`docs/run-details.md` § 7). |
| Panel ceiling | `min(60vh, 480px)` | The 820-tall frames take the 480px branch: the panel's bottom edge lands at y≈528 with its top at y≈45. The 480-tall frame this surface was first captured in took the `60vh` branch instead — a 288px panel, which is the cap working, and the reason `todos-only` and `crowded` are captured at 820: at 288 the item cap's `+4 more` row falls past the fold of the one frame that exists to show it. |
| Scrolls, not clips, and says so | thumb ≈330px of a ≈478px viewport | The `ScrollArea` is `type="auto"`, so the thumb is painted whenever the content overflows and not at all when it fits. Measured in this set rather than assumed: `crowded` carries a `border-control` bar at x≈494..501 spanning y≈52..379 (330 of 478 ⇒ ≈690px of content, ≈210px scrolls), while `failure-unseen` and `todos-only` paint no bar because their content fits. The earlier set could not show the scroll state at all: Radix's default `type="hover"` needs a pointer, a capture has none, and the only cue left was a row sliced by the panel's floor. |
| Row heights | subagents 32px single line, 48px with a second line, 64px for a failure whose exception takes both clamped lines; to-do rows 24px single line, 40px for a blocked row's reason line | Measured off `crowded`'s icon column (a row's top sits ≈8px above its icon's ink): pitch 33, 48, 50, 65, 31 across the six rows, which are the queued 1-line, two running 2-line, failed 3-line (label plus two clamped exception lines), paused and interrupted 1-line rows in rank order. The to-do pair comes from `todos-only`'s mark column. The line heights are pinned (`leading-5`/`leading-4`) because the inherited 19.5px and 17.4px measured as a 48-50px two-line row. |
| One grid | marks and state icons in one 16px column at x≈133..149; first-line text at x≈157-158 in **both** lists | Measured: the roster's state icons ink at x134..148 with labels at 158, and the plan's marks now ink at x134..147 with item text at 157-158. Before the fix the plan sat 12px right of the roster (marks at `pl-6`, text at 170), which is what made one panel read as two lists. The plan's own indent lives on the second line — the blocked reason at x≈157 — not in the first column. |
| Panel edge | the one shadow, and no focus ring | Measured in both brand themes: outside the hairline the ground runs from the shadow's darkest pixel at the edge back to the canvas ≈20px out (dark `(24,21,13)` at the edge → `(30,26,21)` by x≈526; light `(236,232,227)` → `(250,248,242)`), which is the token's 32px blur less its -12px spread. No frame in the set — all eighteen, panel or header — contains an accent-dominant pixel, so the 2px ring the previous set painted on every panel is gone, while the trigger's own ring is untouched. |

## What these frames do NOT prove

- **That the product behaves this way.** Nothing passes `runDetails`; the header's
  new prop is unwired and the popover cannot be reached in the running app. Every
  frame is real components over fixture state, and `Settled`'s missing button is a
  claim about the derived model, not about a session anyone has run.
- **The tooltip copy.** A still cannot show a hover tooltip and the frames are
  captured without a pointer. The strings — the clause order, the shedding, the
  singular/plural forms — are asserted in `scripts/run-detail-model.test.mjs`
  instead. The `danger` dot, which is not a hover, IS photographed.
- **Reduced motion.** The running mark is `motion-safe:animate-spin` and the
  circles stay put when motion is reduced; the frames are taken with motion on.
  The design's claim is that the SHAPES carry the states, and the six states in
  these frames are all distinguishable without colour.
- **The panel updating while open.** The frames are one instant each; whether a
  row that settles mid-read reflows the list is a behaviour, not a still. One
  half of it IS photographed: `failure-unseen` opens through the real button,
  which acknowledges the failure in the same commit, and the panel is still
  there — the state that used to unmount it.
- **Ten of the twelve themes.** See above.
- **Any interactive path.** Rows are not clickable and nothing in the panel is,
  which is the design (`§4.3`) — so a still loses nothing here, but it also cannot
  demonstrate the absence of a click. What it CAN demonstrate is the absence of a
  hover ground, which is a class and not a state: no frame in this set paints
  `accent-wash` on a row, because no row carries it any more.
