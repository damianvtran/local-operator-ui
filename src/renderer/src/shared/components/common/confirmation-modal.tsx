import { DialogDescription } from "@shared/components/ui";
import { TriangleAlert } from "lucide-react";
import type { FC, ReactNode } from "react";
import {
	BaseDialog,
	DangerButton,
	PrimaryButton,
	SecondaryButton,
} from "./base-dialog";

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
			<SecondaryButton onClick={onCancel}>{cancelText}</SecondaryButton>
			{isDangerous ? (
				<DangerButton onClick={onConfirm}>{confirmText}</DangerButton>
			) : (
				<PrimaryButton onClick={onConfirm}>{confirmText}</PrimaryButton>
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
