import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useState } from "react";

/** A legacy image URI is untrusted text, not an attachment or permission to load it.
 * Keep offsets into the original body: neither the DOM nor a second store needs a
 * copy of the payload, and inspection remains possible one bounded page at a time. */
// A URI's content may include punctuation, parameters, percent escapes and
// non-base64 bytes. Stop only at hard text delimiters: treating a parenthesis
// or bracket as an end would expose the rest of a large payload. Never decode
// it or let an attacker-controlled subtype become an unbounded label.
const IMAGE_DATA = /data:image\/[^\s"'<>`]+/gi;
const MIME_END = /[;,]/;
const TRAILING_PROSE = /[)\]}.!?]{1,4}$/;
const MAX_MIME_LENGTH = 80;
const PAGE_SIZE = 2048;

type Span = { start: number; end: number; mime: string };
export function inlineImageSpans(body: string): Span[] {
	return Array.from(body.matchAll(IMAGE_DATA))
		.filter((match) => match[0].includes(",") || match[0].length > 64)
		.map((match) => {
			// Trailing closing punctuation often belongs to surrounding prose or
			// Markdown, not the URI; leaving it in place preserves that context.
			const token = match[0].replace(TRAILING_PROSE, "");
			const end = token.search(MIME_END);
			return {
				start: match.index,
				end: match.index + token.length,
				mime: token.slice(
					5,
					Math.min(end < 0 ? token.length : end, 5 + MAX_MIME_LENGTH),
				),
			};
		});
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
