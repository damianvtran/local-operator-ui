import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	CircularProgress,
	TextField,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { AgentCreate } from "@shared/api/local-operator/types";
import { useCreateAgent } from "@shared/hooks";
import { ExternalLink } from "lucide-react";
import type { FC, FormEvent } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	BaseDialog,
	FormContainer,
	PrimaryButton,
	SecondaryButton,
	TitleContainer,
} from "./base-dialog";

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

const StyledTextField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 8,
		transition: "all 0.2s ease-in-out",
		fontSize: "0.95rem",
		"&:hover .MuiOutlinedInput-notchedOutline": {
			borderColor: alpha(theme.palette.primary.main, 0.5),
		},
		"&.Mui-focused .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.primary.main,
			borderWidth: 1,
			boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
		},
	},
	"& .MuiInputLabel-root": {
		fontSize: "0.9rem",
	},
	"& .MuiInputBase-input": {
		padding: "12px 14px",
	},
}));

const NameField = styled(StyledTextField)({
	marginBottom: 12,
	"& .MuiInputLabel-root": {
		transform: "translate(12px, 12px) scale(1)",
	},
	"& .MuiInputLabel-shrink": {
		transform: "translate(14px, -9px) scale(0.75)",
	},
});

const Subtitle = styled(Typography)(({ theme }) => ({
	color: theme.palette.text.secondary,
	fontSize: "0.875rem",
	marginTop: 4,
	marginBottom: 8,
}));

const AgentHubLink = styled("button")(({ theme }) => ({
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	fontWeight: 500,
	fontSize: "0.92rem",
	color: theme.palette.primary.main,
	textDecoration: "none",
	marginBottom: 16,
	background: "none",
	border: "none",
	padding: 0,
	cursor: "pointer",
	"&:hover": {
		textDecoration: "underline",
		color: theme.palette.primary.dark,
	},
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
	const navigate = useNavigate();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const handleAgentHubClick = () => {
		onClose();
		setTimeout(() => {
			navigate("/agent-hub");
		}, 200);
	};

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
				data-tour-tag="create-agent-dialog-cancel-button"
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
			dataTourTag="create-agent-dialog"
		>
			<Subtitle>
				Configure your new AI assistant with a name and optional description
			</Subtitle>
			<AgentHubLink onClick={handleAgentHubClick}>
				Browse Agent Hub to fetch ready-made agents
				<ExternalLink size={18} style={{ marginLeft: 4 }} />
			</AgentHubLink>
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
						placeholder="Enter a name for your agent"
					/>
					<StyledTextField
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
						rows={2}
						placeholder="Describe what this agent does"
					/>
				</FormContainer>
			</form>
		</BaseDialog>
	);
};
