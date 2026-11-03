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
	/** The URI's own length when the span was widened to a code region around it
	 * (the receipt states the data's size; inspection pages through the region). */
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
 *  - fenced blocks: a line whose prefix (spaces, tabs, blockquote `>`) is followed
 *    by 3+ backticks or tildes, closed by a line with at least as many of the same
 *    character and nothing else; an unclosed fence runs to the end, as in
 *    CommonMark. The prefix is looser than CommonMark's 0-3 spaces so a fence
 *    inside a list item or quote counts too; erring towards "code" only ever keeps
 *    a small URI visible, which is the safe side.
 *  - inline code spans: a backtick run closed by the next run of EXACTLY its
 *    length within the same paragraph (a blank line ends one), an escaped opener
 *    losing its first backtick. Matching keeps one forward-only pointer per run
 *    length, so many unmatched openers cost one pass, not one pass each.
 * Not modelled: indented (4-space) code blocks. A small URI in one is untouched
 * by the floor; a large one splits as before, which degrades only that block. */
function codeRegions(body: string): Region[] {
	const regions: Region[] = [];
	let segment = 0;
	let fence: { char: string; size: number; start: number } | null = null;
	let lineStart = 0;
	for (;;) {
		let lineEnd = body.indexOf("\n", lineStart);
		if (lineEnd < 0) lineEnd = body.length;
		let i = lineStart;
		while (
			i < lineEnd &&
			(body[i] === " " || body[i] === "\t" || body[i] === ">")
		)
			i++;
		const char = body[i];
		let run = 0;
		if (char === "`" || char === "~")
			while (i + run < lineEnd && body[i + run] === char) run++;
		const rest = () => body.slice(i + run, lineEnd);
		if (fence) {
			if (char === fence.char && run >= fence.size && !rest().trim()) {
				regions.push({ start: fence.start, end: lineEnd });
				fence = null;
				segment = lineEnd;
			}
		} else if (run >= 3 && !(char === "`" && rest().includes("`"))) {
			inlineCodeRegions(body, segment, lineStart, regions);
			fence = { char, size: run, start: lineStart };
		} else if (i === lineEnd || (body[i] === "\r" && i + 1 === lineEnd)) {
			inlineCodeRegions(body, segment, lineStart, regions);
			segment = lineEnd;
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
	for (const match of body.matchAll(IMAGE_START)) {
		const start = match.index;
		if (spans.length && start < spans[spans.length - 1].end) continue;
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
			spans.push({
				start: code.start,
				end: code.end,
				mime,
				dataLength: Math.min(end, code.end) - start,
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
