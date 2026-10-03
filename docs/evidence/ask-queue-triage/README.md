# The ask-queue triage pair: waiting vs moved on, urgency, and the deadline

Three defects the desktop-surface audit filed against the queued-ask lane
(`~/local-operator-ui` PRs #734/#746), all of them on the MINIMIZED bar, and all
of them the same class: the bar stated something the queue's own fold does not.

| # | the defect | the fix |
| --- | --- | --- |
| 1 | `presentAsk` folded `timed_out` into `open`, so a queue whose deadlines had passed still read **"2 questions waiting"** — one of those two asks had had its deadline fire and the agent had walked past it | the view carries `waiting` (inside the window) and `movedOn` (deadline passed, late answer still lands) beside the backend's `open`, and the bar prints both when both are present |
| 2 | the wire's `urgent` flag reached the receipt fold and **no desktop component painted it** — an ask with a 10-minute window looked exactly like one with an hour | the panel row's status mark and the bar's glyph take the `warning` role for an urgent ask, with an `sr-only` "Urgent." beside the row's mark so the cue is not colour-only |
| 3 | `askExpiryText` was rendered **only on the expanded panel row**, so the one number that decides whether to triage now was behind the click that expands it | the view carries the soonest deadline across the waiting asks and the collapsed bar prints it against the carrier's own clock |

## Round 1's remediation, and what moved

Both reviews landed on the same root defect from different instruments — the UX
round from the flow, the design round from the pixels — which is the strongest
signal either round produced.

| finding | what it was | what this pass does |
| --- | --- | --- |
| UX U1 = design D1 (MAJOR) | the amber was bought by asks the agent had MOVED ON from: `urgent` was derived over the outstanding set, which includes `timed_out`. In `minimized-mixed` the amber came entirely from the ask the operator could no longer catch; over `minimized-moved-on-only` it painted amber with **no deadline at all** and nothing on screen to explain it | `urgent` is scoped to the same set the deadline reads (`waiting`), so amber means exactly "an ask you can still catch is urgent". Measured: the two frames now read `accent` and `minimized-urgent` (whose waiting ask really is urgent) still reads `warning` |
| UX U2 = design D4 (MAJOR) | the deadline span and the amber were painted in the JSX alone, so the button announced a state the screen was not in | one composition (`askBarDeadline`) feeds both the span and `askBarLabel`, and the urgency word comes from the same predicate as the ink |
| design D2 | the deadline is a queue-scope reading printed beside ONE named question; with two windows it read as the named ask's | the `soonest ` scope word appears whenever the soonest is not the named ask's own; with one waiting ask it is that ask's and stays bare (`minimized-two-windows` vs `minimized-mixed`) |
| design D5 | the urgent arm returned an early `HelpCircle`, taking the Clock away from a timed-out urgent row | the status switch decides the glyph again; only the ink steps (`expanded-moved-on`: `lucide-clock text-warning`) |
| design D6 | in a truncated frame the deadline was the visible subset's soonest | no deadline at all in a truncated frame — a queue-scope countdown cannot be derived from a prefix, exactly as the count falls back to the backend's tally |
| UX U3 = design D3 (MINOR) | the deadline was `shrink-0` while the question ellipsised | the bar measures itself (`@container`) and drops the deadline below 20rem of bar width — about the 268px the app's own 800x600 minimum window leaves for the pane. `minimized-mixed-narrow` (393px) still shows it; `minimized-pane-floor` (300px) does not |
| UX U4 (MINOR) | the mixed form was the only one without its noun | `1 question waiting · 1 moved on` — costs ~40px of question cell, stated below |
| design D7 (NIT) | a refuted 3.59:1 measurement stood beside the code | removed; the standing 7.85:1 / 8.19:1 reading is the one in the file |

## The pair this set is

Eight states, two brand palettes, before and after. `before/` is `origin/main`'s
components (`e209f1e495` this pass, `56aed8ef8e6` for the first); `after/` is the
content commit the manifest's stamps name. The four NEW states render fixtures
that do not exist on `main`, so their `before/` frames are those fixtures over
`main`'s components — the delta, which is what a pair is for.

ONE ROW IS THE EXCEPTION, and it is the reason the pair is worth anything:
`expanded-moved-on`'s `before/` is the **round-1 head** (`058926cda56`), not
`main`. The defect design D5 filed — the urgent arm taking the Clock away from a
timed-out row — is THIS PR's own code, so `main` renders the same Clock the fix
restores and a `main`-based pair would have been two identical frames. Shot
against the head that carried it, the pair shows what the round was reviewing.

| state | before | after |
| --- | --- | --- |
| `minimized-moved-on-only` | (`main`) `1 question waiting — …`, **warning** glyph | `1 question moved on — …`, accent glyph |
| `minimized-mixed` | (`main`) `2 questions waiting — …`, **warning** glyph | `1 question waiting · 1 moved on — …` + `expires in 48m`, accent glyph |
| `minimized-urgent` | (`main`) `1 question waiting — …`, warning glyph, no deadline | same sentence + `expires in 18m`, warning glyph |
| `expanded-urgent` | (`main`) panel row's mark in warning | unchanged in ink; the row keeps `circle-help` |
| `minimized-two-windows` | (`main`) `2 questions waiting — Deploy the staging release?`, no deadline | same + **`soonest expires in 12m`** |
| `expanded-moved-on` | (**round-1 head**) `lucide-circle-help` amber | **`lucide-clock`** with `text-warning` |
| `minimized-mixed-narrow` (393px) | (`main`) question has the room; no deadline | `expires in 48m` present, question yields |
| `minimized-pane-floor` (300px) | (`main`) question has the room; no deadline | **deadline absent**, question keeps its room |

## The numbers, measured

**Ink.** Each frame's most saturated pixels against the two palette tokens
(`localOperatorDark`: `accent #38c96a`, `warning #e0b04b`; `localOperatorLight`:
`accent #137742`, `warning #8a5800`), as the smallest ΔRGB from the frame to each
token. `nearer=` is which token the frame's inks are closer to:

| state | theme | before | after |
| --- | --- | --- | --- |
| `minimized-moved-on-only` | dark / light | **warning** 47.2 / 45.6 | accent 55.4 / 36.1 |
| `minimized-mixed` | dark / light | **warning** 47.2 / 45.6 | accent 51.4 / 38.3 |
| `minimized-urgent` | dark / light | warning 48.4 / 39.8 | warning 48.4 / 39.8 |
| `expanded-urgent` | dark / light | warning 51.2 / 38.3 | warning 51.2 / 38.3 |
| `expanded-moved-on` | dark / light | warning 51.2 / 38.3 | warning 51.2 / 38.6 |
| `minimized-two-windows` | dark / light | accent 54.7 / 36.3 | accent 54.7 / 36.3 |
| `minimized-mixed-narrow` | dark / light | **warning** 47.2 / 45.8 | accent 54.7 / 38.3 |
| `minimized-pane-floor` | dark / light | **warning** 47.2 / 45.8 | accent 54.7 / 38.3 |

Distances are blends rather than exact token values because the glyph's strokes
are one to two pixels wide at this measure.

**The pane, read from the rendered DOM** (a scratchpad CDP probe —
`dom_audit.mjs` could not run: no playwright in this worktree, and installing one
is out of bounds). `label` is the question cell's `clientWidth`/`scrollWidth`:

| state | viewport | bar width | deadline span | label |
| --- | --- | --- | --- | --- |
| `minimized-mixed` | 617 | 585.00 | `block` `expires in 48m` | 428 / 498 |
| `minimized-moved-on-only` | 617 | 585.00 | absent | 520 / 520 (fits) |
| `minimized-urgent` | 617 | 585.00 | `block` `expires in 18m` | 431 / 513 |
| `minimized-two-windows` | 617 | 585.00 | `block` `soonest expires in 12m` | 383 / 383 (fits) |
| `minimized-mixed-narrow` | 393 | 361.00 | `block` `expires in 48m` | 204 / 498 |
| `minimized-pane-floor` | 300 | 268.00 | `none` | 203 / 498 |

The yield rule is why the last two rows' label cells are the SAME (~203px): below
20rem of bar width the deadline steps aside so the question keeps the room it
would have had without it. **The cost is stated rather than hidden**: at 393px
and below, the count ("1 question waiting · 1 moved on", ~215px at the bar's 14px
copy) consumes the cell and the question itself is not visible — the frame shows
the bar as a COUNTS chip, with the question one expansion away. At the 617px
pane, the question shows and ellipsises; that is the trade design round 1's D2/D3
asked to see photographed, and UX round 1's U3 is fixed at the floor this pass
reached rather than by making the deadline shrinkable (which would print
`expires in 4…` rather than a number).

**Announced names** (the button's own `aria-label`, read from the DOM — and every
one of these strings is also asserted, browser-free, in
`scripts/ask-queue.test.mjs`):

```
minimized-mixed       1 question waiting · 1 moved on — Which environment should I deploy this to? expires in 48m. Expand to answer.
minimized-moved-on-only  1 question moved on — Which files should the cleanup script touch? Expand to answer.
minimized-urgent      1 question waiting — Should I roll the staging cluster back to the previous build? expires in 18m. Urgent. Expand to answer.
minimized-two-windows 2 questions waiting — Deploy the staging release? soonest expires in 12m. Expand to answer.
```

The name carries the deadline and the urgency word at EVERY width, including the
two where the visible span yields: the name is not a width-constrained surface,
and a screen reader losing the triage number to a pixel budget would be the
defect U2/D4 filed, re-committed.

## What produced these frames

The repo's own capturer, one private headless Chrome per run (reaped by the
rig), driven against a Storybook dev server:

```
node_modules/.bin/storybook dev -p 6017 --no-open --ci --quiet      # 6018 if held

node scripts/capture-evidence.mjs http://localhost:6017 \
  --only=chat-asks-queued-asks --allow-backend \
  --themes=localOperatorDark,localOperatorLight
```

`--allow-backend` because a backend was listening on the app's configured port;
the ask stories render from fixtures and never call out, which is what that flag
states.

**This set is NOT in the sweep's `STORIES` table**, and that is deliberate: the
sweep re-captures every story from the tree it runs on, so a `before/` directory
in the table would be overwritten by the CURRENT code on the next sweep and the
pair would silently become a pair of identical frames. It is declared in
`docs/evidence/manifest.json`'s `supplementary` list instead — the same shape
every bespoke set in this tree uses — and its frames are excluded from the swept
count.

The one thing the rig command above does not carry is where the frames LAND: the
capturer writes under the story's own surface directory (`chat-asks-queued-asks/`)
unless the entry names a `dir`. This pass therefore ran with these eight rows
appended to `STORIES`, one per state, with `before/` and `after/` substituted
between the two runs — and removed again before the commit, because the sweep's
table is `main`'s:

```js
["chat-asks-queued-asks--minimized-moved-on-only", 617, 150, { dir: "../ask-queue-triage/after/minimized-moved-on-only" }],
["chat-asks-queued-asks--minimized-mixed",          617, 150, { dir: "../ask-queue-triage/after/minimized-mixed" }],
["chat-asks-queued-asks--minimized-urgent",         617, 150, { dir: "../ask-queue-triage/after/minimized-urgent" }],
["chat-asks-queued-asks--expanded-urgent",          617, 470, { dir: "../ask-queue-triage/after/expanded-urgent" }],
["chat-asks-queued-asks--minimized-two-windows",    617, 150, { dir: "../ask-queue-triage/after/minimized-two-windows" }],
["chat-asks-queued-asks--expanded-moved-on",        617, 470, { dir: "../ask-queue-triage/after/expanded-moved-on" }],
["chat-asks-queued-asks--minimized-mixed-narrow",   393, 150, { dir: "../ask-queue-triage/after/minimized-mixed-narrow" }],
["chat-asks-queued-asks--minimized-pane-floor",     300, 150, { dir: "../ask-queue-triage/after/minimized-pane-floor" }],
```

617px is the story decorator's default measure — the chat pane at the app's
default 1380x900 window — and the two brand palettes are `branding.md` § 9.9's
minimum.  393px and 300px are the design round's own requested width and the
pane the app's minimum window leaves; the decorator reads both from a story's
`parameters.paneWidth`, so a second width is a parameter rather than a second
story file.

The `before/` run is the same command with the four component modules
(`ask-queue.ts`, `ask-bar.tsx`, `ask-panel.tsx`, `ask-surfaces.tsx`) checked back
out at the base commit and the fixtures kept — `e209f1e495` for every state but
`expanded-moved-on`, whose `before/` is `058926cda56` because the arm D5 filed
against is this branch's own code (see the pair table).

## Not covered here

`dom_audit.mjs` (the design-qa skill's overlap/clipping/target-size pass) did not
run: it needs playwright, and installing a browser engine is out of bounds on
this machine. What replaces it is the CDP probe above (computed styles and the
accessible name, from the same rendered stories the frames come from) plus the
committed assertions in `scripts/ask-queue.test.mjs` for every string and count.
The frame-level geometry — overlap, clipping, target size — is **not** covered by
this pass and is not claimed.
