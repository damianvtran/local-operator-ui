# Session archive and delete

A conversation can now be **archived** (hidden from the lists and from search,
still resumable by id, restorable) and **deleted** (permanently, from this
machine, behind one confirmation). The two live beside each other on purpose:
the archive is the answer to "I am done with this and may come back", the delete
is the answer to "this transcript must not be here any more", and a design that
offers only one of them makes people use it for both.

## The precedent survey

Five products have shipped some version of this, and each one's failure is a
decision point:

| Precedent | What it does | What this design takes, and refuses |
| --- | --- | --- |
| **Codex CLI** (`openai/codex`, "Add session delete commands in CLI and TUI", #27476) | `/delete` opens a two-option popup — *"Delete this session?"* / *"Cannot be undone."* / `1. No, keep this session` · `2. Yes, delete and exit` | Taken whole, in this app's idiom: the permanent act is a modal with a named conversation, a stated consequence and a Cancel that is focused FIRST, and the destructive choice is the second one. Refused: running it without asking, which is the shape a slash command invites. |
| **ChatGPT** | Archive is one item in the chat's three-dot menu, **no confirmation**; archived chats go to *Settings → Data controls → Archived chats*; the sidebar's search does not look into them | Taken: archiving is a single reversible gesture with no dialog. Refused: the destination. A settings page behind two clicks is where an archived conversation goes to be forgotten, and the search there does not reach them at all. This design puts the escape hatch where the user is already looking — the search block — because otherwise "archived" and "gone" are the same experience from the reading side. |
| **Claude desktop** (issues #62428, #67835, #30869: "No UI to restore/unarchive archived sessions", "Session archive is one-way: no unarchive tool and no Archived view") | Archive with **no restore path at all** in the released UI; the documented workaround is editing `"isArchived": true` in the session's JSON by hand | This is the failure the feature exists to avoid. Three consequences, all built: the row carries a **control that says Unarchive**, the open conversation carries an **Archived pill with its restore beside it**, and a successful `/archive` offers an **Undo** — because the typed route is the one with no row left on screen to press. |
| **Zed** | Past agent threads live in a **Thread History** surface separate from the live list | Taken: an archived conversation is not a section in the sidebar. Refused: a whole second surface. The pin work had already spent a design round fitting the two sections that exist, and a third would be a navigation layer for a state most users will rarely enter. The search block's one control is the whole of the new chrome. |
| **k9s / lazygit** | Destructive acts ask in a modal with a one-key confirm (lazygit's "are you sure" for squash, `y`/`n`) | Taken: the danger role is a CONTRAST decision, not a colour preference — the confirm button is the destructive one, the title carries a warning glyph, and Enter cancels because Cancel holds the focus. Refused: a keyboard-only confirm. This app has a mouse, and the modal deliberately has no Enter handler (`confirmation-modal.tsx`). |

## What was decided

### Archive keeps the conversation open, and hides it from lists

`POST /v1/desktop/sessions/{id}/archive` with `{"archived": bool}` — a desired
state, never a toggle. The conversation's own pane is untouched: archiving the
open conversation leaves it open and merely adds the header pill, because
archiving is about where a conversation is *listed*, not whether it is *running*.
`/unarchive` restores it.

### One catalogue read, partitioned client-side

`GET /v1/desktop/sessions` answers `include_archived: true` (what this app asks
for) and every row carries `archived`. The panel then decides what to draw, which
is what lets one fetch answer both questions a hiding server cannot: the open
conversation's own state, and whether the row in front of the user should offer
Archive or Unarchive. With the capability **absent** nothing is hidden at all —
see *Fail-closed* below.

### The escape hatch is inside the search block, and only while a query exists

The `Include archived` control renders under exactly the rule the clear control
already follows: while the box has a query. At rest the panel is the panel it
was — no section, no row, no column, no badge — and a search that has been widened
says so where the widening happened, because that is the moment it matters.

**The control is REMEMBERED, and the widening is scoped to a query** (round 1,
UX U8: clearing the box used to disarm it, so a user who cleared and retyped the
same query silently lost the archived result they had just found). The two halves
are separate on purpose: the box keeps its tick across an empty field, and
`archivedSearchWidened` (with its own test) is what says the tick is IN FORCE only
while a query is — otherwise a remembered switch would widen the at-rest lists,
which is the one thing this feature exists not to do. The state is visible where
it acts: the box comes back ticked.

### Delete asks, and never on the row

A hover-revealed control that permanently destroys a transcript is one mis-click
away, and the reveal make it *easier* to hit by accident: the row the pointer is
on is the row under a hand that has just pressed something. So the delete lives
behind a **menu item** on the conversation's own actions (`Conversation actions`
in the header — the options surface a canonical session actually has) **and**
behind a typed `/delete`, and both routes end in the ONE dialog the app already
uses for destructive acts. `/delete` therefore stages a candidate and never
calls the wire: the wire requires `confirmed: true`, only the dialog sends it, and
no typed word can be that confirmation.

### The archived marker leads the row

Archived rows show a muted archive glyph before the title. It is not in the
trailing slot: that slot admits exactly one statement, `rowTrailingStatement`
records the three layouts that failed when it admitted more, and the archived row
is precisely the row that most often needs "· in conversation" (an archived
conversation found by search is usually found by its body). A leading glyph is
outside that rule rather than an extension of it.

**Its cost, recorded rather than hidden** (round 1, D4): the glyph plus its 4px
lead indents the title of an ARCHIVED row by 14–18px, so the title column is
ragged exactly in the view built to compare archived and live rows side by side.
The design round's cheapest fix — draw the marker in the existing ~20px status
column, which costs no new width — cannot be taken without either losing the
status glyph that shares that column or reserving the width on EVERY row, which
would take ~3 characters off every live title to remove a 14px rag from the
archived ones. Neither is cheap, so the rag is accepted and stated; the
measurement is in the evidence README.

### Fail-closed, stated as a measurement

With `session_archive` absent there is no slot on any row, no marker, no control
in the search block, no menu item, no `/archive` or `/unarchive` row in the
palette, and **nothing is hidden**: `visibleRows(rows, false)` returns the same
array, unchanged, because a client-side partition on a backend with no archive
store would hide conversations behind no visible affordance that could bring them
back. The frames measure what that does and does not mean
(`docs/evidence/session-archive/README.md`): the panel is the same except that the
archived conversation is now listed, and a 690x60 band around a live row is
byte-identical.

## The reserved slot, and the rule for the pair (round 1, design ruling)

The design round ruled the **first** slot stays at every width and verified the
no-reflow claim rather than accepting it. The second slot — the pin control's,
which this branch does not carry — is where the ruling binds: **two sibling slots
at ≥ 280px, one shared hover-revealed control holding pin + archive below 280.**
The numbers the ruling rests on, all of them from the frames (the sidebar occupies
device `x 440..999`, i.e. **280 CSS px**, the default; the clamp is 240–360):

| panel | no slot | one slot (this branch) | two slots (pin + archive) |
| --- | --- | --- | --- |
| 240 (clamp min) | 200 px | 172 px | **144 px ≈ 20 characters** |
| 280 (default, = these frames) | 240 px | **212 px — measured** | 184 px ≈ 26 characters |
| 360 (clamp max) | 320 px | 292 px | 264 px |

The arithmetic is one reservation of 28px (24px control + the wrapper's 4px gap)
per slot, subtracted from the panel: `panel − 68` with one slot, `panel − 96` with
two. At the clamp minimum the pair leaves a title that identifies nothing, paid on
every row whether or not the reader ever pins or archives — which is why the rule
sheds a slot below 280 rather than reserving both everywhere.

**A correction this record owes**: an earlier draft of the evidence README said
the frames were taken at a "shipped 320px panel". They were not — the panel is
**280px in every frame**, which is `DEFAULT_CHAT_SIDEBAR_WIDTH`.

## What was deliberately NOT built

- **No "Archived chats" section in the sidebar.** The pin work spent a design
  round fitting the sections that exist; a third would be chrome for a state the
  user enters rarely, and it would compete with the two that are already there.
- **No delete on the row.** See above.
- **No bulk archive or bulk delete.** Selecting many conversations is a bigger
  surface (selection state, a bulk confirm that names a count, a bulk refusal
  story) and nothing in the reports asked for it.
- **No "archive all previous chats" or age-based automation.** A silent rule that
  moves conversations out of the list is the one thing that would make the
  archive feel like data loss.
- **No schedule or timer on the delete.** A "deleted in 30 days" promise needs a
  reaper, a clock and a story about a machine that was off; the wire's delete is
  permanent and says so.
- **No second missing-session state.** Deleting the open conversation clears the
  selection and lands on the notice that already exists
  (`MISSING_SESSION_NOTICE_ID`), which the composer already reads.
- **No soft-delete / trash.** "Recoverable" is what the archive is for; a second
  recoverable state beside it would make the two indistinguishable.

## The interaction, end to end

1. **Archive a row**: the row's control (`aria-label` = `Archive “<title>”`)
   writes the desired state, the row leaves the list, the panel reports a refusal
   in its own register if the wire says no — and a successful press offers the
   same **Undo** the typed command does, because the row and its control are gone
   with it (round 1, UX U2: the same act used to report differently depending on
   the surface that performed it). The keyboard moves to the row that took the
   vacated place rather than to `<body>` (UX U5).
2. **Archive by command**: `/archive` on the open conversation does the same and
   offers the same **Undo**, under one retirement rule: the offer stands while the
   conversation still holds the state the offer was taken from, and is retired the
   moment this client knows it does not (`undoOfferStands`). An answer that merely
   MENTIONS the row no longer ends it — that version lasted 0.4–1.6s and nobody
   could reach it (round 1, UX U4).
3. **Find it again**: the search block, with `Include archived` on. The row is
   marked, and its control reads **Unarchive**.
4. **Restore the open one**: the header's `Archived` pill carries an unarchive
   control beside it; `/unarchive` appears in the palette only while the open
   conversation is archived. Typed on a conversation whose state this window does
   not hold, it says SO rather than claiming "not archived" (round 1, N4).
5. **Delete**: the conversation menu's `Delete conversation…`, or `/delete`
   typed. Both open the confirmation; confirming removes exactly this
   conversation, and keeps any subagent runs it started (the dialog says so when
   there are any). A live conversation is refused with the guard's own sentence
   PLUS the remedy this window actually has — the route's "stop it before deleting
   it" names a control this pane does not carry (round 1, UX U3) — and the
   refusal returns the keyboard to **Cancel** rather than leaving it on the
   destructive button. Closing the dialog hands the keyboard back to the control
   that opened it (UX U9).
6. **Deleted while open**: the pane lands on the missing-session state it already
   had (`MISSING_SESSION_NOTICE_ID`), naming the conversation that is gone, with
   the composer refusing input — and the row cannot come back from an answer that
   was already in flight, nor from a cached search answer (round 1, M1: the
   delete is a stamped write like the archive, via the store's `forgotten`
   tombstone).

## What is owed to QA, stated rather than assumed

`setSessionArchived`'s currency rests on an ordering assumption the client cannot
prove from here: that a read whose REQUEST started after the press observes the
write. If the sibling route answers a post-press read from before its own write —
two connections, more than one worker — an answer saying `archived: false` would
settle the client's fact and the row would reappear until the next page. The
comment in the store says so at the stamp; QA settles what the route actually
guarantees.

## Open for the design round

- **The pair rule** above is the design round's ruling and is carried to the pin
  pull request; this branch ships one slot, which is what the ruling keeps at
  every width.
- **The marker's ragged title column** (~14px, archived rows only) is recorded
  above rather than fixed: the two candidate fixes cost more than the defect.
- **The withdrawn panel is not DOM-identical**, and the earlier claim that it was
  is corrected here and in the source comments: with no capability nothing is
  hidden, so an archived conversation is LISTED where an enabled panel hides it.
  What is byte-identical is the 690×60 band around a live row, which is what the
  `cmp` in the evidence README compares.
