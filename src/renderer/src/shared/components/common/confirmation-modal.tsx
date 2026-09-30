import { DialogDescription } from "@shared/components/ui";
import { TriangleAlert } from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef } from "react";
import {
	BaseDialog,
	DangerButton,
	PrimaryButton,
	SecondaryButton,
} from "./base-dialog";
import { Spinner } from "./spinner";

type ConfirmationModalProps = {
	/**
	 * Whether the modal is open
	 */
	open: boolean;
	/**
	 * Title of the confirmation modal
	 */
	title: string;
	/**
	 * Message to display in the confirmation modal
	 */
	message: ReactNode;
	/**
	 * Text for the confirm button
	 */
	confirmText?: string;
	/**
	 * Text for the cancel button
	 */
	cancelText?: string;
	/**
	 * Whether the action is dangerous (will style the confirm button as error)
	 */
	isDangerous?: boolean;
	/**
	 * Callback when the confirm button is clicked
	 */
	onConfirm: () => void;
	/**
	 * Callback when the cancel button is clicked or the modal is closed
	 */
	onCancel: () => void;
	/**
	 * A value that, when it changes while the dialog is open, hands the keyboard
	 * back to the CANCEL action.
	 *
	 * WHY: an action inside the dialog can be REFUSED - the delete route answers
	 * 409 for a conversation a running session holds - and the refusal is rendered
	 * inside the dialog that asked. Without this the focus is left wherever the
	 * press put it, which is the DESTRUCTIVE button, so the safe action is not the
	 * one the keyboard holds and Enter repeats the refused act (UX round 1, U3).
	 *
	 * Opened dialogs already focus Cancel through the primitive's own
	 * `onOpenAutoFocus`; this restores that same default after a refusal. A SIGNAL
	 * rather than a boolean, so two refusals in one dialog are two changes, and
	 * UNDEFINED for a caller that never refuses anything - which keeps every other
	 * dialog that uses this component exactly as it was.
	 */
	focusCancelSignal?: unknown;
	/**
	 * Whether the confirmed action is IN FLIGHT.
	 *
	 * WHY (UX review round 1, U3): the monitor cancel held no busy state, so a
	 * second press re-sent the write, and a refusal arriving ~1 s later looked
	 * like a press that had done nothing. While `busy` is set, both footer
	 * buttons disable and EVERY close path is refused - Escape and an outside
	 * click are prevented here, and the corner X goes disabled through the
	 * primitive's own `closeDisabled` - so the dialog owns exactly one in-flight
	 * request and its outcome always lands in the dialog that asked (the
	 * `project-form-dialog.tsx` policy for the same pending window).
	 *
	 * Undefined/false for every caller that never has a write in flight, which
	 * keeps every other dialog that uses this component exactly as it was.
	 */
	busy?: boolean;
	/**
	 * The confirm label while `busy` (e.g. `Stopping…`). The caller owns copy,
	 * like every other label here; the shared component only owns the state.
	 */
	busyText?: string;
	/**
	 * Extra classes for the dialog PANEL, merged last so a caller can PIN the
	 * width.
	 *
	 * WHY (design round 1, D4): the monitor cancel's refusal paragraph lengthened
	 * the card between the first press and the retry, so the buttons moved under
	 * the pointer that was about to press again. A caller whose dialog can gain a
	 * paragraph mid-flow stabilises its own box; undefined for every other
	 * caller, which keeps their panels exactly as they were.
	 */
	panelClassName?: string;
};

/**
 * A reusable confirmation modal component
 *
 * Used for confirming potentially destructive actions like deleting items
 */
export const ConfirmationModal: FC<ConfirmationModalProps> = ({
	open,
	title,
	message,
	confirmText = "Confirm",
	cancelText = "Cancel",
	isDangerous = false,
	onConfirm,
	onCancel,
	focusCancelSignal,
	busy = false,
	busyText,
	panelClassName,
}) => {
	/*
	 * No Enter handler here, deliberately.
	 *
	 * There used to be a document-level one that called `onConfirm` on any
	 * Enter, on the theory that a confirmation should be one keystroke. With
	 * `autoFocus` gone from the confirm buttons, Radix focuses the first
	 * tabbable - which is Cancel - so pressing Enter on a visibly focused
	 * "Cancel" ran the destructive action instead, and ran it FIRST: keydown
	 * reaches document before the browser dispatches the button's activation
	 * click, so both fired and the delete won. Every one of the six dialogs
	 * that use this component is destructive.
	 *
	 * Enter now does what it does everywhere else - activates the focused
	 * button. Cancel is focused, so Enter cancels; Tab then Enter confirms.
	 * Escape is left to the dialog primitive, which already cancels on it.
	 */

	/*
	 * The safe action's own button, so a refusal can hand the keyboard back to it
	 * (`focusCancelSignal` above). A ref rather than a query for the dialog's first
	 * button, because two dialogs can be open at once and a document-wide query
	 * would reach for whichever happens to be first in the tree.
	 */
	const cancelRef = useRef<HTMLButtonElement | null>(null);
	useEffect(() => {
		if (!open || focusCancelSignal === undefined) return;
		cancelRef.current?.focus();
	}, [focusCancelSignal, open]);

	const dialogTitle = isDangerous ? (
		<>
			<TriangleAlert size={19} className="text-danger" aria-hidden="true" />
			<span className="text-danger">{title}</span>
		</>
	) : (
		title
	);

	const dialogActions = (
		<>
			{/*
			 * The two hooks the driver scenes press (`data-cancel-action`,
			 * `data-confirm-action`): the buttons' own labels are caller-supplied
			 * sentences, and a scene that selected a button by its text would break on a
			 * copy edit that changed nothing else - the convention `data-session-delete`
			 * and `data-chat-row` already follow. Attributes only: no dialog's rendering
			 * changes.
			 */}
			<SecondaryButton
				ref={cancelRef}
				data-cancel-action
				onClick={onCancel}
				disabled={busy}
				/*
				 * THE RING ON `:focus` AND NOT ONLY `:focus-visible` (design round 2, D6).
				 *
				 * This dialog MOVES focus to Cancel on purpose (`focusCancelSignal`), and
				 * the app's ring is `:focus-visible`-only (`styles/index.css`) - which a
				 * programmatic focus does NOT match, because the browser keys it on the
				 * interaction that led there. So the state where the keyboard is
				 * deliberately parked on the safe action was the one state that showed no
				 * ring, while Enter on that very button cancels: the modal asserts the
				 * keyboard is here and then draws nothing to say so.
				 *
				 * Same 2px accent ring at the same 2px offset the global rule draws, spelled
				 * as utilities so it cannot drift from it in colour or weight.
				 */
				className="focus:outline-2 focus:outline-solid focus:outline-accent focus:outline-offset-2"
			>
				{cancelText}
			</SecondaryButton>
			{/* The confirm's busy half of U3 (disabled + label swap + spinner), see `busy`'s note above. */}
			{isDangerous ? (
				<DangerButton
					data-confirm-action
					onClick={onConfirm}
					disabled={busy}
					aria-busy={busy}
					startIcon={busy ? <Spinner size="xs" /> : undefined}
				>
					{busy && busyText ? busyText : confirmText}
				</DangerButton>
			) : (
				<PrimaryButton
					data-confirm-action
					onClick={onConfirm}
					disabled={busy}
					aria-busy={busy}
					startIcon={busy ? <Spinner size="xs" /> : undefined}
				>
					{busy && busyText ? busyText : confirmText}
				</PrimaryButton>
			)}
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onCancel}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="xs"
			/*
			 * THE PENDING WINDOW HAS ONE CLOSE POLICY, the project form's own (UX
			 * round 1 U1; round 2 U7): while the write is in flight, Escape and an
			 * outside click are refused and the corner X is disabled through the
			 * primitive - a close there would abandon a write whose refusal the
			 * reader is about to be shown. Without a busy write the handlers are
			 * inert and every other dialog behaves exactly as it did.
			 */
			dialogProps={{
				closeDisabled: busy,
				...(panelClassName ? { className: panelClassName } : {}),
				onEscapeKeyDown: (event: KeyboardEvent) => {
					if (busy) event.preventDefault();
				},
				onInteractOutside: (event: Event) => {
					if (busy) event.preventDefault();
				},
			}}
		>
			{/*
			 * `asChild` so the description is a `div`: callers pass paragraphs as
			 * `message`, and a `p` inside a `p` is invalid and gets unnested by the
			 * parser.
			 */}
			<DialogDescription asChild>
				<div className="text-body text-ink-muted">{message}</div>
			</DialogDescription>
		</BaseDialog>
	);
};
