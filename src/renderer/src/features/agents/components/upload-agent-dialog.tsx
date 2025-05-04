/**
 * @file upload-agent-dialog.tsx
 * @description Dialog component for confirming agent upload to the Agent Hub.
 */

import {
	Box,
	Checkbox,
	FormControlLabel,
	Typography,
	Link,
} from "@mui/material";
import { RadientAuthButtons } from "@shared/components/auth/radient-auth-buttons";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import type { FC } from "react";
import { useState } from "react";

/**
 * Props for the UploadAgentDialog component
 */
type UploadAgentDialogProps = {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when the dialog is closed */
	onClose: () => void;
	/** Name of the agent being uploaded */
	agentName: string;
	/** Whether the user is authenticated with Radient */
	isAuthenticated: boolean;
	/** Callback function when the upload is confirmed */
	onConfirmUpload: () => void;
	/** Optional callback for after successful sign-in via the dialog */
	onSignInSuccess?: () => void;
};

/**
 * UploadAgentDialog Component
 *
 * Handles the confirmation process for uploading an agent to the Agent Hub,
 * including authentication check and terms agreement.
 */
export const UploadAgentDialog: FC<UploadAgentDialogProps> = ({
	open,
	onClose,
	agentName,
	isAuthenticated,
	onConfirmUpload,
	onSignInSuccess,
}) => {
	const [agreedToTerms, setAgreedToTerms] = useState(false);

	const handleAgreementChange = (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		setAgreedToTerms(event.target.checked);
	};

	const handleConfirm = () => {
		if (agreedToTerms && isAuthenticated) {
			onConfirmUpload();
		}
	};

	// Reset agreement state when dialog closes or auth state changes
	useState(() => {
		if (!open) {
			setAgreedToTerms(false);
		}
	});

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={`Upload "${agentName}" to Agent Hub?`}
			maxWidth="sm"
			fullWidth
		>
			{!isAuthenticated ? (
				<Box sx={{ textAlign: "center", p: 2 }}>
					<Typography variant="body1" sx={{ mb: 3 }}>
						You need to be signed in to Radient to upload agents to the Agent
						Hub.
					</Typography>
					<RadientAuthButtons
						titleText="Sign in to continue"
						descriptionText=""
						onSignInSuccess={onSignInSuccess} // Pass down the success handler
					/>
				</Box>
			) : (
				<Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
					<Typography variant="body1">
						You are about to upload the agent{" "}
						<Typography component="span" fontWeight="bold">
							{agentName}
						</Typography>{" "}
						to the public Agent Hub. This will include:
					</Typography>
					<ul>
						<li>Agent Configuration & Settings</li>
						<li>Conversation History</li>
						<li>Execution History</li>
						<li>Learnings & Memory</li>
						<li>Current Plan (if any)</li>
					</ul>
					<Typography variant="body1">
						This information will be publicly visible and downloadable by other
						users. Please ensure you are not uploading sensitive or private
						information.
					</Typography>
					<FormControlLabel
						control={
							<Checkbox
								checked={agreedToTerms}
								onChange={handleAgreementChange}
								name="termsAgreement"
								color="primary"
							/>
						}
						label={
							<Typography variant="body2">
								I confirm that I have read and agree to the{" "}
								{/* TODO: Add actual link to T&Cs */}
								<Link href="#" target="_blank" rel="noopener noreferrer">
									Terms & Conditions
								</Link>{" "}
								and that this agent does not contain malicious content or
								violate usage policies.
							</Typography>
						}
						sx={{ mt: 1 }}
					/>
				</Box>
			)}
			{/* Actions */}
			<SecondaryButton variant="outlined" onClick={onClose}>
				Cancel
			</SecondaryButton>
			{isAuthenticated && (
				<PrimaryButton
					onClick={handleConfirm}
					disabled={!agreedToTerms}
					variant="contained"
				>
					Confirm Upload
				</PrimaryButton>
			)}
		</BaseDialog>
	);
};
