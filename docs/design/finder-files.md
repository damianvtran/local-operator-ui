# Finder Files — one inventory, bounded presentation

This is the current Files presentation. `canvas-files-list.md` records the preceding
flat-list/artifact fix and its retained identity/action invariants; this document
supersedes its flat layout and ephemeral type-filter choices. The design input
was the designer's Finder Files spec (2026-10-14, main at `4818c322f`).

## Membership is not a UI inference

When `features.session_files >= 1`, the backend `/files?scope=family` result is
exclusive authority: the UI does **not** union transcript mentions into it, even
when that result is empty, building, failed or unsupported. Only a known
capability-absent backend enables the legacy transcript scanner. Negotiation,
unresolved frontend metadata and known remote placement are not permission to
stat transcript paths on this disk.

The existing desktop transport carries two operations: `sessions.files` and
`sessions.files.materialise`. The latter is a user-selected path action, not a
thumbnail side effect. A child attachment retains the parent URL session plus
`session.child_id`; opening, copying and saving all use that same resolver.
Artifact tabs use the transcript's canonical `artifact:<digest>` identity;
`CanvasDocument.indexedFileId` retains the backend row handle for explicit
materialisation only, so index and transcript opens do not create duplicate tabs.
The shared inventory lives in ChatContent: the rail and open canvas read one
count and one generation, including while the canvas is closed.

## Structure

The Files segment is labelled. The body has search, a single sort menu and type
filter, followed by counts and the session folder action. A selected/persisted
filter is visibly active and has Reset filter. Search is not persisted.

Highlights are first, expanded, with the producer's why. Remaining working files
are collapsed by default when Highlights exist. Search/filter forces them open.
Otherwise kind sections stand alone: Images, Videos, Documents (text/code/PDF
etc.), Spreadsheets, Other. Images use a width-derived 2–6-column grid; videos use
full-width reserved bands; other kinds use compact rows. Kind grouping can be
turned off; there is no competing list/grid toggle.

Sort is Mentioned, Name, Kind, Modified, Created or Size, with per-key default
order. Unknown metrics sort last in either direction. First-mention ordering is
retained from the journal metadata, not from an array's current paint order.
New backend/stat membership is deferred while the pointer/focus is in the list
or its lightbox is open. Unsupported/remote transitions override that deferral.

Sort/order, group-by-kind, Working/Highlights/kind disclosure and type filter are
user-wide profile preferences (existing preference store v4). Search is transient.
A migration sanitises hand-edited enum/array values. Narrowing temporarily opens
all sections with matches without overwriting those saved folds.

Sorting is presentation-only over loaded rows: it cannot restart pagination.
All cursor pages and backfill slices are assembled privately, including the cold
first pass. Until a complete ready generation exists, the view shows loading or
building with indexed-pass loaded/total progress, never provisional file rows or
thumbnails. Same-session Retry and turn-settle refresh retain the former complete
generation until its replacement is ready, then swap atomically. This costs an
initial full pagination wait, but prevents client sorting from remounting entire
thumbnail viewports per page or late Highlights snapping above a partial list.
A new revision on a cursor-less building poll is legitimate progress, not a
defensive-reset budget failure.

## The keyboard contract

This is a button/list composition, **not** an ARIA grid/listbox. One list control
is tabbable. The active file is retained in the render window. Arrows follow the
same pure row/column geometry that places it; arrows also reach disclosure
headers. Left/Right on a header collapse/expand. Home/End and Page Up/Down move
within the layout; printable input type-aheads over matching names. Shift+F10
opens the shipped menu, including Expand image, so revealed pointer controls do
not become hidden keyboard dependencies. Slash focuses search within this view,
but does not steal slash from editable controls. Escape clears an applied
search/filter first; otherwise it remains the canvas family's dismissal.

Lightbox/collage navigation is the shipped `ImageLightbox`, over matching images
in their current order, excluding folded-away sections. It resolves an original only when explicitly expanded,
has a finite failure state, and restores the opening row rather than the last
picture visited in the carousel. Menus reuse `ImageActionsMenu` and its action
table, not a second copy of clipboard/save/location logic. Menu dismissal restores
the visible roving row, not the hover-only ellipsis. Path-action menus disclose
that the action prepares a local scratchpad copy; preparation failures are not
reported as a failed Save operation.

## Remediation evidence geometry

The dock's width came from `canvasDockWidth` and its own 560px cap
(`CANVAS_PANE_MAX_PX`) when this remediation matrix was measured; that cap is now
the slot's one ceiling (`RIGHT_SLOT_MAX_PX`, 1200), so the figures below record
the tree the matrix ran on. It measures a
real 400px dock, narrow overlay and 560px maximum, plus a 960px window with its
actual pane width reported. It does not invent a 960px dock or widen the global
canvas contract at the time. Sticky headers pin at the scroller top: vertical padding is on
the bottom/content, not above that sticky coordinate.

## The resource boundary

`finder-layout.ts` is a pure mixed-height layout; `finderWindow` binary-searches
its bands with at least 600px overscan. The scroller alone is observed, rows have
reserved geometry, and native sticky section headings stay mounted. Thumbnails
mount with the window but read only near the viewport. Four concurrent reads,
640px maximum downscaled PNGs, and 150 warm LRU entries bound the working set.
A transient failure is retried on remount. Blob URLs/bytes are not put into the
persisted canvas store.

Video bands deliberately use metadata/glyphs rather than fetch every whole clip
for a decorative first-frame poster. Playback uses the existing canvas player.
This is the bounded-I/O choice: the current attachment relay has a 32 MiB whole
asset ceiling and no poster endpoint. That ceiling/large-clip limitation is not
changed or claimed fixed here.

## State/evidence boundary

Empty, loading, partial building, stat-incomplete, failed and unsupported states
are distinct. A bounded building poll has an explicit Continue/Retry endpoint;
cancelling an owner generation prevents a stale page from committing or issuing
its next request. A render-phase owner fence also prevents a previous session's
absolute paths appearing before effect cleanup. A reset cursor/revision replaces
prior pages rather than appending an inconsistent window.

Headless app evidence and actual scale counters live in
`docs/evidence/finder-files/`. Controlled loading/503/building stimuli are marked
as such; normal populated/empty/child containment use the real isolated service.
The mobile/TUI implementation boundary is `session-files-parity.md`.
