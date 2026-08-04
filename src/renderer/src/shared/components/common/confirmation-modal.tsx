import { DialogDescription } from "@shared/components/ui";
import { TriangleAlert } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect } from "react";
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
	 * Enter confirms from anywhere in the dialog, which is the whole point of a
	 * confirmation step being one keystroke. Escape is deliberately not handled
	 * here: the dialog primitive already cancels on Escape, and a second
	 * listener would call `onCancel` twice per press.
	 */
	useEffect(() => {
		if (!open) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Enter") {
				onConfirm();
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open, onConfirm]);

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
