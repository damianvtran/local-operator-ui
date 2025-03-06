/**
 * Model Select Component
 *
 * A component for selecting an AI model with autocomplete functionality.
 * Filters available options based on the selected hosting provider.
 */

import { faRobot } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Autocomplete,
	Box,
	CircularProgress,
	TextField,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { FC, SyntheticEvent } from "react";
import { useMemo, useState, useEffect } from "react";
import {
	getHostingProviderById,
	getModelsForHostingProvider,
	type Model,
} from "./hosting-model-manifest";

/**
 * Type for model option in the autocomplete
 */
type ModelOption = {
	id: string;
	name: string;
	description?: string;
	model?: Model | undefined;
};

type ModelSelectProps = {
	/**
	 * Current model ID
	 */
	value: string;

	/**
	 * Current hosting provider ID
	 */
	hostingId: string;

	/**
	 * Callback function when the model is changed
	 * @param value - The new model ID
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Whether to allow custom model entries
	 * Default: true
	 */
	allowCustom?: boolean;
};

// Styled components for consistent UI
const FieldContainer = styled(Box)({
	marginBottom: 24,
	position: "relative",
});

const FieldLabel = styled(Typography)(({ theme }) => ({
	marginBottom: 8,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.secondary,
	fontWeight: 600,
}));

const LabelIcon = styled(Box)({
	marginRight: 12,
	opacity: 0.8,
});

const StyledAutocomplete = styled(Autocomplete)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 8,
		backgroundColor: alpha(theme.palette.background.default, 0.7),
	},
}));

const OptionContainer = styled(Box)({
	display: "flex",
	flexDirection: "column",
	width: "100%",
});

const OptionLabel = styled(Typography)({
	fontWeight: 500,
});

const OptionDescription = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
}));

/**
 * Model Select Component
 *
 * A component for selecting an AI model with autocomplete functionality.
 * Filters available options based on the selected hosting provider.
 */
export const ModelSelect: FC<ModelSelectProps> = ({
	value,
	hostingId,
	onSave,
	isSaving = false,
	allowCustom = true,
}) => {
	// State for tracking input value and editing state
	const [inputValue, setInputValue] = useState(value || "");
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Get available models for the selected hosting provider
	const availableModels = useMemo(() => {
		// Ensure we have a valid hosting ID before fetching models
		if (!hostingId) {
			return [];
		}
		
		// Get models for the selected hosting provider
		const models = getModelsForHostingProvider(hostingId);
		
		return models;
	}, [hostingId]);

	// Convert models to autocomplete options
	const modelOptions: ModelOption[] = useMemo(() => {
		// Map available models to autocomplete options
		const options: ModelOption[] = availableModels.map((model) => ({
			id: model.id,
			name: model.name,
			description: model.description,
			model,
		}));

		// Check if the current value exists in the available models
		const modelExists = availableModels.some((model) => 
			model.id === value || 
			// Also check without provider prefix (e.g., "gpt-4" matches "openai/gpt-4")
			(value && value.includes('/') ? model.id.endsWith(value.split('/')[1]) : false)
		);
		
		// If the current value is not in the available options, add it as a custom option
		if (value && value.trim() !== "" && !modelExists) {
			options.push({
				id: value,
				name: value,
				description: "Custom model",
				model: undefined,
			});
		}

		return options;
	}, [availableModels, value, hostingId]);

	// Helper text to show when no models are available
	const helperText = useMemo(() => {
		if (availableModels.length === 0 && hostingId) {
			const provider = getHostingProviderById(hostingId);
			if (provider) {
				return `No models for ${provider.name}`;
			}
			return "No models available";
		}
		return undefined;
	}, [availableModels.length, hostingId]);

	// Find the current selected option
	const selectedOption = useMemo(() => {
		if (!value || value.trim() === "") return null;
		
		// Check if the value exists exactly in the available options
		const exactMatch = modelOptions.find(option => option.id === value);
		if (exactMatch) {
			return exactMatch;
		}
		
		// Check if the value is a model name without provider prefix
		if (!value.includes('/') && hostingId) {
			// Try to find a model with this name in the current hosting provider
			const matchByName = modelOptions.find(option => 
				option.id.endsWith(`/${value}`) || 
				option.name.toLowerCase() === value.toLowerCase()
			);
			if (matchByName) {
				return matchByName;
			}
		}
		
		// Return a custom option if no match is found
		return {
			id: value,
			name: value,
			description: "Custom model",
			model: undefined,
		};
	}, [value, modelOptions, hostingId]);

	// Reset input value when value prop changes
	useEffect(() => {
		// Find the option that matches the current value
		const option = modelOptions.find(opt => opt.id === value);
		if (option) {
			// If found, update the input value to match
			setInputValue(option.name);
		} else if (value) {
			// If not found but value exists, set input to value
			setInputValue(value);
		} else {
			// If no value, clear input
			setInputValue("");
		}
		
	}, [value, modelOptions]);

	// Handle option change
	const handleChange = async (
		_event: SyntheticEvent,
		newValue: unknown,
	) => {
		if (!newValue) return;
		
		try {
			setIsSubmitting(true);
			// Type assertion since we know the structure
			const option = newValue as ModelOption;
			await onSave(option.id);
		} catch (error) {
			console.error("Error saving model:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Handle input change
	const handleInputChange = (_event: SyntheticEvent, newInputValue: string) => {
		setInputValue(newInputValue);
	};

	// Handle custom value submission (when allowCustom is true)
	const handleCustomSubmit = async (event: React.KeyboardEvent) => {
		if (!allowCustom || event.key !== "Enter" || !inputValue.trim()) return;
		
		// Check if the input value matches any existing option
		const matchingOption = modelOptions.find(
			option => option.name.toLowerCase() === inputValue.toLowerCase()
		);
		
		if (matchingOption) {
			// If there's a match, use that option's ID
			await handleChange(event as unknown as SyntheticEvent, matchingOption);
		} else if (inputValue.trim() !== selectedOption?.name) {
			// If it's a new custom value, use the input value as the ID
			try {
				setIsSubmitting(true);
				await onSave(inputValue.trim());
			} catch (error) {
				console.error("Error saving custom model:", error);
			} finally {
				setIsSubmitting(false);
			}
		}
	};

	// Extract provider from model ID (e.g., "openai/gpt-4" -> "openai")
	const getProviderFromId = (id: string): string => {
		const providerMatch = id.match(/^([^/]+)\//);
		return providerMatch ? providerMatch[1] : "Other";
	};

	return (
		<FieldContainer>
			<FieldLabel variant="subtitle2">
				<LabelIcon>
					<FontAwesomeIcon icon={faRobot} />
				</LabelIcon>
				Model
			</FieldLabel>
			
			<StyledAutocomplete
				key={`model-select-${value}-${hostingId}-${modelOptions.length}`}
				value={selectedOption}
				inputValue={inputValue}
				onChange={handleChange}
				onInputChange={handleInputChange}
				options={modelOptions}
				getOptionLabel={(option) => (option as ModelOption).name}
				isOptionEqualToValue={(option, value) => 
					(option as ModelOption).id === (value as ModelOption).id
				}
				groupBy={(option) => getProviderFromId((option as ModelOption).id)}
				renderOption={(props, option) => (
					<li {...props}>
						<OptionContainer>
							<OptionLabel>{(option as ModelOption).name}</OptionLabel>
							{(option as ModelOption).description && (
								<OptionDescription>{(option as ModelOption).description}</OptionDescription>
							)}
						</OptionContainer>
					</li>
				)}
				freeSolo={allowCustom}
				renderInput={(params) => (
					<TextField
						{...params}
						placeholder="Select a model..."
						variant="outlined"
						size="small"
						helperText={helperText}
						FormHelperTextProps={{
							sx: {
								fontSize: '0.7rem',
								mt: 0.5,
								opacity: 0.8,
								fontStyle: 'italic',
							},
						}}
						InputProps={{
							...params.InputProps,
							endAdornment: (
								<>
									{isSaving || isSubmitting ? (
										<CircularProgress size={20} />
									) : (
										params.InputProps.endAdornment
									)}
								</>
							),
						}}
						onKeyDown={handleCustomSubmit}
					/>
				)}
			/>
		</FieldContainer>
	);
};
