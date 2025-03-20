/**
 * Model Select Component
 *
 * A component for selecting an AI model with autocomplete functionality.
 * Filters available options based on the selected hosting provider.
 */

import { faRobot, faStar } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Autocomplete,
	Box,
	CircularProgress,
	TextField,
	Tooltip,
	Typography,
	alpha,
	createFilterOptions,
	styled,
} from "@mui/material";
import { useModels } from "@renderer/hooks/use-models";
import type { FC, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
	type Model,
	getHostingProviderById,
	getModelsForHostingProvider,
} from "./hosting-model-manifest";

/**
 * Type for model option in the autocomplete
 */
type ModelOption = {
	id: string;
	name: string;
	description?: string;
	model?: Model | undefined;
	recommended?: boolean;
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
		padding: "16px",
		transition: "all 0.2s ease",
		"&:hover": {
			backgroundColor: alpha(theme.palette.background.default, 0.9),
		},
	},
	"& .MuiInputBase-root": {
		minHeight: "54px",
	},
}));

const OptionContainer = styled(Box)({
	display: "flex",
	flexDirection: "column",
	width: "100%",
});

const OptionLabelContainer = styled(Box)({
	display: "flex",
	alignItems: "center",
	gap: "8px",
});

const OptionLabel = styled(Typography)({
	fontWeight: 500,
});

const RecommendedStar = styled(Box)(({ theme }) => ({
	color: theme.palette.warning.main,
	display: "flex",
	alignItems: "center",
}));

const OptionDescription = styled(Box)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
	"& a": {
		color: theme.palette.primary.main,
		textDecoration: "none",
		"&:hover": {
			textDecoration: "underline",
		},
	},
	"& p": {
		margin: 0,
	},
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
	// State for tracking if user is typing or just clicking
	const [isUserTyping, setIsUserTyping] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Flag to track if the dropdown should show all options (no filtering)
	const showAllOptions = useRef(false);

	// Get available models for the selected hosting provider
	const availableModels = useMemo(() => {
		if (!hostingId) {
			return [];
		}

		// Get models for the selected hosting provider
		const models = getModelsForHostingProvider(hostingId);

		return models;
	}, [hostingId]);

	// Force refresh models when hosting provider changes
	const { refreshModels, isLoading: isModelsLoading } = useModels();
	const previousHostingIdRef = useRef<string | null>(null);
	const refreshTimeRef = useRef<number | null>(null);
	const refreshAttemptCountRef = useRef<number>(0);
	const MAX_REFRESH_ATTEMPTS = 3;

	useEffect(() => {
		// Only refresh if hostingId has changed and is not null
		if (hostingId && previousHostingIdRef.current !== hostingId) {
			previousHostingIdRef.current = hostingId;

			// Reset refresh attempt counter when hosting provider changes
			refreshAttemptCountRef.current = 0;

			// Use a debounced refresh to prevent multiple rapid calls
			const timeoutId = setTimeout(() => {
				// Add a check to prevent refreshing if we've refreshed recently
				const now = Date.now();
				const lastRefreshTime = refreshTimeRef.current;
				const THROTTLE_DURATION = 2000; // 2 second cooldown

				// Prevent infinite loops by limiting the number of refresh attempts
				if (refreshAttemptCountRef.current >= MAX_REFRESH_ATTEMPTS) {
					console.warn(
						`Exceeded maximum model refresh attempts (${MAX_REFRESH_ATTEMPTS}) for hosting provider ${hostingId}`,
					);
					return;
				}

				// Only refresh if we haven't refreshed recently and we're not currently loading models
				if (
					(!lastRefreshTime || now - lastRefreshTime > THROTTLE_DURATION) &&
					!isModelsLoading
				) {
					refreshAttemptCountRef.current += 1;
					refreshModels();
					refreshTimeRef.current = now;
				}
			}, 100); // Slight delay to batch potential multiple changes

			return () => clearTimeout(timeoutId);
		}

		return undefined;
	}, [hostingId, refreshModels, isModelsLoading]);

	// Convert models to autocomplete options
	const modelOptions: ModelOption[] = useMemo(() => {
		// Start with Default option
		const options: ModelOption[] = [
			{
				id: "",
				name: "Default",
				description: "Clear model selection",
				model: undefined,
			},
		];
		// Map available models to autocomplete options
		for (const model of availableModels) {
			options.push({
				id: model.id,
				name: model.name,
				description: model.description,
				model,
				recommended: model.recommended,
			});
		}

		// Check if the current value exists in the available models
		const modelExists = availableModels.some((model) => {
			// Exact match
			if (model.id === value) {
				return true;
			}

			// Check with provider prefix
			if (value?.includes("/")) {
				return model.id?.endsWith(value.split("/")[1]);
			}

			// If value doesn't have a provider prefix, check if model.id ends with value
			// or if model.id without provider prefix equals value
			if (value && !value.includes("/")) {
				// If model.id has a provider prefix
				if (model.id.includes("/")) {
					return model.id.endsWith(`/${value}`);
				}
				// If neither has a provider prefix, just compare directly
				return model.id === value;
			}

			return false;
		});

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
	}, [availableModels, value]);

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
		const exactMatch = modelOptions.find((option) => option.id === value);
		if (exactMatch) {
			return exactMatch;
		}

		// Check if the value is a model name without provider prefix
		if (!value.includes("/") && hostingId) {
			// Try to find a model with this name in the current hosting provider
			const matchByName = modelOptions.find(
				(option) =>
					option.id.endsWith(`/${value}`) ||
					option.name.toLowerCase() === value.toLowerCase(),
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

	// Update input value when selected option changes
	useEffect(() => {
		if (selectedOption) {
			setInputValue(selectedOption.name);
		} else {
			setInputValue("");
		}
	}, [selectedOption]);

	// Handle option change
	const handleChange = async (_event: SyntheticEvent, newValue: unknown) => {
		if (!newValue) return;

		try {
			setIsSubmitting(true);
			// Type assertion since we know the structure
			const option = newValue as ModelOption;
			await onSave(option.id);

			// User has selected an option, so they're no longer typing
			setIsUserTyping(false);

			// When a selection is made, set the input value to the display name
			setInputValue(option.name);
		} catch (error) {
			console.error("Error saving model:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Handle input change
	const handleInputChange = (_event: SyntheticEvent, newInputValue: string) => {
		// Set flag when user is actively typing
		if (newInputValue !== selectedOption?.name) {
			setIsUserTyping(true);
			showAllOptions.current = false;
		}

		setInputValue(newInputValue);
	};

	// Handle dropdown open
	const handleOpen = () => {
		// If user clicks to open without typing, show all options
		if (!isUserTyping && selectedOption) {
			showAllOptions.current = true;
		}
	};

	// Handle dropdown close
	const handleClose = () => {
		// Reset show all options flag
		showAllOptions.current = false;

		// If dropdown is closed without selecting, reset to selected option
		if (isUserTyping && selectedOption) {
			setInputValue(selectedOption.name);
			setIsUserTyping(false);
		}
	};

	// Handle custom value submission (when allowCustom is true)
	const handleCustomSubmit = async (event: React.KeyboardEvent) => {
		if (!allowCustom || event.key !== "Enter" || !inputValue.trim()) return;

		// Check if the input value matches any existing option
		const matchingOption = modelOptions.find(
			(option) => option.name.toLowerCase() === inputValue.toLowerCase(),
		);

		if (matchingOption) {
			// If there's a match, use that option's ID
			await handleChange(event as unknown as SyntheticEvent, matchingOption);
		} else if (inputValue.trim() !== selectedOption?.name) {
			// If it's a new custom value, use the input value as the ID
			try {
				setIsSubmitting(true);
				await onSave(inputValue.trim());
				setIsUserTyping(false);
			} catch (error) {
				console.error("Error saving custom model:", error);
			} finally {
				setIsSubmitting(false);
			}
		}
	};

	/**
	 * Extract provider from model ID (e.g., "openai/gpt-4" -> "openai")
	 * This function is used to group models in the dropdown by their provider
	 *
	 * @param id - The model ID to extract the provider from
	 * @returns The provider part of the model ID, or an empty string if no provider is found
	 */
	const getProviderFromId = (id: string): string => {
		// Handle empty or invalid IDs
		if (!id || typeof id !== "string") return "";

		// Extract the provider part (everything before the first slash)
		// This ensures all models from the same provider are grouped together
		// regardless of their model name
		const slashIndex = id.indexOf("/");
		if (slashIndex > 0) {
			return id.substring(0, slashIndex);
		}

		return "";
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
				key={`model-select-${hostingId}-${modelOptions.length}`}
				value={selectedOption}
				inputValue={inputValue}
				onChange={handleChange}
				onInputChange={handleInputChange}
				onOpen={handleOpen}
				onClose={handleClose}
				options={modelOptions}
				selectOnFocus
				clearOnBlur={false}
				openOnFocus
				filterOptions={(options, params) => {
					// If showing all options (clicked to open without typing), don't filter
					if (showAllOptions.current) {
						return options;
					}

					// Otherwise use default filtering
					return createFilterOptions()(options, params);
				}}
				getOptionLabel={(option) => (option as ModelOption).name}
				isOptionEqualToValue={(option, value) =>
					(option as ModelOption).id === (value as ModelOption).id
				}
				groupBy={(option) => getProviderFromId((option as ModelOption).id)}
				renderOption={(props, option) => (
					<li {...props}>
						<OptionContainer>
							<OptionLabelContainer>
								<OptionLabel>{(option as ModelOption).name}</OptionLabel>
								{(option as ModelOption).recommended && (
									<Tooltip title="Recommended based on community usage and feedback">
										<RecommendedStar>
											<FontAwesomeIcon icon={faStar} size="xs" />
										</RecommendedStar>
									</Tooltip>
								)}
							</OptionLabelContainer>
							{(option as ModelOption).description && (
								<OptionDescription>
									<ReactMarkdown
										components={{
											a: ({ href, children }) => (
												<a
													href={href}
													target="_blank"
													rel="noopener noreferrer"
												>
													{children}
												</a>
											),
										}}
									>
										{(option as ModelOption).description}
									</ReactMarkdown>
								</OptionDescription>
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
								fontSize: "0.7rem",
								mt: 0.5,
								opacity: 0.8,
								fontStyle: "italic",
							},
						}}
						InputProps={{
							...params.InputProps,
							sx: {
								fontSize: "0.875rem",
								lineHeight: 1.6,
							},
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
						onFocus={() => {
							// On focus, if we have a selected value and user is not typing,
							// set flag to show all options
							if (selectedOption && !isUserTyping) {
								showAllOptions.current = true;
							}
						}}
					/>
				)}
			/>
		</FieldContainer>
	);
};
