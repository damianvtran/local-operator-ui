# Chat link affordances: detected targets, the hover toolbar, and Quote

Written at UI head `f48da23a0` (branch `feat/chat-link-affordances`, off
`origin/main` = `318cbb75e`, released as `local-operator-ui` 0.26.5). Line
citations are against that tree.

## 1. What the operator asked for, and what was wrong

Verbatim: file links should be clickable, hovering one should offer copy,
visit/open and open folder "if it's a file and not a URL", the toolbar must play
well with the quote button and offer Quote when part or all of a link is
selected, and a URI that is *detected* but not written as a markdown link should
get the same URI styling — without disrupting links markdown already captures.
"Make the UX improvements, thoroughly test, and then release."

The case that motivated it: an assistant turn rendered

```
File: ~/workspace/opoint-renewal-2026-09-17/opoint_adverse_media_query_failures_2026-09-17.xlsx (37 KB, 8 sheets)
```

as dead text. The app could see the path and could do nothing with it: no
anchor, no click, no copy, no reveal.

## 2. Detection: a remark plugin over the mdast

`remarkLinkifyTargets` (`src/renderer/src/features/chat/utils/remark-linkify-targets.ts`)
rewrites two node kinds and no others:

| node | rule |
|---|---|
| `text` | every admitted target inside it becomes a `link` atom, spliced in place |
| `inlineCode` | only when the span's ENTIRE value is one admitted target |

Refused structurally (never visited): `code`, `link`, `linkReference`,
`definition`, `image`, `imageReference`, `html`, `inlineMath`, `math`. That list
is the argument for a plugin over the two alternatives: a **string pre-pass**
cannot tell a path in a fence or in an existing link's label from one in prose —
and this repository already recorded that dead end (`convertUrlsToMarkdownLinks`
in `markdown-renderer.tsx`, which "did nothing, ever") — while a **DOM walk**
creates nodes React does not own and cannot see the source at all.

```
`~/x/report.xlsx`      -> linked (whole span, keeps its inlineCode child)
`rm -rf /tmp/x`        -> literal
`--out=/tmp/x`         -> literal
`/tmp/a.pdf /tmp/b.pdf`-> literal (two targets in one span is not "the whole span")
```

The plugin takes **no options** and its plugin arrays are module-scope constants
(`GFM_LINKIFY`, `GFM_MATH_LINKIFY`), because a per-render array is the memo miss
`MARKDOWN_COMPONENTS`' own comment records.

`MarkdownRenderer` gained `linkify` (default on). The canonical streaming row
turns it off (`AssistantRow`, `linkify={!record.streaming}`): a row still
receiving deltas is a prefix the next token falsifies, so
`/Users/x/opoint-renewal-2026-09-1` would become a link to a path that does not
exist and then silently re-link as the rest of it arrived. The legacy
`StreamingMarkdown`'s closed blocks keep it on — a closed block's source can
never change again — and its in-flight tail is literal text and is never parsed.

## 3. One grammar, two surfaces

`src/renderer/src/features/chat/utils/link-grammar.ts` holds the token grammar
(`PROSE_PATH`, `FILE_URL`, `TRAILING_PUNCTUATION`, `SHELL_METACHARACTERS`,
`URL_QUERY`, `URL_TRUNCATION`, `API_PATH_PREFIXES`, `MAX_CANDIDATE_LENGTH`,
`ALLOWED_PREFIX`, `normalizeCandidate`, `normalizeFileUrl`, …) and the
span-producing scanner `targetsIn(text, policy)`. `mentioned-files.ts` imports it
and its list producers are one-line filters over it; that move is MECHANICAL and
its own 42-test suite passes untouched.

The two surfaces call `targetsIn` with different policies, and the differences
are enumerated on `TargetPolicy` so a reviewer can reject one alone:

| | Files panel (`MENTION_POLICY`) | Linkifier (`LINK_POLICY`) |
|---|---|---|
| known extension required | yes (`~/x/report.xlsx`, not `~/x/proj`) | no — a directory is useful to open |
| `file://` needs an extension | no | no (the same on both sides) |
| relative tokens (`notes.md`, `src/foo.ts`) | never | never — no cwd, so no root to guess |
| fragment guard (`rejectFragments`) | off | on |
| evidence gate (`evidence`) | off — no oracle is supplied, and an absent oracle REFUSES | on — the session's own probe cache answers |

The two surfaces differ in exactly **three admissions**, each of them expressed on
`TargetPolicy` so a reviewer can reject one alone (round 1, review M2: this table
said "exactly one" for the extension filter, and two other comments counted a
"fourth" difference; that round's answer was two, and this change measured a third
— see below for why the count moved, and why the evidence gate is not something the
panel could switch on). The fragment guard is the one that needed a decision. The
panel never needed it,
because the extension rule was doing its job by accident: `/tmp/{a,b}.ts` arrived
as `/tmp/` and was refused for having no extension. The linkifier drops that rule,
so without the guard the brace expansion renders a link to `/tmp/` and macOS's
`screen(1).png` renders one to `.../screen` — an anchor whose whole claim is
wrong, where a missing tile never was. The guard admits the file-url scanner's own
shape (an opening bracket that closes further along the token is a name carrying
on) and drops the fragment rather than guessing, which is the direction
`scanFileUrls` already takes.

**The evidence gate is the third admission, and it is the only one that is not a
boolean.** A bare extensionless token — `/new`, `/tmp`, `/v2/things` — is one
shape to a text scanner and three different things to a reader: a slash command
the transcript is full of, a directory, or a typo. Only the disk tells them apart,
so the linkifier takes an ORACLE (`evidenceFor`, reading the answers the toolbar's
probe already cached) and admits such a candidate only when the disk says it
exists. The panel supplies no oracle and needs none: its extension rule has
already refused every ambiguous shape before that question is reached, which is
why the order in `targetsIn` is load-bearing and why an absent oracle REFUSES
rather than admits. Without it the linkifier underlined `/new` in the operator's
own sentence and the hover answered `No file at /new`.

**A `#` is not part of a path, on either surface** (round 1, review M4). This is
grammar rather than policy: the same rule `normalizeFileUrl` already applies to a
`file://` URL — a fragment is not a path — is now applied to a bare token, so
`/tmp/a.pdf#page=2` links the file that is actually there and leaves the reader's
`#page=2` as ordinary text. Before it, the linkifier admitted the whole token and
rendered an anchor whose target named a file nothing has. The cost is stated
where it is paid: a file whose NAME contains a `#` is linked as the part before
it, and the toolbar then reports the path it cannot find, which is a press that
explains itself rather than a silent refusal.

## 4. What a click does, and the three traps

**A local path this app can SHOW opens in the pane's own canvas.** That is the
operator's ask of 2026-09-18 ("opening up files ... supported by canvas view
(PDFs, XLSX/csvs, text, markdown, etc) by default are opened in the canvas
instead of opened by the OS unless the user clicks to open with default
application in the hover popup (add this)"), and it is the one row of this table
that changed. "Can SHOW" is `viewerFor(path, type)` in
`utils/viewer-routing.ts` returning a kind rather than `null` — one predicate the
canvas already routes by, reused here rather than re-derived. Where it answers
`null` (a `.zip`, a `.dmg`, an unknown binary) nothing moves: the press is the OS
hand-off it always was.

| target | click | toolbar |
|---|---|---|
| `http(s)://…` | unchanged: `target="_blank"` → `setWindowOpenHandler` → `shell.openExternal` | `Copy link` · `Open in browser` · `Quote` |
| a local path with a canvas viewer, in a pane | the CANVAS: `openPathInCanvas` → the document, the right-hand slot, the tab | `Copy path` · `Open in canvas` · `Open in default app` · `Open folder` · `Quote` |
| the same path where there is no pane (no provider) | `openFile` (main expands `~`) — the press it had before this change | the four-action strip (`Open`, `Open folder`) |
| the same path ABOVE `MAX_EAGER_READ_BYTES`, for a kind the press reads itself (`utf-8`/`base64`: markdown, html, code, spreadsheet) | `openFile` — the press REFUSES above the ceiling, so the OS hand-off and its sentence are what happens | `Copy path` · `Open` · `Open folder` · `Quote`, plus the note `Too large for the canvas preview` |
| the same path above the ceiling for a kind that reads its own bytes (`pdf`, image, audio, video) | the CANVAS, unchanged: the ceiling is the eagerly-read kinds' rule, not a size rule | the five-action strip above |
| `file://…` | decoded path → as the row above | as the row above |
| `~/…`, `/abs…` with no viewer (`.zip`, `.dmg`, unknown) | `openFile` | `Copy path` · `Open` · `Open folder` · `Quote` |
| a directory | `openFile` | `Copy path`, `Open` (no `Open folder`) |
| a path that is not there | the canvas is SKIPPED (the probe's cached answer already says so) → `openFile` fails → error toast | `Copy path`, plus the reason `No file at …` |
| bare relative `notes.md` | unchanged (an anchor, `target="_blank"`) | not a target: no toolbar |
| `ftp://`, `mailto:`, unknown schemes | unchanged | not a target: no toolbar |

**The ceiling the strip has to know about (round 3, U8a).** The press reads
`utf-8`/`base64` kinds itself, and it refuses above `MAX_EAGER_READ_BYTES` — a
document whose `content` cannot be persisted is worse than no document (round 2's
blocker: an empty sheet, an empty editor, and `Workbook is empty` throwing the
window into its error boundary). A strip that still offered `Open in canvas` for
such a file would be promising a destination the press deliberately does not reach,
which is the state round 3's UX pass measured: a button reading "Open in canvas"
handing the file to the OS. So the toolbar asks the same question the press does —
one exported constant, one predicate (`canvasActionFor`), so the button and the
press cannot drift — and where the answer is "the press will refuse", the strip
falls back to the OS shape and says why in the note slot it already has for a
missing path. The kinds that read their own bytes are never capped: a 40 MB PDF
keeps its canvas button, which is the case the canvas exists for.

**An open document wins over the ceiling.** The Files panel's own click reads
uncapped, so a 9 MB spreadsheet can already be sitting in the pane; a press on its
link SELECTS it (the store keeps the entry it has, so the panel's bytes and the
reader's own edits survive) rather than refusing on a size rule that only ever
governed building a new document.

**Two presses, one meaning each.** The id `open` means THE CANVAS wherever the
app can show the path, and the OS's application gets an id of its own
(`open-default`, labelled with the string the canvas's own viewer chrome already
ships — `OpenInOsButton`, `file-viewer-state.tsx`). Two buttons whose only
difference is their tooltip would be one control with an ambiguous press; two ids
are two answers, and each one is assertable without a browser
(`scripts/link-actions.test.mjs`).

**The fallback is part of the rule.** `openPathInCanvas` answers `false` when the
pane would not take the path — a type with no viewer, a read that failed, a path
the probe already knows is gone — and the click then does exactly what it did
before: the OS attempt and its `Could not open …` sentence. A refusal that
produced nothing would be the silent no-op this whole matrix exists to remove.

Three traps, all of which would ship a plausible-looking no-op or a broken
window:

1. **`defaultUrlTransform`.** react-markdown runs every href through it, and its
   safe list is `https?|ircs?|mailto|xmpp`: a `file:///…` href is silently
   replaced with `""`. So a detected file link carries the PATH in `href`
   (`~/x/report.xlsx`), never a `file://` URL — asserted, not claimed,
   in `scripts/link-targets.test.mjs`.

   **And this is why the renderer passes its own `urlTransform`** (round 1,
   review M1). The trap was originally answered by making the linkifier write a
   path into `href` and accepting that `classifyHref`'s `file://` branch could
   never run — a branch, four unit assertions and two comments that claimed a
   reachability the app did not have. The operator asked for the affordances on
   markdown-captured links too, so the branch is now REAL: `MarkdownRenderer`
   passes a `urlTransform` that keeps `file:` for `href` and delegates
   everything else to `defaultUrlTransform`, which is why a hand-written
   `[report](file:///tmp/a.pdf)` renders as a target with a toolbar while
   `javascript:`, `data:` and `vbscript:` are still blanked exactly as the
   library intends (`scripts/chat-link-affordances.test.mjs` asserts both
   halves).
2. **Nothing guards same-window `file://` navigation** (`will-navigate` appears
   nowhere in `src/main/index.ts`), so `preventDefault()` on every detected
   file target is mandatory rather than defensive — it is the `open`/`hold`
   branch of `clickDecision` (`link-actions.ts`), which the anchor's handler
   only performs.
3. **A `mousedown`+`mouseup` inside one link fires `click` with a live
   selection**, so without the drag-select guard a drag over a file link would
   launch an application mid-gesture. The guard reads the live selection
   (`selectionTouches`), because whatever ended the gesture, the state that
   matters is whether text is still lit, and the decision it feeds is `hold`.

### Where a `%` is decoded

ONE layer, named so nobody adds a second: `mdast` keeps a destination verbatim
(the linkifier's `url` is already the decoded path), react-markdown's
`normalizeUri` percent-encodes it on the way into `hast`, and
`link-actions.ts`'s `classifyHref` is the boundary that decodes it back — once,
and fail-safe against a malformed escape. Everything downstream (the anchor's
`href`, its `data-lo-target`, `Copy path`, `Open`, `Open folder`, the probe, the reveal)
uses that one value, which is what makes `file:///tmp/a%20b.txt` copy and open
the file whose name has a space in it (round 1, QA Q-1 and UX U3: the encoded
string reached `shell.openPath`, which takes a filesystem path and not a URL).
`link-grammar.ts` decodes too, because a `file://` URL's own escapes must be
undone before this layer ever sees it; a path goes through each layer once and
neither twice.

Two labels are spelled out rather than abbreviated because round 1 (design D6)
found the doc saying `Copy` where the DOM, the tooltip and the accessible name all
say `Copy path` / `Copy link`: a URL's press says `Copy link`, a local target's
says `Copy path`, and that is what this document says from here on.

## 5. The toolbar, and the state machine

The shell is the same object the Quote control wears — `bg-elevated`,
`border-hairline`, `rounded-md`, `h-8`, `px-1`, the shared `QUOTE_TOOLKIT_ATTR`,
the same 8px clearance — because two floating toolbars that look different is a
defect rather than a style choice. It is placed by the SAME pure function
(`placeQuoteControl`), against the link's own boxes, through the SAME hook
(`use-floating-control.ts`), so the placement disciplines (coalesced re-measure,
the reflow no event reports, row-relative position, the hide when the anchor's
first line leaves the viewport) exist once.

**The subject is the measure key** (round 1, design D1). The row mounts this
control at a stable JSX position, so moving from one link to another inside ONE
turn re-renders it rather than re-mounting it — and none of the events the hook
listens for fires when that happens. Before the key, the contents and the
accessible name followed the new link while the RECT kept the old one's
coordinates, so the strip floated over a link it was not about. The key is the
subject ELEMENT (its identity, not an href), and round 1's regression is pinned
twice: the pure arithmetic in `scripts/chat-link-affordances.test.mjs`, and a
real pointer in the evidence rig's `hover-same-turn-second-link` entry, whose
`expectAnchored` claim fails on the pre-remediation tree.

**A link that is not on its row's first line is placed BELOW itself** (round 1,
design D2, UX U6). The 8px-above placement is the highlight control's rule, and
its anchor is a highlight that usually begins on the row's first line, where the
8px is the row's own leading and covers nothing; a LINK can be anywhere in a
paragraph, and round 1 measured the strip hiding 128px of the very path this
change exists to make usable, for as long as the pointer rested on a link
further down. The rule is expressed against the anchor's OWN first-line height
rather than a constant, and it only takes the flip when below is inside the pane
— so the clamp never becomes the thing that decides the position. `hover-file`
(first line, still above) and `hover-directory` (mid-row, now below) are the two
frames that show it.

**The rule's cost, measured rather than argued** (round 2, design D2). Flipping
does not make the coverage disappear; it moves it to the line BELOW the anchor,
and § 5 recorded only the benefit. Round 2 measured the ink under the strip in
the hover frames — pixels of the resting frame that differ from the canvas by
more than 30 — and found two states where what is covered is text a reader wants:

| state | strip rect (LIVE, this head) | covered ink | what it is |
|---|---|---|---|
| `hover-file` | `[175,334,330,363]` | 0 px | nothing — the first-line case is genuinely clean. The rect is 30px wider than round 3's: the fifth button (`Open in canvas` · `Open in default app` in place of the lone `Open`) |
| `hover-directory` | `[584,612,682,644]` | 42 px | the glyph tops of the line below, grazed by the strip's last two rows. UNCHANGED by this round: a directory still gets `Copy path · Open · Quote` |
| `hover-url` | `[245,486,343,518]` | **169 px** | the table's own column header, the word `path`. UNCHANGED: a URL still gets `Copy link · Open in browser · Quote` |
| `hover-missing` | `[217,612,475,644]` | 82 px | the tail of the sentence's wrapped continuation. UNCHANGED: a path that is not there still gets `Copy path · Quote` |
| `hover-cell` | `[256,565,411,594]` | **587 px** | the paragraph below the table (see the container paragraph under this table). 587 at this head's five-button width against **483** at the same registration's 126 px width: the added 30px band covers 104 px of that paragraph, **+21.5%** |

THE `hover-file` / `hover-cell` RECTS MOVED AGAIN, by 30px, and the ink column
with them — this is the round that put the operator's own ask on the strip, so
the two states that are ABOUT a canvas-openable file grew a button while
`hover-directory`, `hover-url` and `hover-missing` did not (their matrices are
untouched, which is why three of these five rows are the previous round's
numbers unchanged). The ink numbers were re-measured at this head by the same
reading: pixels of the resting frame more than 30 away from the CANVAS, counted
inside that row's own rect. `hover-file` stays at 0 px, and the one that moves in
kind is `hover-cell` — the fifth button hangs over the paragraph below the table,
26px below the table's last painted rule, so its cost is **483 → 587**
(+104 px, **+21.5%**) of prose rather than a glyph top. That is the price of showing
both destinations, and it is recorded here at the size it actually is rather than
as "+30px".

**Which capture each rect belongs to**, since the two ends of that delta must come
from one registration to mean anything: the `hover-file` and `hover-cell` rects in
the table above are this head's five-button capture, and `hover-directory`,
`hover-url` and `hover-missing` carry round 3's rects — 4 px lower in `y` at the
same width — because those three matrices are untouched by this change: the pass
re-took ALL 23 states of the set (a set capture cannot refresh a subset), so those
three frames ARE new — what did not move is their content, and the numbers in those
three rows are the previous capture's because an ink figure only compares inside one
registration. Their committed frames are the new ones. Comparing an ink number across two registrations is
exactly how round 1's `671 → 776` pair came about (671 was measured on the round-3
capture's taller rect), so the rule is: **a pair must be measured inside one
registration, and a row that says UNCHANGED keeps the capture it came from.**

EVERY RECT IN THIS TABLE IS 31px WIDER THAN THE ONE ROUND 2 PUBLISHED, and
that is the round-3 correction (design round 3, D2): the earlier column was
measured before `Quote` joined the hover strip, so it described a three-button
strip — `hover-file`'s `[174,337,271,368]` against this head's
`[174,337,302,369]`, and so on down the column. The ink numbers move with the
wider rect (`hover-directory` 4 → **42**, `hover-missing` 66 → **82**,
`hover-url` 167 → **169**, `hover-file` 0), and the round-3 re-measurement
reproduces the OLD readings at the OLD rects, so what was stale was the
arithmetic, not the method. The number that moves in kind is
`hover-directory`: "4 px — descender tops" describes a strip whose bottom edge
just misses the line below, where the live strip's last two rows graze the glyph
tops of it. Rule and choice unchanged; the cost is larger than round 2 recorded
and is stated here at the size it actually is.

The alternative considered and NOT taken is "place it on the side that covers
less readable text". It cannot be implemented in the placement: `placeQuoteControl`
is a pure function of BOXES (`quote-anchor.ts`), and "is this text readable or is
it a table header" is not a property of a box. What the placement could do is
prefer the side with more room, and that is the rule that produced the round-1
defect this one replaces — the reason the flip exists is that the space above a
mid-paragraph link is the line above it, which has text in it. So the rule stands
and the cost is recorded here, with both sides photographed (`hover-file` above,
`hover-directory`/`hover-url` below) rather than asserted away.

**The strip may leave its container, and does.** In a table, the cell link's box
is `[255,544,612,561]`, the table's last painted rule is at y=568, and the strip
lands at `[256,565,411,594]` — 26px of it below the table, over the paragraph that
follows
(`hover-cell`, 587 ink px of that paragraph at this head's five-button width, the
number this round's fifth button moved from 483 at the same registration). The
placement clamps to the pane
(`quote-anchor.ts`), not to the
anchor's own ancestors, and deliberately: a link can sit in a table cell, a list
item, a blockquote or a paragraph, and a container-aware rule would need an
answer for each. The visible consequence is that a table's header row can be
covered by the strip for a link in its first body row, which is the same cost
measured above, one container further in.

**The pointer travels a CORRIDOR between the link and its toolbar, and that is
what makes the buttons reachable at all** (round 2, design D1 — the BLOCKER). The
toolbar is placed 8px clear of the anchor's own box, and those 8px belong to the
row's wrapper: `position: absolute` keeps the strip out of the turn's own box, so
the element under a pointer crossing the gap is an ANCESTOR of the turn. Every
containment test the row had answers "not the turn" for it — `turn.contains(related)`
is false and `closest("[data-lo-kind]")` is null — so the non-link branch of
`pointerover` cleared the subject and the strip unmounted before the pointer could
reach a button. Only a single teleport survived: `2 steps@16ms` was lost at step
1, `4 steps` at step 2, `1px@8ms` on the first pixel off the anchor, and the
committed `hover-toolbar-button`/`copy-pressed` frames showed a state under a
gesture no mouse makes.

The rule is now geometric and stated once (`use-link-subject.ts`): the subject
survives while the pointer is inside the union of the anchor's own box and the
strip's, each inflated by the 8px clearance the strip is placed at plus a 2px
rounding margin. It cannot outlive the pointer leaving both, because it is a
function of where the pointer IS rather than of a timer, and it cannot follow a
reader into the prose: half a line of text is further from the anchor's box than
the clearance, so moving onto the words around a link dismisses as before. The
rig drives the failing chains as ASSERTIONS rather than scenes —
`hover-gap-crossing` (in and back out, two samples at 16ms), `hover-gap-long`
(four samples), `hover-gap-fine` (a sample every pixel at 8ms, from a link placed
BELOW its toolbar, so both placements are covered) and `hover-gap-leave` (the
arrival, then out to the prose, where the strip must go). Each fails on the
pre-remediation tree, which is what makes them evidence rather than pictures.

**The pointer dwells for 120ms; the keyboard does not.** Sweeping the pointer
across a paragraph that names several paths used to re-mount the strip for each
one it crossed, so it flashed and moved under a gesture the reader was not
aiming with. Focus, the context-menu key and `Shift+F10` are immediate, because
a keyboard reader has already chosen and a wait there would be latency with
nothing to protect.

THE ROW DECIDES THE SUBJECT, ONCE (`use-link-subject.ts`). Identity is the
ELEMENT REFERENCE, not an href or an index: two links can carry the same href,
and a streaming row re-renders per delta.

| the reader's state | the row's subject | what is offered |
|---|---|---|
| pointer over a link, nothing highlighted | that link | `Copy path` · `Open in canvas` · `Open in default app` · `Open folder` · **Quote** (a canvas-openable file; see § 4 for the four other shapes) |
| a highlight wholly inside a link (part or whole) | that link | **Quote** · `Copy path` · `Open in canvas` · `Open in default app` · `Open folder` |
| a highlight spanning a link and the prose beside it | none — the turn's Quote control | Quote only |
| a highlight across two links in one turn | none — the turn's Quote control | Quote only |
| a highlight spanning two turns | none — `quote-model.ts`'s own rule | Quote on the turn it began in |
| a link focused with `Tab` | that link | as the file case; Quote leading iff the highlight is in it |
| nothing | none | nothing |

**Quote is on the toolbar in BOTH states, and that is round 2's decision** (UX
round 2, U4). The state it used to wait for — a highlight wholly inside the link —
turned out not to be reachable with a mouse in any instrument this project can
drive: a `mousedown` on an `<a href>` in Chromium starts no text selection and
fires no `dragstart`, with or without `draggable={false}`, so the
`selection-in-link*` frames are built through the DOM's `Selection` API and show a
state no pointer reader can produce. A Quote that appears only for that selection
is dead UI for most readers, and the operator's ask is the buttons AND quote "in
all cases on hover or select". So the hover state carries Quote too — trailing,
because a reader who has not chosen is offered the actions on the link first and
the quote of the link's own words last — and the press quotes the highlight when
there is one and the link's own text when there is not. A highlight inside the
link still wins over the whole-link text.

**A highlight outranks the pointer**, and that ordering is what keeps a quote
attributed to the link it came from: a drag that ends on a different link leaves
the pointer over it, so a pointer-first rule would raise that link's toolbar with
a Quote button for a highlight it does not own.

**One control per highlight.** When a link owns the highlight, the row does not
mount the turn's Quote control; the link's toolbar is the one offering the press.
The row makes that decision (`!link.quoteAvailable`), so `quote-toolkit.tsx`'s own
gate stays a statement about its own turn.

`selectionWhollyWithin` answers **no** for every shape it cannot attribute: a
collapsed caret, two different links, an endpoint on a toolbar, a highlight in
another turn. A wrong "yes" is a misattributed quote; a wrong "no" costs one
extra press, so the predicate is deliberately suspicious.

The press itself is ONE implementation (`use-quote-press.ts`), shared with the
Quote control, and it carries the recorded history of what a press that leaves
focus behind costs (discarded keystrokes; Enter staging a duplicate quote).

**Liveness is learned on reveal**, not per row: one `probeFiles([target])` per
spelling per session, cached in `link-actions.ts`, skipped entirely when the
preload bridge is absent (Storybook, browser development) — where the toolbar is
OPTIMISTIC, because with no way to stat, disabling Open would be the app asserting
that a path the reader can see does not exist. A failed press forgets the entry,
so the next reveal asks again.

## 6. Accessibility

Each action is the shared `Button` (`variant="ghost"`, `size="icon-sm"`) with an
`aria-label` and a `Tooltip`; the strip is `role="toolbar"` with its own
`aria-label="Actions for report.xlsx"`; the anchor's accessible name stays its own
visible text. The two opens carry their own labels as both the tooltip and the
accessible name (`Open in canvas`, `Open in default app`), which is the whole
reason they are two actions rather than one: a screen-reader reader hears which
destination each press reaches, and neither is named after the icon it wears.

**The keyboard contract, stated because the DOM's own order cannot express it**
(round 1, UX U1 and U2). The strip is rendered ONCE per turn, after the whole
markdown body, so every one of the turn's buttons sits after every one of its
links and a plain Tab reached the buttons of the LAST link only — earlier links'
actions were Tab-unreachable, and `Shift+F10` (a key a Mac keyboard does not
label) was the only per-link route:

| key | from | what happens |
|---|---|---|
| `Tab` | a focused link | enters THAT link's toolbar (its first button) |
| `Tab` | a button that is not the last | the next button |
| `Tab` | the toolbar's last button | the next link in the same turn, so every link's own actions stay reachable |
| `Shift+Tab` | the toolbar's first button | back to the link the strip is about |
| `Shift+Tab` | a focused link | the previous focusable, as the browser gives it |
| `Escape` | inside the toolbar | hides the strip, hands focus back to the link, and drops the highlight it was acting on |
| `Escape` | anywhere else, with the strip up | hides the strip (the pointer-raised case, where focus is wherever the reader left it) |
| `Shift+F10`, the context-menu key | a focused link | raises the strip and focuses its first button |

**The two halves can disagree, and `Tab` resolves it toward the keyboard** (round
2, UX U8 / code review MINOR 1). The pointer out-ranks the keyboard — a resting
pointer re-subjects the strip — so focus can be on one link while the strip is
about another. In that state the old code consumed the reader's `Tab` and focused
the strip's first button, which belonged to the link under the POINTER: the press
that followed acted on a link the reader had not chosen. The row now re-subjects
to the FOCUSED link before its first button takes focus, so the table above holds
in every state rather than only where the two happen to agree. `Shift+F10` and
the context-menu key already did this (they re-pin to the focused link), which is
why the defect was only ever visible on the `Tab` path.

`Escape` is answered by the toolbar for its own focused buttons and by
`use-link-subject.ts` for a pointer-raised strip, and neither may test
`defaultPrevented` to decide whether the key is theirs: a tooltip layer listens
on `document` in the CAPTURE phase, so the event reaches the toolbar already
marked — which is exactly how the documented dismissal was dead on arrival.
A dismissal also has to outlive the focus hand-back: `focusin` is one of the
events that reveals a link, so the row ignores the one `focusin` the dismissal
itself caused, and a pointer arriving at that link again raises it as usual.

The strip is unmounted at rest (nothing invisible is ever in the tab order) and
`visibility: hidden` (never `display: none`) covers the frames before its first
measurement — which is also what keeps it measurable, since the placement is
computed from its own measured box.

## 7. Main process: the tilde, and the answer

`open-file` and `show-item-in-folder` now route through `resolveUserPath`, the one
resolution rule `read-file`, `save-file`, `file-exists` and `directory-exists`
already shared. They did not, so `~/…` — how an agent writes most paths — opened
nothing: `shell.openPath` does not expand a tilde.

Both answer `{ ok, resolved, error? }` (`FileActionOutcome`) rather than `void`,
because both discarded the half that says whether anything happened:
`shell.openPath` RETURNS its failure as a string rather than throwing, and
`showItemInFolder` returns nothing at all while happily revealing the parent of a
path that is not there. The reveal now stats the path first
(`throwIfNoEntry: false`, so a missing path is an ordinary `undefined`).

## 8. Deliberate exclusions

Stated because a reviewer will look for them:

- **No hover toolbar on the trace rows** (`agent-question.tsx`,
  `agent-reasoning.tsx`). A question callout is the most prominent thing on screen
  by § 7, and a hover strip competing with its own pressable options is worse than
  links that simply open.
- **No hover toolbar on the legacy `message-item` rows.** `SessionPanel` passes
  `canonical` unconditionally, so those rows are unreachable; they DO get the
  markers and the styling, which is what "everywhere else that renders markdown"
  means.
- **Not the composer's `ReplyPreview`, not the canvas, not the WYSIWYG editor.**
- **No `CONTROLS` row for the strip.** It is a `PERCEPTIBLE` ground step plus a
  `GRAPHICS` row for the hovered icon instead, and the reason is measured: a
  `CONTROLS` row demands a 3:1 edge, and this strip's whole distinction is a
  lightness step between adjacent grounds (`elevated` on `canvas` and `surface`
  measures 1.03-1.40:1). Forcing one would put an edge on a design that does not
  have one — the same reason the browser tab's hover fill lives in `PERCEPTIBLE`.
  It is the SECOND worked exception to § 9.8 inside that script, so the exception
  is named BESIDE THE ROW (`scripts/contrast-contract.mjs`, "link toolbar ground
  step (a § 9.8 exception)") rather than only in this document: the two numbers a
  reader checks against — the whole-registry worst case and the twelve themes the
  evidence set paints — are quoted together there (round 1, design D5).
  An `accentWash` hover row could not work either: the wash over `elevated`
  measures ΔE00 0.77 at worst (obsidian), i.e. the hover signal here is the INK
  step, not the fill.
- **No hover reveal for the turn's Quote control.** It is raised by a highlight
  and nothing else, which is the operator's earlier ask and is untouched here.
- **No new interaction with the `files` panel or the canvas tiles.** They already
  have their own actions menu; this change does not touch it. The panel's CLICK is
  the one other place that opens a path in this canvas, and it deliberately keeps
  its own implementation: it REPLACES an existing document in the store so a tile
  re-opened after the agent rewrote the file shows the new bytes
  (`canvas-file-freshness`), it carries the tile's own facts onto the document, and
  its failure toast is worded for a tile the reader was looking at.
  `utils/open-in-canvas.ts`'s header states all three. What the two share is the
  RULE, not the code: `viewerFor` decides, and both call it.
- **No canvas routing on the trace rows, the gate card, or the legacy
  `message-item` rows.** Those surfaces render markdown OUTSIDE the pane provider
  (`canvas-pane.tsx`), so `useCanvasPane()` answers `null` there and the press is
  the press of before. This is the same boundary as the first two exclusions and
  it is one rule rather than two: the canvas action lives ON the link toolbar, and
  the toolbar exists on the transcript's own rows only, so the routing is provided
  to exactly the surface that offers the press. A markdown surface added later gets
  neither until somebody provides the pane deliberately.

## 9. Evidence

- `scripts/link-targets.test.mjs` — the admission table, the shared-grammar
  property (both directions now, with a case for each of the two flags, so a
  change that only NARROWS the panel turns it red), byte-identical markdown nodes
  beside a bare path the plugin links, fences, whole-span inline code, span
  offsets, the `#` cut, and the href trap.
- `scripts/link-actions.test.mjs` — classification, the percent-decoding boundary
  (space, literal `%`, non-ASCII, malformed escape), the click decision and its
  drag refusal (plus the canvas outcome, with the no-pane fallback asserted beside
  it), the toolbar matrix in BOTH shapes — the five-action canvas strip and the
  four-action strip a surface with no pane keeps — including the directory and
  known-missing vetoes on the canvas action, `canvasActionFor` as the one
  predicate the matrix and the icon map share, the probe's caching rules, the
  missing-path reason, and the selection-in-link boundary set.
- `scripts/chat-link-affordances.test.mjs` — the SHIPPED components in jsdom: the
  rendered anchor's decoded `href`/`data-lo-target`, a hand-written
  `file://` markdown link, the scheme matrix against the transform itself
  (`javascript:`, `data:`, `vbscript:`, `ftp:`, `blob:`, `about:blank` and the
  `file:`-prefixed shapes the classifier declines, in mixed case and with leading
  whitespace and control characters, all with the invariant that nothing survives
  the transform unclassified), `draggable={false}`, a real click that opens the
  decoded path and a real click with a live highlight that opens nothing, the
  placement's re-measure when the subject changes inside one turn, the pointer
  CORRIDOR between a link and its toolbar, and the keyboard contract (`Tab` into
  the focused link's toolbar in the mixed pointer/keyboard state, `Escape` out of
  it and back to the link). WHERE A PRESS GOES is asserted here too, against the
  real stores rather than a stub: a press inside a pane writes the document, the
  selected tab and the right-hand slot and never calls `openFile`; a text path is
  read as `utf-8` and a PDF is not read at all; the same press with NO provider is
  the press of before; a type with no viewer and a path the probe already knows is
  gone are both handed to the OS with no tab; and the strip's own two opens are
  pressed by their accessible names (`Open in canvas`, `Open in default app`) with
  each reaching its own destination. The boxes are stubbed throughout — jsdom has
  no layout engine — so the arithmetic and the wiring are what these assert; the
  pixels are the rig's.
- `scripts/message-quote.test.mjs` — the `QUOTE_TOOLKIT_ATTR` exclusion asserted
  against the link toolbar (which renders real text, so the exclusion is not
  theoretical), plus the mid-row flip and its fallback.
- `src/renderer/src/features/chat/canonical/link-targets.stories.tsx` — the eight
  admission shapes, the narrow column, the selection-in-link state and the press
  that follows it, the two SPANNING highlights (a link and its prose, and two
  links in one turn), and `NoViewerTargets`: a `.zip` and a `.dmg` beside an
  `.xlsx`, which is the UNCHANGED half of the routing rule. That one is a story of
  its own rather than two more sentences in the fixture the rest of the set
  photographs, because adding to that fixture moves the links below it and
  re-measures every strip in the set.
- `docs/evidence/chat-canonical-links/` — the rendered frames, including the
  pointer-revealed toolbars (the rig's own CDP `Input.dispatchMouseEvent`, because
  a story `play` cannot produce a real pointer) and the states round 1's review
  found missing. Several of those entries carry a CLAIM rather than only a
  picture — `expectAnchored`, `expectGone`/`expectPresent`, `expectAttribute`, and
  round 2's `hoverPath`/`expectKept` — so the sweep fails rather than
  photographing the wrong state under a confident name. The four `hover-gap-*`
  entries are design D1's BLOCKER as regression tests: real pointer paths, sampled
  at 16ms and at every pixel, in both placements and back out to the prose, each
  of which fails on the pre-remediation tree. Its README states the gesture behind
  each directory, and the one limit this branch could not remove from the code
  side — a highlight inside an anchor, which no mouse gesture makes. `hover-file`
  and `hover-toolbar-button` are the new matrix in pixels (the five-action strip,
  and the tooltip of its `Open in canvas` button), and `hover-no-viewer` is the
  other side of the routing rule.

### What the evidence set does NOT have, and why

- **No `main`-side before half for the resting frames.** The story file is ADDED
  by this branch, so no `main` frame of it exists or can exist (round 1, review
  M5 corrected this sentence in two places). What the set has instead is the
  story's own resting state, and the change it is the "before" of is "the previous
  behaviour was no anchor at all".
- **No real drag with an endpoint inside a link.** In headless Chromium a drag
  whose endpoint lies inside an anchor produces no highlight at all, with or
  without `draggable={false}` (round 1, UX U4; re-measured on this head). So the
  two spanning states are built by a story `play` through the DOM's own
  `Selection` API — the same instrument the committed `selection-in-link` frames
  use — and the README says so per directory. Whether a WINDOWED build selects
  there is unconfirmed and is round 2's to measure; what this branch did is
  remove the one code side of it (`draggable={false}`, so the app's own anchors no
  longer start Chromium's native link drag) and say so rather than claim it.

### Findings this round declined, with the reason

- **A dead path looks exactly like a live one until it is hovered (round 1, UX
  U5 is the finding; this is the decision against fixing it here).** The
  alternative — probing every row's paths as they render so the register can
  differ at rest — was rejected deliberately, and the reasons are structural
  rather than aesthetic: a row re-renders per streaming delta, so a per-row probe
  is a stat storm on the one surface built to repaint cheaply, and `probe-files`
  caps its batch at 64 paths per call, which a turn naming more than that (this
  repository's own transcripts do) would silently exceed. Liveness is therefore
  learned ON REVEAL, once per path per session, and the resting register stays
  one register for every link. The trade is accepted, not overlooked: a reader
  who never hovers a token cannot tell it is gone, and the two places that DO
  tell them are the toolbar's own `No file at …` reason and the error toast after
  a press. Making the state legible at rest needs a probe budget the app does not
  have, which is a different change with a different cost.
- **The narrow column's mid-word table break (round 1, design D8) is NOT
  addressed here.** `detected-targets-narrow` shows `artif/act` and `repo/rt`
  broken mid-word inside the table's cells, and the design round verified it is
  pre-existing rather than caused by this branch: replacing the cell's anchor with
  a bare text node leaves the column widths identical (cell 1 59px, cell 2 256px,
  table 316px in a 420px viewport, `table-layout: auto`). It is the table's own
  `word-break` behaviour at a narrow width, it exists on `main`, and fixing it
  would change every table in every transcript — out of this change's scope.

## 10. Where a press opens: the pane identity, and the two modules this adds

`viewerFor(path, type)` (`utils/viewer-routing.ts`) is the app's existing
definition of "supported by canvas view", and this change reuses it rather than
writing a second list of extensions: the canvas's own click, the document tile and
this press all route through the same predicate, so a format added to the viewer
list is openable from a link in the same commit.

**`utils/open-in-canvas.ts` owns the rule and the effect.** `opensInCanvas(pane,
path)` answers the decision (a pane in reach AND a viewer for the type — asked of
FILES only, because `viewerFor` reads the last path segment and a URL like
`https://example.com/paper.pdf` would otherwise wear the canvas mark on a button
labelled `Open in browser`); `openPathInCanvas(conversationId, path)` performs it:
the probe answer, the document, the text kinds' bounded read,
`setCanvasOpen(true)` then `addFileAndSelect`. Its answer is a boolean, and the
caller's fallback is the point of it — a refusal means "do what this app did
before", which is the OS hand-off and its own sentence.

Three bounds are deliberate and are stated in that module rather than here:

- **the press ASKS when nothing is cached.** The hover normally warms the answer
  (the toolbar's liveness is learned there, so a row is not a stat storm), but a
  press can arrive with no hover at all — a keyboard activation, a touch, a link
  whose strip was never revealed — and the kinds that read their own bytes read
  nothing here, so a file deleted between the reveal and the press used to open a
  tab onto nothing while a text file correctly fell back to the OS. One stat on
  the path the reader is pressing, and `null` (no bridge, a probe that threw)
  still attempts the canvas, which is the optimistic direction `probeTarget`
  documents;
- **a refusal never leaves a dead tab.** A directory, a type with no viewer or a
  path the answer calls gone — cached or just asked — gets no document at all: the
  tab is written only after every check has passed;
- **the document is bounded, and carries the answer's facts.** Its `id` and `path`
  are the probe's RESOLVED spelling, which is the identity the store dedupes by
  and the same string the Files panel's tile for that file already carries
  (`use-mentioned-files.ts` rewrites every tile to `result.resolved`); without it
  the transcript's `~/` spelling and the panel's `/Users/...` spelling became two
  tabs on one file (review round 1, M1). `availability`, `sizeBytes` and
  `lastAgentModified` come from the same answer, and the eager read is capped at
  `MAX_EAGER_READ_BYTES` (1 MiB) because the store persists its documents to
  `localStorage`. ABOVE THAT CAP THE PRESS REFUSES - the same `return false` a
  `.zip` gets, so the caller's OS hand-off and its sentence are what the reader
  meets. The rounded version of this, in round 1, handed over a POINTER document
  (no bytes, `sizeBytes` set) on the theory that a viewer would read on demand;
  it does not - the kinds the cap covers render `document.content` - and round 2
  measured what the reader got instead: an empty sheet, an empty editor, and, on
  leaving a spreadsheet, `Workbook is empty` thrown from the sheet viewer with the
  ErrorBoundary over the whole window. `readMtimeMs` is set only when bytes were
  actually read. (The Files panel's own click still reads uncapped; that is its own
  change, not this one's.)

**`utils/canvas-pane.tsx` is how the pane reaches the two components that need it.**
The anchor is `MarkdownRenderer`'s (`MarkdownAnchor`), which every markdown surface
in the app renders and which takes no pane prop and must not grow one; the toolbar
is mounted by the transcript's own rows. `CanvasPaneProvider` is mounted around the
transcript's ROW LIST — one place, the only place where both consumers live — and
its value is the OPENER bound to that conversation, not the id:

- the id already has a reader with a different contract (`LinkToolkit`'s
  `conversationId`: the key a staged quote is filed under), so publishing it here
  would be two sources of one value, which `use-quote-press.ts`'s own header
  refuses;
- the value is memoised on the id, because a transcript re-renders per streaming
  delta and a fresh context value would re-render every anchor in every row;
- an absent `conversationId` provides `null` rather than skipping the provider, so
  the surfaces that render markdown OUTSIDE the chat pane — the run panel's child
  reader, which passes no id at all, plus the legacy `message-item` rows and the
  trace rows of § 8 — get the same "no pane in reach" answer and the same
  behaviour they had before this module existed.

That press is ASSERTED rather than photographed, and the difference is stated here
because review round 1 (U4) found the earlier wording claiming a story got the null
answer: the story file passes a `conversationId` on purpose, so its frames show the
five-action canvas strip, and therefore NO frame in
`docs/evidence/chat-canonical-links/` is a pane-less press. What covers it is
`scripts/chat-link-affordances.test.mjs`'s "a press with NO pane is exactly the
press of before: the OS", which drives a real anchor with no provider and reads
the OS call back off the bridge. (`hover-no-viewer` is the OTHER half - a path
with no viewer, not a pane with no canvas - and its four-action strip is not
evidence for this one.)

The consequence worth naming: **canvas routing is provided to exactly the surface
that offers the toolbar.** The trace rows, the gate card and the legacy
`message-item` rows render markdown outside it (see § 8), so a link there opens in
the OS as it always did — one boundary rather than two rules that could drift.
