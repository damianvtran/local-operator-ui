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
| The STORY states (the row's own bands, at two column widths and the floor) | the served Storybook, in the operator's browser, at `?args=theme=…` | `goal-tab-rest/`, `goal-tab-revealed/`, `goal-tab-x-only/`, `loop-tab-rest/`, `loop-tab-revealed/`, `loop-tab-facts/`, `loop-band-fit/`, `loop-band-fit-goal/`, `loop-band-fit-floor/`, `loop-band-fit-floor-goal/`, `loop-band-overflow/`, `loop-settled-focus/`, `long-goal-dismiss-focus/` |
| The INTERACTION (press → command → wire) | `harness/`, served by its own Vite config, in the operator's browser | `interaction-rest/`, `interaction-performed/`, `interaction-undone/`, `interaction-refused/`, `in-flight-dismiss/` |

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
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-chip-facts&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-band-fit&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-band-fit-goal&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-band-fit-floor&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-band-fit-floor-goal&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--loop-settled-focus&viewMode=story&args=theme:localOperatorDark
http://localhost:6018/iframe.html?id=chat-composer-status-row--long-goal-dismiss-focus&viewMode=story&args=theme:localOperatorDark
http://localhost:5214/docs/evidence/composer-status-clear/harness/composer-status-clear.html?theme=localOperatorDark
http://localhost:5214/docs/evidence/composer-status-clear/harness/composer-status-clear.html?theme=localOperatorDark&hang=refused&long=refused
```

The last two harness URLs differ only in the two FIXTURE parameters the in-flight frame
needs, both off by default: `hang=<session>` makes that band's command never answer (a
hung or recovering owner, from the renderer's side) and `long=<session>` gives that band
the 300-character goal. They change the BRIDGE and one band's fixture rather than the
page, so the four interaction frames still photograph the page they were taken from.

The two focus-only stories (`--loop-settled-focus`, `--long-goal-dismiss-focus`) focus
their own control in an effect rather than by a click, because the states they exist for
cannot survive a press: the settled loop's `Clear loop` is what REMOVES the chip, and a
long goal's dismiss is what sends the command. They are the `useOpenLastGoal` convention
one activator over, and the cost of taking that path is stated under “what these frames
are not” below: a programmatic focus paints the reveal but does NOT open a Radix tooltip.

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
  asserts on BOTH grounds: `surface`, where the readings wear the same box, and
  `canvas`, which is this row's own ground (design review round 2 measured the pairing
  `ΔE00(accentWash, canvas)` at 13.33 dark / 6.75 light, and the contract's
  `reading button, hovered` row now covers it rather than leaving it to the designer's
  arithmetic).
- **BUSY IS A SECOND ACTIVATOR, and one frame paints it.** The reveal is keyed to the
  pair's hover/focus AND to the control's own in-flight state (UX round 2's U8, one
  class: `DISMISS_BUSY_REVEAL`). `in-flight-dismiss/` is that state: a hung command, the
  pointer gone, the control still painted. It is not a HOVER frame either — the press
  is what put the pointer there.
- **A press in the HARNESS does what a press does in the app** (its bridge answers
  and the wire moves). Nothing in these frames is a hover frame, and no frame claims
  to be one.

The keyboard half of the reveal is pinned in `scripts/composer-tabs.test.mjs` (both
activators cut across every media state), and the click-through by `tooltip` in the
story frames is the accessible name the same test asserts.

## The frames

| Frame | What it shows |
| --- | --- |


| [`loop-tab-facts/`](loop-tab-facts/) | **The numbers the record cites, on a page that can hold them** (agent review round 2, MINOR 3): the `LoopChip` story's last two bands shot on their own, because every frame committed for that story photographs bands 1-4. The six-chip band at 900px reads `900px column · row 58px tall · overflowX 0px · 6 chips · 2 dismiss (89px+86px) · dismiss gap 0px+0px · goal 257px (text 188/188) · loop item 269px in 900px: “Loop: running, 2 of 5 turns”` — which is where the loop half of D1's geometry and both dismiss widths are actually printed — and the 172px floor reads `172px column · row 158px tall · overflowX 0px · 6 chips · 2 dismiss (26px+26px)…`, which is § 3.1's 158px. |
| [`loop-band-fit/`](loop-band-fit/), [`loop-band-fit-goal/`](loop-band-fit-goal/), [`loop-band-fit-floor/`](loop-band-fit-floor/), [`loop-band-fit-floor-goal/`](loop-band-fit-floor-goal/) | **QA round 2's Q4, and its fix, in the frames' own numbers.** The `@max-[240px]` step with a pixel on each side (241/240/239) and the app's floor with a pixel on each side (173/172/171), once per clause shape — the count loop ("`Loop: running, 0 of 25 turns`", the WIDER clause) and the goal loop ("`Loop: running, 0 turns`", the narrower one the step looked sufficient for). Four stories rather than one because a band is ~215px of page and a band below the fold is a claim its frame does not carry. Every band prints `overflowX 0px`, the item's painted width against the row's content box, and the clause it painted — e.g. at 240px, the count loop: `overflowX 0px · 1 dismiss (86px) · loop item 190px in 240px: “Loop: running”`: the figure has yielded and the item fits. The yield is MEASURED (`itemFits`, § 12.5), not a widened threshold, which is why the count clause — wider than any boundary would have been sized for — yields at the same band as the narrow one. |
| [`loop-band-overflow/`](loop-band-overflow/) | **The before half, and the defect as a number.** The same three widths and the same count loop with the measured fit rule deliberately DISABLED, which is the code this round's reviews measured: `overflowX 37px` at 241px and `38px` at 240px ("`loop item 270px in 241px”"), and `0px` at 239px, where the step happens to fire. QA's own rig put the same shape at `19px`/`52px` on the built app at 240/241 with the app's own paddings; what this frame adds is the second half of the mechanism — the item is wider than the line and NOTHING in it yields, because both the chip and the dismiss are `shrink-0`. |
| [`loop-settled-focus/`](loop-settled-focus/) | **Design review round 2's D9, first state.** The SETTLED loop's own dismiss, painted: `Loop: achieved` beside `X Clear loop`, revealed by focus, with the frame printing `3 chips · 2 dismiss (89px+90px) · dismiss gap 0px+0px · loop item 207px in 900px`. The state had no frame because the only way to reach it was a press, and that press is what takes the chip away. |
| [`long-goal-dismiss-focus/`](long-goal-dismiss-focus/) | **D9's third state, as far as this tool can take it.** The 300-character goal with its dismiss revealed, which is the state `TOOLTIP_CLAMP` belongs to — and the tooltip is NOT painted, because a programmatic focus does not open a Radix tooltip (`:focus-visible` is required) and the press that would provide one is what closes it. The frame carries the reveal and the goal's own truncation (`goal 665px (text 595/1956)`); the clamp remains unpainted by any frame here, stated rather than implied. **Re-shot in the round-3 remediation (design review round 3, `D12`)**: the band's own caption promised "the tooltip clamps to four lines" — it is painted INTO the frame, so the still asserted the state this row says no frame here paints. The caption now names the box and the word it does paint and says the clamp is declared rather than shown; nothing else in the frame moved (measured against the previous commit: a single 952×23px text line at `583,56` differs, both palettes). |
| [`in-flight-dismiss/`](in-flight-dismiss/) | **D9's second state, and what UX round 2's U8 is about.** The harness with the refusal band's command hung (`?hang=refused&long=refused`): the press is dispatched — `commands: sessions.command goal clear -> session refused` — the wire does NOT move, and the dismiss is `disabled` with its ink stepped and its box still PAINTED while the pointer is elsewhere. Before U8 the control computed `opacity: 0` there and the row said nothing until the command settled. The long goal rides this band so the same frame is the one a hover-capable instrument would use for the clamp. **Re-shot in the round-3 remediation (design review round 3, `D12`)**: this band carried the DEFAULT page's caption — a 503 whose refusal arrives as the app's own toast — while the fixture it is shot with makes the command never answer, so the frame contradicted its own log line. The caption is now a function of the fixture (`HANGING`), the same query string the bridge reads; the rest of the frame is unchanged (one 2001×25px text line at `54,968`, both palettes). |
| [`goal-tab-rest/`](goal-tab-rest/) | The `GoalClear` story at rest, bands one to four: the goal's dismiss HELD (nothing painted, its 89px box reserved so a reveal cannot move the snippet — the numbers are printed into the frame: `900px column · row 32px tall · overflowX 0px · 2 chips · 1 dismiss (89px) · dismiss gap 0px · goal 257px (text 188/188)`), the goal alone on the row, a 300-character goal whose snippet yields while the count does not move, and the 240px band. The 240 band shows the LAYOUT rule — the item is the row's whole content box there — and NOT the dropped word: the word yields strictly BELOW 240px, so the band that carries the X alone is the 172px floor (`goal-tab-x-only/`). The control itself is held at rest in every band here, so no frame in this directory paints it. |
| [`goal-tab-revealed/`](goal-tab-revealed/) | The same story with the goal's CHIP focused: the `X` and `Clear goal` are painted **at the chip's own trailing edge** (the band's facts print `dismiss gap 0px`; the arrangement this replaces measured 132px, 414px and 532px in the same three states), and the reveal's scope is the trigger's line, which design review round 2 (D8) corrected this set's own description of: that line is a BLOCK-level box inside the item's `flex-1` root, so its box IS the item's content box and the ✕ can still be revealed from the item's blank stretch — what the primitive's own row buys is that no caller can widen the scope by accident (`docs/composer-status-tabs.md` § 12.3). The chip's tooltip is the open tooltip (the chip holds focus); the control's own tooltip is the derived string `goalClearLabel`, asserted in the test suite. |
| [`goal-tab-x-only/`](goal-tab-x-only/) | **Design review round 1's D4, the state nobody had looked at.** The 172px floor band — the app's real column floor, where `@max-[240px]` matches and the dismiss's word is dropped — with the control REVEALED: a bare `X` at the chip's trailing edge inside its held 26px box, its accessible name still carrying the verb (`Clear goal — …`), and the numbers beside it: `172px column · row 54px tall · overflowX 0px · 2 chips · 1 dismiss (26px) · dismiss gap 0px · goal 136px (text 67/1956)`. The 240px band above it is in the same frame for comparison, with its word kept (89px). |
| [`loop-tab-rest/`](loop-tab-rest/) | The `LoopChip` story at rest: the loop chip alone at the row's start (`Loop: running, 2 of 5 turns` — **one text flow**, so the readings' box gap no longer lands between the status word and its own comma: QA round 1's Q2), the goal/loop/plan pair, `judging` with no figure beside its word, and the settled `achieved` case whose affordance already reads `Clear loop`. |
| [`loop-tab-revealed/`](loop-tab-revealed/) | The same story with the running loop's dismiss focused: `X` and `Stop loop` painted at the loop chip's trailing edge, tooltip `Stop loop — running, 2 of 5 turns`. The reveal is captured on the goal+loop PAIR band rather than on the loop-alone band, which keeps the band's own caption legible beside the tooltip (code review round 1, NIT 2). **The six-chip band's facts are NOT in this frame** and the earlier version of this row cited them here: this story's two `RowFacts` bands (the six chips at 900px and the 172px floor) are the last two of eight and fall below the fold, which this capture tool cannot scroll — that is agent review round 2's MINOR 3, and the numbers live in [`loop-tab-facts/`](loop-tab-facts/) below. |
| [`interaction-rest/`](interaction-rest/) | The harness at rest: four bands, each with the wire it reads (`wire: goal … · loop …`) and an empty command log. |
| [`interaction-performed/`](interaction-performed/) | **The point of the whole set.** Three presses, one per command band, and the log line each one left: `sessions.command goal clear -> session clear-goal` (the wire's goal is now `""`, the row renders NOTHING, and the toast channel offers the text back — `Goal cleared` with an `Undo` action), `sessions.command loop stop -> session stop-loop` (the wire is `loop cancelled` — **the backend KEEPS the state**, so the chip stays and now reads `Loop: cancelled` with `Clear loop`), and the settled band, whose log line is **absent because the press sent NOTHING**: no released backend has a spelling that clears a settled loop, and the two the companion adds start a loop on one that does not know them, so the row acknowledges its own chip and the wire stays `loop achieved`. The fourth band is the refusal control and is untouched. |
| [`interaction-undone/`](interaction-undone/) | **The recovery, driven.** The `Undo` in the cleared goal's toast, pressed: the log gains `sessions.command goal Reconcile the March invoices -> session clear-goal`, the wire's goal is `"Reconcile the March invoices"` again and the chip is back on the row. This is the half of UX round 1's U1 that a confirmation without a recovery would not have. |
| [`interaction-refused/`](interaction-refused/) | The refusal path: the bridge answers 503, the wire does NOT move, the control stays revealed under the press, and the row answers **in the control's own words** through the app's toast channel — `Could not clear the goal: the backend refused: the session is not accepting commands` (not `/goal did not run: …`, which named a slash command the person never typed: UX round 1's U2). The dismiss's tooltip in this frame is a TWO-LINE tooltip over a short goal, which is what design review round 2 (D7) measured: `TOOLTIP_CLAMP` is `line-clamp-4`, and "four lines at most" was true of the class and not of any pixel here. The clamp itself is still unpainted BY ANY FRAME IN THIS SET — see the bullet below — and the full value stays in the control's accessible name, which the test suite asserts. |
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
  focus, not a frame of a Tab walk. The two focus-only stories focus their control
  PROGRAMMATICALLY, which is what a click cannot do for those states — and the cost is
  that a programmatic focus paints the reveal but does not open a Radix tooltip
  (`:focus-visible` is required), so `loop-settled-focus/` and
  `long-goal-dismiss-focus/` carry no tooltip at all.
- **The CLAMP's paint is still unpainted, and this round could not take it.**
  `TOOLTIP_CLAMP` (`line-clamp-4`) is asserted as a class and stated in the accessible
  name, and design review round 2 (D9) asked for its four-line paint: this tool cannot
  produce it. A press paints the reveal but closes the tooltip that was open under the
  pointer, a programmatic focus paints the reveal but opens no tooltip at all, and the
  tool has no hover verb and no key dispatch (a keyboard focus is the third activator
  and the only one that would work). The harness now carries the fixture that would
  show it (`?long=refused`, a 300-character goal, and `in-flight-dismiss/` is shot with
  it), so a hover-capable instrument can take it in one press — until then the claim
  is a class and an accessible name, not a pixel.
- **Not free of the tool's own artifacts, and they are named rather than hidden.**
  The dismiss's or the chip's tooltip paints over whatever sits above the row in the
  band it belongs to (a `side="top"` tooltip over a caption that must sit above the
  row); the reveal frames keep the band's numbers below the row legible for that
  reason. And the harness's wire is its own stub, so nothing here speaks for a real
  backend's receipts.
