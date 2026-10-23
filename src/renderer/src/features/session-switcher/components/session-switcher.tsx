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
 *
 * THE ONE THING THAT IS ALWAYS MOUNTED IS THE ANNOUNCEMENT (`output` below). A
 * live region announces a CHANGE, so a node that arrives with its text already in
 * it says nothing in most screen readers: kept mounted and empty while closed,
 * the region speaks the first row when the panel paints and the next row on every
 * step. Focus still never enters the panel - the region is off-screen and takes
 * no focus.
 */

import { ChatSessionStatus } from "@features/chat/components/chat-session-status";
import { useSuppressBrowserView } from "@shared/browser-view-policy";
import { cn } from "@shared/lib/utils";
import { createPortal } from "react-dom";
import { t } from "../../../../../i18n/messages";
import type { SwitcherRow } from "../session-switcher-model";
import { useSessionSwitcherKeys } from "../use-session-switcher-keys";

export function SessionSwitcher() {
	const { visible, rows, cursor, commitAt, hoverAt } = useSessionSwitcherKeys();
	/* The native browser view paints above ALL DOM, so an overlay that does not
	 * register is invisible wherever a browser pane is on screen. Same funnel as
	 * every dialog (`useSuppressBrowserView`), one id of its own. */
	useSuppressBrowserView(visible, "session-switcher");

	const selected = cursor !== null && visible ? (rows[cursor] ?? null) : null;
	const open = visible && rows.length >= 2;

	return (
		<>
			{/*
			 * THE SELECTION, SPOKEN. Focus stays where the reader is working, so a
			 * screen reader has nothing to follow unless this says it: the row's name and
			 * its place in the list, on the opening press and on every step. `output` with
			 * `aria-live="polite"` is this app's idiom for exactly this
			 * (`older-history-slot.tsx`), and `sr-only` keeps it out of the layout.
			 *
			 * The position is a NUMERAL pair (`2 / 5`), not "2 of 5": prose here would be
			 * a new translated key, and adding one to this surface's namespace would stale
			 * the audit hashes of every locale in it. Digits and a solidus read the same in
			 * all eight shipped locales - the pager in `table-pager.tsx` writes its
			 * position exactly this way.
			 */}
			<output
				aria-live="polite"
				className="sr-only"
				data-session-switcher-announcement=""
			>
				{selected !== null && cursor !== null ? (
					<>
						{titleOf(selected)}, {cursor + 1} / {rows.length}
					</>
				) : null}
			</output>
			{open
				? createPortal(
						<div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
							{/* biome-ignore lint/a11y/useSemanticElements: a modal `dialog` element would move focus and trap it, which is the one thing this surface must not do - the chord commits on Control's keyUp. */}
							<div
								role="dialog"
								aria-modal="false"
								aria-label={t("ui.command_palette.palette_search.recents")}
								/* The palette's own list width (`command-palette.tsx`: `w-160`) and
								   its 8 px list inset, so two long titles that share a prefix stay
								   distinguishable here exactly as they are there. `max-w-[90vw]` is
								   the same guard the palette keeps for a narrow window. */
								className="pointer-events-auto w-160 max-w-[90vw] rounded-lg border border-hairline bg-elevated p-2 shadow-overlay"
							>
								{rows.map((row, index) => (
									<SwitcherRowButton
										key={row.sessionId}
										row={row}
										active={index === cursor}
										onCommit={() => commitAt(index)}
										onHover={() => hoverAt(index)}
									/>
								))}
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}

/**
 * The row's name: the catalogue's title, or the placeholder for a row that has
 * none yet. One expression for the visible copy and the spoken one, so the two
 * cannot name the same row differently.
 */
function titleOf(row: SwitcherRow): string {
	return row.title ?? t("ui.command_palette.palette_search.untitled_chat");
}

function SwitcherRowButton({
	row,
	active,
	onCommit,
	onHover,
}: {
	row: SwitcherRow;
	active: boolean;
	onCommit: () => void;
	onHover: () => void;
}) {
	return (
		<button
			type="button"
			/* Out of the tab order and never focused: this surface is driven by a held
			   chord, and focus belongs to wherever the reader is working. */
			tabIndex={-1}
			aria-current={active ? "true" : undefined}
			/* The row's stable hook for the rigs and for the driver: the id it would
			   open, which the copy above cannot carry. The pointer's own handlers
			   below read it too, to tell a press on a row from a press elsewhere. */
			data-session-id={row.sessionId}
			/* COMMIT ON THE PRESS, not on `click`. On macOS every press here is a
			   Ctrl+click (the overlay only exists while Control is held), Chromium
			   turns that into `contextmenu` and fires NO `click` at all - so the click
			   handler this replaces could never run on the operator's platform. */
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				onCommit();
			}}
			/* The pointer must not take the caret either - the panel is up for as long
			   as Control is held, and a button that stole focus would leave it on a node
			   that unmounts the moment the row is committed. */
			onMouseDown={(event) => event.preventDefault()}
			/* And no OS context menu over a surface that is only up for a held chord. */
			onContextMenu={(event) => event.preventDefault()}
			/* Hovering moves the selection, the palette's own treatment: a press commits
			   the row under the pointer, so the pointer has to show what that would be. */
			onPointerEnter={onHover}
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
			{/* A placeholder reads quieter than a name: this row's title is missing, not
			   called "Untitled chat". `text-ink-muted` still clears the 4.5:1 text floor
			   on this panel in both themes. */}
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-body-sm",
					row.title === null ? "text-ink-muted" : "text-ink",
				)}
			>
				{titleOf(row)}
			</span>
		</button>
	);
}
