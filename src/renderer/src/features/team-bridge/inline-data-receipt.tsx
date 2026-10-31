import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { type ReactNode, useState } from "react";

/** A legacy image URI is untrusted text, not an attachment or permission to load it.
 * Keep offsets into the original body: neither the DOM nor a second store needs a
 * copy of the payload, and inspection remains possible one bounded page at a time. */
const IMAGE_DATA = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]{64,}/gi;
const PAGE_SIZE = 2048;

type Span = { start: number; end: number; mime: string };
export function inlineImageSpans(body: string): Span[] {
	return Array.from(body.matchAll(IMAGE_DATA), (match) => ({
		start: match.index,
		end: match.index + match[0].length,
		mime: match[0].slice(5, match[0].indexOf(";")),
	}));
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
					<div className={cn("flex gap-2")}>
						<button
							type="button"
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
