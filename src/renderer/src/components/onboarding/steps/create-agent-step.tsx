/**
 * Create Agent Step Component
 *
 * Sixth step in the onboarding process that allows the user to create their first agent.
 */

import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Alert, Button, CircularProgress, TextField } from "@mui/material";
import { useCreateAgent } from "@renderer/hooks/use-agent-mutations";
import { useConfig } from "@renderer/hooks/use-config";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@renderer/store/onboarding-store";
import type { FC } from "react";
import { useState, useRef } from "react";
import {
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

				await createAgentMutation.mutateAsync({
					name: name.trim(),
					description: description.trim() || undefined,
					hosting: configData.values.hosting,
					model: configData.values.model_name,
				});

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
			<SectionTitle>Create Your First Agent</SectionTitle>
			<SectionDescription>
				Create your first AI agent with a name and optional description. This
				agent will use the default model and provider you selected.
			</SectionDescription>

			<FormContainer>
				<TextField
					label="Agent Name"
					variant="outlined"
					fullWidth
					value={name}
					onChange={handleNameChange}
					error={!!nameError}
					helperText={nameError || "Enter a name for your agent"}
					placeholder="My First Agent"
					required
					disabled={isSaving}
				/>

				<TextField
					label="Description (Optional)"
					variant="outlined"
					fullWidth
					value={description}
					onChange={handleDescriptionChange}
					helperText="Describe what this agent does"
					placeholder="A helpful assistant for..."
					multiline
					rows={2}
					disabled={isSaving}
				/>

				{saveSuccess && (
					<Alert
						severity="success"
						icon={<FontAwesomeIcon icon={faCheck} />}
						sx={{ mt: 2, mb: 2 }}
					>
						Agent created successfully
					</Alert>
				)}

				<Button
					variant="contained"
					color="primary"
					fullWidth
					onClick={handleCreateAgent}
					disabled={!name.trim() || !!nameError || isSaving}
					sx={{ mt: 2 }}
				>
					{isSaving ? <CircularProgress size={24} /> : "Create Agent"}
				</Button>
			</FormContainer>
		</SectionContainer>
	);
};
