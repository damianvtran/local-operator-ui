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

**The chord is printed two ways, and that is one decision, not an
inconsistency.** The panel's footer draws its keys as the app's key cap
(`bg-sunken`); the rail draws `⌘+K` as plain monospace at the row's own ink
(`ink-muted` — it was `ink-dim`, which measured as fine print: 5.76:1 on the rail
against the label's 8.94:1). A cap is `sunken`, and the rail IS `sunken`, so a cap
there would have no ground of its own and would read as a boxless glyph; the panel
sits on `elevated`, where a cap does have one. Two grounds, two treatments —
recorded here rather than "fixed" in either direction (design round 1, D6; the
ink step is a change, not a hierarchy: the chord and the row's label share the
role).

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

`/info`, `/usage`, `/analytics` and `/session` present in the chat pane's picker
slot, whose adapters need that pane's session handle, command catalogue and
rebind path. The palette therefore does not open them: it writes a request
(`chat-panel-request-store.ts`), routes to the chat pane when it is elsewhere,
and the pane's dispatcher consumes it exactly the way a typed command is
consumed. One presentation slot, one implementation of each panel.

The request is one-shot (matched on its own nonce) and expires, because nothing
can consume it while no chat pane is mounted — an old request means the pane
never arrived, and acting on it later would open a panel the user asked for in
another context with nothing on screen to explain it.

`Session` and `Analytics` are readings **of a conversation**, so they also
require a live session: `session.diagnostics` on a draft would report on a
session that does not exist yet, and Analytics' "this session" scope would have
nothing to scope to.

**All four require a pane that can present them.** The pane exists when the
catalogue capability is live and the route resolves to a session or a draft —
with the backend down the chat route paints its connecting state instead — so on
such a machine the palette offers no panel row at all. That is the rule this
palette holds every row to ("a palette that lists an action it cannot perform is
worse than one that omits it"), and the driver scene with no backend asserts it.

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
