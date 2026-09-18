import type { CanvasDocument } from "@features/chat/types/canvas";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { formatCalendarDateTime } from "@shared/utils/date-utils";
import { RefreshCw } from "lucide-react";
import { type FC, useId } from "react";
import { useFileFreshness } from "./use-file-freshness";

/**
 * The line a document wears: when the file on disk was last changed, and the
 * control that reads it again.
 *
 * WHY IT IS HERE AND NOT IN `ViewerChrome`. `ViewerChrome` is the media
 * viewers' own bar - the name and `Open in default app` - and only the four byte
 * viewers use it; the code, markdown and spreadsheet surfaces have toolbars of
 * their own and no such bar. A timestamp that appears on a PDF but not on the
 * file you are editing is worse than one that appears nowhere, so this sits at
 * the document level, above `CanvasContent`, where every viewer gets it and
 * neither the viewers nor their toolbars have to know it exists.
 *
 * WHY A ROW RATHER THAN THE TAB STRIP OR A TOOLTIP. The strip is navigation
 * between documents and already scrolls when a conversation has many open; a
 * mtime and an action in that row would compete with the file names it exists to
 * show. A tooltip on the tab would hide the answer to "is this the version I
 * just wrote", which is the question the line is for.
 *
 * THE GROUND, and why it is chrome rather than content. `sunken` with a
 * `hairline` under it, the same treatment the 40px bar and the tab strip above
 * already wear: this is a fact about the file and a control, not part of what the
 * document says, and the canvas's own rule (see `index.tsx`) is that the
 * document is the only thing on `surface`. Reading order in the panel is
 * therefore chrome, chrome, chrome, document - one recessed block over the
 * page.
 *
 * ITS HEIGHT AND ITS RIGHT INSET ARE THE PANEL'S, NOT THIS ROW'S (design round
 * 1, D1/D2). The row is 32px - the tab strip's own height - and its control sits
 * 8px in from the pane's edge, because every other right-hand control in this
 * panel reads from an 8px chrome inset (the pane head) or the strip's 4px, and
 * the only 24px edge in sight belongs to `ViewerChrome`'s CONTENT, which is a
 * different thing. Measured before the fix: at 28px in a 27px content box, flush
 * to the pane edge, the control lost the top and right sides of its own focus
 * ring to the strip above and the dock's clip to the right, and its hover fill
 * covered the hairlines on both sides of it.
 *
 * THE STAMP HOLDS, THE SENTENCE YIELDS WITH AN ELLIPSIS, AND ONLY THE STAMP CAN
 * MAKE THE ROW SCROLL (design round 2 D7, corrected in round 3 by D10). Round 1
 * made both text elements shrinkable, which flex shrank in proportion to width -
 * so the STAMP lost its meridiem before the sentence beside it. Round 2's fix
 * made both `shrink-0` inside a scrolling region, which traded the ellipsis for a
 * scrollbar: the hold sentence needs 694px and the row offers about 320px at the
 * default pane, so the actionable clause was never on screen at any width, the
 * clip fell mid-glyph, and the app's 8px scrollbar grew the region and jumped the
 * row's text 4px. The order is now: the stamp is `shrink-0` (the fact the row
 * exists to state), the sentence truncates with an ellipsis, and the region
 * scrolls only in the one case neither can help - a stamp wider than the pane.
 *
 * AND THE SENTENCE ITSELF IS SHORT (D10's other half): see `FACT_TEXT` in
 * `use-file-freshness.ts` for the copy that fits, with the full claim in
 * `FACT_DETAIL` for the tooltip and the accessible description.
 *
 * The timestamp is `formatCalendarDateTime`, the app's one formatter for a
 * moment in a metadata field: the platform locale, so it renders in the reader's
 * own timezone and spelling, with the seconds every "last modified" field drops.
 * It carries `tabular-nums` because it is the app's only figure that changes
 * under the reader while they watch it - every other one already does - and a
 * digit boundary would otherwise re-lay the row's own text by 5.35px (design
 * round 1, D6).
 */
export const DocumentFreshnessBar: FC<{
	document: CanvasDocument;
	conversationId?: string;
}> = ({ document, conversationId }) => {
	const {
		lastModifiedMs,
		refreshing,
		note,
		detail,
		dirty,
		diskChanged,
		refresh,
	} = useFileFreshness({
		document,
		conversationId,
	});
	const announcementId = useId();

	/*
	 * Two states, one line, and neither guesses: the file's time is known, or it
	 * is not - a document created in the panel, or one opened through the OS
	 * dialog, is exactly this for the moment before its first check answers (and
	 * a build with no local-file bridge stays here, which is true: nothing was
	 * read from a disk).
	 */
	const stamp =
		lastModifiedMs === null
			? "Not read from disk yet"
			: `Modified ${formatCalendarDateTime(new Date(lastModifiedMs))}`;

	/*
	 * THE NAME FOLLOWS THE STATE (UX round 1 U7, round 2 U1). "Re-read from disk"
	 * promises a re-read, and while the buffer is dirty the press deliberately does
	 * not perform one - it answers whether the file moved on and leaves the
	 * reader's words alone. In the `disk-changed` state the press is the reader's
	 * way OUT of the hold, and the one thing it must not do is surprise them: the
	 * file's version wins and their unsaved edits go, which is what the name says.
	 */
	const controlLabel = diskChanged
		? "Load the file's version (your unsaved edits are discarded)"
		: dirty
			? "Check the file (your edits are kept)"
			: "Re-read from disk";

	return (
		<div
			className={cn(
				"flex h-8 shrink-0 items-center gap-2 border-hairline border-b bg-sunken px-2",
			)}
			data-tour-tag="canvas-document-freshness"
		>
			{/*
			 * THE TAB STOP AND THE TOOLTIP TRIGGER ARE THE REGION (design round 3,
			 * D11). They were on the sentence, whose box is exactly the text's height,
			 * so the focus ring was clipped to a single left-hand line by the region's
			 * own `overflow-x: auto` - and the region, which is the thing that can
			 * actually overflow, was not reachable by keyboard at all. On the region
			 * the ring paints (an element does not clip its own outline) and the
			 * keyboard reader gets the horizontal scroll too.
			 */}
			<Tooltip content={detail ?? ""} side="bottom" delayDuration={1200}>
				<div
					// biome-ignore lint/a11y/noNoninteractiveTabindex: this is a scroll container, which is the one non-interactive role a tab stop is for - D11's keyboard reader needs it to reach the sentence when it truncates, and it carries no action.
					tabIndex={0}
					className={cn(
						"flex min-w-0 flex-1 items-center gap-2 overflow-x-auto",
					)}
					data-tour-tag="canvas-document-freshness-region"
				>
					<span
						className={cn(
							"shrink-0 whitespace-nowrap text-meta text-ink-muted tabular-nums",
						)}
						data-tour-tag="canvas-document-modified"
					>
						{stamp}
					</span>
					{/*
					 * THE ANNOUNCEMENT IS A SEPARATE, ALWAYS-MOUNTED REGION (UX round 1,
					 * U6): a live region has to exist BEFORE the text it announces arrives,
					 * and this row's text appears and disappears with the file's state, so
					 * it cannot be the region itself. `output` with `aria-live` is the shape
					 * this app already uses for exactly this (`older-history-slot.tsx`).
					 */}
					<output
						id={announcementId}
						className="sr-only"
						aria-live="polite"
						data-tour-tag="canvas-document-freshness-announcement"
					>
						{note ?? ""}
					</output>
					{note ? (
						<span
							className={cn("min-w-0 truncate text-meta text-ink-muted")}
							data-tour-tag="canvas-document-freshness-note"
						>
							{note}
						</span>
					) : null}
				</div>
			</Tooltip>
			<div className={cn("shrink-0")}>
				<Tooltip content={controlLabel}>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={controlLabel}
						aria-describedby={note ? announcementId : undefined}
						disabled={refreshing}
						onClick={refresh}
						data-tour-tag="canvas-refresh-file-button"
					>
						<RefreshCw aria-hidden="true" />
					</Button>
				</Tooltip>
			</div>
		</div>
	);
};
