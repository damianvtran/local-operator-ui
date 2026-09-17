# Composer status row — clearing the goal, and stopping or clearing a loop

The two DISMISS affordances this change adds to the composer's status row, at rest
and revealed, and the interaction that makes them worth having: the goal clearing
off the wire and being offered back, a running loop stopping, a settled loop being
acknowledged, and a refusal staying in the row's voice rather than going silent.

`docs/composer-status-tabs.md` § 12-13 is the design record these frames answer
to; this file says where the pixels came from and what each one is evidence of.

**The frames come from the OPERATOR'S BROWSER, not from a rig's own headless
Chromium.** That is a deliberate divergence from the twelve-theme sweep and it is
recorded rather than implied: this machine's operator policy forbids a screenshot
produced by a scripted browser engine (the same policy
`manifest.json`'s `chat-run-panel/mcp-grant-confirm` entry cites for its own owed
re-capture), and the interaction these frames exist for cannot be driven from a
story at all — it needs a bridge and a wire. So the two halves are:

| Half | Driven by | Frames |
|---|---|---|
| The STORY states (the row's own bands, at two column widths and the floor) | the served Storybook, in the operator's browser, at `?args=theme=…` | `goal-tab-rest/`, `goal-tab-revealed/`, `goal-tab-x-only/`, `loop-tab-rest/`, `loop-tab-revealed/` |
| The INTERACTION (press → command → wire) | `harness/`, served by its own Vite config, in the operator's browser | `interaction-rest/`, `interaction-performed/`, `interaction-undone/`, `interaction-refused/` |

## The commands

```sh
# The stories, served from THIS worktree. 6018 because a sibling worktree held
# 6017 while this ran (`docs/evidence/chat-composer-status-row/README.md` records
# the same walk-forward).
npx storybook dev -p 6018 --no-open --quiet

# The interaction harness. Its own port variable, `strictPort: true`, and a
# scratch port because it is not the sweep and must never fight one.
COMPOSER_STATUS_CLEAR_PORT=5214 npx vite \
  --config docs/evidence/composer-status-clear/harness/composer-status-clear.vite.mjs
```

Then, in the operator's browser, one page per frame:

```
http://localhost:6018/iframe.html?id=chat-composer-status-row--goal-clear&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-chip&viewMode=story&args=theme:localOperatorLight
http://localhost:5214/docs/evidence/composer-status-clear/harness/composer-status-clear.html?theme=localOperatorDark
```

`args=theme:<id>` is how a story takes a palette (`.storybook/preview.tsx`'s
`theme` arg, applied by its own decorator), and it is the ONLY channel a browser
tool has: the sweep sets the attribute through CDP, which is exactly what the
policy above forbids here.

## The reveal: what produced these frames, and what they therefore do NOT show

`:hover` IS BROWSER STATE, and the reveal is keyed to it (`group-hover`, one class
string shared with `group-focus-within` — see below). **The `browser` tool has no
hover verb, and a press in this host produces `:focus` without hover** (measured by
design review round 1: after a press the control carries the base layer's
`focus-visible` outline and `ink-muted` ink, with no `accent-wash` ground anywhere
in either palette). So:

- **`goal-tab-revealed/` and `loop-tab-revealed/` are the FOCUS path**, produced by
  focusing the chip (the goal's) or the control itself (the loop's). The ✕ and its
  word are painted; the chip's own tooltip is open in the goal frames because the
  chip is what holds focus, and the dismiss's tooltip is open in the loop frames for
  the same reason.
- **The HOVER APPEARANCE IS NOT IN THIS SET AND IS NOT VERIFIED BY PIXELS**: no frame
  here paints `hover:bg-accent-wash` or the `hover:text-ink` step on the `canvas`
  ground. The class string that carries both activators is asserted mechanically
  instead — `scripts/composer-tabs.test.mjs` compares the utilities after
  `group-hover:` against the utilities after `group-focus-within:` as two SETS, so
  the keyboard half cannot drift behind the pointer half — and the paint difference
  between the two is one colour step whose contrast pairing `scripts/contrast-contract.mjs`
  already asserts on `surface` for the readings' own control.
- **A press in the HARNESS does what a press does in the app** (its bridge answers
  and the wire moves). Nothing in these frames is a hover frame, and no frame claims
  to be one.

The keyboard half of the reveal is pinned in `scripts/composer-tabs.test.mjs` (both
activators cut across every media state), and the click-through by `tooltip` in the
story frames is the accessible name the same test asserts.

## The frames

| Frame | What it shows |
| --- | --- |
| [`goal-tab-rest/`](goal-tab-rest/) | The `GoalClear` story at rest, bands one to four: the goal's dismiss HELD (nothing painted, its 89px box reserved so a reveal cannot move the snippet — the numbers are printed into the frame: `900px column · row 32px tall · overflowX 0px · 2 chips · 1 dismiss (89px) · dismiss gap 0px · goal 257px (text 188/188)`), the goal alone on the row, a 300-character goal whose snippet yields while the count does not move, and the 240px band. The 240 band shows the LAYOUT rule — the item is the row's whole content box there — and NOT the dropped word: the word yields strictly BELOW 240px, so the band that carries the X alone is the 172px floor (`goal-tab-x-only/`). The control itself is held at rest in every band here, so no frame in this directory paints it. |
| [`goal-tab-revealed/`](goal-tab-revealed/) | The same story with the goal's CHIP focused: the `X` and `Clear goal` are painted **at the chip's own trailing edge** (the band's facts print `dismiss gap 0px`; the arrangement this replaces measured 132px, 414px and 532px in the same three states), and the reveal's own scope is the trigger's line rather than the item's `flex-1` box — so the ✕ cannot be revealed from the row's empty space. The chip's tooltip is the open tooltip (the chip holds focus); the control's own tooltip is the derived string `goalClearLabel`, asserted in the test suite. |
| [`goal-tab-x-only/`](goal-tab-x-only/) | **Design review round 1's D4, the state nobody had looked at.** The 172px floor band — the app's real column floor, where `@max-[240px]` matches and the dismiss's word is dropped — with the control REVEALED: a bare `X` at the chip's trailing edge inside its held 26px box, its accessible name still carrying the verb (`Clear goal — …`), and the numbers beside it: `172px column · row 54px tall · overflowX 0px · 2 chips · 1 dismiss (26px) · dismiss gap 0px · goal 136px (text 67/1956)`. The 240px band above it is in the same frame for comparison, with its word kept (89px). |
| [`loop-tab-rest/`](loop-tab-rest/) | The `LoopChip` story at rest: the loop chip alone at the row's start (`Loop: running, 2 of 5 turns` — **one text flow**, so the readings' box gap no longer lands between the status word and its own comma: QA round 1's Q2), the goal/loop/plan pair, `judging` with no figure beside its word, and the settled `achieved` case whose affordance already reads `Clear loop`. |
| [`loop-tab-revealed/`](loop-tab-revealed/) | The same story with the running loop's dismiss focused: `X` and `Stop loop` painted at the loop chip's trailing edge (the 900px six-chip band's facts print `2 dismiss (89px+86px) · dismiss gap 0px+0px`), tooltip `Stop loop — running, 2 of 5 turns`. The reveal is captured on the goal+loop PAIR band rather than on the loop-alone band, which keeps the band's own caption legible beside the tooltip (code review round 1, NIT 2). |
| [`interaction-rest/`](interaction-rest/) | The harness at rest: four bands, each with the wire it reads (`wire: goal … · loop …`) and an empty command log. |
| [`interaction-performed/`](interaction-performed/) | **The point of the whole set.** Three presses, one per command band, and the log line each one left: `sessions.command goal clear -> session clear-goal` (the wire's goal is now `""`, the row renders NOTHING, and the toast channel offers the text back — `Goal cleared` with an `Undo` action), `sessions.command loop stop -> session stop-loop` (the wire is `loop cancelled` — **the backend KEEPS the state**, so the chip stays and now reads `Loop: cancelled` with `Clear loop`), and the settled band, whose log line is **absent because the press sent NOTHING**: no released backend has a spelling that clears a settled loop, and the two the companion adds start a loop on one that does not know them, so the row acknowledges its own chip and the wire stays `loop achieved`. The fourth band is the refusal control and is untouched. |
| [`interaction-undone/`](interaction-undone/) | **The recovery, driven.** The `Undo` in the cleared goal's toast, pressed: the log gains `sessions.command goal Reconcile the March invoices -> session clear-goal`, the wire's goal is `"Reconcile the March invoices"` again and the chip is back on the row. This is the half of UX round 1's U1 that a confirmation without a recovery would not have. |
| [`interaction-refused/`](interaction-refused/) | The refusal path: the bridge answers 503, the wire does NOT move, the control stays revealed under the press, and the row answers **in the control's own words** through the app's toast channel — `Could not clear the goal: the backend refused: the session is not accepting commands` (not `/goal did not run: …`, which named a slash command the person never typed: UX round 1's U2). The dismiss's tooltip in this frame is the CLAMPED one (design review round 1, D7): four lines at most, with the full value still in the control's accessible name. |

## What these frames are not

- **Not a backend proof.** The wire the harness moves is the harness's own: it
  applies each command's effect to the frontend state the row reads, modelling the
  backend's own behaviour (`goal clear` empties the goal; `loop stop` settles the loop
  to `cancelled` and KEEPS it, which is what `local_operator/session/goal_loop.py`
  publishes from its `CancelledError` arm). The backend half of the pair is
  `local-operator`'s change, and no frame here claims it.
- **Not a hover frame, and not the twelve-theme sweep.** Two brand palettes, which is
  `docs/branding.md` § 9.9's minimum and where contrast defects hide, not twelve; and
  the hover paint is unverified for the reason at the top of this file, not by
  oversight. A full sweep of this surface needs the rig.
- **Not the story set next door, and that set is STALE for this change.**
  `docs/evidence/chat-composer-status-row/` is the swept set: its frames are
  pictures of the row BEFORE the goal's dismiss box and the loop chip existed, and
  the row they name has moved (the goal chip's snippet now yields to a held 89px
  box; a sixth chip can appear). Its frames are left in place rather than deleted
  — they are the record of the arrangement the design record's § 2, § 3.1 and § 5.4
  quote numbers from — and the re-capture is OWED, for the reason recorded in
  `manifest.json`'s `captureOrigin.browserToolPass` and in this set's own
  `supplementary` entry. What that set's stale frames do NOT cover is the row's
  CURRENT geometry, and that is what the `RowFacts` captions in the frames above
  carry.
- **Not a keyboard walk.** The reveal's keyboard half is a class-string parity pin in
  `scripts/composer-tabs.test.mjs` and the focus state of a control under its own
  focus, not a frame of a Tab walk.
- **Not free of the tool's own artifacts, and they are named rather than hidden.**
  The dismiss's or the chip's tooltip paints over whatever sits above the row in the
  band it belongs to (a `side="top"` tooltip over a caption that must sit above the
  row); the reveal frames keep the band's numbers below the row legible for that
  reason. And the harness's wire is its own stub, so nothing here speaks for a real
  backend's receipts.
