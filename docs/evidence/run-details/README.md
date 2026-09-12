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
# 6017 was held by another worktree's Storybook, and Storybook walks forward on
# a taken port: this run bound 6018. (It walks *again* per run - the first
# attempt of this round landed on 6019 - so read the port off the banner rather
# than assuming it.)
pnpm storybook --port 6017 --no-open

node scripts/capture-evidence.mjs http://localhost:6018 \
  --only=run-details \
  --themes=localOperatorDark,localOperatorLight \
  --allow-backend

pnpm check-evidence
```

**Why narrowed rather than swept.** A full sweep is 474 frames and about half an
hour, and it DELETES the set before re-taking it — so a sweep to add sixteen
frames rewrites 474 nobody reviewed and buries the sixteen that changed. `--only`
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
| [`todos-only`](todos-only/) | One section only: fourteen items over three phases, capped at ten with `+4 more`. Every item state in one plan — pending, done (struck, `ink-dim`), dropped (struck, `— dropped`, tag not struck), blocked (full `ink`, the loudest row, `— blocked: <reason>` beside it) — and the flat/headerless path is in `failure` rather than here. |
| [`failure`](failure/) | The only colour the panel spends: the cross on the failed row, `danger`. Its second line is the first line of `error_text`, and nothing else on the row is red. Beside it a settled child with its role suppressed and no activity line. Below: the **flat single-phase plan**, rendering headerless with no `Todos · 0/3` it does not need. |
| [`crowded`](crowded/) | Both overflows. Six rows, then `+3 more`, in the priority order (running, queued, failed, paused, interrupted, settled; ties newest to oldest). The tally has shed whole segments down to `2 running · 1 queued · 1 failed · 1 paused`. Below, the plan starts — and stops at the panel's own ceiling, which is the next section. |
| [`settled`](settled/) | Everything settled and nothing unseen, so **there is no run-details button** in the header. `§3.3`: settled work alone does not raise the trigger, because a finished roster is history and history lives in the transcript. |
| [`header-trigger`](header-trigger/) | The same ground with work in flight: the button is present, at the end of the bar beside the canvas button, in the cluster that took over `ml-auto`. Diff `settled` against this one — the fixtures are the only difference. |
| [`header-trigger-failed`](header-trigger-failed/) | The unseen failure: an 8px `danger` dot on the button's top-right corner. It is not a count; it says a child failed and nobody has looked, and the trigger clears it when the panel opens. |

## Geometry, measured from the frames

| What | Value | Where it comes from |
| --- | --- | --- |
| Panel width | 384px (`w-96`) | 377px of unbroken `elevated` on a text-free row, plus the two 1px hairline edges: x≈119..503, with the focus ring outside at 505. |
| Panel ceiling | `min(60vh, 480px)` | The 820-tall frames take the 480px branch: the panel's bottom edge lands at y≈528 with its top at y≈45. The 480-tall frame this surface was first captured in took the `60vh` branch instead — a 288px panel, which is the cap working, and the reason `todos-only` and `crowded` are captured at 820: at 288 the item cap's `+4 more` row falls past the fold of the one frame that exists to show it. |
| Scrolls, not clips | content ≈740px in a 475px viewport | Re-captured once with `type="always"`: the thumb spanned y≈50..355 of the viewport, i.e. 305px of 475 ⇒ ≈740px of content, so ≈260px scrolls. Without that check "the panel is cut off" and "the panel scrolls" are the same still, and only one of them is the design. The committed frames use Radix's default `type="hover"`, which is why **no frame shows a scrollbar**: the thumb appears on pointer-enter and a headless capture never has a pointer. |

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
  row that settles mid-read reflows the list is a behaviour, not a still.
- **Ten of the twelve themes.** See above.
- **Any interactive path.** Rows are not clickable and nothing in the panel is,
  which is the design (`§4.3`) — so a still loses nothing here, but it also cannot
  demonstrate the absence of a click.
