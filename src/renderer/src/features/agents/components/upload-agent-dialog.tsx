/**
 * @file upload-agent-dialog.tsx
 * @description Dialog component for confirming agent upload to the Agent Hub.
 */

import {
	Box,
	Checkbox,
	FormControlLabel,
	Link,
	Typography,
} from "@mui/material";
import { RadientAuthButtons } from "@shared/components/auth/radient-auth-buttons";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import type { FC } from "react";
import { useEffect, useState } from "react";

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
	/** Validation issues to display (if any) */
	validationIssues?: string[];
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
	validationIssues = [],
}) => {
	const [agreedToTerms, setAgreedToTerms] = useState(false);

	const handleAgreementChange = (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		setAgreedToTerms(event.target.checked);
	};

	const handleConfirm = () => {
		if (agreedToTerms && isAuthenticated && validationIssues.length === 0) {
			onConfirmUpload();
		}
	};

	// Reset agreement state when dialog closes
	useEffect(() => {
		if (!open) {
			setAgreedToTerms(false);
		}
	}, [open]);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={`Upload "${agentName}" to Agent Hub?`}
			maxWidth="sm"
			fullWidth
		>
			{validationIssues.length > 0 && (
				<Box sx={{ mb: 2 }}>
					<Typography variant="body2" color="error" sx={{ fontWeight: 400, fontSize: "0.875rem" }}>
						Agent is missing required fields:
					</Typography>
					<ul style={{ margin: 0, paddingLeft: 20 }}>
						{validationIssues.map((issue) => (
							<li key={issue}>
								<Typography variant="body2" color="error" sx={{ fontSize: "0.875rem" }}>
									{issue}
								</Typography>
							</li>
						))}
					</ul>
				</Box>
			)}
			{!isAuthenticated ? (
				<Box sx={{ textAlign: "center", p: 2 }}>
					<Typography variant="body1" sx={{ mb: 3, fontSize: "0.875rem" }}>
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
					<Typography variant="body1" sx={{ fontSize: "0.875rem" }}>
						You are about to upload the agent{" "}
						<Typography component="span" fontWeight="bold" sx={{ fontSize: "0.875rem" }}>
							{agentName}
						</Typography>{" "}
						to the public Agent Hub. This will include:
					</Typography>
					<ul>
						<li style={{ fontSize: "0.875rem" }}>Agent Configuration & Settings</li>
						<li style={{ fontSize: "0.875rem" }}>Conversation History</li>
						<li style={{ fontSize: "0.875rem" }}>Execution History</li>
						<li style={{ fontSize: "0.875rem" }}>Learnings & Memory</li>
						<li style={{ fontSize: "0.875rem" }}>Current Plan (if any)</li>
					</ul>
					<Typography variant="body1" sx={{ fontSize: "0.875rem" }}>
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
							<Typography variant="body2" sx={{ fontSize: "0.875rem" }}>
								I confirm that I have read and agree to the{" "}
								<Link
									href="https://radienthq.com/terms"
									target="_blank"
									rel="noopener noreferrer"
								>
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
			<Box sx={{ display: "flex", justifyContent: "flex-end", gap: 2, mt: 2 }}>
				<SecondaryButton variant="outlined" onClick={onClose}>
					Cancel
				</SecondaryButton>
				{isAuthenticated && (
					<PrimaryButton
						onClick={handleConfirm}
						disabled={!agreedToTerms || validationIssues.length > 0}
						variant="contained"
					>
						Confirm Upload
					</PrimaryButton>
				)}
			</Box>
		</BaseDialog>
	);
};
