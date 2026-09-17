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

The fragment guard is the fourth difference and the one that needed a decision.
The panel never needed it, because the extension rule was doing its job by
accident: `/tmp/{a,b}.ts` arrived as `/tmp/` and was refused for having no
extension. The linkifier drops that rule, so without the guard the brace
expansion renders a link to `/tmp/` and macOS's `screen(1).png` renders one to
`.../screen` — an anchor whose whole claim is wrong, where a missing tile never
was. The guard admits the file-url scanner's own shape (an opening bracket that
closes further along the token is a name carrying on) and drops the fragment
rather than guessing, which is the direction `scanFileUrls` already takes.

## 4. What a click does, and the three traps

| target | click | toolbar |
|---|---|---|
| `http(s)://…` | unchanged: `target="_blank"` → `setWindowOpenHandler` → `shell.openExternal` | Copy, Open in browser |
| `file://…` | decoded path → `openFile` | as a file path |
| `~/…`, `/abs…` | `openFile` (main expands `~`) | Copy, Open, Open folder |
| a directory | `openFile` | Copy, Open (no Open folder) |
| a path that is not there | `openFile` fails → error toast | Copy, plus `No file at …` |
| bare relative `notes.md` | unchanged (an anchor, `target="_blank"`) | not a target: no toolbar |
| `ftp://`, `mailto:`, unknown schemes | unchanged | not a target: no toolbar |

Three traps, all of which would ship a plausible-looking no-op or a broken
window:

1. **`defaultUrlTransform`.** react-markdown runs every href through it, and its
   safe list is `https?|ircs?|mailto|xmpp`: a `file:///…` href is silently
   replaced with `""`. So a detected file link carries the PATH in `href`
   (`~/x/report.xlsx`), never a `file://` URL — asserted, not claimed,
   in `scripts/link-targets.test.mjs`.
2. **Nothing guards same-window `file://` navigation** (`will-navigate` appears
   nowhere in `src/main/index.ts`), so `preventDefault()` on every detected
   target is mandatory rather than defensive.
3. **A `mousedown`+`mouseup` inside one link fires `click` with a live
   selection**, so without the drag-select guard a drag over a file link would
   launch an application mid-gesture. The guard reads the live selection
   (`selectionTouches`), because whatever ended the gesture, the state that
   matters is whether text is still lit.

## 5. The toolbar, and the state machine

The shell is the same object the Quote control wears — `bg-elevated`,
`border-hairline`, `rounded-md`, `h-8`, `px-1`, the shared `QUOTE_TOOLKIT_ATTR`,
the same 8px clearance — because two floating toolbars that look different is a
defect rather than a style choice. It is placed by the SAME pure function
(`placeQuoteControl`), against the link's own boxes, through the SAME hook
(`use-floating-control.ts`), so the placement disciplines (coalesced re-measure,
the reflow no event reports, row-relative position, the hide when the anchor's
first line leaves the viewport) exist once.

THE ROW DECIDES THE SUBJECT, ONCE (`use-link-subject.ts`). Identity is the
ELEMENT REFERENCE, not an href or an index: two links can carry the same href,
and a streaming row re-renders per delta.

| the reader's state | the row's subject | what is offered |
|---|---|---|
| pointer over a link, nothing highlighted | that link | Copy · Open · Open folder |
| a highlight wholly inside a link (part or whole) | that link | **Quote** · Copy · Open · Open folder |
| a highlight spanning a link and the prose beside it | none — the turn's Quote control | Quote only |
| a highlight across two links in one turn | none — the turn's Quote control | Quote only |
| a highlight spanning two turns | none — `quote-model.ts`'s own rule | Quote on the turn it began in |
| a link focused with `Tab` | that link | as the file case; Quote iff the highlight is in it |
| nothing | none | nothing |

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
visible text. Tab to the anchor reveals the toolbar and Tab again enters the
buttons; `Escape` hides it and hands focus back to the anchor; the context-menu
key and `Shift+F10` open it and focus its first button; a press outside the turn
and a pointer leaving it both hide it; a link whose first line scrolls off screen
takes its toolbar away with it.

Nothing invisible is ever in the tab order: the toolbar is unmounted when it has
no subject, and `visibility: hidden` (never `display: none`) covers the frames
before its first measurement — which is also what keeps it measurable, since the
placement is computed from its own measured box.

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
  An `accentWash` hover row could not work either: the wash over `elevated`
  measures ΔE00 0.77 at worst (obsidian), i.e. the hover signal here is the INK
  step, not the fill.
- **No hover reveal for the turn's Quote control.** It is raised by a highlight
  and nothing else, which is the operator's earlier ask and is untouched here.
- **No new interaction with the `files` panel or the canvas tiles.** They already
  have their own actions menu; this change does not touch it.

## 9. Evidence

- `scripts/link-targets.test.mjs` — the admission table, the shared-grammar
  property, byte-identical mdast with the plugin on and off, fences, whole-span
  inline code, span offsets, and the href trap.
- `scripts/link-actions.test.mjs` — classification, the click/probe matrix as pure
  functions, the probe's caching rules, and the selection-in-link boundary set.
- `scripts/message-quote.test.mjs` — the `QUOTE_TOOLKIT_ATTR` exclusion asserted
  against the link toolbar (which renders real text, so the exclusion is not
  theoretical).
- `src/renderer/src/features/chat/canonical/link-targets.stories.tsx` — the eight
  admission shapes, the narrow column, the selection-in-link state and the press
  that follows it.
- `docs/evidence/chat-canonical-links/` — the rendered frames, including the
  pointer-revealed toolbars (the rig's own CDP `Input.dispatchMouseEvent`, because
  a story `play` cannot produce a real pointer) and the `main`-side before half.
