# The action row under the turn-closing answer

Issue #695, and the design memo's (a)–(h) rulings. The reporter's habit —
"copy response" under the reply, ChatGPT-shaped — met a surface that had no
control there at all: every per-message action lived in a hover-only toolbar at
the turn's top-right (`components/message-item/message-controls.tsx`, reachable
only from two story files and superseded here). The desktop UI does ship `/copy`,
which this README claimed otherwise until design round 1's D2 — but it is a
PICKER: it opens a destination chooser and copies a whole record from it, so it is
a route to the text rather than an affordance under the answer the reader is
looking at.

This set is the change's own evidence, and its pair under
[`../chat-canonical-message-actions-before/`](../chat-canonical-message-actions-before/)
is half the claim: a frame of the row alone cannot show that the reader used to
have nothing on that line. **The row is discoverable because it is ON SCREEN at
rest**, so every state below is photographed with no pointer in the frame unless
the state IS the pointer.

**THE ARM, DECLARED (design round 1 D2, round 2 D1): the nine resting states
ship in the HOVER-LESS arm (`touch: true` — `Emulation.setTouchEmulationEnabled`
in the rig); the seven interaction states ship in a hover-capable one, and the
four states that declare no arm inherit the rig's renderer (`host` in the table
below).** Which arm
a capture renders under decides whether a pointer-less frame can show the row at
all: its reveal is `opacity-0 … group-hover:opacity-100
group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`
(`message-actions.ts`), so under the product's own pointer arm the row is
invisible until the pointer or the keyboard arrives — and nine of this set's
states exist precisely to show the row in its context. The hover-less arm is the
app's own, not an invention of the rig: the arrival animation beside the reveal
is gated on `hover: hover` for exactly the opposite reason
(`styles/index.css`).

**The older generation was not this arm, and could not be reproduced as it
stood:** its resting frames predate the reveal itself — `opacity-0` and the
`(hover: none)` exception landed in `3d03a2f3e63`, after those frames were taken
— so they show the row because nothing hid it then, under a hover-capable host.
That is why round 1's reading (and the sentence that briefly stood here, calling
it "the rig's headless Chrome reports no hover capability") was wrong, and why a
refresh that simply inherited the host's media result lost the row from all nine.
The arm is now SET BY THE RIG and declared per entry (`touch`), so a different
host cannot move it silently.

**And the product's pointer arm has no resting frame at all** — by design, not by
omission: to a reader with a mouse the row is one hover or one Tab away, and the
`hover-copy/` and `focus-copy/` entries are that arm's own evidence.

**This set also carries the 2026-10-01 REARRANGEMENT of its own line** (operator
direction: the caption to the content's own left rail, the action row and the
stamp as the line's right cluster), and the before half of that pair is the
sibling
[`../chat-canonical-message-actions-foot-before/`](../chat-canonical-message-actions-foot-before/).
The arrangement's numbers — including the hover proof, which is not a still but
the idle and hovered boxes being identical — are in *The measured rail* below.

## What is in it

| directory | state | arm | what it is for |
|---|---|---|---|
| `rest/` | a settled answer, no pointer | **hover-less** | the discoverability claim itself: the row ON SCREEN, asserted per shot |
| `hover-answer-no-corner-control/` | the pointer parked on the answer | pointer | the superseded pattern's own region, with `expectPresent: '[data-lo-answer-actions]'` and `expectGone: '[data-lo-link-toolbar]'` asserted |
| `hover-copy/` | the pointer on Copy | pointer | the hover step: `accent-wash` ground, `accent` ink |
| `focus-copy/` | Tab-reached Copy, real presses | pointer | the focus ring, and the "Copy" tooltip |
| `copied/` | Copy pressed | pointer | the tick and the `Copied` name, asserted by `expectAttribute` |
| `short-answer/` | a one-line answer | **hover-less** | the row must not read as a second sentence |
| `refused/` | a refusal | **hover-less** | the row is present; the danger ink stays on the prose |
| `truncated/` | a partly-received answer | **hover-less** | the caption above, the row below |
| `streaming/` | a settled turn beside an in-flight one | **hover-less** | the row on the settled answer, and NONE on the in-flight turn's rows |
| `multi-answer/` | two settled answers in one turn | **hover-less** | exactly one row, on the closing answer |
| `bar-suppressed/` | a turn folded into its bar | **hover-less** | the actions still on the line, the bar keeping its numbers and stamp |
| `one-call-turn/` | the minimum action count: one call, settled | **hover-less** | one call is one hidden span, so the turn folds into a single bar and the bar above states `1 action`; the closing line keeps the row with no caption beside it |
| `compacted-run/` | a turn split by a mid-run compaction | host | the caption at the content's rail — `Worked for 12s · 2 actions` — with the row's box at rest inside the rig's hover-capable renderer; the REVEAL is the sibling below, and the caption/actions/stamp boxes are identical between the two |
| `compacted-run-hover/` | the same state, pointer on the answer | pointer | the reveal: the buttons arrive at the right cluster and NOTHING moves — every box is identical to the idle reading above |
| `narrow/` | 420px, `isSmallView` | **hover-less** | one line, buttons intact, no wrap, focus reachable |
| `user-row/` | the USER turn's own row (design round 1, D2) | host | `Copy`, and `Fork from this message` since the fold brought #739's control to the row, mounted under the bubble: the reveal box is at rest, so the frame is the bubble and the row's own box |
| `user-row-hover/` | the same, pointer on that row's Copy | pointer | the reveal, with the row's right edge on the bubble's |
| `user-row-small/` + `user-row-small-hover/` | the same pair at 420 | host / pointer | the same shape where the content rail is 32 rather than 107 |
| `compacted-run-small/` | `compacted-run` at 420 | host | the caption's rail at `isSmallView` — no frame had a caption at this width before (design round 1, D2) |

**The `arm` column is the rig's own declaration, one state at a time** (design round
5, D5/D6: "one arm per shot, every state restating its arm"). **hover-less** is
`touch: true` (`Emulation.setTouchEmulationEnabled` in the loop) — the row is
visible with no pointer in the frame, which is what a *resting* state is for, and
each of those nine entries now carries `expectPresent: '[data-lo-answer-actions]'`
so a shutter that finds no row on that line FAILS the run rather than filing a
frame that cannot show what it exists to show. **pointer** is a real pointer, Tab
walk or press, and needs a hover-capable renderer to mean anything. **host** is
the four entries that declare no arm (they were added before the rule and their
pairs straddle it): the rig's renderer decides, and on this rig that is
hover-capable, so their row is present but unpainted at rest and the *reveal* is
the sibling frame — which is why the table names the sibling rather than claiming
a row on screen it does not paint. Before round 5 this set shipped seven of its
nine hover-less states from a generation where the arm was not yet set, so the
claim above was carried by `rest/` alone while the other seven showed a closing
line whose only ink was the stamp; the whole set was re-shot at the head this
record describes, and that is the difference the frames now show.

Six themes, chosen by the memo's logic rather than by taste: `localOperatorLight`
and `localOperatorDark` (the brand), `sage` and `catppuccinMacchiato` (the two
smallest ground steps in the fleet — ΔE00 2.05 and 2.08 against the contract's
4.0 floor for a findable surface, where a wash that vanishes matters most),
`obsidian` (the lowest canvas, L\* 12) and `radient` (ΔE00 6.76, the widest step,
which must **not** move). The other 53 palettes are covered by
`pnpm check-themes`, which reads all of them.

## The measured rail (the memo's Q1), and the 2026-10-01 rearrangement

A still cannot settle an edge claim, so these numbers come from the rendered DOM:
`scripts/chat-alignment-geometry.mjs` gained this set's entries, an
`actions`/`line` measurement, a real pointer for the hover pass, and the fold
entries' own `line`/`lastRight` reading (that claim is the fold record's), and
the command is re-runnable.

```sh
node scripts/chat-alignment-geometry.mjs http://127.0.0.1:6077 --json
```

| story | prose.left | content.left (gutter) | caption.left (the rail) | actions.left | first button | stamp.left | line box | line height |
|---|---|---|---|---|---|---|---|---|
| `chat-canonical-message-actions--rest` | 107 | 107 (0px) | — | 694.8 | 694.8 | 794.8 | 107→917 | 28 |
| `chat-canonical-message-actions--bar-suppressed` | 107 | 107 (0px) | — | 825 | 825 | — | 107→917 | 28 |
| `chat-canonical-message-actions--compacted-run` | 107 | 107 (0px) | **107** | 694.6 | 694.6 | 794.6 | 107→917 | 28 |
| `chat-canonical-message-actions--compacted-run` (hover) | 107 | 107 (0px) | **107** | 694.6 | 694.6 | 794.6 | 107→917 | 28 |

**The user row and the small view (design round 1, D2), as numbers.** The probe
reads the user turn's own row now, and two 420px states:

| state | reading |
| --- | --- |
| `user-row/` @1024 | row `857 → 917`, first button `857`, buttons `2 [Copy, Fork from this message]`, bubble right `917`, delta **0** |
| `user-row-hover/` @1024 | the same boxes, the control revealed |
| `user-row-small/` @420 | row `328 → 388`, buttons `2 [Copy, Fork from this message]`, bubble right `388`, delta **0** |
| `user-row-small-hover/` @420 | the same boxes, the control revealed |
| `compacted-run-small/` @420 | caption left **32** (the `isSmallView` rail), actions `165.6`, line `32 → 388` (height 34.8) |

The user row's right edge is its bubble's, and the row carries `Copy` and
`Fork from this message` at both widths — **two** controls, which the table above
and the frames now agree on. The row was `Copy` alone when design round 1's R4
ruled its format correct as-is; the fork control joined it on `main` (#739) and
the fold re-shot these four states at that head, so this sentence and the probe's
`buttons 2` describe one tree (design round 5, D8c, caught them disagreeing). The
420 story had to
be BUILT for this: `isSmallView` is a prop the transcript is told about, not a
window width, so running the 1024px story at a 420px viewport photographs the wide
layout clipped (the probe showed the caption and the actions reporting their 1024px
boxes); `compacted-run-small` is the new story that paints it.

**Q1, answered and closed.** The shipped head paints NO agent glyph and no gutter:
`content.gutterPx` is **0** for every state, `MessageContainer` is `relative
w-full` for an agent row (its own header states D11 — the 40px gutter and the
avatar are deleted, and `message-avatar.tsx` has no importer), and the row is a
SIBLING of the answer's content box inside that container, so the caption's left
edge and the prose's left edge are the same 107px by construction rather than by
a second measurement. The comment on the foot-line region that named a `pl-10`
gutter — the stale claim the memo's D1 flagged — is corrected in this change
rather than left standing beside a frame that contradicts it. **The answer and
the ledger share the rail; the caption keeps it and the actions and the stamp
ride the line's far end.**

**THE REARRANGEMENT (operator direction, 2026-10-01).** The operator's sentence —
"now that the action buttons only show up on hover, the Worked for and action
count looks a bit weird — rearrange so those are on the leftmost extent and the
action buttons are to the right" — is the change this pair photographs. Until it,
the ACTIONS took the line's left edge and the caption followed them: the buttons
are opacity-only-hidden at rest but hold their 60px box, so the caption read
indented by 68px of nothing, under prose it belongs to. Now the caption starts at
the content's own left edge and the right cluster is `[actions][stamp]` (stamp
rightmost, the shape every state already had), pushed by the actions' own
`ml-auto` wrapper.

| reading | before (`af6fffa899` + this set's story cell) | after (this branch) |
|---|---|---|
| caption.left (`compacted-run`) | **175** | **107** |
| actions.left (`compacted-run`) | 107 | 694.6 |
| stamp.left (`compacted-run`) | 794.5 | 794.6 |
| caption/actions/stamp, idle vs hovered | identical | **identical** |

**FOLDED ONTO `origin/main` = `9d9cd4be63` (76 commits), AND RE-SHOT WHOLE AT THAT
HEAD — after a first pass that got it wrong** (design round 5, D5–D8; agent review
R5-2/R5-4; QA Q-r5-1..Q-r5-3). The fold's one content conflict was
`canonical-transcript.tsx`: `main` had added the Fork point to the answer row
(#739 / #1002) while this branch held that row moved to the line's far end, so one
row per answer rides the right rail, with `main`'s `conversationId`/`entryId` on
THIS branch's instance.

The Fork control is a fact about the frames — the cluster is one control wider —
so the set was re-shot, and the first attempt is what those findings are about:
it ran `--only=` with **no** `--themes=`, which leaves the rig's DEFAULT twelve
palettes in place (four states went from six palettes to thirteen, and
`focus-copy/` stopped at eleven on a six-palette budget), and it left sixteen of
the twenty states untouched — seven of them still carrying the generation that
painted **no row at rest**, which is the one thing this set's own claim cannot
survive. It also never re-shot the four states that paint a row in a
pointer-capable arm besides the two it did (`copied/`, `compacted-run-hover/`,
`user-row-hover/`, `user-row-small-hover/`), so the set contradicted itself
state-to-state on the fact it exists to evidence.

**This head's frames are ONE shoot, at the command below, whole set.** Every state
is photographed under its declared arm — `touch: true` (the hover-less arm) for
the nine resting states, a real pointer for the interaction states — and the
rig's own `expectPresent: '[data-lo-answer-actions]'` is what makes a resting frame
with no row on screen fail the run rather than ship (the check whose absence let
the old generation's seven frames through). The palettes are the six the command
names, state by state: `scripts/check-evidence-palettes.mjs` asserts that budget
per directory and runs inside `pnpm test:desktop`, because a `--only=` run without
`--themes=` is exactly how the strays got committed in the first place.

The `-foot-before` sibling is deliberately NOT re-shot: it is the operator's
pre-change state on the cut point `af6fffa899`, where the row carried two
controls, and re-shooting it would destroy the comparison it exists to make.

**No layout shift on hover, and that is the numbers' claim rather than the
frames'.** `ACTION_ROW_REVEAL_CLASSES` is opacity-only, so the boxes above are
byte-equal between the idle and hovered readings of the same state (the
`compacted-run` pair in the table; the before column was measured the same way on
the pre-change tree and is equal too). The buttons' arrival is the only thing that
changes in `compacted-run-hover/`.

**Three buttons — Copy, Speak, and `Fork from this message` — and the count is the
probe's own output rather than this sentence's arithmetic:** `actions.buttons`
reads **3** on every entry above, and the user row's own row reads **2** (`Copy`,
`Fork from this message`). The fork control joined both rows on `main` (#739 /
#1002, the fork-from-this-message work) while this branch held the arrangement, so
the folded head re-measured every cell here: `size-7` (`icon-sm`) each with a 4px
gap, the toolbar now **92×28** (28×3 + 4×2) with its first button at 28×28, and
the cluster's left edge moving 32px left on exactly the states that paint it — the
answer's own rail (107) and stamp (794.6) are untouched, and so is the hover
proof below, because the box is what the reveal holds.

## The accepted cost, restated honestly

The closing line is **28px** tall where the `text-meta` line under an answer was
**17.4px** — the caption's own line box, measured on the same DOM — so a finished
turn grows by **+10.6px**, not the ~+20px the memo estimated. The `mt-1` (4px)
above it is unchanged and the answer itself never moves, because the line is
`mt-1` on the flex column rather than a reserved strip.

**And on a bar'd turn it is a line that was not there before**: when a run folds
into its bar the closing line is otherwise suppressed (`closingLineSuppressed`),
so those turns gain the actions' 28px line plus its 4px margin. That is the state
`bar-suppressed/` photographs; it is called out here rather than averaged into
the 10.6px above.

## The caption beside the actions: the shape that does paint it (operator direction, 2026-10-01)

Round 1 (design memo D1) ruled that the app cannot paint the memo's sketch — the
caption and the action row on ONE line — and this record used to explain why no
frame showed it. That finding was right about the states it looked at and wrong as
a general claim: there IS a shape that keeps the foot on a barred turn, and it is
the one the operator's report is photographed in (`compacted-run/`).

The chain, restated with its third case:

1. The caption's own gate is `foot.actions > 0` (`canonical-transcript.tsx`), and
   `foot.actions` counts a turn's **tool rows**. A turn with no calls has no
   numbers to state — `rest/` and `short-answer/` are those turns, and they paint
   **actions + stamp**.
2. A turn WITH a call always gives its run something to hide. `planRun`
   (`turn-collapse-model.ts`) builds `hidden` from every row between the opening
   user row and the closing answer that is not pinned, and
   `staysVisibleWhileCollapsed` is `true` for `compaction`, a complete `notice`
   and an error `custom` — never for a `tool` row. `collapses` is
   `hidden.length > 0 && … && !live`, so one call is enough.
3. **A collapsed run withholds the caption and the stamp from the closing line —
   but only while its hidden span is ONE pre-answer segment.** The model sets a
   segment's `stampTs` — the turn's instant, which its bar paints and which is
   what suppresses the closing line's own foot — **only when that segment is the
   run's sole pre-answer segment**: the shape where the bar's totals ARE the
   turn's totals. A run whose span partitions into two or more segments (a pinned
   statement between its calls: the `compaction` row here, a complete notice or
   an error `custom` in the same class) leaves every segment without the stamp,
   so `closingLineSuppressed` stays false and the closing line keeps its foot —
   it is where the turn's totals and instant go when the bars state only parts.

So the line has three shapes, one per state: **actions + stamp** (`rest/`,
`short-answer/` — no calls), **actions alone** (`bar-suppressed/`,
`one-call-turn/` — one hidden segment, the bar states the numbers), and
**caption + actions + stamp** (`compacted-run/` — the run split around a pinned
row, the shape the operator's report is about). `one-call-turn/` is the tightest
rendering of the second: one call is the smallest count that makes the turn
foldable, and the frame shows the bar reading `1 action` while the closing line
carries the row with no caption beside it. `hover-answer-no-corner-control/` and
`bar-suppressed/` are the same fact seen from the other two angles. The design
round should judge the row against those frames, not against the sketch.

## The Speak arm this set does not photograph (design round 1, D3)

The frames show Speak **disabled**, with its reason in the tooltip: the story
renders `frontend={null}`, and the button's gate is the Radix credential probe
(`useRadientCredentialProbe`) — a react-query read against the local API that a
static fixture cannot satisfy. Photographing the ENABLED arm would mean stubbing
that provider inside the story, which is new machinery in the render path the
frames are supposed to be evidence about, so the enabled arm is asserted instead
and this is where it is recorded: `scripts/message-actions.test.mjs` mounts the
real row with the probe answering "configured", asserts the button is enabled,
and asserts the press reaches the speech store keyed by THIS answer with the
visible text. The busy/playing swap is asserted there too (`Stop`, same node,
focus kept). Nothing in this set claims otherwise.

## How they were taken

```sh
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-canonical-message-actions-- \
  --themes=localOperatorLight,localOperatorDark,sage,catppuccinMacchiato,obsidian,radient \
  --allow-backend --theme-settle-ms=180000
```

Storybook 8.6.12 on the shipped `.storybook/main.ts` (which sets
`reactDocgen: "react-docgen"`; the stale paragraph in `capture-evidence.mjs`'s
header that told a capturer to override it is corrected in this change), headless
Chrome as the rig always runs it. The entries are narrowed with `--only=` and a
trailing `--` so the pre-change set beside them (`chat-canonical-message-actions-
before--…`, whose ids also contain the prefix) is never touched by this run.

`--allow-backend` because the operator's live daemon answers on :1111 and must not
be stopped for a capture, and every story here is a static fixture
(`frontend={null} gate={null}`) that never contacts it. `--theme-settle-ms`
because this host is loaded and the guard's 10s default does not fit it. The
hover, focus and press entries are real input through the input pipeline —
`hover` moves a pointer, `tabTo` presses real Tabs until the Copy button holds
focus, `press` is a real press — because a class that faked either state would
photograph the story.

**Re-taken WHOLE on the folded tree (2026-10-01).** The branch folded
`origin/main` = `0d4db85a5e` (29 commits) and the set was re-captured in one pass
on the folded tree — **fifteen states × six themes, 90 frames** — because this
change moves the line every state paints. All 78 frames the set shipped were
rewritten: the committed ones predate the at-rest reveal (the controls were
faintly painted in that capture and hold their box invisibly now) and this change
moved that box to the line's far end; `rest/` after the round-1 Speak/Stop swap
had already been re-checked byte-identical once, and this pass moves it because
the box moved. The two states this change adds — `compacted-run/`,
`compacted-run-hover/` — are new frames, and their half of the pair is the sibling
`../chat-canonical-message-actions-foot-before/`, whose README states which states
it carries and why.

**And five more states, for design round 1's D2** (`user-row/`, `user-row-hover/`,
`user-row-small/`, `user-row-small-hover/`, `compacted-run-small/`), which is what
takes this set to **twenty states and 120 frames**. They are captures rather than
re-shoots: nothing in that round moves the pixels the existing fifteen paint (the
round's spot-check of `rest/` and `compacted-run/` in all six themes came back
byte-identical, `compare -metric AE` = 0 on twelve frames).

**The earlier re-verify note is superseded.** Round 1's pass re-captured the same
set on its own fold (`origin/main` = `9dd18ab318`) and every frame came back
byte-identical except the `streaming/` working line's animated mark — 19 pixels in
a 4x12 box against 16 pixels in the same box between two captures of the SAME
tree, so that difference was the mark's phase rather than the tree. That finding
still holds for what it measured; it is not a claim about the tree this change
ships, and the frames above are the ones this change's code paints.

**The fold-header correction did not move this set (spot-checked).** The same pass
that shipped these frames also corrected the fold header's yield factors (it is
`chat-trace-fold/`'s claim, and its record is there). None of these states renders
a trace fold, so the correction cannot move them — checked rather than assumed:
`rest/`, `compacted-run/` and `compacted-run-hover/` were re-captured at the
corrected head in all six themes (**18 frames**) and came back byte-identical but
for `rest/sage`'s 73 pixels (0.0001 of the frame, the environmental encode the
`images-many-hover` cells show too).

## What this set is NOT

Component-level frames from Storybook, not the whole app: no sidebar and no
composer are in them. It carries **no frame of the dead component** — the memo
rules that out, and the superseded top-right hover pattern is named in prose in
`hover-answer-no-corner-control/`'s own entry rather than photographed. These
frames contain no data from any machine.
