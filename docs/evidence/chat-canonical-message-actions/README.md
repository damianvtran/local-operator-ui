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
rest** — in the arm the resting states are captured under, declared immediately
below — so every state below is photographed with no pointer in the frame unless
the state IS the pointer.

**THE ARM, DECLARED (design round 1 D2, round 2 D1): the nine resting states
ship in the HOVER-LESS arm (`touch: true` — `Emulation.setTouchEmulationEnabled`
in the rig); the four interaction states ship in a hover-capable one.** Which arm
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

## What is in it

| directory | state | what it is for |
|---|---|---|
| `rest/` | a settled answer, no pointer | the discoverability claim itself |
| `hover-answer-no-corner-control/` | the pointer parked on the answer | the superseded pattern's own region, with `expectPresent: '[data-lo-answer-actions]'` and `expectGone: '[data-lo-link-toolbar]'` asserted |
| `hover-copy/` | the pointer on Copy | the hover step: `accent-wash` ground, `accent` ink |
| `focus-copy/` | Tab-reached Copy, real presses | the focus ring, and the "Copy" tooltip |
| `copied/` | Copy pressed | the tick and the `Copied` name, asserted by `expectAttribute` |
| `short-answer/` | a one-line answer | the row must not read as a second sentence |
| `refused/` | a refusal | the row is present; the danger ink stays on the prose |
| `truncated/` | a partly-received answer | the caption above, the row below |
| `streaming/` | a settled turn beside an in-flight one | the row on the settled answer, and NONE on the in-flight turn's rows |
| `multi-answer/` | two settled answers in one turn | exactly one row, on the closing answer |
| `bar-suppressed/` | a turn folded into its bar | the actions still on the line, the bar keeping its numbers and stamp |
| `one-call-turn/` | the minimum action count: one call, settled | where the caption would sit if the line could carry it beside the actions — it cannot, and the bar above states `1 action` instead (D1) |
| `narrow/` | 420px, `isSmallView` | one line, buttons intact, no wrap, focus reachable |

Six themes, chosen by the memo's logic rather than by taste: `localOperatorLight`
and `localOperatorDark` (the brand), `sage` and `catppuccinMacchiato` (the two
smallest ground steps in the fleet — ΔE00 2.05 and 2.08 against the contract's
4.0 floor for a findable surface, where a wash that vanishes matters most),
`obsidian` (the lowest canvas, L\* 12) and `radient` (ΔE00 6.76, the widest step,
which must **not** move). The other 53 palettes are covered by
`pnpm check-themes`, which reads all of them.

## The measured rail (the memo's Q1)

A still cannot settle an edge claim, so these numbers come from the rendered DOM:
`scripts/chat-alignment-geometry.mjs` gained this set's two entries and an
`actions`/`line` measurement, and the command is re-runnable.

```sh
node scripts/chat-alignment-geometry.mjs http://127.0.0.1:6077 --json
```

| story | prose.left | content.left (gutter) | toolbar.left | first button | railDelta | line box | line height | meta span | stamp.left |
|---|---|---|---|---|---|---|---|---|---|
| `chat-canonical-message-actions--rest` | 107 | 107 (0px) | 107 | 107 | **0** | 107→917 | 28 | 17.4 | 794.7 |
| `chat-canonical-message-actions--bar-suppressed` | 107 | 107 (0px) | 107 | 107 | **0** | 107→917 | 28 | — | — |

**Q1, answered and closed.** The shipped head paints NO agent glyph and no gutter:
`content.gutterPx` is **0** for both states, `MessageContainer` is `relative
w-full` for an agent row (its own header states D11 — the 40px gutter and the
avatar are deleted, and `message-avatar.tsx` has no importer), and the row is a
SIBLING of the answer's content box inside that container, so toolbar.left and
the prose's left edge are the same 107px by construction rather than by a second
measurement. The comment on the foot-line region that named a `pl-10` gutter —
the stale claim the memo's D1 flagged — is corrected in this change rather than
left standing beside a frame that contradicts it. **The answer and the ledger
share the rail; the caption follows the actions on the same line when there is
one.**

Three buttons, `size-7` (`icon-sm`) each with a 4px gap: the toolbar measures
**92×28** (28×3 + 4×2, and `actions.buttons` reads 3 on both entries — the
number in the geometry probe's own output, not arithmetic done here), its first
button 28×28, and the pitch between buttons is 32px. Re-measured after #1002's
Fork joined the row; the row and the line keep their rail and their 28px.

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

## The caption beside the actions: why no frame shows it (design round 1, D1)

The memo's sketch puts the actions on the same line as `Worked for 1m 12s · 8
actions`. The app cannot paint that composition, and the reason is structural
rather than rare — a chain worth stating in full, because "the sketch's shape is
missing" is otherwise indistinguishable from "nobody captured it":

1. The caption's own gate is `foot.actions > 0` (`canonical-transcript.tsx`),
   and `foot.actions` counts a turn's **tool rows**. A turn with no calls has no
   numbers to state, so the caption is absent by that gate — `rest/` and
   `short-answer/` are exactly those turns, and they paint **actions + stamp**.
2. A turn WITH a call always gives its run something to hide. `planRun`
   (`turn-collapse-model.ts`) builds `hidden` from every row between the opening
   user row and the closing answer that is not pinned, and
   `staysVisibleWhileCollapsed` is `true` for `compaction`, a complete `notice`
   and an error `custom` — **never for a `tool` row**. `collapses` is
   `hidden.length > 0 && … && !live`, so one call is enough.
3. A collapsed run withholds the caption AND the stamp from the closing line:
   `suppressClosingLine` reaches the row as `closingLineSuppressed`, the caller
   hands `foot: null` for those turns, and the bar states the numbers and the
   stamp instead (`TurnSummary`).

So the two halves of the line that do exist are **actions + stamp** (no calls)
and **actions alone** (calls, bar above). `one-call-turn/` is the tightest
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

TWO RUNS, because the set ships TWO ARMS and the arm is a property of the
renderer rather than of the story (see *The arm, declared* above):

```sh
# The nine RESTING states, in the hover-less arm: `touch: true` on those entries,
# which is how the row is on screen at rest.
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-canonical-message-actions-- \
  --dirs=rest,short-answer,refused,truncated,streaming,multi-answer,bar-suppressed,one-call-turn,narrow \
  --themes=localOperatorLight,localOperatorDark,sage,catppuccinMacchiato,obsidian,radient \
  --allow-backend --theme-settle-ms=180000

# The four INTERACTION states, in a hover-capable arm: a real pointer moves
# (`hover`), real Tabs are pressed (`tabTo`), a real press (`press`).
node scripts/capture-evidence.mjs http://127.0.0.1:6077 \
  --only=chat-canonical-message-actions-- \
  --dirs=hover-answer-no-corner-control,hover-copy,focus-copy,copied \
  --themes=localOperatorLight,localOperatorDark,sage,catppuccinMacchiato,obsidian,radient \
  --allow-backend --theme-settle-ms=180000
```

Both runs write the same directory; the split is by `--dirs=`, and no entry's
arm can be set by the environment: the rig sends the touch emulation for every
entry, on or off. The interaction states must stay hover-capable rather than
merely preferring it — Tailwind's `hover:` variant is gated on `hover: hover`,
so under the resting arm's own emulation the hover ground could not paint at all.

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

**Re-verified on the fold, not re-shot.** The whole set was re-captured on the
folded tree (`origin/main` = `9dd18ab318`, which moved `canonical-transcript.tsx`,
`transcript-reducer.ts` and the scroll pager under this branch) and every frame
came back byte-identical except the `streaming/` working line's animated mark —
19 pixels in a 4x12 box, against 16 pixels in the same box between two captures of
the SAME tree, so the difference is the mark's phase rather than the tree. **That
was the state before round 2 of #1002; the nine resting frames were re-shot since
(design round 2 D1 — see *The arm, declared*), so byte-identity with the previous
generation no longer holds for them.** The
committed frames are the ones this set shipped and they describe the folded tree.

**Thirteen states, 78 frames.** `one-call-turn/` was added in round 1 (D1) and its
six frames were taken on the fixed tree; the other twelve states were re-checked
against it rather than re-taken **in that round** — a re-capture of `rest/` then
came back **byte-identical** after the round's component change (the Speak/Stop
swap in `message-actions-row.tsx`), which was that round's claim that the change
moves nothing at rest. **That is round 1's record, not this set's present state**:
the nine resting states were re-shot in round 2 (D1) under the hover-less arm, so
none of them is byte-identical to the round-1 generation any more.

## What this set is NOT

Component-level frames from Storybook, not the whole app: no sidebar and no
composer are in them. It carries **no frame of the dead component** — the memo
rules that out, and the superseded top-right hover pattern is named in prose in
`hover-answer-no-corner-control/`'s own entry rather than photographed. These
frames contain no data from any machine.
