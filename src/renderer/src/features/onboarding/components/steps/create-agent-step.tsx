/**
 * Create Agent Step Component
 *
 * Sixth step in the onboarding process that allows the user to create their first AI agent
 * with an exciting and engaging interface.
 */

import {
	faCheck,
	faLightbulb,
	faMagicWandSparkles,
	faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	CircularProgress,
	TextField,
	Typography,
	alpha,
	useTheme, // Import useTheme
} from "@mui/material";
import { useCreateAgent } from "@shared/hooks/use-agent-mutations";
import { useConfig } from "@shared/hooks/use-config";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { FC } from "react";
import { useRef, useState } from "react";
import {
	EmojiContainer, // Keep one EmojiContainer import
	FieldLabel, // Import FieldLabel
	FormContainer,
	LabelIcon, // Import LabelIcon
	PrimaryButton, // Import PrimaryButton
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

/**
 * Create agent step in the onboarding process
 */
export const CreateAgentStep: FC = () => {
	const theme = useTheme(); // Get theme context
	// State for agent name and description
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [nameError, setNameError] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	// Reference to store the timeout ID for clearing
	const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Get config for default model and provider
	const { data: configData } = useConfig();
	const { setCurrentStep } = useOnboardingStore();

	// Create agent mutation
	const createAgentMutation = useCreateAgent();
	const { setLastChatAgentId } = useAgentSelectionStore();

	// Handle name change
	const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setName(value);

		if (!value.trim()) {
			setNameError("Agent name is required");
		} else {
			setNameError("");
		}
	};

	// Handle description change
	const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setDescription(e.target.value);
	};

	// Handle creating the agent
	const handleCreateAgent = async () => {
		if (
			name.trim() &&
			!nameError &&
			configData?.values.hosting &&
			configData?.values.model_name &&
			!isSaving
		) {
			try {
				setIsSaving(true);
				setSaveSuccess(false);

				const result = await createAgentMutation.mutateAsync({
					name: name.trim(),
					description: description.trim() || undefined,
					hosting: configData.values.hosting,
					model: configData.values.model_name,
				});

				// Set the newly created agent as the selected agent
				if (result?.id) {
					setLastChatAgentId(result.id);

					// Store the agent ID to navigate to after onboarding completes
					sessionStorage.setItem("onboarding_created_agent_id", result.id);
				}

				setSaveSuccess(true);

				// Clear any existing timeout
				if (successTimeoutRef.current) {
					clearTimeout(successTimeoutRef.current);
				}

				// Set a timeout to hide the success message and move to the next step
				successTimeoutRef.current = setTimeout(() => {
					setSaveSuccess(false);
					// Move to the congratulations step after agent is created
					setCurrentStep(OnboardingStep.CONGRATULATIONS);
				}, 1500);
			} catch (err) {
				console.error("Failed to create agent:", err);
			} finally {
				setIsSaving(false);
			}
		}
	};

	// Define shadcn-like input styles using sx prop
	const inputSx = {
		"& .MuiOutlinedInput-root": {
			borderRadius: theme.shape.borderRadius * 0.75,
			backgroundColor: theme.palette.background.paper,
			border: `1px solid ${theme.palette.divider}`,
			minHeight: "40px", // Standard height
			// height: "40px", // Let height be determined by content for multiline
			transition: "border-color 0.2s ease, box-shadow 0.2s ease",
			"&:hover": {
				borderColor: theme.palette.text.secondary,
			},
			"&.Mui-focused": {
				borderColor: theme.palette.primary.main,
				boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
			},
			"& .MuiOutlinedInput-notchedOutline": {
				border: "none",
			},
			"& .MuiInputBase-input": {
				padding: theme.spacing(1, 1.5),
				fontSize: "0.875rem",
				// height: "calc(40px - 16px)", // Remove fixed height for multiline
				boxSizing: "border-box",
			},
			"& .MuiInputBase-input::placeholder": {
				color: theme.palette.text.disabled,
				opacity: 1,
			},
			"& .MuiInputAdornment-root": {
				color: theme.palette.text.secondary,
				marginRight: theme.spacing(0.5),
				// Align adornment top for multiline
				alignSelf: "flex-start",
				marginTop: theme.spacing(1.25),
			},
		},
		"& .MuiFormHelperText-root": {
			fontSize: "0.75rem",
			mt: 0.5,
			ml: 0.5,
		},
		// Remove MUI label specific styles from inputSx
		// "& .MuiInputLabel-root": { ... },
		// "& .MuiInputLabel-outlined.MuiInputLabel-shrink": { ... },
	};

	// Style for info boxes
	const infoBoxSx = {
		p: 1.5,
		borderRadius: theme.shape.borderRadius * 0.75,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: alpha(theme.palette.background.default, 0.5),
		display: "flex",
		alignItems: "center",
		gap: 1.5,
	};

	// Style for the success alert
	const successAlertSx = {
		mt: 1, // Reduced margin
		mb: 1,
		borderRadius: theme.shape.borderRadius * 0.75,
		border: `1px solid ${theme.palette.success.main}`,
		backgroundColor: alpha(theme.palette.success.main, 0.1),
		color: theme.palette.success.dark,
		"& .MuiAlert-icon": {
			color: theme.palette.success.main,
		},
	};

	return (
		<SectionContainer>
			<SectionTitle>
				<EmojiContainer sx={{ mb: 0 }}>🤖</EmojiContainer> Create Your First AI
				Assistant
			</SectionTitle>
			<SectionDescription>
				Give your AI assistant a name and describe its purpose. This helps
				personalize its responses.
			</SectionDescription>

			{/* "Pro tip!" Info Box */}
			<Box sx={{ ...infoBoxSx, mb: 2 }}>
				<FontAwesomeIcon
					icon={faLightbulb}
					size="lg"
					color={theme.palette.warning.main} // Use warning color for tips
				/>
				<Typography variant="body2">
					<Typography component="span" fontWeight="medium">
						Pro Tip:
					</Typography>{" "}
					Use a descriptive name like "Research Assistant" or "Creative Writing
					Partner".
				</Typography>
			</Box>

			<FormContainer>
				{/* Agent Name */}
				<Box>
					{" "}
					{/* Wrap Label and Input */}
					<FieldLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faRobot} size="sm" />
						</LabelIcon>
						Agent Name
					</FieldLabel>
					<TextField
						// Remove label prop
						variant="outlined"
						fullWidth
						value={name}
						onChange={handleNameChange}
						error={!!nameError}
						helperText={nameError || "A memorable name for your AI assistant"}
						placeholder="My Awesome Assistant"
						required
						disabled={isSaving}
						// Remove InputProps startAdornment
						sx={inputSx} // Apply shared input styles
					/>
				</Box>

				{/* Agent Description */}
				<Box>
					{" "}
					{/* Wrap Label and Input */}
					<FieldLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faLightbulb} size="sm" />
						</LabelIcon>
						Description (Optional)
					</FieldLabel>
					<TextField
						// Remove label prop
						variant="outlined"
						fullWidth
						value={description}
						onChange={handleDescriptionChange}
						helperText="Describe the assistant's purpose or specialty"
						placeholder="e.g., Helps with research, writing, coding..."
						multiline
						rows={3} // Keep multiline
						disabled={isSaving}
						// Remove InputProps startAdornment
						sx={inputSx} // Apply shared input styles
					/>
				</Box>

				{/* Save Success Alert */}
				{saveSuccess && (
					<Alert
						severity="success"
						icon={<FontAwesomeIcon icon={faCheck} />}
						sx={successAlertSx}
					>
						<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
							<EmojiContainer sx={{ mb: 0 }}>🎉</EmojiContainer> AI assistant
							created successfully!
						</Box>
					</Alert>
				)}

				{/* Create Button - Use PrimaryButton */}
				<PrimaryButton
					fullWidth
					onClick={handleCreateAgent}
					disabled={!name.trim() || !!nameError || isSaving || saveSuccess} // Disable after success too
					startIcon={
						isSaving ? undefined : (
							<FontAwesomeIcon icon={faMagicWandSparkles} />
						)
					} // Hide icon when loading
					sx={{ mt: 1 }} // Reduced margin top
				>
					{isSaving ? (
						<CircularProgress size={24} color="inherit" />
					) : (
						"Create My AI Assistant"
					)}
				</PrimaryButton>

				{/* Final Note */}
				<SectionDescription sx={{ mt: 1, textAlign: "center" }}>
					<EmojiContainer sx={{ mr: 0.5 }}>💫</EmojiContainer>
					Almost there! Just one more click after creating your agent.
				</SectionDescription>
			</FormContainer>
		</SectionContainer>
	);
};
