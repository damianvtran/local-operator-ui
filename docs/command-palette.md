# The command palette

One surface, opened with `Cmd+K` (`Ctrl+K` off macOS) or by pressing **Search**
at the foot of the app rail, that searches and runs everything the app can do
from one field.

This document is the contract, not the tutorial: what the palette reads, what it
opens, and which decisions are deliberate so a later change does not undo them
without noticing.

## The two gestures, and why one of them is not in the main process

| Gesture | Owner | Why |
| --- | --- | --- |
| `Cmd/Ctrl+K` | the **renderer** (`palette-shortcut.ts`) | Two surfaces in the canvas already own this chord — the code editor's AI edit and the Markdown editor's link insert, which is what `Cmd+K` means in every editor a user has met. The decision reads `defaultPrevented`, so the editor that got there first keeps it. A `before-input-event` hook in main fires before the renderer sees the key at all and cannot ask. |
| `Cmd/Ctrl+P` | the **main process** (`src/main/index.ts`) | The palette's original chord, kept for everyone who learned it from the app's own onboarding tour. It predates the palette's own shortcuts and still works wherever the window has focus. |

One keystroke, one owner, both decided in one place each. A press that both
answered would toggle twice and open nothing.

The **rail row** is the third door, and it exists because the chord is invisible:
a user who never learns `Cmd+K` would use the palette once, if at all. The row is
the only control the rail carries besides the account row, it is on screen on
every route, and it prints the chord so the rail teaches it without being asked.

**The chord is printed one way, and this paragraph used to say two.** The panel's
footer and the rail both draw it as the app's key cap (`KeyboardShortcut`), which
is a change from what shipped: the rail printed `⌘+K` as plain monospace because a
cap was filled `bg-sunken` and the rail was `sunken` at the time, so a cap there
would have had no ground of its own. That argument was sound about that cap and is
why the cap lost its fill rather than the rail keeping a second spelling: a cap now
carries no ground and no border on any surface, so the panel's footer, the rail,
the New chat row beside the sidebar and the inline editor's footer draw the same
box on different grounds (design round 1, D6). The rail's ground has moved since —
it is `surface` with a `border-r border-hairline` rule now, not the recessed
`sunken` step — and the cap's fill-lessness outlives the arrangement that forced
it: it is the construction every ground draws, not a rail workaround.

**The cap's ink is `ink-dim`, and the round that raised it to `ink-muted` was
undone by a measurement on the palette.** The step up was taken to stop the rail's
chord reading as fine print (it measured 5.76:1 against the label's 8.94:1), and it
is the wrong trade: `ink-muted` is above `ink-dim`, and `ink-dim` is what this app
prints a legend's labels in, so the annotation ended up louder than the thing it
annotated. Read out of the committed frames, a legend cap sat at 6.76–6.83:1
against the bar while its labels read 4.55:1 and 3.87:1, and on the active row the
`Go` verb read 4.54:1 against its own `↵` cap at 7.02:1 (design round 1, D2). At
`ink-dim` the cap clears § 3's 4.5:1 text floor on every ground it renders on
(worst 4.51:1, dracula on `elevated`), sits at or below its label, and the
monospace face and the one box are what say "this is a key". The rail is the one
place the chord is now the QUIETER of the two marks, and that is the intended
relationship rather than a regression: the label is what you read, the cap is what
tells you it has a key.

## What the palette says about itself

Four strings carry a decision, and each is easy to "tidy" into being wrong:

- **The degraded-search line names the state, not the only remedy.** "Conversation
  search is unavailable while the backend is unreachable, so chats are matched by
  name." and "Chats are matched by name. Update Local Operator to search inside
  conversations." are two sentences because they are two facts: `unavailable`
  means the capability was read and is absent, while an unreachable backend was
  never read at all. Telling someone to update an app that cannot reach its
  backend is a remedy that cannot work (design round 1, D2).
- **Rows do not repeat their group heading.** A settings SECTION row carries no
  hint; a registry KEY row names the section it lives in, which is the one thing
  its own name cannot say (design round 1, D3).
- **The clipped count is a sentence with a noun** — "showing the best 7 of 9
  matches" — and it sits beside the movement keys it qualifies, with the escape
  affordance taking the right edge. Two unrelated statements in one right-aligned
  slot read as one sentence (design round 1, D5).
- **The list fades at the fold, and only when there is a fold.** The scroll
  container's inset is an overlay rather than a spacer in the flow, and the
  condition is MEASURED — the content's height against the scroller's box — not
  inferred from `clipped`, which is a statement about the result cap and is false
  on the commonest overflowing list of all, the browse layout. `clipped` still
  drives the footer's "showing the best N of M", which is the question it
  answers; the fold has its own (design rounds 1, 2 and 3, D1, D7 and the MAJOR
  that pairing the two produced).

## What a query means

A query is a **scope** and some **terms**.

| Prefix | Scope | Word form (first token, with terms after it) |
| --- | --- | --- |
| `>` | commands, pages and panels | `command`, `commands`, `action`, `page`, `go` |
| `#` | conversations | `chat`, `chats`, `conversation`, `session` |
| `@` | agents | `agent`, `agents`, `bot` |
| `,` | settings | `setting`, `settings`, `preference`, `config` |

Two rules, both about words being things a user might be looking FOR:

- **words scope the query only as the first token**, so `theme settings` searches
  for a row containing both words while `settings theme` looks inside settings;
- **and only when terms follow it**, so `chat` on its own searches for "chat"
  rather than answering with an empty chats list. A glyph carries no ambiguity,
  which is why a bare `#` IS a scope.

`/` is deliberately **not** the settings prefix: this app already gives `/` a
meaning in the composer (its slash-command menu), and a palette where `/` means
settings would teach two answers to one gesture. `,` is VS Code's settings
prefix, which is the convention most users have met.

The scope legend is rendered in the palette's footer whenever the query is empty
or found nothing — the two states where a hint is worth its pixels.

## What it searches

| Group | Source | Where the answer comes from |
| --- | --- | --- |
| Go to | the app's routes | static, with a keyword table for the words people use ("cron" → Schedules, "dark mode" → Appearance) |
| Chats | the conversation store | **the backend's search** (`sessions.search`, negotiated as `session_search`) joined by the sidebar's own `searchChats`, so the two surfaces cannot answer the same query differently; degrades to title matching when the backend cannot search |
| Agents | the agent roster | fetched once and matched locally; past one page the backend is also asked for a name-filtered page, so a large roster stays searchable |
| Actions | the app's own commands | new chat, create agent, canvas toggle, clear conversation — each offered only where it can work |
| Panels | the slash-command destinations | `info`, `usage`, `analytics`, `session.diagnostics` — see below |
| Settings | the settings rail's sections **and** the backend's settings registry | a registry row deep-links to `/settings?setting=<key>`, the settings page's own reveal-and-focus target |

### Panels are destinations, not routes

`/info`, `/usage`, `/analytics` and `/session` present in a picker slot rather
than at an address — the mental model is "open a panel, Esc closes it", and a
route would need its own deep-link semantics, its own Esc handling and a
back/forward story for a modal. The palette therefore does not open them: it
writes a request (`panel-presentation-store.ts`) and a presenter consumes it
exactly the way a typed command is consumed. One implementation of each panel,
and the palette gaining nothing but a way to name one.

**There are two presenters now**, which is what makes the panels readable from
any page. `/info`, `/usage` and `/analytics` describe the MACHINE and read no
conversation: the chat pane presents them whenever it is mounted, and the shell's
`PanelOutlet` presents them on every route the pane does not own — so choosing
Analytics while reading Settings opens the panel over Settings rather than
throwing the user back to chat. Which host acts is decided by a CLAIM rather
than by the route: the pane claims the slot on mount and releases it on unmount,
and the shell presents only while no claim is outstanding. A route check would
have been the tempting predicate and the wrong one, because the chat route also
paints its connecting and error states, where nothing can present anything.

`Session` is a reading **of a conversation**, so it keeps both gates: it needs a
live session (`session.diagnostics` on a draft would report on a session that
does not exist yet) and therefore still routes the user to chat. Analytics is in
neither the pane-only set nor a special case: its conversation half — the "This
session only" scope — appears only where a conversation is in front of the user,
which is the pane.

The request is one-shot (matched on its own nonce) and expires, because a request
nothing consumes is a request the user asked for in another context: with a pane
mounted the window is one frame, and for the machine panels the shell answers it
immediately.

**The machine rows are gated on whether the backend is live**, the rule this
palette holds every row to ("a palette that lists an action it cannot perform is
worse than one that omits it") — with the backend down the machine panels have
nothing to read, and the driver scene with no backend asserts that no panel row
is offered. They are gated a second time on **main's own answer about the
credential** (`DaemonStatusSnapshot.desktopAvailable === false`, QA round 1 Q-1):
`/v1/capabilities` is an unauthenticated route, so a daemon this app cannot
authenticate to still advertises the features the liveness bit reads, and the row
would open a panel reading "Desktop authorization is required." in every section.
Only an explicit `false` closes that gate — a host with no main to ask is not a
refusal. `/session` additionally requires a pane that can present it, since that
pane is its only presenter.

## How matches are ranked

- **Tiers, not booleans**: exact word > word prefix > substring > subsequence
  (`rta` → "Retention analysis"). The loose tier is refused below three
  characters, because a one- or two-letter subsequence matches nearly every row.
- **Every token must match**, so a second word narrows rather than broadens.
- **Field weights**: name > keywords/aliases > hint > group > help text.
- **The backend's tier outranks text**: a conversation the store knows by content
  outranks one whose title merely contains the letters, which is the same order
  the sidebar uses.
- **Groups are ordered by their best row, then capped**: the answer to the
  question leads the list, and no one source can bury the others. A scope gives
  its group more room, because naming a source is the user saying which they mean.
- **Loose matches are dimmed**, and a conversation matched on its body says so
  ("In conversation") — a row whose name shares nothing visible with the query
  reads as a bug unless it is marked.

## Performance contract

What a keystroke costs is a pass over an in-memory array. What it never costs is
a network round trip:

- the field is uncontrolled by the list: `useDeferredValue` lets React draw the
  character immediately and re-rank when it has spare time;
- **one request per source, not per keystroke** — the agent roster is fetched
  once and matched locally; the settings registry is one cached query shared with
  the settings page; the conversation search is debounced by the module that owns
  it (150 ms) and is skipped entirely when the scope excludes chats;
- the rendered list is capped (6 per group, 24 for a scoped group, 48 total) and
  the legend says when the answer was clipped.

## Focus

- The query field takes focus on open, from every door — the chord, the rail row,
  and the onboarding tour driving the store.
- Focus stays there for the dialog's whole life: the list is walked with
  `aria-activedescendant`, so every keystroke still reaches the field.
- `Up`/`Down` walk the list; `Enter` runs the active row; `Esc` closes.
  `Home`/`End` are **not** intercepted — they move the caret, because a user who
  cannot fix a typo without leaving the list has lost the surface's whole premise.
- Closing restores focus to whatever had it before the palette opened, falling
  back to the rail's Search row. This is explicit rather than inherited: a Radix
  modal ends by focusing its trigger, this surface has none, and before this the
  gesture left focus on `document.body` — a keyboard user had to click before the
  keyboard worked again.
- One close is exempt, and it is the one where the row the user picked **moved
  the view**. Picking another conversation, or the `New chat` row, changes the
  identity the pane is keyed on (`SessionPanel key={identity}`), so the pane and
  the composer under it are replaced, and the node captured at open belongs to
  the pane the user has just left. A moved view **never** restores to that node —
  being still in the document is not being still the thing the close should
  return to, and the door that proves it is the rail: open the palette from the
  sidebar's Search row and pick a conversation and the captured node is that rail
  button, which survives the switch, so a rule that asked "is the captured node
  usable" first put the caret back on the rail 8.6 ms after the destination
  composer had focused itself. Instead the moved view decides first, and the
  caret's state picks the rest: unclaimed (still on the palette's own field, or
  nowhere) hands it to the composer the close mounted, and already claimed by
  another field moves nothing — which is the measured ordering in every entrance,
  the composer focuses itself several milliseconds before this restore runs. A
  moved view with no composer to hand the caret to still ends on the rail's
  Search row, never on the body. The rule and the three orderings of that race
  are in `composer-caret.ts`, and its eight cells are pinned in
  `scripts/palette-focus.test.mjs`; "the view moved" is asked of the pane's own
  identity (`panelIdentityOfView`), so every row that switches a conversation is
  covered without that row having to remember to declare itself.
- A close that did **not** move the view is the pre-existing rule unchanged, and
  that is what keeps `Esc` and the panel-exit path byte-for-byte what they were:
  if the captured node is still usable the caret goes back to it, whatever else
  holds the caret at that moment; if something else took it and the captured node
  is gone, nothing moves at all; and with nothing restorable and nobody holding
  the caret, the fallback is the rail's Search row, never the body.
- A composer that **refuses input** is still a legitimate destination for the
  moved-view restore: it holds the reader's own words and keeps the caret
  (`readOnly`, not `disabled`). The composer's own mount self-focus keeps its
  `!isInputDisabled` gate, so the rule is the same from every door — a
  gesture-driven restore may land in a box that refuses input, an unprompted
  focus grab may not.

## Adding a row

1. Add it to the right builder in `palette-search.ts` (pure: no React, no
   imports), or to the arrays in `use-palette-sources.ts` for anything that needs
   a hook.
2. Give it `keywords` — the words a user would type for it, not a restatement of
   its name. This is where the aliases that make the palette feel semantic live.
3. Give it a `verb` if "Run" is not what Enter does.
4. If it needs a backend, gate it on the capability that would answer, and say in
   the comment what the row would be without it. A palette that lists an action it
   cannot perform is worse than one that omits it.
5. If it is a visual state worth looking at, add a story to
   `command-palette.stories.tsx` and an entry to `STORIES` in
   `scripts/capture-evidence.mjs` — the evidence set is the review surface.
