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
   in its own register if the wire says no.
2. **Archive by command**: `/archive` on the open conversation does the same and
   offers **Undo** in a toast, retired the moment an answer newer than the press
   speaks about the row — an offer is only honest while the state it was taken
   from still holds.
3. **Find it again**: the search block, with `Include archived` on. The row is
   marked, and its control reads **Unarchive**.
4. **Restore the open one**: the header's `Archived` pill carries an unarchive
   control beside it; `/unarchive` appears in the palette only while the open
   conversation is archived.
5. **Delete**: the conversation menu's `Delete conversation…`, or `/delete`
   typed. Both open the confirmation; confirming removes exactly this
   conversation, and keeps any subagent runs it started (the dialog says so when
   there are any). A live conversation is refused with the guard's own sentence.

## Open for the design round

- **The reserved slot costs the title 28px** (24px + the row wrapper's 4px gap)
  on every row at rest, and 56px once the pin control's own slot lands beside it.
  The frames and the arithmetic are in
  `docs/evidence/session-archive/README.md`. If that reads as too expensive, the
  alternatives are a single shared menu on the row (which the pin session
  rejected for its own control) or revealing on focus only.
- **The marker's weight** (`text-ink-dim`, 14px) is chosen to read as "filed
  away" rather than as a warning; a second opinion belongs in the design round,
  in both palettes.
