# The canvas Files view — the list, its search, and the reachable last row

Status: **implemented** on `feat/canvas-files-list`. This is the record of what
the surface IS, written beside the code and the frames it describes, so the
decisions a later reader would otherwise re-litigate are findable in the tree
rather than only in a pull request's thread.

Read with: `docs/branding.md` (the design contract — every role named below is
checked against it), `docs/evidence/canvas-workspace/` (the rendered frames this
change re-shot and added), `AGENTS.md` (environment, evidence, gates).

---

## 0. The defect, and why it was one class

The operator reported that the Files view's last rows were sliced at the window's
bottom edge and no scrolling revealed a bottom padding.

The cause is in the ancestor chain, not in the list. `canvas/index.tsx` is
`flex h-full flex-col` and its first child is the 40px chrome bar
(`h-10 shrink-0`); the Files view's root was a SIBLING of that bar carrying
`h-full`, so `height: 100%` was resolving against the pane while the box also had
to hold the bar — 40px more than the space it had. The dock's `overflow-hidden`
cut that band off, so the scroller inside reached its own maximum scroll with the
last rows still under the clip and its own bottom padding inside the band.

`h-full` was doing two jobs: the flex base size, and the item's specified size
suggestion, which caps the content-based minimum size (CSS Flexbox § 4.5). That
minimum binds because the item's `overflow` is `visible`, and its content is a
long list, so flex could not shrink it back.

The fix is the root's class: `flex min-h-0 flex-1 flex-col`. `flex-1` states what
the element is — the rest of the column, not all of a box that also holds the bar
— and `min-h-0` removes the floor. It is also the spelling the variables viewer
already uses.

**Measured, in the built app against a real 341-file session, before and after**
(`scripts/mentioned-files-app-proof.mjs --geometry`, window 1380x900, so
`innerHeight` 868). Both runs are the same instrument against the same session;
the before run is the pristine base, the after run is this branch:

| quantity | before (`main`) | after |
| --- | --- | --- |
| viewer root computed `height` / `min-height` | `868px` / `auto` | `828px` / `0px` |
| scroller's bottom past the window edge | **40px** | **0px** |
| scroller's bottom relative to the dock's | −40px | 0px |
| last row's bottom at maximum scroll | **883.67** | **860** |
| last row's visible fraction | **0.89** | **1.00** |
| rows with their bottom past the window edge | **2** | **0** |
| the probe's verdict / exit code | FAIL / 1 | PASS / 0 |

The defect cannot come back silently: `--geometry` now asserts it, and exits
non-zero when the last row is not reachable.

---

## 1. The list

One row per file, 36px tall (`h-9`), a `ul` of `li`s with a button each. No
`role="listbox"`: there is no selection model (the row's action is "open this
file"), and a listbox without one is a lie to a screen reader. The row's
accessible name is its own text — name, directory, size or receipt — and it
carries **no `aria-label`**, because one would replace that text and take the
missing-file receipt with it.

Slots, in order: a fixed 28px leading visual; the name (`text-body-sm`,
`flex-1`, so it is the last thing to truncate); the directory (`text-mono-sm`,
inline, and the FIRST thing to give up width); and one right-hand slot holding
either the probe's size or the receipt. The `⋯` menu is absolutely positioned in
a trailing 28px the row reserves with its own `pr-8`, so revealing it covers
nothing — and it comes AFTER the row's button in DOM order, which is the tile
grid's own keyboard fix kept: the row's first Tab stop is the file, not a menu.

The current file (open in the Documents view) takes the shared current-row role,
imported from the chat panel rather than re-spelled; its `hover:` half is what
stops the row's hover step repainting a row the user is IN.

### What the tile grid established, and survives

Three rules, each of which replaced a defect:

- **Append order is the order.** First mention, never re-sorted; a stat answer
  arriving must not move a row under the pointer. The search and the filter are
  FILTERS, not sorts: they narrow the same order.
- **A basename collision keeps both rows** and draws the directory line on them.
  Identity is the resolved path. Following design round 1's D1 the line is
  shortened from the LEFT (`displayParent`) so the segment that disambiguates
  survives, and the full path stays the tooltip.
- **`missing` is a receipt, never a filter.** The row stays in place, in append
  order, with a working Copy path, and clicking re-probes once and explains
  rather than opening nothing.

### One decision: the directory line is drawn on a CLASH ONLY

The alternative — a directory on every row — was drawn at the dock's 400px end
during the design pass and truncated two of seven names to make room for a line
most rows did not need. The line is inline, so a clash costs no row height; on
every other row the line goes to the name, which is the thing being scanned.
`docs/evidence/canvas-workspace/files-narrow/` is that width, rendered.

---

## 2. Search

Matches the row's **name and its path** — the real path AND the `~`-abbreviated
one, so `~/work` finds a row whose directory reads `~/work/reports` — never the
`…/` shortening the row paints, because that is a spelling the user did not
type. Every whitespace-separated token must match somewhere in the row (an AND),
case- and accent-insensitively through the app's own `fold`. A whitespace-only
query is no query, and there is no minimum length: nothing is hidden by default.

The pure functions are `buildFileRows` and `filterAndSearchRows` in
`file-rows.ts`, so all of this is assertable without React.

### Two numbers, or the list lies

Whenever a query or a filter is ACTIVE the head states both: `3 of 12 files`. The
first number is what the reader is looking at, the second is the panel's own
completeness claim — a query that hides a file must not be able to hide that the
file exists. With neither control on, one number (`12 files`) is the honest one.

### The query is component state, not store state

The canvas store is persisted to `localStorage`, and the repo's doctrine for
this is *a mode of a pane is not a preference* (`ui-preferences-store.ts`,
quoting `docs/run-sidebar.md` § 3.5). A persisted query would re-open the panel
filtered on the next launch with no visible cause, and a query stored per
conversation would silently change what a panel shows when the user switches
sessions.

The cost, stated rather than hidden: switching views unmounts the panel, so the
query resets. That is cheap to re-type, where a stale filter is not — and while
either control narrows the list the head states both numbers.

---

## 3. The filter

ONE control, a multi-select menu of nine kind groups derived from
`CanvasDocumentType` (`Images`, `Video`, `Audio`, `Documents`, `Spreadsheets`,
`Presentations`, `Code`, `Archives`, `Other`) — not twelve types, and not
extension lists, which once disagreed with the classifier. The trigger reads
`Filter` at rest and `Images +1` when narrowed, and its accessible name always
names every selected group. It takes the accent wash while narrowing, which is
the app's treatment for an active state.

Two things it deliberately does NOT do: there is **no default filter that hides
files**, and there is no default "hide missing" — a missing file is a receipt
(§ 1). Absent `availability` is not missing: it means the probe has not answered.

---

## 4. States, and the copy that distinguishes them

| state | head | body |
| --- | --- | --- |
| no files, scan not running | hidden | `No files yet` / the sentence that says what appears here |
| scan running | count + `Searching earlier messages… N messages scanned` | the rows found so far, or `Searching earlier messages…` |
| scan stopped | + the stop sentence and `Search earlier messages` on its own full-width row | the rows found so far, or `No files in the messages searched` |
| nothing matches the query | `0 of 12 files` | `No files match “…”` + what the search matches + a `Clear search` action IN THE BODY |
| a filter hides everything | count, filter named in the trigger | `No files of those types` + a `Clear filter` action |
| one file / hundreds | `1 file` / `412 files` | — |

Two rules hold this table together. A query's emptiness never borrows the scan's
copy — "there are no files" is a claim about the conversation, and the query is
what emptied the list. And the head renders on `files.length > 0` rather than on
the visible row count, so a query that matches nothing cannot take away the field
that typed it.

No render window is added: at 341 rows the list is lighter than the grid it
replaces (a 36px row with a 28px thumbnail against a 140px tile), and the count
is the statement that keeps a future window honest.

---

## 5. The blank canvas

`Nothing open yet` now offers three actions, always in this order: `Browse
files (N)`, `Open file from disk`, `New file`. The order is fixed — an action
that moves between conversations is the same defect as a row that re-sorts
itself — and only the weight varies: with files to browse the Files action is the
panel's one `primary`, and with none it is a `secondary` like its siblings rather
than spending the accent on an empty destination (and it drops the count instead
of printing `(0)`).

`Open file` is now `Open file from disk` in the action, the chrome bar's tooltip
and its accessible name, so one action has one name in the app.

---

## 6. Evidence

- `docs/evidence/canvas-workspace/files*/` — the list, re-shot across the twelve
  sweep themes, plus `files-narrow` (the dock's 400px end), `files-filtered` and
  `files-no-matches` (both driven through the real field by their play
  functions), and `files-scrolled` (forty-eight rows at maximum scroll, which
  throws if the list did not scroll or if the last row's bottom is past the
  window).
- `docs/evidence/canvas-workspace/nothing-open/` — the blank canvas.
- `scripts/mentioned-files-app-proof.mjs --geometry` — the numbers in § 0, with
  the vertical claim as an assertion rather than a printed figure.
- `scripts/mentioned-files.test.mjs` — the view model: the three kept rules, the
  token AND, folding on both sides, the abbreviated path, kind grouping, the size
  slot's `null`, and the count's two-number rule.

---

## 7. Deferred, deliberately

Recorded here so each is a decision rather than an omission. None is a ticket.

- Arrow-key row navigation, roving tabindex, Home/End and typeahead. The grid had
  none, and adding one changes the interaction flow, which deserves its own pass.
- A scoped `/` (or another chord) to focus the search from inside the canvas,
  with its `keyboard-scopes.ts` test. `⌘F` is not free, and this pane already
  shares `⌘N` under a scope test.
- A render window for a very long list, with the sentence that says how many rows
  are held back — only when a real conversation needs it.
- Sorting by name, size or modified. Append order is the rule, and a sort control
  is a second way for a row to move.
- File-content search: this panel reads no bytes, so that is a backend feature.
- Remembering the query across a view switch (§ 2).
- A selection treatment for rows; the list has hover, current and focus, and no
  multi-select to give a selection meaning.

## 8. Not touched, and why

The variables viewer, the run panel and the documents view were audited and are
already correct — each carries `min-h-0`, or overflows through a container whose
`overflow` zeroes the automatic minimum. Two same-shape `h-full` blocks (the
Files panel's own `No files yet` state and the variables panel's centred state)
fit only because their content is short; they are a latent trap rather than this
defect, and widening the diff to "clean up every `h-full`" would grow the
evidence set for no measured gain.
