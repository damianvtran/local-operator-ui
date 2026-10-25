/**
 * The transcript line's right-click menu, and the one home for its three
 * presses.
 *
 * A LINE, NOT A MESSAGE. Every rendered row - prose, tool ledger, fold header,
 * turn bar, peer/wake/receipt - is a transcript line the reader can point at,
 * and the operator asked for copy on all of them. The menu's subject is passed
 * in already derived (`transcript-copy.ts`), so this file decides only how a
 * line's payload is offered; it never reads `innerText` and never re-parses a
 * record.
 *
 * `ContextMenuTrigger asChild` puts the trigger on the caller's own element, so
 * a row keeps its existing DOM shape (no wrapper box, no layout). Nested rows
 * are safe: Radix's inner trigger calls `preventDefault`, and the outer
 * trigger's composed handler is skipped on a default-prevented event - so a
 * right-click inside an open fold's row opens that ROW's menu, not the fold
 * header's as well.
 *
 * A ROW'S PAYLOAD IS DERIVED WHEN THE MENU OPENS, not when the row mounts. A
 * record's plain-text form runs the markdown parser over its whole body
 * (`copyTextForRecord`), and computing it eagerly put one parse per mounted row
 * inside the transcript's mount task - 174 ms of a long cold open, for a menu
 * almost no row is ever asked for (renderer profile §4 L2-a). A caller whose
 * payload is expensive therefore hands `getPayload` instead of the strings; it
 * is read while open and at the copy press, so even a record replaced under an
 * open menu stays current; the caller memoises it per record identity. Callers
 * whose payload is already a cheap string (a fold header, a turn bar) keep
 * passing `text`/`markdown`.
 *
 * COPY SELECTION IS READ WHEN THE MENU OPENS, not when the component renders:
 * the highlight is what it is at the press. It is disabled rather than hidden
 * when there is none, which is the convention these menus already follow for an
 * action the current state cannot carry.
 */

import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@shared/components/ui/context-menu";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { showInfoToast } from "@shared/utils/toast-manager";
import type { ReactNode } from "react";
import { useState } from "react";
import { copyTarget } from "../utils/link-open";

/** A line's two clipboard payloads. */
export type TranscriptCopyPayload = {
	/** What `Copy text` writes - the row's visible words. */
	text: string;
	/** What `Copy as Markdown` writes - the row's source form. */
	markdown: string;
};

type TranscriptCopyMenuBase = {
	/** The single element the trigger merges onto; must accept DOM props/ref. */
	children: ReactNode;
	className?: string;
};

/*
 * Exactly one of the two payload forms, so a caller cannot hand both and leave
 * the reader guessing which one the menu honours.
 */
export type TranscriptCopyMenuProps = TranscriptCopyMenuBase &
	(
		| (TranscriptCopyPayload & { getPayload?: never })
		| {
				/**
				 * Read only on demand: while the menu is open (all pointer/keyboard
				 * openers use Radix's `onOpenChange`) and at the copy press, never
				 * during a closed row's render. Memoise by current record identity.
				 */
				getPayload: () => TranscriptCopyPayload;
				text?: never;
				markdown?: never;
		  }
	);

const EMPTY_PAYLOAD: TranscriptCopyPayload = { text: "", markdown: "" };

/** One clipboard press with the app's existing success/failure channel. */
const write = async (value: string, announcement: string) => {
	if (!value) return;
	if (await copyTarget(value)) showInfoToast(announcement);
};

export const TranscriptCopyMenu = (props: TranscriptCopyMenuProps) => {
	const { children, className, getPayload } = props;
	useI18nLocale();
	/*
	 * Demand lasts while the menu is OPEN, not just for its opening gesture.
	 * A streaming row can be replaced while its menu stays open: freezing the
	 * opening payload copied stale text and kept its old disabled state (R1).
	 * Re-read on open-menu renders; the row's record-identity cache makes an
	 * unchanged record free, and closed rows still never derive a payload.
	 */
	const [isOpen, setIsOpen] = useState(false);
	const { text, markdown } = getPayload
		? isOpen
			? getPayload()
			: EMPTY_PAYLOAD
		: { text: props.text ?? "", markdown: props.markdown ?? "" };
	/*
	 * Captured on OPEN rather than compared at render time: Radix mounts the
	 * content while the same pointer gesture is still settling, and a selection
	 * read after the menu takes focus is no longer the reader's highlight.
	 */
	const [selection, setSelection] = useState("");
	const hasText = text.trim().length > 0;
	return (
		<ContextMenu
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) return;
				/*
				 * THE READER'S HIGHLIGHT, CAPTURED ON OPEN - and guarded because the
				 * transcript is also rendered in jsdom with no window (the copy
				 * tests mount the pane and swap the global between cases). In the
				 * app `window` is always there, so this is a no-op; without it a
				 * menu open in a windowless mount throws before the content
				 * mounts, and the test sees "the context menu opened" as false
				 * (CI, 2026-10-20). The `try` covers a window that exists but is
				 * CLOSED (jsdom's `window.close()` leaves `_document` undefined),
				 * which is the same leak in the test runner's teardown.
				 */
				let selection = "";
				try {
					selection =
						typeof window === "undefined"
							? ""
							: (window.getSelection()?.toString().trim() ?? "");
				} catch {
					selection = "";
				}
				setSelection(selection);
			}}
		>
			<ContextMenuTrigger asChild className={cn(className)}>
				{children}
			</ContextMenuTrigger>
			<ContextMenuContent data-lo-copy-menu="">
				<ContextMenuItem
					disabled={!hasText}
					onSelect={() => {
						// Resolve at the press too: an already-dispatched menu action
						// must not capture the previous render's record version.
						void write(
							getPayload ? getPayload().text : text,
							t("ui.common.actions.copied"),
						);
					}}
				>
					{t("ui.chat.transcript_copy.menu.copy_text")}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={!hasText}
					onSelect={() => {
						void write(
							getPayload ? getPayload().markdown : markdown,
							t("ui.chat.transcript_copy.toast.copied_markdown"),
						);
					}}
				>
					{t("ui.chat.transcript_copy.menu.copy_markdown")}
				</ContextMenuItem>
				<ContextMenuItem
					disabled={selection.length === 0}
					onSelect={() => {
						void write(
							selection,
							t("ui.chat.transcript_copy.toast.copied_selection"),
						);
					}}
				>
					{t("ui.chat.transcript_copy.menu.copy_selection")}
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
};
