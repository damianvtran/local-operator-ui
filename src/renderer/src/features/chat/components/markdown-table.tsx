/**
 * The scroll wrapper every markdown table renders inside.
 *
 * WHY THIS EXISTS (operator report, 2026-09-30; design consult D1). A table the
 * agent wrote into an answer had its short columns squeezed to a few pixels -
 * `#684 (1a)` and `MERGED f11952f1d2` wrapping mid-token - because markdown's
 * cells inherited a character-level break from the stylesheet root. The fix's
 * first half is CSS (`markdown.css`: a table cell's min-content becomes its
 * longest word); the second half is this element: a table whose columns STILL
 * need more width than the column has somewhere to go. Without it, the table
 * overflows the page; with it, the table scrolls inside its own box and keeps
 * its natural width (the design's containment candidate, measured against
 * squeezing, page overflow and per-column widths in the consult).
 *
 * It lives in its own module rather than being exported from
 * `markdown-renderer.tsx` so that the projects surface can share it without
 * importing the chat transcript renderer - `project-markdown.tsx` deliberately
 * does not (`WHY NOT MarkdownRenderer` there), and the wrapper is the one
 * element both surfaces must render identically. ONE implementation, two
 * consumers; a copy in either file is the "second implementation of one thing"
 * this repo refuses.
 *
 * NO JS, and that is a requirement rather than a preference: this component is
 * mounted once per table on the streaming path, so it must not measure,
 * observe, or carry state (`MARKDOWN_COMPONENTS`'s identity comment, and the
 * perf lane's no-measuring rule). Chromium makes an overflowing scroller
 * keyboard-focusable on its own and scrolls focused descendants into view, so
 * the box needs no `tabindex` and no overflow detection either.
 *
 * `node` is destructured and dropped rather than spread: react-markdown 10.1.0
 * hands every custom component the mdast node (`passNode` is on by default),
 * and spreading it onto a DOM element sets a `node` attribute React warns
 * about. The `code` entry in `markdown-renderer.tsx` drops it the same way.
 */
import type { FC, HTMLAttributes } from "react";
import type { ExtraProps } from "react-markdown";

/*
 * The mdast `node` react-markdown hands every custom component (it is
 * destructured away below), typed with the library's own `ExtraProps` rather
 * than as `unknown` so the component stays assignable to a `Components["table"]`
 * slot - the FC prop-type validation React derives is invariant over it.
 */
type MarkdownTableProps = HTMLAttributes<HTMLTableElement> & ExtraProps;

export const MarkdownTable: FC<MarkdownTableProps> = ({
	node: _node,
	...rest
}) => (
	<div className="lo-md-table-scroll">
		<table {...rest} />
	</div>
);
