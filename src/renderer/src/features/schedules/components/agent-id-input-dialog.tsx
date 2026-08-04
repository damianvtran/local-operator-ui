import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { Input, Label } from "@shared/components/ui";
import { useId, useState } from "react";
import type { FC } from "react";

type AgentIdInputDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (agentId: string) => void;
};

/**
 * Prompts the user to enter the Agent ID to associate with a new schedule.
 *
 * The error state rides on `aria-invalid` so the red border and the announced
 * message come from one source; typing clears it immediately.
 */
export const AgentIdInputDialog: FC<AgentIdInputDialogProps> = ({
	open,
	onClose,
	onSubmit,
}) => {
	const [agentId, setAgentId] = useState("");
	const [error, setError] = useState("");
	const baseId = useId();
	const errorId = `${baseId}-error`;

	const handleSubmit = () => {
		if (!agentId.trim()) {
			setError("Agent ID cannot be empty.");
			return;
		}
		setError("");
		onSubmit(agentId);
		setAgentId(""); // Reset for next time
	};

	const handleCancel = () => {
		setError("");
		setAgentId(""); // Reset for next time
		onClose();
	};

	return (
		<BaseDialog
			open={open}
			onClose={handleCancel}
			title="Enter Agent ID"
			maxWidth="xs"
			fullWidth
			actions={
				<>
					<SecondaryButton onClick={handleCancel}>Cancel</SecondaryButton>
					<PrimaryButton onClick={handleSubmit}>Submit</PrimaryButton>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				<p className="text-body-sm text-ink-muted">
					Please enter the Agent ID to associate with the new schedule.
				</p>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="agentId">Agent ID</Label>
					<Input
						autoFocus
						id="agentId"
						type="text"
						value={agentId}
						aria-invalid={error ? true : undefined}
						aria-describedby={error ? errorId : undefined}
						onChange={(event) => {
							setAgentId(event.target.value);
							if (error) setError(""); // Clear error when user types
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								handleSubmit();
							}
						}}
					/>
					{error && (
						<p id={errorId} className="text-danger text-meta">
							{error}
						</p>
					)}
				</div>
			</div>
		</BaseDialog>
	);
};
