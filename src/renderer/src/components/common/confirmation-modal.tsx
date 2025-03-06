import { faExclamationTriangle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	DialogContentText,
	Typography,
	styled,
} from "@mui/material";
import {
	BaseDialog,
	DangerButton,
	PrimaryButton,
	SecondaryButton,
	TitleContainer,
} from "./base-dialog";
import type { FC, ReactNode } from "react";

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

const WarningIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	color: theme.palette.error.main,
	fontSize: "1.2rem",
}));

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
	const dialogTitle = isDangerous ? (
		<TitleContainer>
			<WarningIcon icon={faExclamationTriangle} />
			<Typography variant="h6" component="span" color="error">
				{title}
			</Typography>
		</TitleContainer>
	) : (
		title
	);

	const dialogActions = (
		<>
			<SecondaryButton onClick={onCancel} variant="outlined">
				{cancelText}
			</SecondaryButton>
			{isDangerous ? (
				<DangerButton onClick={onConfirm} autoFocus>
					{confirmText}
				</DangerButton>
			) : (
				<PrimaryButton onClick={onConfirm} autoFocus>
					{confirmText}
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
			dialogProps={{
				"aria-labelledby": "confirmation-dialog-title",
				"aria-describedby": "confirmation-dialog-description",
			}}
		>
			<DialogContentText id="confirmation-dialog-description">
				{message}
			</DialogContentText>
		</BaseDialog>
	);
};
