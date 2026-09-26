/**
 * The chat column's one content measure.
 *
 * ONE token, consumed by both the transcript and the composer, so there is a
 * single outer edge rather than two that happen to agree. They did not quite
 * agree: measured at 1380x872 the transcript's inner column ended at x=1356
 * and the composer at x=1364 - 8px apart, because the transcript is the
 * scroll container and reserves a scrollbar gutter while the composer does
 * not. Two edges that are nearly the same read as a mistake rather than as a
 * decision, and the only way they stay identical through later edits is if
 * neither file owns the number.
 *
 * ## Why container queries and not `sm:` / `md:`
 *
 * The breakpoints these replaced keyed off the VIEWPORT, and the thing that
 * gets narrow here is the COLUMN. With the canvas panel open at a 1380px
 * window the chat column collapses to its 220px floor while `md:` is still
 * comfortably active - so `md:max-w-[900px]` was being applied to a 220px
 * column, which is a cap that can never bind and a rule that describes a
 * layout the user is not looking at. `@container` asks the question that
 * actually determines the answer: how wide is the column this content is in.
 *
 * `@container` is already in the tree (`page-header.tsx`,
 * `wysiwyg-markdown-editor.tsx`), so this follows existing practice rather
 * than introducing a mechanism.
 *
 * ## What is NOT here
 *
 * No reading measure on `.lo-markdown`, on either branch. The 62ch cap that
 * used to live there was removed from the user bubble too (operator report,
 * 2026-09-16: a card widened by a reply quote or an attachment left the prose a
 * centre-constrained column inside it), so a user turn is an aside by the
 * card's own `max-w-[75%]` inside this 640px measure, and agent output takes no
 * cap at all — it shares the left edge and the width of the tool rows in the
 * same turn. `markdown.css`'s measure comment carries both reports and the
 * numbers.
 *
 * So this 640px is the whole width the agent's answer resolves against, and
 * the ledger resolves against it too. That is the alignment: one container
 * measure, two registers, one pair of edges.
 *
 * ## Why 640 and not 900
 *
 * The 900 this token used to carry was measured, and the measurement is the
 * argument against it: wrapped word-by-word in SFNS at 14px over a
 * 700-character sample of real answer prose, a 900px line runs **146
 * characters** average and the longest line observed is the same 146. On the
 * 640 below it the same sample runs **101 average with a 104 worst line**. The
 * reference set the design board measured tops out at 108 (`Cursor 3`) and the
 * chat-first products sit at 62–87, so 900 was outside every comparator and 640
 * is inside the range while still being the widest column that is:
 *
 *  - 680 lands exactly ON the board's worst case (107 average, 110 worst) and
 *    720 and above exceed it, so 640 is the widest column with headroom rather
 *    than a taste margin;
 *  - it is the widest column that still fits at 800x600 with the collapsed
 *    56px strip: 800 − 56 − 2x24 of gutter = 696, i.e. the column plus 28px of
 *    slack each side. That is the binding constraint that makes 680 unsafe
 *    (16px of slack, which the first scrollbar or resize handle eats);
 *  - it holds the app's real content: the widest code line in the baseline
 *    frames is 57 Geist Mono characters at 13px = 445px + 32 padding = 477, and
 *    the transcript's three-column table fits at 640 with the middle column the
 *    only one that wraps. At 560 the table's first and third columns start
 *    wrapping too, which is how a measure becomes a defect.
 *
 * The cost, stated rather than hidden: 101 characters is still wider than
 * Claude.ai (76) and Zed (87), which carry no tables and no diffs in the
 * answer. If the frames show the table wrapping badly, the amendment moves this
 * token to 680 — one line here — and never narrows `.lo-markdown` alone, which
 * is the failure the branding contract pre-names (a cap on prose alone puts a
 * second left edge inside the row).
 */

/**
 * Names the chat column as a query container. Applied once, on the element
 * that owns the column's width, so every measure below resolves against it.
 */
export const CHAT_COLUMN_CONTAINER = "@container/chatcol";

/**
 * The shared content measure, and the column width at which it starts to bind.
 *
 * 640px is the reading measure: the file's own docstring carries the
 * characters-per-line measurement that picks it. It is consumed by the user
 * block, prose, the trace AND the composer — the measure narrows the shared
 * container, never prose alone, because a cap on `.lo-markdown` by itself
 * puts a second left edge inside the row.
 *
 * 688 is the threshold, and it is arithmetic rather than taste: 640 + 2x24 of
 * column gutter, the minimum inset the system states for a pane. Below a 688px
 * container the content takes the full width rather than a percentage, since a
 * percentage of an already-narrow column just adds margins to something that
 * has no room to spare — and above it the column is centred, so the pane's own
 * padding becomes the outer gutter (52px a side at the 800x600 floor).
 *
 * The threshold moved with the measure and not separately: at the old 750 a
 * 800x600 window (chat pane 744 after the collapsed 56px strip) would have
 * rendered a full-width 696px line and quietly broken the claim the measure
 * exists to make. One number, one moment.
 */
export const CHAT_MEASURE =
	"w-full @min-[688px]/chatcol:max-w-[640px] @min-[688px]/chatcol:mx-auto";

/**
 * The column width at which the composer's row stops being one line: above it
 * the session readings sit inline between the working-directory chip and the
 * controls, below it they take the row's own first line.
 *
 * 750 is the COMPOSER ROW's own measurement and it is deliberately no longer
 * `CHAT_MEASURE`'s threshold: the two used to describe one moment only because
 * the measure's threshold happened to equal this number, and with the measure
 * at 640 and its threshold at 688 that coincidence is gone. Naming the measure
 * here instead would move the composer's row shape at 688-750px of column —
 * where the readings currently take the row's first line and fit doing it — as
 * a side effect of a typographic decision. The two will decouple properly when
 * the composer takes its one 32px control row at every width; until then this
 * number stays where the composer's own chips were measured.
 */
export const CHAT_ROW_INLINE_PX = 750;

/**
 * The column width at and below which the composer's working-directory chip
 * drops its text and renders as its folder glyph alone.
 *
 * MEASURED, not chosen: the chip's text floor is 96px, and at a 240px column
 * the row has 202px for attach (28) + chip (96 + 12 gap) + microphone (28) +
 * send (28) + gaps - 204px of demand against 202px of supply, so the button
 * line broke to a third line and the composer grew from 143.5px to 179.5px
 * (design round 1, D1/D8). Named here beside the inline threshold because the
 * two are the composer row's only width rules and reading one without the
 * other is how they drift apart.
 */
export const CHAT_CHIP_ICON_ONLY_PX = 240;

/**
 * The horizontal inset the shared measure resolves against, for the composer
 * band. `px-6` is 24px, and 24px is not a taste choice: it is exactly what the
 * transcript above insets its content by -- its own `p-4` (16px) PLUS the 8px
 * scrollbar gutter it reserves with `[scrollbar-gutter:stable_both-edges]`.
 * The composer is not a scroll container and reserves no gutter, so matching
 * the TOTAL is the only way the two content boxes share one outer edge.
 *
 * ## Why this is a constant and not a per-breakpoint choice
 *
 * The band used to compact this to `px-1` in the small view while the
 * transcript kept its 24px, which put the composer 20px outside the
 * transcript on BOTH edges below a 600px column -- the same double-edge
 * defect the shared measure was introduced to remove (design round 2, D10),
 * just larger and only at narrow widths. It survived review because the
 * evidence for the original fix was captured at ONE viewport (1380), where
 * the two rules happen to agree.
 *
 * So the horizontal inset is deliberately OUTSIDE the small-view ternary that
 * still compacts the band's VERTICAL padding: vertical space is scarce on a
 * short window and compacting it costs nothing, whereas the horizontal inset
 * is a shared edge and compacting one side of it is a misalignment. If a
 * future change compacts this, it must compact the transcript's `p-4` and its
 * gutter in the same commit, or the edges part again.
 */
export const CHAT_COLUMN_INSET = "px-6";

/**
 * The composer's capped blocks: a whole number of lines, and the leading they are
 * counted in.
 *
 * Two blocks in the composer band grow and therefore cap themselves - the status
 * row's goal body and the send-error alert above the box - and both used
 * `max-h-32` (128px). At the composer's own `leading-5` that is six lines plus 8px
 * of a seventh, so the cap lands INSIDE a line's glyphs: the paint is a row of
 * letter TOPS under a complete line, which reads as a rendering accident rather
 * than as "there is more" (design review round 1, D2, measured on the column
 * floor's frame at 5x: ink runs at y458-460, 3px of the seventh line's glyphs,
 * immediately above the plan chip).
 *
 * 120px is six whole lines, so the last painted line is always a complete one.
 * `leading-5` is stated rather than inherited for the same reason: the cap is an
 * arithmetic property of the leading, and a block whose leading came from a text
 * token (the alert's `text-body-sm` pairs 13px with 1.5, i.e. 19.5px) would put
 * the boundary back through a line. The alert's lines are therefore 20px rather
 * than 19.5px, which is the cost of one shared device instead of two magic
 * numbers, and it is the only visual change to that block.
 *
 * A FADE was considered and rejected as the cue: the repo does have the device
 * (`picker-host.tsx`, `canvas-tabs.tsx`, `[mask-image:linear-gradient(...)]`),
 * but it is applied unconditionally there to regions that always overflow. On a
 * block that does NOT overflow, a static mask would dim the last line of a
 * two-line alert - a new defect in exchange for the old one. The scrollbar the
 * browser paints while scrolling is the interaction-time cue; what this constant
 * removes is the broken glyphs at rest.
 */
export const CAPPED_BLOCK = "max-h-[7.5rem] overflow-y-auto leading-5";
