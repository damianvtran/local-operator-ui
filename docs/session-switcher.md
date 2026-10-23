# The Ctrl+Tab recent-session switcher

Hold Control, tap Tab, let go: the app walks the conversations you were last in
and switches to the one you stopped on. `Ctrl+Shift+Tab` walks the other way,
and Control with the backtick key (`` Ctrl+` ``) is an alias for "back", the same
step as `Ctrl+Shift+Tab`.

This note is the contract: which rows it offers, what each press and release
does, and the one sentence that decides Ctrl+Tab between the app and the in-app
browser. Code: `src/renderer/src/features/session-switcher/`. Tests:
`scripts/session-switcher.test.mjs`.

## The chord

| Gesture | Step |
| --- | --- |
| `Ctrl+Tab` | forward, wrapping at the last row |
| `Ctrl+Shift+Tab` | back, wrapping at the first row |
| Ctrl and the backtick key | back — the same step as `Ctrl+Shift+Tab` |
| release `Control` | commit the selected row |
| `Escape` | cancel, commit nothing |
| window blur, or the document going hidden | cancel, commit nothing |
| a press on a row | commit that row |

The chord is the **physical Control key on every platform**, macOS included:
`Cmd+Tab` never reaches this window (the OS application switcher owns it), so a
macOS user holds Control. Cmd, Alt and a bare Tab are all refused.

**Escape cancels whatever else is held**, because a run only exists while Control
is, so every real Escape during one carries Control too. It is claimed on the
window in the capture phase (`preventDefault` and `stopPropagation`), which is
what keeps it away from the chat pane's Esc-to-interrupt: pressing Escape to
leave the switcher never stops the running turn behind it. Cmd+Escape and
Alt+Escape are refused (they are other surfaces' gestures), and so is an Escape
that is cancelling an IME's candidate string.

**A press that reports Control up ends the run too**, cancelling and never
committing. The run is normally ended by Control's keyup, and that release can go
missing (an OS shortcut taken mid-hold, a keyup delivered while a native view held
focus); without this rule the overlay stayed up owning the keyboard, and the next
stray release somewhere else committed a row nobody chose.

**The backtick alias was checked before it was bound**: no main-process accelerator, no
browser chord (`shared/browser-chord.ts`), and the assignable grammar cannot
spell punctuation at all — so it was unbound everywhere in main, the renderer
and the console.

## The focus rule

**When keyboard focus is inside the in-app browser panel - its tab strip,
address bar/popout, start page, or the web page itself - Ctrl+Tab and
Ctrl+Shift+Tab switch browser tabs; everywhere else, the console included, they
open the session switcher, except while Tab is already claimed for a list: the
composer's slash list, or the canvas editor's list item it nests.**

It is one exported predicate, `browserOwnsTabChord(document, target)` in
`features/browser/hooks/use-browser-chords.ts`, wrapping the browser's own owner
rule (`chordOwner`). The switcher calls it on both keys and bails on true; it
does not consult `event.defaultPrevented`, and listener registration order
decides nothing.

Two halves of that are worth writing down, because they are properties of
Electron rather than of this code:

- **A driven page never sees this surface at all.** While a native
  `WebContentsView` holds focus the keys do not reach the renderer's DOM; main's
  per-view `before-input-event` hook answers Ctrl+Tab with the browser's own
  next/previous tab. There is no path from a focused page to the switcher.
- **The address bar and the tab strip are DOM, inside the browser root**, so the
  predicate sees them and the browser keeps the chord. The address bar's own
  `Tab` branch (`browser-url-bar.tsx`) handles a bare `Tab` for focus movement
  and returns; it never claims Ctrl+Tab, and the chord door runs before it in
  any case.
- Outside the browser nothing in main claims Ctrl+Tab: there is no menu
  accelerator for it, and the chrome/page input router returns without
  `preventDefault` when the browser owns neither (so the press reaches the
  renderer, and the Control release reaches it too — this surface never moves
  focus).

The console is the branch that needed code rather than a sentence: xterm maps a
tab to `\t`, so `Ctrl+Tab` only ever sent a shell a plain tab. Its own key handler
(`console-mirror.tsx`) now hands the chord back to the page, and also hands plain
Tab back while a run is open (see the lost-release rule above). Plain Tab stays
the shell's. The two lists that keep Tab are ones a popup or an editor owns on
purpose, and both claim it with `preventDefault`, which is the guard the switcher
already reads.

## The rows

- **A conversation on screen is row 0**, then up to four more: the most recent
  other conversations from the visit ring the command palette's Recents pin also
  reads (`conversationRecents`, written only by `use-conversation-recents.ts`).
  Five rows in total.
- **With nothing on screen** (a new draft with no session, Settings, the browser
  route) the five most recent conversations are the whole list. "On screen" is the
  route's answer, not the store's: `/chat` routes read the displayed session, the
  same gate `app.tsx` uses, because `activeSessionId` survives a navigation away
  from the chat and would otherwise make the conversation you just left row 0 - and
  the first press would step past it while nothing could take you back to it.
- **Archived and dead entries are skipped** by the palette's own join
  (`chatRecentsOfRow`), so an archived conversation — or one whose id outlived
  it — costs no slot, and the next eligible conversation fills it.
- **Busy conversations stay in the list.** Switching to one does not interrupt
  it; the row carries the same status mark the sidebar draws
  (`ChatSessionStatus`).

## The cursor

- It starts **on the current conversation**, and the **opening press counts**:
  the first `Ctrl+Tab` lands on row 1 (the previous conversation) and the first
  `Ctrl+Shift+Tab` on the last row. With no conversation on screen the cursor
  starts *before* row 0, so the two keys land on the first and last rows.
- Both directions wrap, identically.
- **Releasing Control commits.** Releasing on the current conversation closes
  without navigating.
- **Auto-repeat is swallowed and does not step**: one press is one step, and a
  held Tab cannot strobe the list or move focus.
- **Fewer than two rows opens nothing** and navigates nowhere — but the press is
  still swallowed, so Tab does not move focus out of the composer instead.
- A press that started inside an open dialog, menu or select starts no run (the
  app's own dispatch rule, `keyboard-scopes.ts`).

## The overlay

It paints only after the chord has been held for **180 ms**
(`SESSION_SWITCHER_REVEAL_MS`), so a quick tap-and-release commits without a
flash. The delay is measured from the chord's keydown, not from the Control
keydown: Control alone is held for longer than that every time somebody types
Ctrl+C.

The overlay **takes no focus**. It is a plain portal, not a `Dialog`: the caret
stays where the reader left it, Control's keyUp still lands on the document, and
a pointer press on a row commits without the button ever taking focus. It
registers itself with `useSuppressBrowserView` like every other overlay, because
a native browser view paints above all DOM.

Two things the pointer and a screen reader get, since the keyboard never enters
the panel:

- **Hovering a row moves the selection to it** - the palette's treatment, because
a press on a row commits the row it is over, so the pointer has to show which one
that would be.
- **The selection is announced**: a polite live region (`output`, off-screen)
speaks the row's name and its position ("2 / 5") on the opening press and on
every step. It is mounted while the panel is closed and starts empty, because a
live region announces a change - a node that arrives with its text already in it
is silent.

A row's press commits on `pointerdown`, not on `click`: the overlay only exists
while Control is held, so on macOS every press on a row is a Ctrl+click, which
Chromium turns into `contextmenu` with no `click` at all. Rows also swallow that
context menu, so the OS menu never opens over a surface that is up for a held
chord. The panel is the palette's own width and inset (`w-160`, 8 px), so two long
titles that share a prefix stay distinguishable in both lists.

## Not in the keymap registry

The assignable-shortcut grammar (`shared/keymap/keymap-chord.ts`) cannot spell
`tab` — the edit-ending keys are refused — and no binding in that registry can
express a gesture that commits on a key *release*. So this chord is a fixed one
with its own listener, and `RESERVED_CHORDS` needs no row for it: it cannot be
captured in the first place. `docs/design/keyboard-shortcuts.md` states the same
exemption.
