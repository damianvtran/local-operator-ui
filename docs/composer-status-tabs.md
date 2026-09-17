# Composer status tabs — the goal and the plan, above the composer

A compact, expandable status line above the composer: the session's standing
goal, and the size of the run's plan with a way through to it. Plus one glyph
change on the run pane's header trigger.

Design record, in the sense `docs/run-sidebar.md` and `docs/run-details.md` use
the word: every claim attributed to a file:line or to a measurement, every
decision carrying its reason, and the alternatives that lost recorded rather
than deleted. Where this document disagrees with those two, this one is newer
and says why; where it disagrees with `docs/branding.md`, the branding contract
wins and this document is wrong.

**Status: spec, then implementation, then revised against it.** The row is
shipped (PR #175) and this document was corrected in that PR's remediation round
to describe what shipped rather than what was planned - each correction carries
the measurement or the review finding that made it, and the divergences the
implementation took deliberately are folded in rather than left to be
rediscovered. The places that moved: `§ 2.3`/`§ 3.1` (the chip's height and the
plan's gate), `§ 2.4`/`§ 4.4` (the column floor's real width and the body's cap),
`§ 4.1`/`§ 4.2` (the measured class overrides and the floor's label), `§ 5.1`
(the count's visible affordance mark) and `§ 9.1` (what was actually captured).

**Status: the clear/stop change, added at the end.** `§ 12` and `§ 13` are the
dismiss affordance and the sixth chip (the session's loop), added after the row
shipped; `§ 3.1`, `§ 7`, `§ 8`, `§ 9.1` and `§ 10` carry the amendments they owe
those two sections, and `§ 14` is the list of what they do not settle. Nothing
above them was re-argued: where an earlier decision is touched, the section says
which one and why.

---

## 0. The ask, and the reference the operator named

Three asks, in the operator's words:

1. "Add small expandable tabs above the composer to show the current goal if
   there is one (show goal and a small snippet above the composer in one line),
   todos, etc." — reviewing how Codex does it, "where if there are todos or if
   there is a goal, there's a short preview above the composer that doesn't take
   up much vertical space and you can click it to expand and see."
2. "For the todos, it should indicate that there are todos, how many, and
   clicking would open the sidebar to show them in detail (helps to guide the
   user to the sidebar and show that this exists)."
3. The run pane's header icon: "the heartbeat icon isn't the best given what is
   currently in there, probably an info-related icon might be better."

**The reference, and what can and cannot be verified about it.** `openai/codex`
issue #11752 ("Todo list above the input line", opened 2026-02-13, closed
2026-04-03 for lack of upvotes) is a CLI user asking for exactly this
placement, and his own problem statement is the shape to copy: *"Id like 'Plan
list | Todo list' to always be above the input line, and not get lost in the
history… With each new message, such as 'updated plan,' the block moves up and
gets lost, leaving you confused about where you left off and returned to,
making it difficult to tell what stage of execution it is. This is already
implemented in the VSC Extension—the todo list always appears above the input
block."* Three things are settled by that thread and only by it: the problem is
the plan scrolling away with the transcript; the extension is the existing
implementation of the fix; and the request itself will not ship in the CLI, so
the extension is the reference rather than a stopgap. Fetched for this document:
`learn.chatgpt.com/docs/codex/ide` (2026-09-14) does **not** describe a plan
preview at all — the extension's behaviour is cited here from the issue thread
and from the operator's own observation of it, and the frames for *this* app are
the evidence for this app. What is taken from the reference is its **shape**:
pinned in place, compact when collapsed, expandable where it sits. What is not
taken is its content model: the issue's own reason is seeing "which point of the
plan the model is currently executing", and this row states the plan's size and
hands the current point to the pane instead (§ 5.1).

---

## 1. The preceding decision this must not re-open

`docs/run-sidebar.md` § 3.1 (line 193) rejected option **B, "a dock band above
the composer, mirroring the TUI"**, for three reasons: it "reclaims transcript
height on every turn"; it "forces one placement for two surfaces with different
lifetimes"; and "a child reader cannot live in a band."

That rejection is about the **run pane** living above the composer, and it
stands. The row specified here is not that band, and the difference is the thing
to hold on to:

| | The rejected dock band | This row |
|---|---|---|
| What it holds | the roster, the plan, the MCP servers, a child reader | two controls and one line of prose |
| Scroll region | its own | none |
| Lifetime | the whole pane's | the goal's and the plan's |
| Height, collapsed | unbounded (content-driven) | **32px**, fixed |
| Height, worst case | the pane's content | 168px, and only while the goal is expanded |

The test to apply to any future amendment: if it needs a scroller, a row per
child, or a reader, it has become the band and `§ 3.1 B` applies again.

---

## 2. Placement and vertical cost

### 2.1 Where it sits

The row is the composer band's **first child**, inside `message-input.tsx`'s
`inputContent` form (`message-input.tsx:988`), immediately above the send-error
alert (`message-input.tsx:1020-1026`) and therefore above the composer box
(`message-input.tsx:1249-1258`).

```
message-input's form
├── ComposerStatusRow            <- NEW: CHAT_MEASURE + the box's own horizontal inset
│   ├── the goal disclosure      <- chevron + "Goal:" + a one-line snippet; expands in place
│   └── the plan count           <- "4 to-dos open"; opens the pane at the plan
├── role="alert" (send error)    <- existing, unchanged
└── COMPOSER_BOX                 <- the textarea, then the button row (which holds the readings)
```

**Outside the composer box, not inside it, and that is the alert's own argument
rather than a new one.** `message-input.tsx:1008-1013` records why the send-error
alert sits above the box: *"the composer box is one control with one focus ring
(`COMPOSER_BOX`), and folding an alert into it would put non-interactive prose
and two extra buttons inside the thing that ring frames."* This row is
non-interactive prose (the goal body) plus two controls. Same argument, same
placement, same shared `CHAT_MEASURE` so the two read as one unit
(`message-input.tsx:996-998`).

Second reason, and it is checkable: keeping the row out of the box leaves the
composer box's own geometry untouched. The box measures **111.7px** at a 900px
box and **143.5px** at the 220px column floor
(`docs/evidence/composer-readings/after/numbers.json`, `populated-900` and
`populated-220-canvas`), and the frames for this change assert that those two
numbers do not move — the box only *shifts up* by the row's height.

**Above the alert, not between the alert and the box.** The alert is a failure
that points at the composer, and its docblock's "reads as one unit" claim is
about the box↔alert adjacency; the row is persistent ambient context, so it goes
outboard of a transient one. Band order, top to bottom: row, alert, box.

### 2.2 The row's own box

```ts
cn(CHAT_MEASURE, "flex items-start gap-x-2 gap-y-0.5",
   isSmallView ? "px-2 pb-1" : "px-4 pb-2")
```

- `CHAT_MEASURE` and the `p-4` / `p-2` horizontal step are **the alert's own**
  (`message-input.tsx:1021-1026`), and for its reason
  (`message-input.tsx:1008-1011`): the two "above the box" lines share one outer
  edge, measured in the frames at the box's own left edge plus its padding.
- `pb-2` / `pb-1` is the row's gap to whatever follows it, and it follows the
  alert's because the container owns no gap here: the form is a bare
  `className="w-full"` (`message-input.tsx:988`) and the alert carries its own
  `pb-2`.
- **The first chip carries `-ml-1.5`.** The readings cluster does the same
  thing, at `session-status-strip.tsx:521-525`: *"`-mx-1.5` cancels the readings'
  own inner padding so the strip's text aligns with the composer's text rather
  than sitting 6px in. The padding has to be on the readings themselves, because
  it is what gives their hover fill a body to be."* Measured in the 220px floor
  frame: the box is at `x=524`, the box's content edge is `533` (524 + the 1px
  `border-control` + `p-2`), and the first reading's **text** lands on 533
  because of that −6px (`numbers.json`, `populated-220`: `stripBox.x = 527`,
  `readings[0].box.x = 527`, `marginLeft: "-6px"`). The same device here puts the
  goal chip's text on the row's content edge, which is where the alert's first
  character already sits.

### 2.3 Vertical cost, in the numbers the frames already carry

| | Height | The number it changes |
|---|---|---|
| Collapsed row, one line | **24px** — the readings' own box height (`session-status-strip.tsx:156`, `h-6`). The disclosure's own `min-h-6` (`disclosure.tsx:111`) is a FLOOR rather than a height, so the chip pins `h-6 py-0` to land on the same 24px: measured without it, that box is 25.7px beside the plan chip's 24px (§ 4.1) | — |
| + its `pb-2` / `pb-1` | **8px** / 4px | — |
| **Collapsed, one line** | **32px** (28px under `isSmallView`) | above 750px of column the band goes 111.7 → **143.7px**; in the 240-750px band 143.5 → **171.5px** (the box is already two lines there) |
| **Collapsed, stacked** (at or below 240px of column, § 2.4) | 24 + 2 + 24 + 4 = **54px** | at the 220px floor 143.5 → **197.5px** |
| Expanded, worst case | 24 + 4 (`mt-1`) + 120 (body cap) + 4 (`pb-1`) + 8 = **160px** | band 111.7 → 271.7px, only while the goal is expanded. The cap is 120px rather than 128px since design review round 1 (D2) - see § 4.4 |

Why 24px and not less: it is the smallest box on this composer's own ramp that
still holds a 12px glyph and a `text-meta` label — the readings' box
(`session-status-strip.tsx:142-162`) and the disclosure's own `min-h-6`
(`disclosure.tsx:111`) both land there. Going below it means either an
off-ramp height or a glyph at the size `branding.md` § 5 says is where "one pen
bottoms out" (12px, itself the floor).

What the 32px costs, stated rather than buried: the transcript above loses 32px
of height in every session that has a goal or a plan. That is the operator's
explicit trade ("doesn't take up much vertical space" — 24px of content is one
line of `body-sm`), and it is why the row renders **nothing at all** when there
is no goal and no plan: no 24px, no 8px gap, no band change from 111.7px
(`§ 3.1`).

### 2.4 The column floor, and a short window

**The floor is 172px, not 220px.** The app's chat column measures **172px** with
the canvas pane holding the right slot (QA round 1, driven on the built app at
1380x600 and 1380x900); 220px was this document's assumption and the app never
renders it. Every number below is restated at the real width, and the frames that
prove them render at 172px with the small-view step the app takes there (design
review round 1, D3: before that correction the frames pinned the large-view inset
at a width where the product renders small view, so the set certified 58px of
collapsed height and a 168px body against the product's 54px and a 120px-capped
body).

At that column the composer band is narrow, so the row's arrangement changes:

- **Above 240px of column: one line.** `CHAT_CHIP_ICON_ONLY_PX`
  (`chat-measure.ts:80`) is 240, the composer's own "the chrome cannot share the
  row" number, measured for the working-directory chip at the same width. The
  row reuses it rather than adding a second threshold for the same moment.
- **At or below 240px of column: the row becomes a column** — the goal chip on
  its own line, the count below it, the expanded body between them (the body
  renders inside the goal's item, so in a column it takes the row's full width).

The reason for the switch is the *expanded* body, not the collapsed row: see
§ 4.4. Its cost is 26px of collapsed height, and it is paid only in the width
band where the readings cluster already folds onto two lines of its own —
measured 50px at the narrow column (`numbers.json`, `populated-220`:
`stripBox.h = 50`, `row.h = 90`), which is the same `24 + 2 + 24` the stacked row
produces here. Measured at the app's own floor the stacked row is **54px** with
the small-view `pb-1`, and 58px with the large-view `pb-2` this document's
arithmetic used - the 4px the D3 correction removed. At that width the composer's chrome wraps; that is the app's
existing behaviour, not a new one.

**A short window.** The row bounds itself, which is this composer's own rule:
*"each growable part of the composer caps itself and scrolls internally, so no
wrapper has to clip on behalf of its children"* (`message-input.tsx:1300-1308`,
the attachments block's `max-h-[240px]`). The collapsed row is a fixed 24px; the
body caps at 120px and scrolls; so the row's own growth is bounded at 160px and
no ancestor acquires a scroller to hold it.

**Acceptance test for all of the above**, in the frames rather than by
inspection: `boxOverflowX === 0` and `row.overflowX === 0` at every captured
width, and the box's `h` unchanged at 111.7 / 143.5px with its `y` moved up by
the row's measured height. The composer-readings rig already reports both fields
per frame — `row-frames.mjs` (gitignored, under `out/evidence-harness/`) writes
`numbers.json` from the live DOM, and `boxOverflowX`, `row.overflowX`, `box.h`
and `box.y` are four of its keys.

---

## 3. States

### 3.1 The matrix

| Goal | Plan | What renders | Height |
|---|---|---|---|
| absent (`goal.trim() === ""`) | none (`RunDetails.totalTodos === 0`) | **nothing** — the component returns `null` | 0px |
| present | none | the goal chip alone | 24px + gap |
| absent | present | the plan count alone, at the row's start | 24px + gap |
| present | present | goal chip first, count second | 24px + gap |
| present, expanded | either | the chips' line, plus the goal's body beneath | up to 160px |
| any of the above | any | **plus up to three COUNT chips**, after the plan chip: wakes, then subagents and jobs (`docs/composer-wakes.md`, `docs/composer-activity-chips.md`) | see below |
| any of the above | any | **plus the LOOP chip** when `frontend.loop.status !== "idle"`, and a trailing DISMISS control on the goal and on the loop (§ 12-13) | see below |

The activity chips are the row's second change, and they are the reason the last
row of that table can no longer be described as "24px + gap" in the general case:
four chips do not share a line at any column the app renders, so the row WRAPS.
The wake chip is the third change and changes none of that — it is a fourth count,
it is gated the same way, and it only moves the width at which the group wraps.
Measured on the frames (`docs/evidence/chat-composer-status-row/activity-widths/`,
which prints its own numbers into the picture):

| Column | Chips rendered | Row height | `overflowX` |
|---|---|---|---|
| 900px (the app's own column) | 4, one line | 32px | 0 |
| 240px (`CHAT_CHIP_ICON_ONLY_PX`) | 4, wrapped | 106px | 0 |
| 172px (the app's floor with the canvas open) | 4, stacked | 106px | 0 |

The 240px row read 80px until round 2 (m1) and that number was superseded by the
chip group: the pre-group arrangement shared line 1 with one count chip and put the
other two below, so it was one line shorter and the goal was truncated harder
(`Goal: Rec…` against today's `Goal: Reconcile the March i…`).
`docs/composer-activity-chips.md` § 7 owns that correction and the comparison;
the frames' own captions in `activity-widths/` are where both numbers are read
from.

That height is the cost this row accepts rather than hides, and it is the same
cost § 2.3 already records for the stacked arrangement, one chip further: the row
changes height when a chip appears, when a chip wraps, and when it stacks. What it
never does is paint past its column — the chips are `shrink-0` (§ 5.4's rule that a
bounded count is never cut) and the row is `flex-wrap` above the floor, with the
stacked arrangement turning wrap back OFF in its own query because a column
container wraps into COLUMNS, which is horizontal overflow.

**The plan's gate is the ITEM count (`totalTodos > 0`), and this table used to say
`details.todos.length === 0`.** `RunDetails.todos` holds PHASES, and the model
decodes a phase record with no items to a phase with no items, so the phase count
is non-zero for a session whose plan is one named empty phase - where the row
would state a finished plan over a plan that has no items at all (the settled
clause § 5.1 now fixes; `0 to-dos open` when this round ran, which read as a
finished plan too) (QA round 1, Q3,
driven: that checkpoint renders no row while the pane still shows `To-dos 0 of 0
closed · Foundation`). The item count is zero only when there is genuinely nothing
to be in the middle of. The pane's own section keeps gating on phases,
deliberately and for the opposite reason - it renders phase headers, so a named
empty phase is content for it (`run-details-panel.tsx`'s note at that gate).

At or below 240px of column every one of those rows is the stacked arrangement
(§ 2.4): 54px collapsed instead of 32px, and the count on the line below the
goal rather than at the row's right edge.

**The loop chip and the two dismiss controls move the WIDEST state to two lines,
and the measurement is the frame's own.** At 900px the six chips with both
dismiss boxes are `58px` tall rather than 32 — the goal item at 868px with its
89px dismiss plus the loop item plus the count group cannot share one 868px
content box — while every narrower band still reads `overflowX 0`
(`docs/evidence/composer-status-clear/`). The row's height has been allowed to
change since § 3.1 said so; what this change adds is one more reason it does.

- **"Renders nothing" is the state that most needs pinning**, because it is the
  one an editor breaks by accident: an empty row is still 32px of nothing above
  every composer in the app. It is asserted in the markup test (§ 9.3) and in a
  frame whose numbers must equal the pre-change frame's exactly.
- **The goal chip is gated on the value, not on the session**: the row reads
  `frontend.goal` off the same `sessionStatus.frontend` the readings strip
  already takes (`message-input.tsx:1467-1473`) and shows the chip only when
  `trim()` is non-empty. The wire's default is the empty string
  (`shared/desktop-session-contract.ts:262`), so a session with no goal, a fresh
  draft, and a legacy non-canonical chat all take the same branch — no special
  case for any of them.
- **The count chip is gated on `details` (the derived model) and on the plan
  being non-empty.** `RunDetails.todos` is the phase list the panel renders
  (`run-detail-model.ts:391`), and the model only exists when a canonical
  frontend does (`chat-page.tsx:241-249`), which is exactly the condition the
  pane mounts on (`chat-content.tsx:741`) and the trigger is visible under
  (`run-details-trigger.tsx:199`). A legacy chat grows no row, exactly as it
  grows no trigger.
- **Both chips are ordered goal-then-count** in the DOM, so the painted order and
  the tab order agree in both arrangements (§ 2.4) — the property UX round 1's
  U4 and round 2's U8 are about (`message-input.tsx:1438-1462`).

### 3.2 One derivation, not two

The count comes from the **same `RunDetails` object the pane and the trigger
read**, not from a second call to `deriveRunDetails`. That model's own docblock
fixes why: *"The counts are over the WHOLE wire lists, not the visible slice… one
list, so the three cannot disagree"* (`run-detail-model.ts:363-370`). So
`chat-page.tsx`'s memo (`:241-249`) — already threaded to `ChatContent`
(`chat-content.tsx:181`, `:289`) and from there to the pane (`:741-760`) and the
trigger (`:550`) — is threaded one step further to the composer, as a new
optional prop beside the existing `sessionStatus`
(`message-input.tsx:211-223`). Nothing in the row recomputes a tally, and the
row owns no arithmetic: it chooses which of the model's own functions to print.

### 3.3 Expansion state: local, per conversation, not persisted

- The goal's open state is the disclosure's own `useState`
  (`disclosure.tsx:113`), i.e. component state, and it **does not persist across
  restarts**. It is a disclosure, and `branding.md` § 7's rule is that
  disclosure content is "closed by default"; a persisted `expanded` would start
  every session with the goal's body open, which is the vertical cost the
  operator asked to avoid.
- It must **reset when the conversation changes**: a goal expanded in one
  conversation must not arrive expanded in the next. The composer is *not*
  remounted on a session switch today — `chat-content.tsx:620` passes
  `conversationId={agentId}` as a prop with no `key` — so the reset is explicit
  (key the row on the session id, or reset on it). This is a requirement of the
  spec, not an implementation detail: leaving it out is a bug a reviewer cannot
  see in a still.
- The count chip carries **no state**: it is not a toggle and it is not pressed
  (§ 5.2).

---

## 4. The goal chip

### 4.1 Structure, and the one contract point this row bends

The chip is the app's one disclosure idiom — `Disclosure`
(`@shared/components/ui/disclosure`), which `branding.md` § "Disclosure"
(line 482-493) requires be imported rather than reinvented:

```tsx
<Disclosure
  className="min-w-0 flex-1"
  rowClassName="h-6 rounded-sm px-1.5 py-0"              // see "Two measured overrides" below
  triggerClassName="w-fit max-w-full -ml-1.5 text-ink-muted hover:bg-accent-wash hover:text-ink focus-visible:outline-offset-1!"
  summary={…}   // chevron is the primitive's; the summary is "Goal:" + the snippet
/>
```

- `w-fit` on the trigger is what keeps the goal's **hover shape chip-sized**
  while its flex item takes the free space — that item's width is what the
  expanded body gets (§ 4.4), so the two requirements that usually fight
  (a chip-shaped hover, a full-width body) resolve together.

**Two measured overrides, both found in the frames rather than in review.** This
document prescribed the two class strings above without them, and a future agent
implementing § 4.1 as it used to read would reintroduce two defects this PR's
frames caught. Both are pinned byte-exact by `scripts/composer-tabs.test.mjs`,
because the numbers are the finding:

1. **`max-w-full` — `w-fit` alone does not clamp.** Measured in the live frames,
   Blink resolves `width: fit-content` on this button to its content's max-content
   width: 2026px inside an 868px item, so the chip painted over the plan count and
   past the column at every width, and the snippet's `truncate` never ran because
   there was nothing to truncate against. Clamped, the chip is 768px with the
   snippet truncating (clientWidth 698 against scrollWidth 1956), while a goal that
   FITS is unchanged at 257px — still chip-sized, which is what `w-fit` is for.
2. **`h-6 py-0` — the primitive's `min-h-6` is a floor, not a height.** With its
   `py-0.5` and a 12px label at its own line height the box measured **25.7px**
   beside the plan chip's **24px**: two chips of one species 1.7px apart on one
   line, which is a ragged baseline in the one row where they are meant to be
   identical. Pinned, both are 24px and the collapsed row is the 32px § 2.3
   states.
- `-ml-1.5` and `px-1.5` are § 2.2's alignment device, the readings' own.
- **The one contract point:** `triggerClassName` is documented as "Layout and
  hover ground only" (`disclosure.tsx:73-75`), and `hover:text-ink` plus the ink
  it beats is an **ink** override. It is taken anyway, for three reasons, and
  recorded rather than done quietly: (1) the row's two controls have to be one
  species — the alternative is a goal chip at the primitive's `text-ink-dim`
  beside a count chip at `text-ink-muted`, and in *this* row `ink-dim` is the
  role the readings use for a **readout that is not a control**
  (`session-status-strip.tsx:175`), so the user would read one of the two
  controls as inert; (2) `cn`'s last-wins makes it deterministic rather than
  incidental, which is the same mechanism the app's `Button` call sites already
  use to restate ink (e.g. the attach button,
  `message-input.tsx:1529`); (3) the cleaner fix — a prop for ink — is a
  change to a shared primitive's API for one call site, which is a bigger change
  than this row, and is deliberately not taken here.
- The chevron keeps the primitive's own `text-ink-disabled`
  (`disclosure.tsx:151`, `:165`) and is not overridable from the call site. That
  is the idiom's existing relationship (a chevron one step quieter than its
  label) and it is left alone; the signal that matters is its **shape**.

### 4.2 Collapsed: one line, and the exact truncation rule

Visible: `[chevron 14px] Goal: <snippet>`, one line, 24px tall.

| | Decision | Why |
|---|---|---|
| Label | `Goal:` | It is the picker's own field label (`destination-pickers.tsx:1287`). `Session goal` is the picker's *title* (`:1278`) and is used in the tooltip and the accessible name instead, where there is room for the disambiguating word; a 24px chip cannot carry it at the column floor. `The standing goal` (`:1281`) is prose and is not a label. |
| Separator | a colon, then the value | The working-directory chip's own shape: `Working directory:` + a truncating value in one box (`directory-indicator.tsx:618-624`), `aria-label` carrying the whole thing (`:608`). |
| Truncation | **CSS `truncate`** on the snippet span (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`) | There is no JS cell-measurement helper in this app, and none is wanted: the browser measures the real advance at the real font, size, zoom and theme, where a computed cell count is a guess that the TUI's `truncate_cells` could only make because a terminal cell is a fixed box. The app's own uses are the same mechanism: the plan row's text (`run-detail-todos.tsx:110-117`), the model reading's chip, the section tallies. |
| The rule that pairs with it | **an unbounded value may truncate only where its full text has a second home** | `session-status-strip.tsx:85-89`: *"Only the model name truncates, because it is the one item with unbounded length and the one whose full value the tooltip already carries… Truncating a value reading (`≥$0.0…`, `52.5%/40…`) would be a false or unverifiable claim, which § 8 forbids."* The goal is that same class of item, so the tooltip carries it in full (§ 4.3). |
| Newlines | collapsed by `white-space: nowrap` (a newline renders as a space), preserved verbatim in the expanded body (`§ 4.4`) | A one-line preview cannot show a line break; the full text is one click away and there it keeps the author's breaks. |
| Markup | rendered as **text**, never as markdown | The goal is authored in a plain `Textarea` (`destination-pickers.tsx:1287-1291`), so it is plain text. Rendering it as markdown would be a claim about the value the picker does not make. |
| The floor | the label stays **visible**, at every width | This used to go `sr-only` at the floor, on the reasoning that hiding it "is what lets the goal chip shrink to its chevron so the count is never squeezed". That reasoning does not hold in the arrangement the same rule is paired with: at the floor the row is a COLUMN, so the count has a line to itself with the whole width available — measured, a 92px chip in a 156px content box — and a word on the line above cannot squeeze it. What the hidden label did cost was the row's only identifying word: line one read `> Reconcile the March I…` with nothing saying what it was, one line above the user's composer (design review round 1, D4). The label is `shrink-0`, so it never deforms; the snippet yields first and the count is `shrink-0` and never cut, which is § 5.4's yield order stated the other way round. |

### 4.3 Copy

One derived string per state, used for **both** the tooltip and the
`aria-label`, so the two cannot drift — the pattern `runDetailTriggerLabel`
already sets (`run-detail-model.ts:2154-2182`, and the `trigger` renders
`content={label}` with `aria-label={label}`, `run-details-trigger.tsx:202-244`).

| State | Tooltip and accessible name |
|---|---|
| collapsed | `Expand the session goal — <the goal, in full>` |
| expanded | `Collapse the session goal — <the goal, in full>` |

- The action leads and the value follows, joined by the app's `LABEL_SEAM`
  (`run-detail-model.ts:198`) — the same grammar as `Open run details — 2
  subagents running`.
- The full value is in the tooltip **and** in the body. It is in the tooltip
  because the snippet truncates and § 4.2's rule requires the value to be
  readable somewhere before the click; it is in the body because the body's
  whole job is reading it. Neither is redundant: the tooltip is the hover/focus
  answer, the body is the read.
- `side="top"` explicitly. The band is against the window's bottom edge, so a
  downward tooltip has nowhere to go.

### 4.4 Expanded: the body

The disclosed body reuses the pane's own treatment for an authored instruction —
the child reader's brief block (`run-child-reader.tsx:216-221`, whose classes are
`max-h-48 overflow-auto font-sans text-body-sm leading-5 whitespace-pre-wrap
break-words text-ink-muted`):

| | Value | Why |
|---|---|---|
| Type and ink | `text-body-sm leading-5`, `text-ink-muted`, `font-sans` | The brief block's own roles, and `leading-5` is on the ramp where `body-sm`'s inherited 1.5 is not (`docs/run-details.md:454`). |
| Wrapping | `whitespace-pre-wrap break-words` | The goal is authored and may be a list; the break characters are the author's. Same as the brief. |
| Cap and scroll | **120px (six whole lines at `leading-5`)** + `overflow-y-auto`, shared with the send-error alert as `CAPPED_BLOCK` in `chat-measure.ts` | The app's rule is that a growable block caps itself (`message-input.tsx:1300-1308`). This was `max-h-32` (128px), which at this leading is six lines plus 8px of a seventh: the cap landed inside a line's glyphs and the paint was a row of letter TOPS under a complete line, which reads as a rendering accident rather than as "there is more" (design review round 1, D2, measured on the floor frame: ink at y458-460, 3px of the seventh line, immediately above the plan chip). 120px lands on a line boundary, so the last painted line is always a whole one. A FADE was the alternative and is rejected: the repo has the device (`picker-host.tsx`, `[mask-image:linear-gradient(...)]`) but applies it to regions that always overflow, and on a block that does NOT overflow a static mask would dim a two-line body's last line — a new defect for the old one. |
| Indent | the primitive's `ml-5` | One chevron column, which is the whole reason it exists (`disclosure.tsx:100-105`). |
| Keyboard | `tabIndex={0}`, `role="group"`, `aria-label="Session goal"` | The pane's own rule, read from the other side: its scroller deliberately has **no** tab stop *"because every row inside it is a real button, so the region is reachable and operable by keyboard through its own content"* (`run-panel.tsx:677-689`). This body has no focusable content, so the same rule says the region must carry one — a keyboard user cannot scroll a mouse-only scroller (WCAG 2.1.1; the `scrollable-region-focusable` check). The stop exists **only while the body is mounted**, i.e. only while the goal is expanded, so it never adds a stop to the ordinary composer. |
| Motion | none on open — content mounts, no height animation | The primitive's own decision (`disclosure.tsx:11-14`), and `branding.md` § 5 permits transform transitions for entrances only. |

**The body's width** is the goal item's width, which is the row's width minus
the count chip. Above 240px of column that is 750px+ at a 900px box. At the
column floor the row is a column (§ 2.4), so the body takes the row's own width:
at the app's 172px floor the row's content box is 156px (`172 − 2×8`), less the
primitive's 20px indent, i.e. **~128-136px of measure** — narrower than the
**≥160px** this document called the acceptance floor.

That floor was arithmetic at a 220px column (204 − 20 = 184px) and the app does
not render that column, so the ≥160px figure cannot be met at the real one by any
arrangement this design can reach: even § 10's option D, which lets the body span
the whole row, buys back only the indent and the count chip's line and tops out
around 156px. The honest statement is therefore that **the body's measure at the
column floor is what the app's floor allows, and the frame that proves it is
`column-floor` at 172px**; whether a ~128px measure is acceptable, or whether the
row should change shape at the floor (option D, or letting the body keep the row's
inset), is a design decision recorded in § 11.1 rather than a number this
document can assert.

---

## 5. The plan count chip

### 5.1 What it says, and which decoder says it

**One treatment for both chips**, taken from the readings' own control
(`session-status-strip.tsx:164-172`), because these are the same species of thing
in the same region: `h-6`, `rounded-sm`, `px-1.5`, `gap-1.5`, `text-meta`,
12px glyphs, `text-ink-muted` at rest, `hover:bg-accent-wash hover:text-ink`,
`transition-colors duration-fast ease-out-quart`, `cursor-pointer`,
`focus-visible:outline-offset-1!` — and **no fill and no border at rest**, which
is that box's own rule: *"Four bounded chips above the composer's own bounded box
is three boxes too many, so these read as text until you reach for one"*
(`session-status-strip.tsx:151-154`). This row has two chips over one bounded
box, so the rule applies with one fewer to spare.

Visible: **`[Info] 4 to-dos open`** — the run pane's own mark, then
`todoClause` (`run-detail-model.ts`), which is the app's one spelling of that
fact: it is the clause the run trigger's own tooltip already uses, behind that
label's own `openTodos > 0` guard (`run-detail-model.ts`'s `runDetailTriggerLabel`),
and its singular/plural grammar (`1 to-do open`) is stated once, for the reason
that model records for the sibling attention clause: *"Two copies of one rule is
how round 1's U1-7/Q7 happened… and nothing but review would have caught it"*.
Both citations name the symbol or the guard rather than a line: these numbers had
already drifted before this change, and the file they point into is edited often
enough that a number is a claim with no keeper (agent review round 1, minor 1).

**A settled plan stops spelling a count: `All to-dos resolved`, or `All to-dos
closed` where anything was dropped.** The chip used to print `0 to-dos open`,
which states the remainder and leaves the reader to do the subtraction that
turns it into a fact about the plan; on this row it read as the absence of a
plan rather than the end of one. That is the operator's follow-up rather than a
new design round, and it is the reason `todoClause` now takes the COUNTS rather
than a numeral: it reads `openTodos` and `droppedTodos` off one `RunDetails`, so
no caller can ask it to claim a clean finish without being handed the dropped
count that would contradict it.

The two settled spellings are separate on purpose. `resolved` is a claim about
work that got DONE, and a dropped item was abandoned rather than done, so a plan
that gave part of itself up reads as `closed` — the word `todoTally` already uses
for done plus dropped, and the word the TUI's `RESOLVED_STATUSES` stands behind.
The settled word is therefore scoped PER SURFACE, deliberately: this chip's
`resolved` is the strict subset where nothing was dropped, the pane's tally says
`closed` for both settled cases (`3 of 3 closed`), and the TUI prints `resolved`
for closure including dropped (`n/m resolved`, with the dropped count stated
beside it) — three surfaces, one fact, and no single word that is right on all
three, which is why the difference is recorded here rather than unified onto one
of them (design review round 1, D1).
One clause, one pluralisation, one settled pair; the chip's tooltip and
accessible name are built from that same function (§ 5.3), so the body and the
name cannot state the plan's ending two ways. The count forms — `1 to-do open`,
`4 to-dos open` — are unchanged, spelling and all. The trigger's own tooltip
keeps its guard and so keeps saying nothing about a settled plan: it answers
"is anything asking for something right now?", and the outcome is the chip's fact
rather than the toggle's (`docs/run-details.md` § 6.2).

**The mark is the run pane's own `Info`, leading the count**, and it was added in
design review round 1 (D1). Without it the chip was plain muted text in the same
ink as the goal's snippet, with the pointer cursor and the tooltip as its whole
affordance — neither of which exists in a still, and neither of which a reader
consults before pressing. At the floor it was worse than neutral: `3 to-dos open`
sat on the line under a truncated goal sentence, in the goal's ink, where it read
as the sentence's wrapped remainder, and `0 to-dos open` read as a completion
statement (the copy § 5.1 has since replaced). One glyph now means "this opens
the run pane" on both surfaces, since
the header trigger wears the same mark (§ 6.1). `size-3.5` is the disclosure
chevron's own size, so the two chips carry same-size marks and stay one species.

Rejected alternatives, all of them one line away: **the goal chip's chevron** —
the app's mark for "expands in place", and with both chips on one line it would
say the two controls do the same thing, which is the opposite of the distinction
D1 asks for; **`PanelRight`/`PanelRightClose`** — the pane's own chrome control,
and § 6.1 already refuses an open/close pair that differs by one small arrow with
both on screen at once; **`ArrowUpRight`/`ExternalLink`** — they mean leaving this
surface; **`ListChecks`** — the ledger's glyph for the todo TOOL
(`tool-glyphs.ts`), the collision § 6.1 refuses. The mark is `aria-hidden`: the
accessible name already states the action in words, so it is a decorative
repetition rather than a second label.

- **`todoClause` must be exported** (from `run-detail-model.ts` and the
  `run-details/index.ts` barrel, which already re-exports `todoTally`,
  `visibleTodoPhases` and the rest). It is module-private today. Exporting it is
  the smallest change that lets the chip say what the tooltip says.
- **No invented arithmetic.** The number is `details.openTodos`
  (`run-detail-model.ts:397`), computed as items whose status is pending or
  blocked (`:115-119`, `:971-973`) over the whole plan. The row does not count
  anything itself.
- **What it deliberately does not say.** Not the dropped breakdown, not a
  blocked count, not phases. The trough of a preview is one fact; the pane's
  header states `n of m closed · k dropped` in full
  (`run-detail-model.ts:1811-1843`, rendered at `run-detail-todos.tsx:183-190`)
  and the chip points at it.
- **A finished plan says `All to-dos resolved`, or `All to-dos closed` where
  anything was dropped, and still renders.** The clause stays rather than the
  chip vanishing, because the row's height must not change when the last item
  closes; the words are the model's settled pair (§ 5.1) rather than a count,
  and a plan that abandoned part of itself must not read as one that finished.
- **Rejected: `11 of 15 closed` (`todoTally`).** Three reasons, all checkable:
  it needs the plan named separately, because the phrase does not contain the
  word *to-dos* — the operator's ask 2 is explicit that the chip must say there
  are to-dos — and the 6 extra characters it costs are what the row cannot
  afford at the column floor (§ 5.4); it reports closure where a preview's
  question is what is outstanding; and the pane's count exists to keep a
  **hidden** phase accountable in the TUI (`docs/run-sidebar.md:178-182`), a job
  this panel does not have, which is why the section's tally carries it there.

### 5.2 What clicking does

**A reveal, not a toggle**, and this is the one place where the trigger's own
rule is deliberately not copied:

1. ensure the pane is open (`setRunPanelOpen(true)`); if the canvas holds the
   slot the store's own mutual exclusion clears it
   (`ui-preferences-store.ts:295-302`);
2. ensure the pane is showing the **list** — if a child reader is open, leave it
   (the plan is not on screen inside a reader: a reader replaces the panel body
   wholesale, `run-details-trigger.tsx:61-70`);
3. bring the **To-dos section into view** in the pane's scroll region;
4. **the pane does not take focus.** `docs/run-sidebar.md` § 9 (line 1317) fixes
   this: *"Focus does not move into the pane when it opens. Unlike the popover… a pane
   is part of the page."* The user pressing this chip is in the composer, usually
   mid-sentence; the app's caret guards exist to keep exactly that
   (`message-input.tsx`'s `composerPointerTouched`/`composerFocusIsOurs`), and a
   control that moved focus into another column would take the caret with it. The
   cost is recorded: a keyboard user who presses the chip stays on the chip, and
   reaches the pane by Tab as they already do from the header trigger.

   **What that does NOT say, and must not be read as saying** (QA round 1's
   observation): a genuine CLICK still focuses the pressed button, because that is
   the browser's own behaviour and not this control's decision — measured on the
   built app, `document.activeElement` after a real hit-tested click is
   `BUTTON[Open the wakes in run details — 8 wakes armed]`, so a reader mid-sentence
   who clicks the chip has moved their caret to the chip. It is identical for the
   three sibling count chips and for the pane's header trigger, so nothing here is
   a new behaviour to fix; what the rule above fixes is that the PANE takes no
   focus and no element is teleported. The two claims are separate: **the reveal
   moves nobody, and a click moves the caret to the button the reader clicked.**

**Why not a toggle, given the trigger is one.** The trigger is a toggle because
it is the pane's door — it has to close it too, and it has to be pressable while
the pane is open (`docs/run-sidebar.md` § 3.3, line 261-271). This chip names a
**destination inside** the pane, so its effect must not depend on hidden pane
state: a control that closes the pane when you press it expecting the plan is
the "one control, two meanings" defect this codebase's review history keeps
catching. It therefore carries no `aria-pressed` and no pressed ground, and two
presses are the same as none.

**The mechanism** (the smallest one that can express this): a transient,
consumed-once request in the store that already owns the pane's placement —
`ui-preferences-store.ts` holds `isRunPanelOpen` and its setter (`:72`, `:85`,
`:295`) — carrying a section name and a nonce (so two presses of the same
section both act), plus an effect in `RunPanel` that consumes it: clear a reader
if one is open, scroll the To-dos section's ref into view (`block: "start"`),
then clear the request. The reader's own state stays in the pane, where
`docs/run-sidebar.md` § 3.5 (line 367-376) requires it: *"a mode of a pane is
not a preference, and persisting one would restore a reader on a session whose
lineage it does not belong to."*

### 5.3 Copy

| | String |
|---|---|
| Visible, nothing open and nothing dropped | `All to-dos resolved` |
| Visible, nothing open with items dropped | `All to-dos closed` |
| Tooltip and accessible name | `Open the plan in run details — 4 to-dos open` |
| Tooltip and accessible name, nothing open | `Open the plan in run details — All to-dos resolved` (nothing dropped) / `Open the plan in run details — All to-dos closed` (anything dropped) |

- The settled rows are `todoClause`'s pair and not a second copy of them: the
  chip's body, its tooltip and its accessible name are all one call (§ 5.1).
- The action leads and the count follows, joined by `LABEL_SEAM`, so pressure
  could shed the way the trigger's label already does
  (`run-detail-model.ts:2207-2226`).
- **`run details` is the destination's own user-facing name**: it is the pane's
  `aria-label` (`run-panel.tsx:441`) and the trigger's verb phrase
  (`Open run details`, `run-detail-model.ts:188`). One place, one name.
- `Open the plan` rather than `Show the plan`: the app's controls use the
  imperative it uses elsewhere (`Open run details`, `Open canvas`).

### 5.4 Why the count never truncates and never sheds

The count is `shrink-0`: a number cut mid-figure is a broken claim.
`run-detail-model.ts:1692-1711` states the rule for the pane's tallies — *"Clause
shedding, never truncation… a tally cut mid-segment reads as a broken count"* —
and this chip has no segments to shed (that is what "does not say" in § 5.1
buys). What yields instead is the **goal**'s snippet, and then its label; both
have a second home, and a count does not. This is the working-directory chip's
own yield argument in the same row: *"the chip is the only one whose content
exists somewhere else"* (`directory-indicator.tsx:140-145`).

Measured, at the 220px column floor (a 204px content box, `220 − 2×8`): the
count is ~13 characters — about 122px at the readings' own measured advance
(a digit-heavy `text-meta` string measures 7.2-9.4px per character across the
four readings in `numbers.json`, `populated-900`) — plus its 12px of padding.
With the goal's label `sr-only`ed, the chip needs only its 14px chevron plus 12px
of padding, so `122 + 12 + 8 + 26 ≤ 204` holds with a snippet left over. **That
arithmetic is why the row never wraps above the 240px switch, and it is
arithmetic, not a frame** — the frames are what confirm it (§ 9).

### 5.5 The two activity chips, and the one refusal this document owes them

**They are `docs/composer-activity-chips.md`'s subject, not this one's** — that
document argues the shape (a state mark instead of a count's `Info`, the motion
that comes with a running row, the `count > 0` gate, the wrap rule) — but two
sentences here are what the *plan chip's* reader needs:

- **Same control box, same reveal, one more destination.** The chips import
  `CHIP_CONTROL` from `session-status-strip.tsx` exactly as § 5.1's count chip
does, they carry no `aria-pressed` and no pressed ground for § 5.2's reason, and
  they file the same one-shot, nonce'd request with `section: "subagents"` /
  `"jobs"`. The pane resolves whichever section the request names through that
  section's own ref (`run-panel.tsx`'s section→ref lookup), retires it if the
  section is not on screen, and does not move focus — all three of § 5.2's
  properties, over three destinations instead of one.
- **A refusal, recorded because this document is where it was written.** § 7's
  "no live region, no spinner, no dot" now has a NAMED exception, and the shape of
  that exception is `docs/composer-activity-chips.md` § 5: the PLAN count still
  has no spinner and no live region, and the failure dot is still
  `run-details-trigger.tsx`'s alone — but an activity chip LEADS WITH THE ROSTER'S
  STATE MARK, which spins while the work it names is running. The distinction that
  keeps the refusal meaningful is that the mark is the roster's existing
  nine-state vocabulary, unchanged and unauthored here, and not a decorative pulse
  invented for the composer. `animate-pulse-visible` remains the skeleton's alone.

### 5.6 The wake chip

**`docs/composer-wakes.md`'s subject**, and the two sentences the plan chip's
reader needs are § 5.5's over a fourth destination:

- **Same control box, same reveal, one more destination.** The wake chip imports
  `CHIP_CONTROL` exactly as § 5.1's count chip does, carries no `aria-pressed` and
  no pressed ground for § 5.2's reason, and files § 5.2's one-shot, nonce'd request
  with `section: "wakes"`. The pane resolves it through that section's own ref.
- **It is a MARKED count, and the mark is not the roster's `Info`.** § 6's
  refusal of a mark on the plan chip was overruled in § 5.5's shape for the
  activity chips; the wake chip takes the same ruling, with `AlarmClock`. What
  keeps the refusal meaningful is unchanged and is now stated over three marks:
  each is an existing glyph whose meaning is fixed elsewhere (`Info` for "this
  opens the run pane", the roster's nine states, the alarm for a wake), none is a
  decorative pulse, and `animate-pulse-visible` remains the skeleton's alone. This
  one is the only count chip on the row that does not move, because an armed
  schedule is not moving.

It sits BETWEEN the plan chip and the two activity chips, which is the one
placement sentence this document owes: the goal, the plan and the wakes are what
the session is set up to do, and the subagents and jobs are what is happening now
(`docs/composer-wakes.md` § 4 has the rejected alternative).

---

## 6. The trigger icon

### 6.1 Recommendation: `Info`

Replace lucide's `Activity` with **`Info`** in
`run-details-trigger.tsx` (the import at `:33`, the render at `:254`).

**Why `Activity` was wrong.** The glyph is a heartbeat, and a heartbeat is a
claim about *liveness* — which is not what the pane holds. What is in there is a
roster, a plan and the connections the session has: facts about a run, not a
pulse. The incumbent's justification was never positive: it was only ever "not
`Users`, not `ListChecks`" (`run-details-trigger.tsx:18-20`,
`docs/run-sidebar.md:256-259`, `docs/run-details.md:462-466` — three records,
one negative argument between them). In the frames the glyph reads as a small
chart line in the header cluster (`docs/evidence/chat-run-details/header-trigger`
/`localOperatorDark.webp`, `localOperatorLight.webp`), which is a third reading
nobody intended.

**Why `Info` is right, in this codebase's own terms.** `Info` is already the
app's mark for "there is more to read here", on four surfaces:

| Call site | What it marks |
|---|---|
| `canonical/canonical-transcript.tsx:476` | an `info`-level notice in the trace |
| `message-item/error-block.tsx:112` | the information line inside a failure |
| `generation-settings-section.tsx:94` | a setting's explanation |
| `model-hosting-section.tsx:83` | the same, on the hosting pane |

A pane that reports a run's state is the same kind of thing those four label,
and the operator's own reading ("an info-related icon") is the primary input
here.

**And it is the only candidate that collides with nothing.** Checked against the
app's whole glyph vocabulary:

| Candidate | Why not |
|---|---|
| `Activity` (incumbent) | a liveness claim on a report; see above |
| `Users`, `ListChecks`, `Terminal`, `FileText`, `Plug`, `Wrench`, `Globe`, `Download`, `Search`, `Tag`, `Clock`, `Inbox`, `Send`, `FolderOpen`, `FilePen` | they are the **tool** glyphs (`trace/tool-glyphs.ts:54-79`) — the original reason, unchanged |
| `Check`, `X`, `CircleSlash` | the three outcome glyphs (`tool-glyphs.ts:95-97`) |
| `CircleHelp` | the roster's own mark for a child whose state is **unknown** (`run-detail-row-parts.tsx:51`, `CHILD_ICON`). It is also the app's help glyph |
| `Square`, `SquareCheck`, `SquareSlash`, `SquareDashed` | the plan's four state marks (`run-detail-todos.tsx:34-39`) |
| `FileText` | the canvas button **beside this one** in the header (`chat-header.tsx:212`) |
| `PanelRight`, `PanelRightClose` | the pane's own close control in its chrome bar (`run-panel.tsx:628`). An "open the pane" glyph that differs from a "close the pane" glyph by one small arrow — on screen at the same time, in the same pane's two corners — is the one pairing worse than the heartbeat was |
| `Gauge`, `ChartNoAxesColumn`, `Layers`, `ListTree` | shape metaphors with no established meaning in this app; a new symbol is the thing the incumbent's docblock correctly refused to add |
| `Toggle`/`SlidersHorizontal`/`Settings` | the settings venue, not a run's state |

The glyph is sized by the `Button` variant, not by a `size` prop
(`message-input.tsx:975-985` records why: the variants' `[&_svg]:size-4`
overrides it, so a `size` prop states an intent it cannot deliver). The trigger
is `variant="ghost" size="icon"`, so the glyph renders at 16px on the ramp's
default step.

### 6.2 The docblock paragraph this replaces

`run-details-trigger.tsx:18-20` currently reads:

> `**Icon: `Activity`, unchanged.** `Users` and `ListChecks` already mean a`
> `specific tool in this app (`trace/tool-glyphs.ts:54-79`) and a header button`
> `wearing one would read as that tool rather than as the view over both.`

Replacement (registered in the file's voice, i.e. a docblock fragment at the
same indent, lines wrapped at the same width):

```text
 * **Icon: `Info`, not `Activity`.** The old glyph was a heartbeat, and a
 * heartbeat says *liveness* — the one thing this pane is not: it holds a
 * roster, a plan and the servers the session is connected to, and nothing in it
 * pulses. `Info` is this app's own word for "there is more to read here": it is
 * the mark on the transcript's info notice
 * (`canonical/canonical-transcript.tsx:476`), on the error block's information
 * line (`message-item/error-block.tsx:112`), and on the settings rows that open
 * a section (`generation-settings-section.tsx:94`,
 * `model-hosting-section.tsx:83`). It is also the one candidate that collides
 * with nothing: the table in `trace/tool-glyphs.ts:54-79` is the tool glyphs,
 * `CircleHelp` is the roster's own mark for a child whose state is unknown
 * (`run-detail-row-parts.tsx:51`), the four squares are the plan's state marks
 * (`run-detail-todos.tsx:34-39`), `FileText` is the canvas button beside this
 * one (`chat-header.tsx:212`), and `PanelRight`/`PanelRightClose` are the
 * pane's own close control in its chrome bar (`run-panel.tsx:628`) — an open
 * glyph one small arrow away from a close glyph, on screen at the same time as
 * the close control, is the one pairing worse than the heartbeat was.
```

### 6.3 The two records this supersedes

The icon is claimed in two committed design records, and a record that keeps a
stale claim is worse than no record ("every claim checkable", `branding.md` § 8).
Both are edited in the implementing PR rather than left to rot:

- `docs/run-sidebar.md:256-259` (§ 3.3): the bold sentence becomes
  `**Icon: `Info`, not `Activity`** — see `docs/composer-status-tabs.md` § 6`,
  keeping the surviving half of its reason (the tool-glyph collision) and
  dropping the "unchanged" claim.
- `docs/run-details.md:462-466` (§ 6.1): the same substitution, with a pointer to
  this document.

Everything else in both sections is untouched: the visibility gate (`details !==
null`), the toggle behaviour, the pressed ground, the tooltip copy and the
attention dot are all still right and are not part of this change.

---

## 7. Interaction, focus and accessibility

| | Goal chip | Plan count chip |
|---|---|---|
| Element | a disclosure trigger (the primitive's `button type="button"`) | `button type="button"` |
| Role | none beyond `button`; **not** a `tab` | none; **not** a `tab`, **not** a toggle |
| `aria-expanded` / `aria-controls` | yes / yes — the primitive emits both against a `useId` body (`disclosure.tsx:143-146`, `:158`) | no: it opens a region elsewhere in the page, and `aria-expanded` on a control that does not own the region it reveals is a claim screen readers act on |
| `aria-pressed` | no | **no** (§ 5.2) |
| `aria-label` + tooltip | the one derived string, § 4.3 | the one derived string, § 5.3 |
| Keyboard | in the band's DOM order, ahead of the composer's own controls, because the band precedes the box | same |
| Focus ring | the base layer's `:focus-visible` outline (`styles/index.css`), offset pulled to 1px (`focus-visible:outline-offset-1!`) | identical |
| Hover | a colour step only: `hover:bg-accent-wash hover:text-ink` | identical |
| Pressed / active | none; the **chevron swap** is the state signal (`branding.md` § "Disclosure": *"The chevron swaps, it never rotates"*) | none |
| Body | § 4.4 | — |

And the three controls this change adds (`§ 12-13`), on the same rules:

| | Goal dismiss | Loop dismiss | Loop chip |
|---|---|---|---|
| Element | `button type="button"` | `button type="button"` | a `<span>`, **not** a control |
| Role | none; **not** a toggle, **not** a tab | none | none — a readout |
| `aria-expanded` / `aria-controls` | no: it acts on a value, it does not reveal a region | no | no |
| `aria-pressed` | no | no | no |
| `aria-label` + tooltip | the one derived string: `Clear goal — <the goal, in full>` | `Stop loop`/`Clear loop — <the clause>` | none: a readout's sentence is its visible text |
| Keyboard | in the tab order **at every width**, revealed by `group-focus-within` on the chip, and still revealed while it holds focus | same | not focusable; there is nothing to operate |
| Focus ring | the base layer's `:focus-visible` outline at 1px offset, as the chips' | same | — |
| Hover | a colour step (`hover:bg-accent-wash hover:text-ink`), and the reveal itself is opacity only | same | none: no hover ground, `cursor-default` |

- **Not a `tablist`.** The operator's word for the surface is *tabs*, and this
  document keeps the word for the surface while refusing the role: one of the two
  controls opens a different region rather than revealing a panel in place, there
  is no `tabpanel`, and there is no roving `tabindex` to manage. A `tablist` whose
  members are not tabs announces arrow keys that do nothing (`branding.md` § 7:
  "Two competing expand/collapse patterns is a bug"). Two buttons.
- **Nothing lifts, scales or translates on hover** (`branding.md` § 5) — the
  chips transition `color` and `background-color` only, at
  `duration-fast ease-out-quart`, the readings' own (`session-status-strip.tsx:164-172`).
- **No live region, no spinner, no dot.** The count changes as a plan
  progresses, and announcing every change from the composer would talk over the
  agent's own output; the pane is where the plan is read. And the header
  trigger's dot is deliberately **not** duplicated here: it is a
  two-ledger acknowledgement with its own seen-state
  (`docs/run-sidebar.md` § 3.4), so a second copy in the composer would be a
  second ledger for one fact, with the acknowledgement state of neither.
  **Deliberately overruled once, for the activity chips and only in the SHAPE
  they take** (`docs/composer-activity-chips.md` § 5, and § 5.5 below): those two
  lead with the roster's own state mark, which is motion while a row is running —
  no live region and still no dot, and nothing invented for the composer.
- **Reduced motion**: no motion to cap; the body mounts rather than animating
  (`branding.md` § 5's `styles/index.css` cap is untouched).
- **A crash here must not cost the ability to type.** The row renders inside an
  `ErrorBoundary` with a `null` fallback, exactly as the readings strip does
  (`message-input.tsx:1465-1477`), for its reason: metadata is not the composer.

---

## 8. Colour roles, and the contrast contract

Roles only, per `branding.md` § 2. The row itself declares no ground: it draws
on the chat column's working surface, which is `canvas`
(`contrast-contract.mjs:558-563` pins the column's own
`overflow-hidden rounded-none bg-canvas` class, because repainting it `surface`
merges it with the list panel beside it and no palette assertion can see it).

| Element | Role | Why |
|---|---|---|
| Chip text, at rest | `text-ink-muted` | The readings' own ink for a control (`session-status-strip.tsx:164-172`). `ink-dim` is the role that row uses for an **inert readout** (`:175`), and neither chip is one. |
| Chip text, hover | `text-ink` | The same step the readings take, and the pairing `contrast-contract.mjs:368` asserts. |
| Chip hover fill | `bg-accent-wash` | The readings' hover fill, and the only place that role is a text ground in the app (said so at that contract row). |
| Chevron | `text-ink-disabled` | The primitive's own role for it (`disclosure.tsx:151`, `:165`); the only ink exempt from a floor (`branding.md` § 2), and it is the idiom's existing chevron weight. Its **shape** carries the state, not its ink. |
| Goal body | `text-ink-muted` | The brief block's ink for authored prose (`run-child-reader.tsx:220`). |
| Count | inherits the chip's ink | § 5.4: a coloured count would be a second colour vocabulary for a fact the plan's own section states without colour at all (`docs/run-sidebar.md` § 2.3: the dock band "spends colour on failure and on nothing else", and a to-do waiting on an answer has not failed). |
| Dismiss mark and word (§ 12) | `text-ink-muted`, the readings' own ink for a control | It is a control, so it takes the control ink rather than `ink-dim`; the role is what makes it "subtly treated", and the hover step to `text-ink` is the same one every other chip on the row takes. |
| Loop chip, and its mark (§ 13) | `text-ink-dim`, the readings' own ink for an INERT READOUT | It is the row's one readout, not a control, and § 8's distinction is exactly this pair: a control is `ink-muted`, a readout is `ink-dim`. Mark and text share the one role, the same rule the count chips follow. |
| Nothing destructive | no `danger` anywhere in these three controls | Clearing a goal and stopping a loop remove the session's own standing state, not the user's data, and `danger` on a hover-revealed control that appears under the pointer would be the loudest thing on the composer. The app's danger ink stays where § 8 puts it: the attachment and canvas-tab removals, which delete authored content. |

**`CONTROLS` in `scripts/contrast-contract.mjs`: no new row, and here is the
condition that would change it.** The rule is a component *"with its own fill and
border"* (`AGENTS.md` § "Where colour comes from", `branding.md` § 3, § 9.8), and
this one declares neither: at rest it is text on the page ground, and its only
fill is the hover ground whose one pairing (ink on `accentWash`) is already
asserted by the `reading button, hovered` row (`contrast-contract.mjs:368`) —
a pairing that is ground-independent because `accentWash` is an opaque role in
every palette (e.g. `local-operator.ts:67`, `:186`), not an alpha composite. So:
**if either chip acquires a rest fill or any border — `bg-surface`,
`bg-elevated`, `border-control` — a `CONTROLS` row becomes mandatory in the same
commit**, because green output about a component nobody listed is not evidence
about that component (`branding.md` § 3).

**The three controls § 12-13 add take no `CONTROLS` row, on that same condition
and not by convenience.** Each is the readings' own box, which declares no rest
fill and no border; their only fill is the hover ground whose one pairing (ink on
`accentWash`) the `reading button, hovered` row already asserts; and the loop chip
is the inert form of the same box, which by definition declares neither. The
condition above therefore stands unmodified: **the day one of them acquires a rest
fill or a border, the row is owed in the same commit.**

No `STRUCTURAL_CALL_SITES` entry either: that list pins the *role in the source*
of a boundary (`contrast-contract.mjs:557`), and this component has no
boundary to pin.

---

## 9. Evidence plan

### 9.1 Frames: the row, in the live app

**The live rig, not Storybook, and the set's own README is why**:
`docs/evidence/composer-readings/README.md` records that the readings row
"cannot be photographed in Storybook… a hand-built row in a story would certify a
layout the product does not have (`docs/branding.md` § 8)". This row is the same
kind of object — a flex line whose shape depends on the column's width, the real
chip sizes and the real truncation — so it extends **that set**, whose driver
(`out/evidence-harness/row-frames.mjs`) already aims the viewport so the measured
box lands on a target width and writes `numbers.json` from the live DOM.

States to add, each in `localOperatorLight` and `localOperatorDark`
(`branding.md` § 9.9: the light themes are where contrast defects hide):

| Frame | What it proves |
|---|---|
| `status-neither-900` | **nothing renders**: the band's height equals the pre-change `populated-900` exactly (111.7px), and no pixels appear in the row's band |
| `status-goal-900` | the goal chip alone; the label, the colon, the snippet, the chevron's shape |
| `status-plan-900` | the count alone, at the row's start |
| `status-both-900` | both chips; goal left, count at the right edge; the count's x does not move with the goal's text |
| `status-goal-expanded-900` | the body: the full text, the cap and the scroll, the 120px ceiling (six whole lines), `pre-wrap` on a goal that contains newlines |
| `status-goal-long-900` | a several-hundred-character goal: CSS truncation in the snippet, the tooltip carrying the whole value, the body scrolling |
| `status-both-172` and `status-both-172-canvas` | the column floor (172px, the width the app actually renders): the row stacked, nothing leaving the box (`boxOverflowX === 0`), and the body's measured width — whatever it is, since § 11.1 records that the ≥160px this document asked for is not reachable at the real floor |
| `status-hover-900` and `status-focus-900` | the wash (a real dispatched hover, as the existing `hover-focus-900` does) and the focus ring on each chip |
| `status-goal-draft-900` | a draft pane: the row renders nothing (no session goal yet) |

**What was actually captured, and where it differs from the table above.** The
shipped set is `docs/evidence/chat-composer-status-row/` - four stories over the
two brand palettes, eight frames - captured from the committed rig
(`scripts/capture-evidence.mjs`) against Storybook, because the live-app driver
this section assumed (`out/evidence-harness/row-frames.mjs`) is gitignored and not
in the tree. The names are the story ids, not the `status-*` names above:
`states` carries the matrix (including the "renders nothing" band, which is
`status-neither-900` above), `long-goal` carries the truncation pair, `expanded`
carries the collapsed-above-expanded pair, and `column-floor` carries the floor
pair at the app's real 172px with the small-view step. What that route cannot
photograph is the live composer's own box (a story's box is a stand-in) and the
real `numbers.json` geometry; the set's README says so, and
`docs/evidence/composer-readings/` remains the set that owns the live composer.

`numbers.json` fields to read per frame: `box.h` and `box.y` (the composer box,
unchanged height, moved up), the row's own box, `boxOverflowX`, the two chips'
boxes and their `aria-label`s, and the body's `clientHeight` / `scrollHeight`
(the cap and whether it overflows). Then the manifest
(`docs/evidence/manifest.json`) `supplementary[]` entry for `composer-readings`
must have its `frames` and `surfaces` **re-derived from disk**, because
`scripts/check-evidence.mjs:598-611` requires each set to declare `frames`,
`surfaces`, `themes`, `source`, `why` and `capturedAt`, and fails when the counts
disagree with what is on disk.

**The clear/stop change's frames are a SECOND set, and the swept one above is
declared stale for it** (`docs/evidence/composer-status-clear/`, whose README
states every command, state and limit). Two reasons, both recorded rather than
implied:

- **The interaction cannot be a story.** The subject is a press whose result is the
  WIRE moving — the goal clearing and the row going, the loop settling — so that set
  carries a harness (`…/harness/`) that mounts the shipped row behind an injected
  `window.api.desktop` bridge, records the `sessions.command` request each press
  dispatches, applies that command's effect to the frontend state the row reads, and
  prints both the wire and the command log into the frame. One of its three frames is
  a REFUSAL (a 503 from the bridge), because the failure path is the one outcome the
  row speaks and a story cannot reach it.
- **The six swept directories under `chat-composer-status-row/` are pictures of the
  row before this change**, and the row has moved under them: the goal chip's snippet
  now yields to a held 89px box, and a sixth chip can appear between the goal and the
  plan. They are left in place — they are where § 2, § 3.1 and § 5.4's numbers were
  read — and the re-capture is OWED, not quietly skipped: the rig launches a private
  headless Chromium and this machine's operator policy forbids a screenshot produced
  by a scripted browser engine, the same policy `manifest.json`'s
  `chat-run-panel/mcp-grant-confirm` entry records for its own owed pass. The
  replacement frames come from the operator's own browser, so they are two brand
  palettes rather than twelve — `branding.md` § 9.9's minimum, and the light one is
  where a contrast defect would show.

The states it carries, per the claims above: the goal tab at rest and revealed, the
loop tab at rest and revealed (the loop's own `Stop` and `Clear` states, at 900px and
at the 240px band where its progress and the dismiss's word both yield), the harness
at rest, the three performed presses with the wire each moved, and the refusal. Its
`README.md` names what it is NOT: not a backend proof (the backend half is
`local-operator`'s), and not a theme sweep.

### 9.2 Frames: the icon

The icon change moves the header in every frame that has one, so it is a
**re-take, recorded as one**, with the mutation named rather than left to be
inferred from a pixel diff:

- `docs/evidence/chat-run-panel/{trigger-idle,trigger-hover,trigger-open-hover}`
  — the trigger closed, closed-hovered and open-hovered, whose
  `docs/evidence/chat-run-panel/README.md` already measures the four grounds;
  the icon is the only thing that may change in them.
- the story set under `docs/evidence/chat-run-details/` (the header appears in
  every one of its ten states). Its frames' record is not a README of its own —
  it points at `../run-details/README.md` — so the re-take is recorded there,
  against the story-set conventions that README sets out, and the set's own
  frame table gains a row naming the icon as what moved.
- The claim to state in those READMEs: the glyph's 16px box is the whole
  mutation; a diff confined to the two header action buttons is the evidence,
  and any frame differing elsewhere is a bug, not a re-take artefact.

### 9.3 Tests, and what tests cannot do here

`scripts/composer-readings.test.mjs` is the pattern, and its own docblock states
the division of labour: rendered-markup assertions for the component, and
**source** assertions for the composer's layout, *"because the composer cannot be
rendered in isolation: `MessageInput` needs a message list, a dispatcher and the
canonical store… The rendered geometry itself is measured in the live frames"*
(`:25-31`). So:

- **Markup, rendered from the row alone**: a frontend with no goal and no todos
  renders nothing (`null`, not an empty box); a goal renders one chip whose label
  is `Goal:` and whose `aria-label` carries the full text; a plan renders the
  count with the model's own words for one item and for several; the expanded
  body carries the goal's full text and its `role`/`tabIndex`.
- **Source, for the row's layout**: the one-line-above-240 / column-at-or-below
  240 classes; the goal item's `min-w-0`; the count chip's `shrink-0`; the
  `-ml-1.5` on the first chip.
- **Markup and drives, for the three controls § 12-13 add**: the dismiss renders
  with one derived name and its word as text; both reveal classes cut across every
  media state, on both controls; the loop chip is a `<span>` whose item holds exactly
  one button; the chip's clause and its affordance are asserted as a truth table over
  the exported derivations (`running`/`judging`/each settled word), including the
  BOUNDARY (an unreadable status is not claimed to be moving); and a DRIVEN press on
  each control, in jsdom behind the real bridge seam (`window.api.desktop.request`,
  stubbed), asserts the request it dispatched — `sessions.command`, the session it is
  addressed to, the command and the flag — and that the goal's press leaves the
  disclosure's `aria-expanded` untouched while the disclosure's own press dispatches
  nothing. A refused call is driven too, and asserted to leave the row as it was.
- **What no test covers**: the row's height, the alignment and the truncation are
  geometry, and the frames are their instrument (§ 9.1). The REVEAL is browser state
  that jsdom evaluates in neither direction, so the class strings are pinned in the
  suite and the pixels are the frames'. A green suite is not visual evidence — the
  operator's own rule.

### 9.4 The gates that must stay green

`pnpm check-themes` (the new component adds no `CONTROLS` row, § 8 — and the gate
must be re-run after the `sr-only` floor rule lands to confirm nothing else
moved), `pnpm check-types`, `pnpm lint`, and the evidence gate. No version bump:
`package.json` stays at the last released version (`AGENTS.md` § "PRs do not bump
the version").

---

## 10. Rejected alternatives, in one place

| | Option | Verdict |
|---|---|---|
| A | **Inside the composer box**, as a row of the box | Rejected — § 2.1. It puts non-interactive prose and two controls inside the one ring that frames the field, which is the alert's own recorded rule, and it changes the box's measured geometry (111.7px) that other records quote. |
| B | **The dock band above the composer** | Rejected, and this is `docs/run-sidebar.md` § 3.1 B re-checked in narrower form — § 1's table is the test. |
| C | **Wrapping the chips to two lines whenever they do not fit** | Rejected above 240px: it costs 26px of the operator's explicit budget in the *collapsed* state, to buy room only the *expanded* state needs. It is the arrangement at or below 240px, where the cost is unavoidable and where the readings cluster already pays it. |
| D | **Re-implementing the disclosure trigger** so the body can be a sibling of the chips' line and span the row at every width | Rejected for now. `branding.md` § "Disclosure" allows it in two named places, both because the markup cannot otherwise resolve (a button nested in a button); here it would resolve and only the body's width is at stake, and the stacked arrangement at the column floor (§ 2.4) buys the same measure without a third exception. It is named in § 11 as the remedy if the frames show the stacked body still too narrow. |
| E | **`role="tablist"` with roving focus** | Rejected — § 7. One of the controls does not open a panel in place, and there is no tabpanel. |
| F | **A pressed ground on the count chip** | Rejected — § 5.2. It is not a toggle; the pane's own open state is already on the header trigger, with `aria-pressed` and its pressed ground (`run-details-trigger.tsx:238-243`), and a second control wearing that ground for the same fact is one fact with two spellings. |
| G | **`n of m closed` for the count** | Rejected — § 5.1, on vocabulary, the operator's ask, and the 6 characters the row cannot afford at the floor. |
| H | **The count at the row's left, hugging the goal chip** | Rejected: with the goal's flex item holding the free space (which the expanded body needs), a left-hugging count is not expressible without moving it again on expansion; and a right-edge count does not move at all as the goal's text or the plan's numbers change. It is also the pane's own section-header grammar (`run-detail-todos.tsx:178-190`). |
| I | **Per-app persistence of the expanded state** | Rejected — § 3.3. It would restore an open body on every launch, which is the cost the operator ruled out. |
| J | **Truncating the count** (`4 to-d…`) | Rejected — § 5.4, and `run-detail-model.ts:1692-1701`'s clause rule, which exists because a count cut mid-segment "states a number and hides what it counts". |
| K | **`PanelRight` as the trigger icon** | Rejected — § 6.1. It is one small arrow away from the pane's own close glyph, on screen at the same time. |
| L | **The dismiss's word in the tooltip only** (an `X`-only control at every width) | Rejected for now — the operator asked for the word, and the word is what makes the control legible before the pointer arrives. It is the smaller box and the smaller affordance, and § 14.2 keeps it named as the alternative if the 89px held box is judged too expensive. |
| M | **A reveal that takes up space** (`hidden`, `w-0`, or a `max-width` transition) | Rejected — § 12.2. It re-truncates the snippet under the pointer, which is motion on hover, and § 7 permits a colour step and nothing else. |
| N | **Rebuilding the disclosure so the body can be a sibling of the chips' line**, which is what would let the dismiss sit immediately beside the words | Rejected FOR NOW, and named as the remedy rather than silently preferred — § 12.3. `branding.md` permits the rebuild where the markup cannot otherwise resolve (a button nested in a button); here it resolves, and the placement is the only thing at stake, so the trade is a designer's call with the frames in front of them. |
| O | **The loop chip as a BUTTON** opening `/loop`'s picker | Rejected — § 13.2. The row's "open something" destinations are the pane's sections, the picker is opened by the composer's own slash path rather than from this row, and a chip whose only real action is the dismiss beside it would be a control that mostly does nothing. |
| P | **A spinning loop mark** | Rejected — § 13.3. The row's one piece of motion is the roster's state mark, whose vocabulary is nine states of delegated work; the loop's state is a word in its clause, and a second spin would say "something is moving" twice. |

---

## 11. Risks, and what this document does not settle

Recorded rather than hidden, per `branding.md` § 8.

1. **The expanded body's width at the column floor is narrower than this
   document's acceptance floor, and the floor was the wrong number.** This risk
   asked for ≥160px at a 220px column; the app's column is 172px with the canvas
   open (QA round 1, driven), where the body measures **~128-136px** - and the
   ≥160px figure is unreachable at that width by any arrangement this design can
   reach, including § 10's option D, which buys back the indent and the count
   chip's line and tops out near the row's own 156px content box. So the code is
   not what failed; the acceptance number was arithmetic at a column the app does
   not render. The measured frame is
   `docs/evidence/chat-composer-status-row/column-floor/`, and the open question
   for the designer is whether a ~128px measure is acceptable at the floor or the
   row should change shape there - recorded, not assumed either way.
2. **The alignment argument is a 6px device.** `-ml-1.5` puts the first chip's
   text on the row's content edge (the alert's own left edge), which is 8px left
   of the *message text* below it. The alert accepted that gap deliberately
   (`message-input.tsx:1008-1011`), so this row does too; if a designer would
   rather align to the message text, that is `px-2.5` on the row and one line of
   change.
3. **The `triggerClassName` ink override is outside that prop's stated scope**
   (§ 4.1). It works, it is deterministic through `cn`, and it is recorded.
   A future tidy-up could add an ink prop to the primitive; that is a shared-API
   change and out of scope here.
4. **The goal chip's copy uses a shorter word than its own accessible name.**
   Visible `Goal:`, spoken `the session goal` (§ 4.3-4.4). Both words exist in the
   app for this exact fact (the picker's field label and its title), but the row
   does lean on the tooltip to supply the disambiguating word.
5. **A blocked plan item is not surfaced above the composer.** The operator's ask
   is a count, and the model exposes no blocked tally (`openTodos` is pending
   *plus* blocked, `run-detail-model.ts:115-119`), so saying `1 blocked` would be
   a second tally invented in the composer. If the operator wants that state
   visible without opening the pane, it is a new field on the model plus a change
   here — recorded as a deliberate omission, not deferred work.
6. **Pre-existing gaps noticed while writing this, deliberately not fixed here.**
   (a) The child reader's brief block scrolls (`max-h-48 overflow-auto`,
   `run-child-reader.tsx:216-221`) with no tab stop, so a long brief has the same
   keyboard problem § 4.4 avoids for the goal; it is the same class of defect in
   a surface this change does not touch. (b) `message-input.tsx:1025` compacts
   the alert's horizontal inset to `px-2` under `isSmallView`, while
   `chat-measure.ts:82-107` states that the horizontal inset is deliberately
   outside the small-view ternary; the alert follows the box's own `p-2` step, so
   the two are not actually in conflict — but the comment reads as though they
   are, and a reader will trip on it.
7. **The reference's behaviour could not be verified from OpenAI's docs.**
   `learn.chatgpt.com/docs/codex/ide` says nothing about a plan preview (§ 0), so
   the extension's shape is cited from the issue thread and the operator's
   observation. If the operator has the extension in front of them, one
   screenshot of its preview would settle the two things this document inferred
   rather than saw: whether it is one line or two, and whether the count is
   stated or the current step is.

---

## 12. The dismiss affordance: clearing the goal, and stopping or clearing a loop

### 12.0 The ask, verbatim

> on the goal tab there should be an X that appears on hover, with subtly treated
> text reading "Clear goal", and activating it clears the goal. The same mechanism
> must exist for the loop: a way to stop/clear the loop.

### 12.1 The shape

One control, on the item it belongs to, at that item's trailing edge: an `X` glyph
and one word, and behind it one owner command.

| | Value | Why |
|---|---|---|
| Box | the readings' own control (`CHIP_CONTROL`, `READING_BUTTON` from `session-status-strip.tsx`) | It is the same species as the chips it sits among: no border and no fill at rest, `h-6`, `rounded-sm`, `px-1.5`, `text-meta`, a hover colour step, the base layer's focus ring at 1px offset. A second box shape on one line is the drift § 5.1's export exists to prevent. |
| Mark | `X`, `size-3.5`, `aria-hidden` | The app's one "remove this" glyph (`attachments-preview.tsx`, `reply-preview.tsx`, `canvas-tabs.tsx`, `directory-indicator.tsx`). `size-3.5` is the chevron's own size, so the row's marks stay one size. |
| Word | `Clear goal`, `Stop loop`, `Clear loop` — `text-meta`, one `text-ink-muted` ink for mark and word alike | "Subtly treated" is the operator's phrase and the role states it: `ink-muted` is the readings' ink for a CONTROL, one step quieter than the goal's own hover ink and two steps quieter than the composer. The word is the control's `textContent`, so the thing a person reads and the head of the name assistive tech announces are the same string (WCAG 2.5.3). |
| Reach | the control's own box, held at rest (`opacity-0` with `pointer-events-none`), revealed by `group-hover` and `group-focus-within` | § 12.2. |
| Press | `sessions.command` through the pickers' own channel — `goal --clear`, `loop --stop`, `loop --clear` | § 12.4. |
| Failure | the app's toast channel, in the backend's own words | § 12.4. |

### 12.2 Revealed on hover AND on keyboard focus, with the box held

```ts
const DISMISS_REVEAL = cn(
  "pointer-events-none opacity-0",
  "group-hover:pointer-events-auto group-hover:opacity-100",
  "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
);
```

Three properties, each a decision rather than a habit:

- **Held, not hidden.** The control keeps its BOX at rest. `hidden` (or `w-0`) would
  make the chip's snippet re-truncate the moment the affordance appeared, i.e. the
  text would move under the pointer on every hover — and § 7's rule is that hover
  is a colour step and nothing else. The repo already makes this call twice, at a
  20px scale: `canvas-tabs.tsx` and `directory-indicator.tsx` both hold a trailing
  dismiss's box and reveal it the same way. This is that pattern, not a new one.
  What it COSTS is stated in § 12.6 and printed into every frame.
- **`group-focus-within`, not `group-hover` alone.** Not optional: a hover-only
  control is unusable by keyboard (WCAG 2.1.1), and taking focus on the chip is what
  reveals it. The control is consequently in the tab order at every width, including
  the widths where its word is dropped (§ 12.5).
- **No transition.** The two existing hover-revealed dismisses reveal instantly, and
  the row's chips transition `color` and `background-color` only. A fade here would
  be new motion on this row for nothing (`branding.md` § 5 is why the two are
  instant; the reduced-motion cap is for motion that exists, and this adds none).

**One consequence of `pointer-events-none` at rest, recorded rather than
discovered.** A touch user's first tap sets `:hover` and is not delivered to a
control that is not yet `pointer-events-auto`, so the second tap is the one that
presses. That is inherent to a hover-revealed affordance and it is the existing
pattern's behaviour too; the app is a desktop app with a pointer, and the keyboard
route needs no hover at all.

### 12.3 The structure: a sibling of the trigger, never a child of it

The control is rendered as a SIBLING of the disclosure's trigger, inside a wrapper
that is the row's flex item:

```tsx
<div data-status-goal="" className={cn("group flex min-w-[140px] flex-1 items-center", COLUMN_GOAL)}>
  <Disclosure className={cn("min-w-0 flex-1")} … />          {/* the chip */}
  <button data-status-goal-dismiss="" … />                    {/* the dismiss */}
</div>
```

Two reasons are structural:

1. **A `<button>` inside a `<button>` is invalid markup** and unreachable in some
   engines. The disclosure's trigger is one.
2. **The trigger's own press IS the goal's disclosure.** A control that also cleared
   the goal would be one control with two meanings — the defect § 5.2 refuses the
   count chip a pressed ground for. Clicking here therefore cannot toggle the
   disclosure, and there is no `stopPropagation` in this path because there is no
   ancestor press to stop: the structure is the guarantee, and
   `scripts/composer-tabs.test.mjs` drives the press to assert that the trigger's
   `aria-expanded` has not moved while the command has been dispatched.

The wrapper is also what the reveal needs: `group-hover`/`group-focus-within` need a
common ancestor, and the primitive owns its own root (it renders no children outside
its trigger). It is the flex ITEM as well — the item the expanded body's width comes
from (§ 4.4) and the item the row's wrap regime counts — so the chip and its dismiss
can never be torn onto different lines by the wrap.

**Why the control can be far from the words, and why that is accepted here.** The
item is `flex-1` (the body's width depends on it) and the trigger inside it is
`w-fit` (the hover ground must stay chip-sized, § 4.1), so the item's free space
lives between the chip and the item's trailing edge — which is where the dismiss
sits. On an ordinary row that is immediately left of the next chip; on a row where
the goal is the ONLY item, it is the row's right edge, ~700px from the words
(measured: item 868px, chip 257px, in
`docs/evidence/composer-status-clear/interaction-rest/`). The alternative that puts
the control immediately beside the words needs the BODY to be a sibling of the
chips' line as well — the primitive's markup cannot express that, so it is a rebuilt
disclosure, which is § 10's option D: named here as the remedy rather than done,
because it is a bigger change than this one and it trades a placement against the
body's measured width.

### 12.4 The command, and the one outcome that speaks

Both controls run one owner command through the pickers' own channel —
`useSessionCommand(frontend.session_id).run(name, flag)` (`use-picker-backend.ts`),
the same hook the destination pickers submit with, so the request shape, the request
id and the receipt are the app's own rather than a second way to reach a session
command. The command NAMES (`goal`, `loop`) and the FLAGS (`--clear`, `--stop`) are
literals in the row, deliberately not derived from the control's visible word: the
command surface is the backend's API and the word is copy, so a copy change must not
be able to move the command it runs.

- **Success needs no announcement.** The wire is the feedback: the goal clears and
  the whole row goes (`showGoal` is false), or the loop settles and the chip's own
  word changes. A live region for that is refused by § 7, and a success toast would
  be the row talking over the agent's own output.
- **A refusal has no wire to speak for it**, so it goes to the app's toast channel
  (`showErrorToast`, the same channel the composer's own dictation and attachment
  failures use) with the hook's own `result.text` — the owner's sentence when it gave
  one, the transport's when the call never arrived. One source, so the toast cannot
  paraphrase the backend it reports. The frame:
  `docs/evidence/composer-status-clear/interaction-refused/`.

### 12.5 The word yields at the stacked band

```ts
const NARROW_HIDDEN = "@max-[240px]/chatcol:hidden";
```

At and below 240px the row is a COLUMN (`COLUMN_GOAL`), the goal item takes the
row's whole 156px content box at the app's floor, and `Clear goal` beside the chip's
own ~75px of fixed ink leaves the snippet nothing: measured, the dismiss is 89px at
a 900px column and **26px** at 172px — the `X` alone, which is the affordance's
irreducible part. The accessible name keeps the word at every width, so the control
is never described by less than it says at width.

The same constant drops the loop chip's PROGRESS (§ 13.3), which is the other piece
of copy a 156px column cannot carry. One rule, two users: what yields at the band is
the part that has a second home, and what stays is the part that identifies the
control.

### 12.6 What the held box costs, in numbers

Printed into the frames by the story set's own `RowFacts`
(`docs/evidence/composer-status-clear/goal-tab-rest/`):

| Column | Row | `overflowX` | chips | dismisses | goal chip | snippet |
|---|---|---|---|---|---|---|
| 900px, goal + plan | 32px | 0 | 2 | 1 (89px) | 257px | 188/188 (fits) |
| 900px, a 300-character goal + plan | 32px | 0 | 2 | 1 (89px) | 659px | 589/1956 (truncates) |
| 172px, the app's floor | 54px | 0 | 2 | 1 (26px) | 130px | 61/1956 |

The cost is the 89px column: at a 900px column a goal chip's snippet now starts
truncating 89px earlier than it did. That is the price of a hover that moves
nothing, it is bounded (it does not grow with the row), and the alternative —
revealing by taking up space — is the re-truncation § 12.2 refuses.

---

## 13. The loop chip

### 13.1 The gate, and the field

`frontend.loop` is the only field on the wire whose value can be `running`, and the
chip renders whenever its STATUS is not `idle`. Absent and `idle` are the same fact
here and take the same branch, which is what keeps `Loop: idle` off every composer
in the app — the count gate's argument (`docs/composer-activity-chips.md` § 5) one
chip over. The gate is the status rather than the loop's own `goal`, because a count
loop works the session's STANDING goal (which the goal chip already states) and
gating on that field would hide the one chip that can stop the loop.

### 13.2 It is the row's one READOUT

Every other chip on this row is a control; this one is not, and that is a decision
rather than an omission. The loop's standing state is a fact, the only thing this
row can DO with a loop is stop or clear it, and the alternative — a chip that opens
something — has no destination this row can name: the row's "open something"
destinations are the pane's sections, and the loop's detail lives in `/loop`'s own
picker, which the composer does not open from here.

So it takes the readings' INERT box (`READING_LABEL`, exported beside
`READING_BUTTON` for exactly this) — `text-ink-dim`, `cursor-default`, no hover
ground. The difference between a readout and a control on this row is then legible
without colour: a hover ground and a pointer mean a press does something.

### 13.3 The mark, and the clause

- **The mark is `Repeat`** (`size-3.5`), the one glyph on this row whose meaning is
  fixed elsewhere and fixed to this fact. The app spends `RotateCw` on retry and
  reload (browser chrome, the settings reconnect, the error boundary) and `Info` on
  "this opens the run pane", so neither could mean "loop" without meaning two things.
  **It does not move**: the row's one piece of motion is the roster's state mark on
  the activity chips (`composer-activity-chips.md` § 5), a spin here would be a
  second motion vocabulary for the same question, and the loop's state is already
  stated in words.
- **The clause is the wire's own status word**, plus the progress where the wire
  carries one: `running, 2 of 5 turns` (a count loop's target), `running, 3 turns`
  (a goal loop's count), `judging` (no figure: the judge is deciding the turn that
  just ended, so `completed` has already moved and a number beside that word cannot
  be dated), and the settled states print the word alone (`achieved`, `completed`,
  `cancelled`, `interrupted`, `failed`). The word is printed AS THE WIRE SPELLS IT
  because that is the app's one vocabulary for a loop — the `/loop` picker's own
  status row prints the same token — and a prettier word here would be a second
  vocabulary for one fact, which is the defect `wakeClause` refuses one surface over.
- **The progress YIELDS at the stacked band** (`NARROW_HIDDEN`, § 12.5), and the
  measurement that made it a rule: with the whole clause at the 172px floor the row
  read `overflowX 44px` — a chip that cannot wrap is a chip that paints past its
  column. With the progress dropped, `overflowX 0` at every captured width.
- **What is deliberately NOT here**: the wire's `reason` (why a loop settled) and the
  loop's own `goal`. Both are prose-length, both are in the `/loop` picker's status
  panel, and a 24px chip cannot carry either. Recorded as an omission rather than
  deferred work.

### 13.4 The affordance: Stop while it moves, Clear once it settles

```ts
loopIsRunning(status)  // "running" | "judging" — the picker's own predicate
loopAffordance(loop)   // → { text: "Stop loop", flag: "--stop" } | { text: "Clear loop", flag: "--clear" }
```

One function for the WORD and the FLAG together, so a second derivation cannot print
`Stop loop` and run `--clear`. The mapping is the ask read back: a loop that is
moving is stopped; a loop that has settled is cleared.

**An unreadable status is read as SETTLED**, and the boundary is stated rather than
assumed: the running set is the wire's own two words, and offering `Stop` on a status
this build cannot read would offer a control whose claim the row cannot check —
`Clear` is the command that is safe on a state the row does not recognise.

### 13.5 Where it sits: between the goal and the plan

Order: **goal, loop, plan, wakes, subagents, jobs**. The row's rule is standing
facts before live work (`docs/composer-wakes.md` § 4); the loop is the session's
MODE rather than a count of rows, and it is paired with the goal for the reason the
pair exists — a count loop consumes the standing goal, a goal loop carries one of
its own — and because the two are the row's only controls that TAKE a value away.

The two rejected placements, recorded rather than deleted:

| | Placement | Verdict |
|---|---|---|
| A | **Appended after the two activity chips** | Rejected — the wake chip's refused alternative over again: it reads live work before the thing driving it (`2 subagents running 1 loop running`). |
| B | **After the wakes, immediately before the activity chips** | Rejected: it puts the row's one `running` field behind two counts that describe a plan, i.e. it ranks the plan above the mode that is executing it. |

### 13.6 The first-chip rule, one item further out

The rule is ordinal (§ the `FIRST_CHIP` note), and the loop chip is a second ITEM,
so the chain gained a term: `loopFirst = !showGoal`, `groupIsFirst = !showGoal &&
!showLoop`, and the three count chips' own ordinals hang off that. Six chips, five
items, and the group's leading chip is still decided inside the group.

---

## 14. What this change does NOT settle

1. **The dismiss's distance from the words on a sparse row** (§ 12.3): measured at
   item 868px against chip 257px, and the remedy is § 10's option D rather than a
   tweak. The `goal-tab-rest/` frames show the arrangement, including the band where
   the goal is the row's only item.
2. **The 89px held box** (§ 12.6) is a real cost on a row whose width budget § 5.4
   already argues about. It does not grow with the row and it is what buys a hover
   that moves nothing; a designer may prefer the control's word in the tooltip only,
   which is a smaller box and a smaller affordance.
3. **The loop's `reason` is not surfaced anywhere on the composer** (§ 13.3). A loop
   that failed says `Loop: failed` on the row and why it failed in the pane's own
   record; if the operator wants the reason above the composer, that is a copy change
   with a width question of its own.
4. **Touch's second tap** (§ 12.2) is inherited from the pattern and not solved here.
