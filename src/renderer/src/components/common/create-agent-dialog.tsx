import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	CircularProgress,
	TextField,
	Typography,
	styled,
} from "@mui/material";
import {
	BaseDialog,
	FormContainer,
	PrimaryButton,
	SecondaryButton,
	TitleContainer,
} from "./base-dialog";
import type { AgentCreate } from "@renderer/api/local-operator/types";
import { useCreateAgent } from "@renderer/hooks/use-agent-mutations";
import type { FC, FormEvent } from "react";
import { useState } from "react";

type CreateAgentDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Callback when the dialog is closed
	 */
	onClose: () => void;
	/**
	 * Optional callback when an agent is successfully created
	 */
	onAgentCreated?: (agentId: string) => void;
};

const StyledIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	color: theme.palette.primary.main,
	fontSize: "1.2rem",
}));

const NameField = styled(TextField)({
	marginBottom: 16,
});

const Subtitle = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.875rem",
	marginTop: 4,
}));

/**
 * Dialog for creating a new agent
 *
 * Reusable component that can be used in different parts of the application
 */
export const CreateAgentDialog: FC<CreateAgentDialogProps> = ({
	open,
	onClose,
	onAgentCreated,
}) => {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const createAgentMutation = useCreateAgent();

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();

		if (!name.trim()) {
			return;
		}

		const newAgent: AgentCreate = {
			name: name.trim(),
			description: description.trim() || undefined,
		};

		try {
			const result = await createAgentMutation.mutateAsync(newAgent);
			// Reset form and close dialog on success
			setName("");
			setDescription("");

			// Call the onAgentCreated callback if provided
			if (onAgentCreated && result?.id) {
				onAgentCreated(result.id);
			}

			onClose();
		} catch (error) {
			// Error is handled in the mutation
			console.error("Failed to create agent:", error);
		}
	};

	const isLoading = createAgentMutation.isPending;
	const isSubmitDisabled = isLoading || !name.trim();

	const dialogTitle = (
		<TitleContainer>
			<StyledIcon icon={faRobot} />
			Create New Agent
		</TitleContainer>
	);

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				variant="outlined"
				disabled={isLoading}
			>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				type="submit"
				form="create-agent-form"
				disabled={isSubmitDisabled}
				startIcon={
					isLoading ? <CircularProgress size={20} color="inherit" /> : null
				}
			>
				Create Agent
			</PrimaryButton>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
		>
			<Subtitle>Configure your new AI assistant with a name and optional description</Subtitle>
			<form id="create-agent-form" onSubmit={handleSubmit}>
				<FormContainer>
					<NameField
						autoFocus
						margin="dense"
						id="name"
						label="Agent Name"
						type="text"
						fullWidth
						variant="outlined"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
						disabled={isLoading}
					/>
					<TextField
						margin="dense"
						id="description"
						label="Description (optional)"
						type="text"
						fullWidth
						variant="outlined"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						disabled={isLoading}
						multiline
						rows={3}
					/>
				</FormContainer>
			</form>
		</BaseDialog>
	);
};
