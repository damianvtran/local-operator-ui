/**
 * Create Agent Step Component
 *
 * Sixth step in the onboarding process that allows the user to create their first AI agent
 * with an exciting and engaging interface.
 */

import {
	faCheck,
	faRobot,
	faLightbulb,
	faMagicWandSparkles,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	TextField,
	Typography,
	alpha,
} from "@mui/material";
import { useCreateAgent } from "@renderer/hooks/use-agent-mutations";
import { useConfig } from "@renderer/hooks/use-config";
import { useAgentSelectionStore } from "@renderer/store/agent-selection-store";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@renderer/store/onboarding-store";
import type { FC } from "react";
import { useState, useRef } from "react";
import {
	EmojiContainer,
	FormContainer,
	SectionContainer,
	SectionDescription,
	SectionTitle,
} from "../onboarding-styled";

/**
 * Create agent step in the onboarding process
 */
export const CreateAgentStep: FC = () => {
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

	return (
		<SectionContainer>
			<SectionTitle>Create Your First AI Assistant</SectionTitle>
			<SectionDescription>
				<EmojiContainer>🤖</EmojiContainer> It's time to create your very first
				AI assistant! Give it a name and personality that reflects what you want
				it to help you with. This is where the magic begins!
			</SectionDescription>

			<Box
				sx={{
					p: 2,
					mb: 3,
					borderRadius: 2,
					background: (theme) =>
						`linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.05)} 0%, ${alpha(theme.palette.secondary.main, 0.05)} 100%)`,
					border: (theme) =>
						`1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
					display: "flex",
					alignItems: "center",
				}}
			>
				<FontAwesomeIcon
					icon={faLightbulb}
					style={{
						fontSize: "1.5rem",
						marginRight: "12px",
						color: "#ff9800",
					}}
				/>
				<Typography variant="body2">
					<Box component="span" sx={{ fontWeight: 600 }}>
						Pro tip!
					</Box>{" "}
					Give your agent a descriptive name and purpose. For example, "Research
					Assistant" or "Creative Writing Partner" will help you remember what
					it's designed to do.
				</Typography>
			</Box>

			<FormContainer>
				<Box sx={{ position: "relative" }}>
					<TextField
						label="Agent Name"
						variant="outlined"
						fullWidth
						value={name}
						onChange={handleNameChange}
						error={!!nameError}
						helperText={nameError || "Give your AI assistant a memorable name"}
						placeholder="My Awesome Assistant"
						required
						disabled={isSaving}
						InputProps={{
							startAdornment: (
								<FontAwesomeIcon
									icon={faRobot}
									style={{ marginRight: "10px", color: "#666" }}
								/>
							),
						}}
						sx={{
							"& .MuiOutlinedInput-root": {
								"&.Mui-focused fieldset": {
									borderColor: "primary.main",
									borderWidth: 2,
								},
							},
						}}
					/>
				</Box>

				<Box sx={{ position: "relative" }}>
					<TextField
						label="Description (Optional)"
						variant="outlined"
						fullWidth
						value={description}
						onChange={handleDescriptionChange}
						helperText="Describe what your AI assistant will help you with"
						placeholder="A helpful assistant for research, writing, coding..."
						multiline
						rows={3}
						disabled={isSaving}
						InputProps={{
							startAdornment: (
								<FontAwesomeIcon
									icon={faLightbulb}
									style={{
										marginRight: "10px",
										marginTop: "16px",
										color: "#666",
									}}
								/>
							),
						}}
						sx={{
							"& .MuiOutlinedInput-root": {
								"&.Mui-focused fieldset": {
									borderColor: "primary.main",
									borderWidth: 2,
								},
							},
						}}
					/>
				</Box>

				{saveSuccess && (
					<Alert
						severity="success"
						icon={<FontAwesomeIcon icon={faCheck} />}
						sx={{
							mt: 2,
							mb: 2,
							animation: "fadeIn 0.5s ease-out",
							border: (theme) =>
								`1px solid ${alpha(theme.palette.success.main, 0.5)}`,
						}}
					>
						<Box sx={{ display: "flex", alignItems: "center" }}>
							<EmojiContainer>🎉</EmojiContainer> Your AI assistant has been
							created successfully! Get ready for amazing conversations!
						</Box>
					</Alert>
				)}

				<Button
					variant="contained"
					color="primary"
					fullWidth
					onClick={handleCreateAgent}
					disabled={!name.trim() || !!nameError || isSaving}
					startIcon={<FontAwesomeIcon icon={faMagicWandSparkles} />}
					sx={{
						mt: 3,
						py: 1.5,
						fontSize: "1rem",
						fontWeight: 600,
						borderRadius: 2,
						background: (theme) =>
							`linear-gradient(90deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
						boxShadow: (theme) =>
							`0 4px 15px ${alpha(theme.palette.primary.main, 0.4)}`,
						"&:hover": {
							background: (theme) =>
								`linear-gradient(90deg, ${theme.palette.primary.dark}, ${theme.palette.secondary.dark})`,
							boxShadow: (theme) =>
								`0 6px 20px ${alpha(theme.palette.primary.main, 0.6)}`,
							transform: "translateY(-2px)",
						},
						transition: "all 0.3s ease",
					}}
				>
					{isSaving ? <CircularProgress size={24} /> : "Create My AI Assistant"}
				</Button>

				<Box
					sx={{
						mt: 2,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<EmojiContainer>💫</EmojiContainer>
					<Typography
						variant="body2"
						sx={{ color: "text.secondary", fontStyle: "italic" }}
					>
						This is the final step before your AI journey begins!
					</Typography>
				</Box>
			</FormContainer>
		</SectionContainer>
	);
};
