# The ask-queue triage pair: waiting vs moved on, urgency, and the deadline

Three defects the desktop-surface audit filed against the queued-ask lane
(`~/local-operator-ui` PRs #734/#746), all of them on the MINIMIZED bar, and all
of them the same class: the bar stated something the queue's own fold does not.

| # | the defect | the fix |
| --- | --- | --- |
| 1 | `presentAsk` folded `timed_out` into `open`, so a queue whose deadlines had passed still read **"2 questions waiting"** — one of those two asks had had its deadline fire and the agent had walked past it | the view carries `waiting` (inside the window) and `movedOn` (deadline passed, late answer still lands) beside the backend's `open`, and the bar prints both when both are present |
| 2 | the wire's `urgent` flag reached the receipt fold and **no desktop component painted it** — an ask with a 10-minute window looked exactly like one with an hour | the panel row's status mark and the bar's glyph take the `warning` role for an outstanding urgent ask, with an `sr-only` "Urgent." beside the mark so the cue is not colour-only |
| 3 | `askExpiryText` was rendered **only on the expanded panel row**, so the one number that decides whether to triage now was behind the click that expands it | the view carries `soonestExpiryMs` across the waiting asks and the collapsed bar prints it against the carrier's own clock |

## The pair this set is

Four states, two brand palettes, before and after. `before/` is
`origin/main` = `56aed8ef8e6`; `after/` is the content commit the manifest's
stamps name.

| state | before | after |
| --- | --- | --- |
| `minimized-moved-on-only` | `? 1 question waiting — Which files should the cleanup script touch?`, accent glyph | `? 1 question moved on — …`, warning glyph |
| `minimized-mixed` | `? 2 questions waiting — Which environment should I deploy this to?` | `? 1 waiting · 1 moved on — …`, plus `expires in 48m` |
| `minimized-urgent` | `? 1 question waiting — Should I roll the staging cluster back to the …`, accent glyph, no deadline | the same sentence with the warning glyph and `expires in 18m` beside it |
| `expanded-urgent` | the panel row's mark in accent ink | the same row's mark in warning ink |

The deadline readings are the fixtures' own arithmetic, not a claim about the
clock: `ONE` expires at `TS + 60m` and the stories pin `nowMs` at `TS + 12m`
(`expires in 48m`), `URGENT` at `TS + 30m` (`expires in 18m`).

## The numbers, measured

**Counts.** The bar's sentence is `askBarText`/`askCountLabel` over the story
fixtures, asserted without a DOM in `scripts/ask-queue.test.mjs` (29 tests,
including the split, the moved-on-only case, the head preference, the soonest
deadline and the truncated fallback). The frames are the same functions painted.

**Ink.** Each frame's most saturated pixels, measured against the two palette
tokens (`localOperatorDark`: `accent #38c96a`, `warning #e0b04b`;
`localOperatorLight`: `accent #137742`, `warning #8a5800`), as the smallest
ΔRGB from the frame to each token:

| state | theme | before: nearest | after: nearest |
| --- | --- | --- | --- |
| `minimized-moved-on-only` | dark | accent 54.7 (warning 98.9) | warning 47.2 (accent 102.9) |
| `minimized-moved-on-only` | light | accent 38.3 (warning 91.8) | warning 45.6 (accent 70.8) |
| `minimized-mixed` | dark | accent 55.4 (warning 98.9) | warning 47.2 (accent 103.0) |
| `minimized-mixed` | light | accent 36.1 (warning 90.8) | warning 45.6 (accent 71.0) |
| `minimized-urgent` | dark | accent 54.7 (warning 98.9) | warning 48.4 (accent 102.9) |
| `minimized-urgent` | light | accent 38.3 (warning 91.4) | warning 39.8 (accent 70.6) |
| `expanded-urgent` | dark | accent 52.6 (warning 95.3) | warning 51.2 (accent 104.2) |
| `expanded-urgent` | light | accent 32.7 (warning 90.3) | warning 38.3 (accent 70.9) |

Every BEFORE frame's nearest ink is the accent and every AFTER frame's is the
warning; the distances are blends rather than exact token values because the
glyph's strokes are one to two pixels wide at this measure, which is also why
the reading is "nearest" rather than "equals".

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
`docs/evidence/manifest.json`'s `supplementary` list instead - the same shape
every bespoke set in this tree uses - and its frames are excluded from the swept
count.

The one thing the rig command above does not carry is where the frames LAND: the
capturer writes under the story's own surface directory (`chat-asks-queued-asks/`)
unless the entry names a `dir`. This pass therefore ran with these four rows
appended to `STORIES`, one per state, with `before/` and `after/` substituted
between the two runs - and removed again before the commit, because the sweep's
table is `main`'s:

```js
["chat-asks-queued-asks--minimized-moved-on-only", 617, 150, { dir: "../ask-queue-triage/after/minimized-moved-on-only" }],
["chat-asks-queued-asks--minimized-mixed",          617, 150, { dir: "../ask-queue-triage/after/minimized-mixed" }],
["chat-asks-queued-asks--minimized-urgent",         617, 150, { dir: "../ask-queue-triage/after/minimized-urgent" }],
["chat-asks-queued-asks--expanded-urgent",          617, 470, { dir: "../ask-queue-triage/after/expanded-urgent" }],
```

617px is the story decorator's own measure - the chat pane at the app's default
1380x900 window - and the two brand palettes are `branding.md` § 9.9's minimum.

The `before/` run is the same command with the four component modules
(`ask-queue.ts`, `ask-bar.tsx`, `ask-panel.tsx`, `ask-surfaces.tsx`) checked back
out at `56aed8ef8e6` and the fixtures kept: a story that did not exist on `main`
still renders, and what the frame shows is the CURRENT copy over the new state,
which is exactly the delta this pair is about.
