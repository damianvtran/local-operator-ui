import { faRobot, faSave } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Button,
	Card,
	CardContent,
	CircularProgress,
	TextField,
	Typography,
	styled,
} from "@mui/material";
import type { SystemPromptUpdate } from "@renderer/api/local-operator/types";
import { useSystemPrompt } from "@renderer/hooks/use-system-prompt";
import { useUpdateSystemPrompt } from "@renderer/hooks/use-update-system-prompt";
import { useEffect, useState } from "react";
import type { FC } from "react";

const StyledCard = styled(Card)(() => ({
	marginBottom: 32,
	backgroundColor: "background.paper",
	borderRadius: 8,
	boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		padding: 16,
	},
	[theme.breakpoints.up("sm")]: {
		padding: 24,
	},
}));

const CardTitle = styled(Typography)(() => ({
	marginBottom: 16,
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const CardDescription = styled(Typography)(({ theme }) => ({
	marginBottom: 32,
	color: theme.palette.text.secondary,
}));

const StyledTextField = styled(TextField)(() => ({
	marginBottom: 16,
	width: "100%",
	display: "flex",
	flexGrow: 1,
	"& .MuiInputBase-root": {
		minHeight: 380,
		width: "100%",
		height: "100%",
		display: "flex",
		flexDirection: "column",
	},
	"& .MuiOutlinedInput-root": {
		width: "100%",
		height: "100%",
		display: "flex",
		flexGrow: 1,
	},
	"& .MuiInputBase-input": {
		height: "100%",
		overflow: "auto",
		width: "100%",
		flexGrow: 1,
		display: "flex",
		"&::-webkit-scrollbar": {
			width: "6px",
		},
		"&::-webkit-scrollbar-track": {
			backgroundColor: "transparent",
		},
		"&::-webkit-scrollbar-thumb": {
			backgroundColor: "rgba(255, 255, 255, 0.1)",
			borderRadius: "10px",
			"&:hover": {
				backgroundColor: "rgba(0, 0, 0, 0.2)",
			},
		},
	},
}));

const ButtonContainer = styled(Box)(() => ({
	display: "flex",
	gap: 16,
}));

const LastModifiedText = styled(Typography)(() => ({
	marginTop: 16,
	display: "block",
}));

const LoadingContainer = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	minHeight: 240,
}));

/**
 * SystemPrompt component
 * Displays and allows editing of the system prompt
 */
export const SystemPrompt: FC = () => {
	const {
		data: systemPromptData,
		isLoading,
		error,
		refetch,
	} = useSystemPrompt();
	const updateSystemPromptMutation = useUpdateSystemPrompt();
	const [systemPrompt, setSystemPrompt] = useState("");
	const [isEdited, setIsEdited] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	// Initialize the system prompt when data is loaded
	useEffect(() => {
		if (systemPromptData) {
			setSystemPrompt(systemPromptData.content);
			setIsEdited(false);
		}
	}, [systemPromptData]);

	// Handle input change
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSystemPrompt(e.target.value);
		setIsEdited(e.target.value !== systemPromptData?.content);
	};

	// Handle save
	const handleSave = async () => {
		if (!isEdited) return;

		setIsSaving(true);
		try {
			const update: SystemPromptUpdate = {
				content: systemPrompt,
			};

			await updateSystemPromptMutation.mutateAsync(update);
			// Explicitly refetch to update the UI
			await refetch();
			setIsEdited(false);
		} catch (error) {
			// Error is already handled in the mutation
			console.error("Error updating system prompt:", error);
		} finally {
			setIsSaving(false);
		}
	};

	// Handle reset
	const handleReset = () => {
		if (systemPromptData) {
			setSystemPrompt(systemPromptData.content);
		} else {
			setSystemPrompt(""); // Reset to empty string if no system prompt exists
		}
		setIsEdited(false);
	};

	// Loading state
	if (isLoading) {
		return (
			<StyledCard>
				<StyledCardContent>
					<LoadingContainer>
						<CircularProgress />
					</LoadingContainer>
				</StyledCardContent>
			</StyledCard>
		);
	}

	// Error state
	if (error) {
		return (
			<StyledCard>
				<StyledCardContent>
					<Alert severity="error">
						Failed to load system prompt. Please try again later.
					</Alert>
				</StyledCardContent>
			</StyledCard>
		);
	}

	// No system prompt exists yet (204 response)
	if (!systemPromptData) {
		return (
			<StyledCard>
				<StyledCardContent>
					<CardTitle variant="h6">
						<FontAwesomeIcon icon={faRobot} />
						System Prompt
					</CardTitle>

					<CardDescription variant="body2">
						This system prompt is given to all Local Operator agents. It is
						useful to define some baseline expectations for the behavior of
						every agent in your environment. These instructions will be provided
						in addition to any specific instructions you may have defined for
						each agent.
					</CardDescription>

					<StyledTextField
						label="System Prompt"
						name="systemPrompt"
						value={systemPrompt}
						onChange={handleInputChange}
						variant="outlined"
						multiline
						rows={8}
						fullWidth
						placeholder="Enter instructions for how all agents should behave and respond to your requests..."
					/>

					<ButtonContainer>
						<Button
							variant="contained"
							color="primary"
							size="small"
							startIcon={<FontAwesomeIcon icon={faSave} />}
							onClick={handleSave}
							disabled={!isEdited || isSaving}
						>
							{isSaving ? <CircularProgress size={20} /> : "Save Changes"}
						</Button>

						<Button
							variant="outlined"
							size="small"
							onClick={handleReset}
							disabled={!isEdited || isSaving}
						>
							Cancel
						</Button>
					</ButtonContainer>
				</StyledCardContent>
			</StyledCard>
		);
	}

	return (
		<StyledCard>
			<StyledCardContent>
				<CardTitle variant="h6">
					<FontAwesomeIcon icon={faRobot} />
					System Prompt
				</CardTitle>

				<CardDescription variant="body2">
					This system prompt is given to all Local Operator agents. It is useful
					to define some baseline expectations for the behavior of every agent
					in your environment. These instructions will be provided in addition
					to any specific instructions you may have defined for each agent.
				</CardDescription>

				<StyledTextField
					label="System Prompt"
					name="systemPrompt"
					value={systemPrompt}
					onChange={handleInputChange}
					variant="outlined"
					multiline
					rows={8}
					fullWidth
					placeholder="Enter instructions for how all agents should behave and respond to your requests..."
				/>

				<ButtonContainer>
					<Button
						variant="contained"
						color="primary"
						size="small"
						startIcon={<FontAwesomeIcon icon={faSave} />}
						onClick={handleSave}
						disabled={!isEdited || isSaving}
					>
						{isSaving ? <CircularProgress size={20} /> : "Save Changes"}
					</Button>

					<Button
						variant="outlined"
						size="small"
						onClick={handleReset}
						disabled={!isEdited || isSaving}
					>
						Cancel
					</Button>
				</ButtonContainer>

				{systemPromptData.last_modified && (
					<LastModifiedText variant="caption" color="text.secondary">
						Last modified:{" "}
						{new Date(systemPromptData.last_modified).toLocaleString()}
					</LastModifiedText>
				)}
			</StyledCardContent>
		</StyledCard>
	);
};
