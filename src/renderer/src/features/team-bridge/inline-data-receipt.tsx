import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useState } from "react";

/** A legacy image URI is untrusted text, not an attachment or permission to load it.
 * Keep offsets into the original body: neither the DOM nor a second store needs a
 * copy of the payload, and inspection remains possible one bounded page at a time. */
// Data URI boundaries in prose are ambiguous. Base64 uses its own alphabet;
// a run of wrapped continuation lines needs at least 64 encoded characters in
// aggregate, so a short ordinary next line is not silently hidden. A long run
// of alphabet-only prose is inherently indistinguishable from encoded data.
// Non-base64 bodies retain balanced
// parentheses, but stop at Markdown closers/formatting. Neither path decodes or
// fetches content; unencoded whitespace/quotes are hard boundaries.
const IMAGE_START = /data:image\//gi;
const BASE64_CHAR = /[a-z0-9+/%=]/i;
const BASE64_HEADER = /;base64$/i;
const HARD_END = /[\s"'<>`]/;
const MIME_END = /[;,]/;
const TRAILING_PROSE = /[)\]}.!?]{1,4}$/;
const MAX_MIME_LENGTH = 80;
const PAGE_SIZE = 2048;

type Span = { start: number; end: number; mime: string };
export function inlineImageSpans(body: string): Span[] {
	const spans: Span[] = [];
	for (const match of body.matchAll(IMAGE_START)) {
		const start = match.index;
		if (spans.length && start < spans[spans.length - 1].end) continue;
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
						if (encoded >= 64) {
							cursor = next;
							continue;
						}
					}
					break;
				}
			} else {
				let depth = 0;
				while (cursor < body.length && !HARD_END.test(body[cursor])) {
					const char = body[cursor];
					if (body.startsWith("**", cursor) || char === "]" || char === "}")
						break;
					if (char === "(") depth++;
					if (char === ")") {
						if (!depth) break;
						depth--;
					}
					cursor++;
				}
				cursor -=
					body
						.slice(Math.max(start, cursor - 4), cursor)
						.match(TRAILING_PROSE)?.[0].length ?? 0;
			}
		}
		spans.push({
			start,
			end: cursor,
			mime: header.slice(
				5,
				Math.min(mimeEnd < 0 ? header.length : mimeEnd, 5 + MAX_MIME_LENGTH),
			),
		});
	}
	return spans;
}

function Receipt({ body, span }: { body: string; span: Span }) {
	const [page, setPage] = useState(0);
	const [open, setOpen] = useState(false);
	const pages = Math.ceil((span.end - span.start) / PAGE_SIZE);
	return (
		<details
			className={cn("my-1 text-sm text-ink-muted")}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className={cn("cursor-pointer")}>
				{t("ui.ownerAudit.inline_image_receipt", {
					mime: span.mime,
					count: String(span.end - span.start),
				})}
			</summary>
			{open && (
				<>
					<pre
						className={cn(
							"max-h-48 overflow-auto whitespace-pre-wrap break-all text-mono-sm",
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
						<span>
							{t("ui.ownerAudit.chunk_number", {
								page: String(page + 1),
								count: String(pages),
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
	const spans = inlineImageSpans(body);
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
