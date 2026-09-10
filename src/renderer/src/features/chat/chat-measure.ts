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
 * The 62ch prose cap stays in `markdown.css` on the text elements themselves,
 * deliberately: a `<pre>` or a `<table>` in the same message still needs the
 * full column, which is only possible while the cap is on the prose rather
 * than on this container. See the reading-measure comment there.
 */

/**
 * Names the chat column as a query container. Applied once, on the element
 * that owns the column's width, so every measure below resolves against it.
 */
export const CHAT_COLUMN_CONTAINER = "@container/chatcol";

/**
 * The shared content measure. 900px is the column width the transcript was
 * already using and the width tables, code and diagrams need; below 750px of
 * container the content takes the full width rather than a percentage, since
 * a percentage of an already-narrow column just adds margins to something
 * that has no room to spare.
 */
export const CHAT_MEASURE =
	"w-full @min-[750px]/chatcol:max-w-[900px] @min-[750px]/chatcol:mx-auto";
