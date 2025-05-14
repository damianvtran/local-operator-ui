import type { FC } from "react";
import { useState } from "react";
import {
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	TextField,
	Typography,
} from "@mui/material";

type AgentIdInputDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (agentId: string) => void;
};

/**
 * AgentIdInputDialog component
 *
 * This dialog prompts the user to enter an Agent ID.
 */
export const AgentIdInputDialog: FC<AgentIdInputDialogProps> = ({ open, onClose, onSubmit }) => {
	const [agentId, setAgentId] = useState("");
	const [error, setError] = useState("");

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
		<Dialog open={open} onClose={handleCancel} maxWidth="xs" fullWidth>
			<DialogTitle>Enter Agent ID</DialogTitle>
			<DialogContent>
				<Typography variant="body2" sx={{ mb: 2 }}>
					Please enter the Agent ID to associate with the new schedule.
				</Typography>
				<TextField
					autoFocus
					margin="dense"
					id="agentId"
					label="Agent ID"
					type="text"
					fullWidth
					variant="outlined"
					value={agentId}
					onChange={(e) => {
						setAgentId(e.target.value);
						if (error) setError(""); // Clear error when user types
					}}
					error={Boolean(error)}
					helperText={error}
					onKeyPress={(e) => {
						if (e.key === 'Enter') {
							handleSubmit();
						}
					}}
				/>
			</DialogContent>
			<DialogActions sx={{ p: 2 }}>
				<Button onClick={handleCancel} color="inherit">
					Cancel
				</Button>
				<Button onClick={handleSubmit} variant="contained" color="primary">
					Submit
				</Button>
			</DialogActions>
		</Dialog>
	);
};
