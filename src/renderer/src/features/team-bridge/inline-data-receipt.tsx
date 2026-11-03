import { formatNumber, t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useMemo, useState } from "react";

/** A legacy image URI is untrusted text, not an attachment or permission to load it.
 * Keep offsets into the original body: neither the DOM nor a second store needs a
 * copy of the payload, and inspection remains possible one bounded page at a time. */
// Wrapped alphabet-only prose is indistinguishable from wrapped base64. Leave
// small runs in place; put only large uncertain runs behind their own explicitly
// labelled plaintext inspection, never misrepresent them as image bytes. Neither
// path decodes or fetches content. Whitespace/quotes are hard URI boundaries.
const IMAGE_START = /data:image\//gi;
// `-`/`_` are the URL-safe alphabet (RFC 4648 §5). A conforming data URI never
// uses it, but legacy producers did, and leaving it out let a 550K base64url
// payload escape the receipt after 24 characters (QA round 1, Q2).
const BASE64_CHAR = /[a-z0-9+/%=_-]/i;
// Raw (unencoded) SVG markup after the comma, `data:image/svg+xml;utf8,<svg …>`,
// is full of spaces and quotes, which are hard URI ends for every other shape.
// It ends at its own closing tag, and only on the same line (see the scan).
const RAW_SVG_END = /<\/svg\s*>/gi;
const BASE64_HEADER = /;base64$/i;
const HARD_END = /[\s"'<>`]/;
const MIME_END = /[;,]/;
const TRAILING_PROSE = /[)\]}.!?]{1,4}$/;
const MAX_MIME_LENGTH = 80;
const PAGE_SIZE = 2048;
const UNCERTAIN_LIMIT = 2048;
const ADJACENT_PROSE_LIMIT = 256;
/* THE RECEIPT FLOOR (agent review round 1, R1-1 / QA Q1). A receipt exists to keep
 * a wall of encoded bytes out of the message, so it is only worth what it hides.
 * Below this many characters (URI plus any encoded continuation) the text stays
 * ordinary Markdown: a prose mention of `data:image/png;base64,`, a short example
 * in code, or a 1x1 pixel a reader may want to copy all read as main renders
 * them. The operator's reproduction is ~600K, so the floor is far below any real
 * wall. It equals the inspection page size: anything that clears it would fill
 * at least one page. */
const RECEIPT_FLOOR = 2048;

type Span = {
	start: number;
	end: number;
	mime: string;
	uncertain?: boolean;
	/** Set when the span was widened to a code region around a large URI: the
	 * TOTAL length of every large URI in that region (the receipt states the size
	 * of the data it hides; inspection pages through the region). Summed, not the
	 * first URI's (PR #1554 round 2, R2-3): a fence holding two 3K URIs hides 6K,
	 * and "3,022 characters" undercounted it. Small URIs below the floor are not
	 * counted, whichever side of a large one they sit, so the figure does not
	 * depend on order. */
	dataLength?: number;
};
type Region = { start: number; end: number };

/* MARKDOWN CODE IS OPAQUE TO THE RECEIPT (R1-1 / Q1). The body is split around
 * each receipt BEFORE Markdown parses it, and each side is parsed on its own, so a
 * split inside a fence or a code span would close the code early and reopen it
 * after (the reproduction: prose after a fenced `<img src="data:…">` rendered as
 * code). Running the real parser to find code is not an option: it is the very
 * cost this module avoids (measured 180 ms per 600K characters, and a delimiter-
 * heavy body ran past 120 s). So this is a deliberately small, LINEAR model of the
 * two CommonMark code constructs, char comparisons only (no regex), and it only
 * has to be right about where code is, never render anything:
 *  - fenced blocks: 3+ backticks or tildes, closed by a line with at least as
 *    many of the same character and nothing else; an unclosed fence runs to the
 *    end, as in CommonMark. The opener's prefix follows CommonMark's containers
 *    (see `fenceStart`): blockquote `>` markers and list markers (`- `, `* `,
 *    `+ `, `1. `, `1) `) are skipped, so `- ```` opens a fence (R2-1), and after
 *    them at most 3 columns of indent may precede the fence, measured from the
 *    current list item's content column when the line sits inside one. Four or
 *    more is an indented code line, NOT an opener (R2-2). Erring towards "code"
 *    is NOT a safe side: a phantom unclosed fence makes everything after it one
 *    region, and a later large URI then puts the rest of the message, prose
 *    included, behind the receipt.
 *    The closer keeps the looser prefix (spaces, tabs, `>`): inside a fence only
 *    "does this line close it" matters, and a list marker there is content.
 *  - inline code spans: a backtick run closed by the next run of EXACTLY its
 *    length within the same paragraph (a blank line ends one), an escaped opener
 *    losing its first backtick. Matching keeps one forward-only pointer per run
 *    length, so many unmatched openers cost one pass, not one pass each.
 * Not modelled: indented (4-space) code blocks as regions. A line indented that
 * far is only ruled out as a fence opener. A small URI in one is untouched by the
 * floor; a large one splits as before, which degrades only that block.
 * List tracking is just enough for the opener's column: a stack of the open
 * items' content columns, popped when a line after a blank sits left of them.
 * Lazy continuation and the finer item-ending rules are approximated; a miss
 * there misjudges one opener's indent, never the scan's cost. */
/** Columns of spaces/tabs from `i` (a tab advances to the next multiple of 4,
 * counted from `col`), and where they end. */
function indentAt(body: string, from: number, lineEnd: number, startCol = 0) {
	let i = from;
	let col = startCol;
	while (i < lineEnd && (body[i] === " " || body[i] === "\t")) {
		col = body[i] === "\t" ? col + 4 - (col % 4) : col + 1;
		i++;
	}
	return { i, col };
}

/** Length of a list marker at `i` (`-`/`*`/`+`, or 1-9 digits then `.`/`)`),
 * or 0. CommonMark requires a space or tab after it, which also keeps `---`
 * and `***` (thematic breaks) and `-x` prose from reading as markers. */
function listMarkerAt(body: string, i: number, lineEnd: number): number {
	let j = i;
	if (body[j] === "-" || body[j] === "*" || body[j] === "+") j++;
	else {
		while (j < lineEnd && j - i < 9 && body[j] >= "0" && body[j] <= "9") j++;
		if (j === i || (body[j] !== "." && body[j] !== ")")) return 0;
		j++;
	}
	return body[j] === " " || body[j] === "\t" ? j - i : 0;
}

/** The content column of the deepest open list item at or left of `col`, or 0.
 * `items` is strictly increasing (a child's content starts right of its
 * parent's), so a binary search finds it: O(log depth) per line, which keeps a
 * hostile 250K-deep nest followed by 250K short lines linear-ish, not quadratic. */
function containerColumn(items: number[], col: number): number {
	let low = 0;
	let high = items.length;
	while (low < high) {
		const mid = (low + high) >> 1;
		if (items[mid] <= col) low = mid + 1;
		else high = mid;
	}
	return low ? items[low - 1] : 0;
}

/** Where a fence opener's run would start on this line, or -1 when the prefix
 * rules it out (R2-1 / R2-2; the model is described above `codeRegions`).
 * `items` holds the content columns of the open list items and is updated in
 * place for the markers on this line. Every loop only moves forward through
 * the line's prefix, and each item is pushed once and popped at most once. */
function fenceStart(
	body: string,
	lineStart: number,
	lineEnd: number,
	items: number[],
	afterBlank: boolean,
): { at: number; blank: boolean } {
	let i = lineStart;
	// Blockquote markers: up to 3 spaces, `>`, and one optional space.
	for (;;) {
		const ws = indentAt(body, i, lineEnd);
		if (ws.col > 3 || body[ws.i] !== ">") break;
		i = ws.i + 1;
		if (body[i] === " " || body[i] === "\t") i++;
	}
	let { i: at, col } = indentAt(body, i, lineEnd);
	const blank = at === lineEnd || (body[at] === "\r" && at + 1 === lineEnd);
	if (blank) return { at: -1, blank };
	// A line left of an item's content column after a blank line ends that item.
	// Without the blank it may be a lazy paragraph continuation, so the item
	// stays open: a later `  ```` under it is still the item's fence.
	if (afterBlank)
		while (items.length && items[items.length - 1] > col) items.pop();
	// List markers, possibly nested on one line (`- 1. ```` ). A marker is one
	// only within 3 columns of its container; its content starts after 1-4
	// spaces, and with 5+ one space after the marker (the rest is indented code,
	// so the run cannot be an opener: it is 4+ columns into the content).
	for (;;) {
		const base = containerColumn(items, col);
		if (col - base > 3) return { at: -1, blank };
		const marker = listMarkerAt(body, at, lineEnd);
		if (!marker) break;
		const after = indentAt(body, at + marker, lineEnd, col + marker);
		const gap = after.col - col - marker;
		const content = col + marker + (gap > 4 ? 1 : gap);
		while (items.length && items[items.length - 1] > col) items.pop();
		items.push(content);
		if (gap > 4) return { at: -1, blank };
		at = after.i;
		col = after.col;
	}
	return { at, blank };
}

function codeRegions(body: string): Region[] {
	const regions: Region[] = [];
	let segment = 0;
	let fence: { char: string; size: number; start: number } | null = null;
	let lineStart = 0;
	const items: number[] = [];
	let afterBlank = false;
	for (;;) {
		let lineEnd = body.indexOf("\n", lineStart);
		if (lineEnd < 0) lineEnd = body.length;
		if (fence) {
			let i = lineStart;
			while (
				i < lineEnd &&
				(body[i] === " " || body[i] === "\t" || body[i] === ">")
			)
				i++;
			let run = 0;
			while (i + run < lineEnd && body[i + run] === fence.char) run++;
			if (run >= fence.size && !body.slice(i + run, lineEnd).trim()) {
				regions.push({ start: fence.start, end: lineEnd });
				fence = null;
				segment = lineEnd;
			}
		} else {
			const line = fenceStart(body, lineStart, lineEnd, items, afterBlank);
			const i = line.at;
			const char = i < 0 ? "" : body[i];
			let run = 0;
			if (char === "`" || char === "~")
				while (i + run < lineEnd && body[i + run] === char) run++;
			if (
				run >= 3 &&
				!(char === "`" && body.slice(i + run, lineEnd).includes("`"))
			) {
				inlineCodeRegions(body, segment, lineStart, regions);
				fence = { char, size: run, start: lineStart };
			} else if (line.blank) {
				inlineCodeRegions(body, segment, lineStart, regions);
				segment = lineEnd;
			}
			afterBlank = line.blank;
		}
		if (lineEnd === body.length) break;
		lineStart = lineEnd + 1;
	}
	if (fence) regions.push({ start: fence.start, end: body.length });
	else inlineCodeRegions(body, segment, body.length, regions);
	return regions;
}

function inlineCodeRegions(
	body: string,
	from: number,
	to: number,
	regions: Region[],
) {
	const runs: { pos: number; len: number }[] = [];
	for (let i = from; i < to; ) {
		if (body[i] !== "`") {
			i++;
			continue;
		}
		let j = i;
		while (j < to && body[j] === "`") j++;
		runs.push({ pos: i, len: j - i });
		i = j;
	}
	if (runs.length < 2) return;
	const byLength = new Map<number, number[]>();
	runs.forEach((run, index) => {
		const list = byLength.get(run.len);
		if (list) list.push(index);
		else byLength.set(run.len, [index]);
	});
	const pointer = new Map<number, number>();
	for (let index = 0; index < runs.length; index++) {
		let { pos, len } = runs[index];
		let slashes = 0;
		while (pos - slashes - 1 >= from && body[pos - slashes - 1] === "\\")
			slashes++;
		if (slashes % 2) {
			pos++;
			len--;
		}
		const list = byLength.get(len);
		if (!list) continue;
		let next = pointer.get(len) ?? 0;
		while (next < list.length && list[next] <= index) next++;
		pointer.set(len, next);
		if (next === list.length) continue;
		const close = runs[list[next]];
		regions.push({ start: pos, end: close.pos + close.len });
		index = list[next];
	}
}

export function inlineImageSpans(body: string): Span[] {
	const spans: Span[] = [];
	let regions: Region[] | undefined;
	let region = 0;
	// Raw-SVG ends, cached: matches only move forward, so one search per line and
	// per closing tag serves every match before it (no rescan per match).
	let lineEnd = -1;
	let svgEnd: RegExpExecArray | null | undefined;
	// End of the last large URI. Inside a code-region receipt, later matches are
	// still scanned so their sizes join its total (R2-3), but never one that
	// starts inside a URI already measured: that keeps each character in at most
	// one URI scan, so the pass stays linear.
	let uriEnd = -1;
	for (const match of body.matchAll(IMAGE_START)) {
		const start = match.index;
		const last = spans[spans.length - 1];
		if (
			last &&
			start < last.end &&
			(last.dataLength === undefined || start < uriEnd)
		)
			continue;
		regions ??= codeRegions(body);
		while (region < regions.length && regions[region].end <= start) region++;
		const code =
			region < regions.length && regions[region].start <= start
				? regions[region]
				: undefined;
		// Outside code, a span never runs into the next code region (defensive:
		// every URI end below already stops at a backtick or a line start).
		const limit = code ? body.length : (regions[region]?.start ?? body.length);
		let cursor = start + match[0].length;
		while (
			cursor < body.length &&
			body[cursor] !== "," &&
			!HARD_END.test(body[cursor])
		)
			cursor++;
		const comma = cursor < body.length && body[cursor] === ",";
		if (!comma && cursor - start <= 64) continue;
		const header = body.slice(start, cursor);
		const mimeEnd = header.search(MIME_END);
		let uncertainEnd = cursor;
		if (comma) {
			cursor++;
			if (BASE64_HEADER.test(header)) {
				while (cursor < body.length) {
					if (BASE64_CHAR.test(body[cursor])) {
						cursor++;
						continue;
					}
					if (body[cursor] === "\r" || body[cursor] === "\n") {
						let next = cursor;
						let encoded = 0;
						while (body[next] === "\r" || body[next] === "\n") {
							const lineBreak = next;
							if (body[next] === "\r" && body[next + 1] === "\n") next += 2;
							else next++;
							const lineStart = next;
							while (next < body.length && BASE64_CHAR.test(body[next])) next++;
							// A space or other prose punctuation in this line means its first
							// word is not a continuation just because it uses base64 letters.
							if (
								next === lineStart ||
								(next - lineStart < 64 &&
									next < body.length &&
									!"\r\n)]}*.!?,;:".includes(body[next]))
							) {
								next = lineBreak;
								break;
							}
							encoded += next - lineStart;
						}
						if (encoded >= UNCERTAIN_LIMIT) uncertainEnd = next;
					}
					break;
				}
			} else if (body[cursor] === "<") {
				// Raw markup. Bounded to its own line: a closing tag several
				// paragraphs later must not turn the prose between into "image data".
				if (lineEnd < cursor) {
					lineEnd = body.indexOf("\n", cursor);
					if (lineEnd < 0) lineEnd = body.length;
				}
				if (svgEnd !== null && (!svgEnd || svgEnd.index < cursor)) {
					RAW_SVG_END.lastIndex = cursor;
					svgEnd = RAW_SVG_END.exec(body);
				}
				cursor =
					svgEnd && svgEnd.index < lineEnd
						? svgEnd.index + svgEnd[0].length
						: lineEnd;
			} else {
				// Every delimiter in this non-whitespace run shares one end. Scan it
				// once: rescanning 257 characters at each delimiter makes attacker-
				// supplied punctuation multiply the work on the renderer thread.
				let tokenEnd = cursor;
				while (tokenEnd < body.length && !HARD_END.test(body[tokenEnd]))
					tokenEnd++;
				let depth = 0;
				while (cursor < body.length && !HARD_END.test(body[cursor])) {
					const char = body[cursor];
					const boundary =
						body.startsWith("**", cursor) ||
						char === "]" ||
						char === "}" ||
						(char === ")" && !depth);
					if (boundary) {
						// A short suffix can be adjacent prose; a long one might be the
						// data itself, so it must not escape into an unbounded text node.
						if (tokenEnd - cursor <= ADJACENT_PROSE_LIMIT) break;
					}
					if (char === "(") depth++;
					if (char === ")" && depth) depth--;
					cursor++;
				}
				cursor -=
					body
						.slice(Math.max(start, cursor - 4), cursor)
						.match(TRAILING_PROSE)?.[0].length ?? 0;
			}
		}
		cursor = Math.min(cursor, limit);
		uncertainEnd = Math.min(uncertainEnd, limit);
		const end = Math.max(cursor, uncertainEnd);
		if (end - start < RECEIPT_FLOOR) continue;
		uriEnd = end;
		// Lower-cased for display only (QA N1): MIME types are case-insensitive.
		const mime = header
			.slice(
				5,
				Math.min(mimeEnd < 0 ? header.length : mimeEnd, 5 + MAX_MIME_LENGTH),
			)
			.toLowerCase();
		if (code) {
			// A LARGE URI inside code: the receipt takes the WHOLE code region, so the
			// split lands on the region's edges and both neighbours parse as the
			// author wrote them. Leaving it as code would put the wall back (a
			// fenced block is not height-bounded); splitting inside it breaks the
			// fence. The code around the URI is one click away, in inspection.
			const dataLength = Math.min(end, code.end) - start;
			if (last?.dataLength !== undefined && last.start === code.start) {
				last.dataLength += dataLength;
				continue;
			}
			spans.push({
				start: code.start,
				end: code.end,
				mime,
				dataLength,
			});
			continue;
		}
		spans.push({ start, end: cursor, mime });
		if (uncertainEnd > cursor)
			spans.push({
				start: cursor,
				end: uncertainEnd,
				mime: "",
				uncertain: true,
			});
	}
	return spans;
}

function Receipt({ body, span }: { body: string; span: Span }) {
	const [page, setPage] = useState(0);
	const [open, setOpen] = useState(false);
	const pages = Math.ceil((span.end - span.start) / PAGE_SIZE);
	// Numbers are formatted here and passed as strings (design D1: "600045" is
	// hard to read; the locale's grouping gives 600,045 / 600 045). Formatting in
	// code leaves the catalogue values, and so their audited ledger rows, as is.
	return (
		<details
			className={cn("my-1 text-sm text-ink-muted")}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			{/* `w-fit` keeps the hit area and focus ring on the label, not the
			    whole column (design D3): a block-level summary ran ~715 px past it. */}
			<summary className={cn("w-fit cursor-pointer")}>
				{span.uncertain
					? t("ui.ownerAudit.inspect_body")
					: t("ui.ownerAudit.inline_image_receipt", {
							mime: span.mime,
							count: formatNumber(span.dataLength ?? span.end - span.start),
						})}
			</summary>
			{open && (
				<>
					<pre
						/* A ground step and inset, not a border (design D2, borderless
						   rule): overlay scrollbars stay hidden until scrolled, so the
						   sunken ground is what shows where the scroll region starts and
						   ends. Same step `markdown.css` gives a fenced block. */
						className={cn(
							"my-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-sunken p-2 text-mono-sm",
						)}
					>
						{body.slice(
							span.start + page * PAGE_SIZE,
							Math.min(span.end, span.start + (page + 1) * PAGE_SIZE),
						)}
					</pre>
					<div className={cn("flex items-center gap-2")}>
						<button
							type="button"
							className={cn(
								"min-h-6 rounded px-2 text-ink hover:bg-elevated focus-visible:outline focus-visible:outline-2 disabled:text-ink-dim disabled:hover:bg-transparent",
							)}
							disabled={page === 0}
							onClick={() => setPage(page - 1)}
						>
							{t("ui.ownerAudit.previous_chunk")}
						</button>
						{/* Announced (agent review R1-4): focus stays on Next/Previous and
						    the page text changes silently otherwise. */}
						<span aria-live="polite">
							{t("ui.ownerAudit.chunk_number", {
								page: formatNumber(page + 1),
								count: formatNumber(pages),
							})}
						</span>
						<button
							type="button"
							className={cn(
								"min-h-6 rounded px-2 text-ink hover:bg-elevated focus-visible:outline focus-visible:outline-2 disabled:text-ink-dim disabled:hover:bg-transparent",
							)}
							disabled={page + 1 >= pages}
							onClick={() => setPage(page + 1)}
						>
							{t("ui.ownerAudit.next_chunk")}
						</button>
					</div>
				</>
			)}
		</details>
	);
}

/** Only split bodies that actually contain legacy data, leaving ordinary Markdown
 * and mention offsets untouched. Raw data stays inert even on explicit inspection. */
export function InlineDataBody({
	body,
	renderText,
}: { body: string; renderText: (text: string) => ReactNode }) {
	// Memoized per body (R1-3): the row re-renders on delivery ticks, and the scan
	// is linear but ~100 ms per million characters on the renderer thread.
	const spans = useMemo(() => inlineImageSpans(body), [body]);
	if (!spans.length) return <>{renderText(body)}</>;
	let cursor = 0;
	return (
		<>
			{spans.map((span) => {
				const before = body.slice(cursor, span.start);
				cursor = span.end;
				return (
					<div key={span.start}>
						{before && renderText(before)}
						<Receipt body={body} span={span} />
					</div>
				);
			})}
			{cursor < body.length && renderText(body.slice(cursor))}
		</>
	);
}
