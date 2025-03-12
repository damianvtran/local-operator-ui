/**
 * Create Agent Step Component
 *
 * Sixth step in the onboarding process that allows the user to create their first agent.
 */

import { TextField } from "@mui/material";
import { useCreateAgent } from "@renderer/hooks/use-agent-mutations";
import { useConfig } from "@renderer/hooks/use-config";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@renderer/store/onboarding-store";
import type { FC } from "react";
import { useEffect, useState } from "react";
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

	// Create agent when name and description are set
	useEffect(() => {
		const createFirstAgent = async () => {
			if (
				name.trim() &&
				!nameError &&
				configData?.values.hosting &&
				configData?.values.model_name &&
				!createAgentMutation.isPending
			) {
				try {
					await createAgentMutation.mutateAsync({
						name: name.trim(),
						description: description.trim() || undefined,
						hosting: configData.values.hosting,
						model: configData.values.model_name,
					});

					// Move to the congratulations step after agent is created
					setCurrentStep(OnboardingStep.CONGRATULATIONS);
				} catch (err) {
					console.error("Failed to create agent:", err);
				}
			}
		};

		createFirstAgent();
	}, [
		name,
		description,
		nameError,
		configData,
		createAgentMutation,
		setCurrentStep,
	]);

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
				/>
			</FormContainer>
		</SectionContainer>
	);
};
