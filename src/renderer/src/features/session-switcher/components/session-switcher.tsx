/**
 * The Ctrl+Tab recent-session switcher's overlay.
 *
 * WHY IT TAKES NO FOCUS. The gesture commits on Control's keyUp, so the caret
 * must stay exactly where the reader left it - in the composer, on the sidebar
 * row, in the strip - and the keyUp has to land on the document. A Radix
 * `Dialog` (which the command palette uses) would move focus onto this surface
 * and hand the caret back somewhere chosen by the dialog on close, so this is a
 * plain portal: the panel paints over the app, the keyboard never enters it, and
 * a pointer press on a row commits that row.
 *
 * It is also why nothing here animates in: the panel appears on a held chord and
 * has to be gone the instant the chord is released, and a transition would leave
 * a ghost after the commit. `docs/branding.md` reserves the one shadow for things
 * that leave the flow, which this does.
 */

import { ChatSessionStatus } from "@features/chat/components/chat-session-status";
import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { cn } from "@shared/lib/utils";
import { createPortal } from "react-dom";
import { t } from "../../../../../i18n/messages";
import type { SwitcherRow } from "../session-switcher-model";
import { useSessionSwitcherKeys } from "../use-session-switcher-keys";

export function SessionSwitcher() {
	const { visible, rows, cursor, commitAt } = useSessionSwitcherKeys();
	/* The native browser view paints above ALL DOM, so an overlay that does not
	 * register is invisible wherever a browser pane is on screen. Same funnel as
	 * every dialog (`useSuppressBrowserView`), one id of its own. */
	useSuppressBrowserView(visible, "session-switcher");

	if (!visible || rows.length < 2) return null;

	return createPortal(
		<div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
			{/* biome-ignore lint/a11y/useSemanticElements: a modal `dialog` element would move focus and trap it, which is the one thing this surface must not do - the chord commits on Control's keyUp. */}
			<div
				role="dialog"
				aria-modal="false"
				aria-label={t("ui.command_palette.palette_search.recents")}
				className="pointer-events-auto w-96 max-w-[90vw] rounded-lg border border-hairline bg-elevated p-1 shadow-overlay"
			>
				{rows.map((row, index) => (
					<SwitcherRowButton
						key={row.sessionId}
						row={row}
						active={index === cursor}
						onCommit={() => commitAt(index)}
					/>
				))}
			</div>
		</div>,
		document.body,
	);
}

function SwitcherRowButton({
	row,
	active,
	onCommit,
}: {
	row: SwitcherRow;
	active: boolean;
	onCommit: () => void;
}) {
	return (
		<button
			type="button"
			/* Out of the tab order and never focused: this surface is driven by a held
			   chord, and focus belongs to wherever the reader is working. */
			tabIndex={-1}
			aria-current={active ? "true" : undefined}
			/* The row's stable hook for the rigs and for the driver: the id it would
			   open, which the copy above cannot carry. */
			data-session-id={row.sessionId}
			/* The pointer must not take the caret either - the panel is up for as long
			   as Control is held, and a button that stole focus would leave it on a node
			   that unmounts the moment the row is committed. */
			onMouseDown={(event) => event.preventDefault()}
			onClick={onCommit}
			className={cn(
				"flex h-9 w-full items-center gap-3 rounded-sm px-2 text-left",
				/* The active row is a ground step with its own edge, the palette's own
				   selection pair (`command-palette.tsx`), so the two lists mark the same
				   gesture the same way. */
				active
					? "bg-sunken outline-solid outline-1 -outline-offset-1 outline-control"
					: "bg-transparent",
			)}
		>
			{row.row === null ? (
				/* A conversation with no catalogue row yet (just created, catalogue read
				   still in flight). The slot keeps the title's left edge aligned with
				   every other row rather than inventing a mark for "unknown". */
				<span aria-hidden="true" className="size-4 shrink-0" />
			) : (
				<ChatSessionStatus row={row.row} />
			)}
			<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
				{row.title ?? t("ui.command_palette.palette_search.untitled_chat")}
			</span>
		</button>
	);
}
