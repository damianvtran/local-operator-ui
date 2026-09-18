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
 * THE FACTS SCROLL, THE CONTROL DOES NOT (design round 2, D7, over round 1's
 * D5). Round 1 made both text elements shrinkable, which fixed the control
 * leaving the pane at 79px - and introduced the opposite defect at ordinary
 * widths: flex shrinks in proportion to width, so with the long sticky sentence
 * on screen the STAMP gave way first and lost its meridiem, i.e. the fact the
 * row exists to state disappeared before the sentence beside it did. They are one
 * scrolling region now, each keeping its full width, with the control pinned
 * outside it - the behaviour the tab strip directly above already uses, and at
 * ordinary pane widths there is nothing to scroll.
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
	const { lastModifiedMs, refreshing, note, dirty, diskChanged, refresh } =
		useFileFreshness({
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
			<div
				className={cn("flex min-w-0 flex-1 items-center gap-2 overflow-x-auto")}
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
					/*
					 * `Tooltip` rather than a native `title`, which is this repo's own
					 * substitution for "the full string on hover" (`message-timestamp.tsx`
					 * records it) - and `tabIndex`, so a KEYBOARD user gets the same full
					 * sentence a pointer user does (design round 2, D4's keyboard half: the
					 * trigger was not focusable, so the one thing this tooltip exists for
					 * was unreachable without a mouse).
					 */
					<Tooltip content={note} side="bottom" delayDuration={1200}>
						<span
							// biome-ignore lint/a11y/noNoninteractiveTabindex: the sentence is a FACT about the file rather than a control, and design round 2 D4's keyboard half asks for it to be reachable by focus as well as by hover - the tab stop carries no action, and its only effect is that the tooltip can be opened without a mouse.
							tabIndex={0}
							className={cn(
								"shrink-0 whitespace-nowrap text-meta text-ink-muted",
							)}
							data-tour-tag="canvas-document-freshness-note"
						>
							{note}
						</span>
					</Tooltip>
				) : null}
			</div>
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
