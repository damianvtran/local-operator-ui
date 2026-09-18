import type { CanvasDocument } from "@features/chat/types/canvas";
import { Button, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { formatCalendarDateTime } from "@shared/utils/date-utils";
import { RefreshCw } from "lucide-react";
import type { FC } from "react";
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
 * The timestamp is `formatCalendarDateTime`, the app's one formatter for a
 * moment in a metadata field: the platform locale, so it renders in the reader's
 * own timezone and spelling, with the seconds every "last modified" field drops.
 */
export const DocumentFreshnessBar: FC<{
	document: CanvasDocument;
	conversationId?: string;
}> = ({ document, conversationId }) => {
	const { lastModifiedMs, refreshing, note, dirty, refresh } = useFileFreshness(
		{
			document,
			conversationId,
		},
	);

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

	return (
		<div
			className={cn(
				"flex h-7 shrink-0 items-center gap-2 border-hairline border-b bg-sunken pl-2",
			)}
			data-tour-tag="canvas-document-freshness"
		>
			<span
				className={cn("shrink-0 text-meta text-ink-muted")}
				data-tour-tag="canvas-document-modified"
			>
				{stamp}
			</span>
			{note ? (
				<span
					className={cn("min-w-0 truncate text-meta text-ink-muted")}
					/*
					 * `title` as well as the visible text: the note is the one thing
					 * here that can be longer than the panel is wide, and a clipped
					 * sentence about the reader's own unsaved edits is the last one
					 * that should be unreadable.
					 */
					title={note}
					data-tour-tag="canvas-document-freshness-note"
				>
					{note}
				</span>
			) : null}
			<div className={cn("ml-auto shrink-0")}>
				<Tooltip
					content={
						dirty
							? "Re-read from disk (your unsaved edits are kept)"
							: "Re-read from disk"
					}
				>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Re-read from disk"
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
