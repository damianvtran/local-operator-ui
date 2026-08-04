/**
 * @file upload-agent-dialog.tsx
 * @description Dialog component for confirming agent upload to the Agent Hub.
 */

import { RadientAuthButtons } from "@shared/components/auth/radient-auth-buttons";
import { BaseDialog } from "@shared/components/common/base-dialog";
import {
	Alert,
	AlertTitle,
	Button,
	Checkbox,
	Label,
} from "@shared/components/ui";
import type { FC } from "react";
import { useEffect, useId, useState } from "react";

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
	// Generated rather than a literal: three surfaces mount this dialog (agents
	// page, agents sidebar, chat sidebar) and two can be in the tree at once, so
	// a fixed id would make one label toggle the other dialog's checkbox.
	const termsCheckboxId = useId();

	// Radix reports a `CheckedState`; this control never goes indeterminate, so
	// anything other than `true` is unchecked.
	const handleAgreementChange = (checked: boolean | "indeterminate") => {
		setAgreedToTerms(checked === true);
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
			dataTourTag="upload-agent-dialog"
		>
			<div className="flex flex-col gap-4">
				{validationIssues.length > 0 && (
					// The only boundary inside the dialog: the missing-field list has to
					// read as a blocker rather than as more body copy, and it is what
					// disables the confirm button.
					<Alert variant="danger">
						<AlertTitle>Agent is missing required fields</AlertTitle>
						<ul className="list-disc space-y-1 pl-5">
							{validationIssues.map((issue) => (
								<li key={issue}>{issue}</li>
							))}
						</ul>
					</Alert>
				)}

				{!isAuthenticated ? (
					<div className="flex flex-col items-center gap-6 text-center">
						<p className="text-body text-ink">
							You need to be signed in to Radient to upload agents to the Agent
							Hub.
						</p>
						<RadientAuthButtons
							titleText="Sign in to continue"
							descriptionText=""
							onSignInSuccess={onSignInSuccess}
						/>
					</div>
				) : (
					<>
						<p className="text-body text-ink">
							You are about to upload the agent{" "}
							<span className="font-semibold">{agentName}</span> to the public
							Agent Hub. This will include:
						</p>
						<ul className="list-disc space-y-1 pl-5 text-body text-ink-muted">
							<li>Agent configuration and settings</li>
							<li>Conversation history</li>
							<li>Execution history</li>
							<li>Learnings and memory</li>
							<li>Current plan (if any)</li>
						</ul>
						<p className="text-body text-ink">
							This information will be publicly visible and downloadable by
							other users. Please ensure you are not uploading sensitive or
							private information.
						</p>
						<div className="flex gap-3">
							{/* The box is centred in the first line of the consent text
							    rather than nudged with a margin, so it stays aligned if the
							    copy rewraps. */}
							<span className="flex h-5 shrink-0 items-center">
								<Checkbox
									id={termsCheckboxId}
									name="termsAgreement"
									checked={agreedToTerms}
									onCheckedChange={handleAgreementChange}
								/>
							</span>
							<Label
								htmlFor={termsCheckboxId}
								className="block font-normal text-body text-ink"
							>
								I confirm that I have read and agree to the{" "}
								{/* An anchor is interactive content, so clicking it does not
								    also toggle the checkbox the label owns. */}
								<a
									href="https://radienthq.com/terms"
									target="_blank"
									rel="noopener noreferrer"
									className="text-accent underline-offset-4 hover:text-accent-hover hover:underline"
								>
									terms and conditions
								</a>{" "}
								and that this agent does not contain malicious content or
								violate usage policies.
							</Label>
						</div>
					</>
				)}

				<div className="flex justify-end gap-3">
					<Button
						variant="secondary"
						onClick={onClose}
						data-tour-tag="upload-agent-dialog-cancel-button"
					>
						Cancel
					</Button>
					{isAuthenticated && (
						<Button
							variant="primary"
							onClick={handleConfirm}
							disabled={!agreedToTerms || validationIssues.length > 0}
						>
							Confirm upload
						</Button>
					)}
				</div>
			</div>
		</BaseDialog>
	);
};
