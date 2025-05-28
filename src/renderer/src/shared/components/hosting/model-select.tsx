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
	createFilterOptions,
	styled,
} from "@mui/material";
import { useModels } from "@shared/hooks";
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

	/**
	 * Whether to allow the "Default" option in the select
	 * Default: true
	 */
	allowDefault?: boolean;
};

const FieldContainer = styled(Box)({
	marginBottom: 16,
	position: "relative",
});

const FieldLabel = styled(Typography)(({ theme }) => ({
	marginBottom: 6,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
}));

const LabelIcon = styled(Box)({
	marginRight: 8,
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
});

const StyledAutocomplete = styled(Autocomplete)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: 6,
		backgroundColor: theme.palette.background.paper,
		border: `1px solid ${theme.palette.divider}`,
		padding: "0 !important",
		minHeight: "36px",
		height: "36px",
		transition: "border-color 0.2s ease, box-shadow 0.2s ease",
		"&:hover": {
			borderColor: theme.palette.text.secondary,
			backgroundColor: theme.palette.background.paper,
		},
		"&.Mui-focused": {
			backgroundColor: theme.palette.background.paper,
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
		},
		"& .MuiOutlinedInput-notchedOutline": {
			border: "none",
		},
		"& .MuiInputBase-input": {
			padding: "4px 12px !important",
			fontSize: "0.875rem",
			lineHeight: 1.5,
			height: "calc(36px - 8px)",
			boxSizing: "border-box",
		},
		"& .MuiInputBase-input::placeholder": {
			color: theme.palette.text.disabled,
			opacity: 1,
		},
		"& .MuiAutocomplete-endAdornment": {
			right: "8px",
			top: "50%",
			transform: "translateY(-50%)",
		},
		"& .MuiAutocomplete-inputRoot": {
			padding: "0 !important",
		},
	},
	"& .MuiInputBase-root": {
		minHeight: "36px",
		height: "36px",
		padding: "0 !important",
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
	allowDefault = true,
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
	const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const isInitialMountRef = useRef(true);

	useEffect(() => {
		// Skip the effect on initial mount to prevent unnecessary refreshes
		if (isInitialMountRef.current) {
			isInitialMountRef.current = false;
			previousHostingIdRef.current = hostingId;
			return undefined;
		}

		// Only refresh if hostingId has changed and is not null
		if (hostingId && previousHostingIdRef.current !== hostingId) {
			previousHostingIdRef.current = hostingId;

			// Clear any existing timeout to prevent multiple calls
			if (refreshTimeoutRef.current) {
				clearTimeout(refreshTimeoutRef.current);
				refreshTimeoutRef.current = null;
			}

			// Use a short debounce to prevent multiple rapid calls
			// but ensure models are refreshed quickly when hosting provider changes
			refreshTimeoutRef.current = setTimeout(() => {
				// Always refresh models when hosting provider changes
				if (!isModelsLoading) {
					refreshModels().catch((error) => {
						console.error("Error refreshing models:", error);
					});
				}

				// Clear the timeout reference after it's executed
				refreshTimeoutRef.current = null;
			}, 300); // Short delay to batch potential multiple changes

			return () => {
				if (refreshTimeoutRef.current) {
					clearTimeout(refreshTimeoutRef.current);
					refreshTimeoutRef.current = null;
				}
			};
		}

		return undefined;
	}, [hostingId, refreshModels, isModelsLoading]);

	// Convert models to autocomplete options, ensuring uniqueness by ID and specific ordering
	const modelOptions: ModelOption[] = useMemo(() => {
		const finalOptions: ModelOption[] = [];
		const addedIds = new Set<string>();

		// 1. If hostingId is "radient", add "auto" model first if it exists
		if (hostingId === "radient") {
			const autoModelFromAvailable = availableModels.find(
				(model) => model.id === "auto",
			);
			if (autoModelFromAvailable) {
				finalOptions.push({
					id: autoModelFromAvailable.id,
					name: autoModelFromAvailable.name,
					description: autoModelFromAvailable.description,
					model: autoModelFromAvailable,
					recommended: autoModelFromAvailable.recommended,
				});
				addedIds.add(autoModelFromAvailable.id);
			}
		}

		// 2. Add "Default" option if its ID hasn't been added yet and allowDefault is true
		if (allowDefault && !addedIds.has("")) {
			finalOptions.push({
				id: "",
				name: "Default",
				description: "Clear model selection",
				model: undefined,
			});
			addedIds.add("");
		}

		// 3. Add all other models from availableModels that haven't been added yet
		for (const model of availableModels) {
			if (!addedIds.has(model.id)) {
				finalOptions.push({
					id: model.id,
					name: model.name,
					description: model.description,
					model,
					recommended: model.recommended,
				});
				addedIds.add(model.id);
			}
		}

		// 4. Add the current 'value' as a custom option if it's not empty and not already in finalOptions
		if (value && value.trim() !== "" && !addedIds.has(value)) {
			finalOptions.push({
				id: value,
				name: value,
				description: "Custom model",
				model: undefined,
			});
		}

		return finalOptions;
	}, [availableModels, value, hostingId, allowDefault]);

	// Helper text to show when no models are available
	const helperText = useMemo(() => {
		if (!hostingId && !allowDefault) {
			return "Select a hosting provider first.";
		}
		if (
			hostingId &&
			availableModels.length === 0 &&
			!allowDefault &&
			!modelOptions.some((opt) => opt.id === value && value !== "")
		) {
			return "No models available for selected provider.";
		}
		if (availableModels.length === 0 && hostingId) {
			const provider = getHostingProviderById(hostingId);
			if (provider) {
				return `No models for ${provider.name}`;
			}
			return "No models available";
		}
		return undefined;
	}, [availableModels.length, hostingId, allowDefault, modelOptions, value]);

	// Find the current selected option
	const selectedOption = useMemo(() => {
		if (
			(!value || value.trim() === "") &&
			!allowDefault &&
			availableModels.length === 0
		) {
			return null;
		}
		if ((!value || value.trim() === "") && allowDefault) {
			return modelOptions.find((option) => option.id === "") || null;
		}
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
	}, [value, modelOptions, hostingId, allowDefault, availableModels.length]);

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
			<Tooltip title="Select the AI model that you want to use.  Each model has different capabilities and costs.  Recommended: Automatic">
				<FieldLabel variant="subtitle2">
					<LabelIcon>
						<FontAwesomeIcon icon={faRobot} />
					</LabelIcon>
					Model
				</FieldLabel>
			</Tooltip>

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
				groupBy={(option) => {
					const modelOption = option as ModelOption;
					if (hostingId === "radient" && modelOption.id === "auto") {
						return "Auto (Recommended)"; // Special group for "auto" when Radient is active
					}
					if (modelOption.id === "") {
						return "General"; // Group for "Default"
					}

					const providerId = getProviderFromId(modelOption.id);
					// If the model is from Radient (but not 'auto' and hosting is 'radient')
					if (hostingId === "radient" && providerId === "radient") {
						return "Radient"; // Keep other Radient models in a "Radient" group
					}

					// For models from other providers, or Radient models when hosting is not Radient
					const provider = getHostingProviderById(providerId);
					if (provider) {
						return provider.name; // e.g., "OpenAI", "Anthropic", "Radient"
					}
					if (providerId) {
						// Fallback if provider object not found but ID exists
						return providerId;
					}
					return "Other Models"; // Fallback for models without a clear provider
				}}
				renderOption={(props, option) => {
					const { key, ...rest } = props;
					return (
						<li key={key} {...rest}>
							<OptionContainer>
								<OptionLabelContainer>
									<OptionLabel>{(option as ModelOption).name}</OptionLabel>
									{(option as ModelOption).recommended && (
										// @ts-ignore
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
					);
				}}
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
								fontSize: "0.75rem", // Slightly larger helper text
								mt: 0.5,
								ml: 0.5, // Add slight left margin
								opacity: 0.9,
								fontStyle: "normal", // Remove italic
							},
						}}
						InputProps={{
							...params.InputProps,
							// sx is handled by StyledAutocomplete now
							endAdornment: (
								<>
									{isSaving || isSubmitting || isModelsLoading ? ( // Include models loading state
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
						disabled={Boolean(
							(!hostingId && !allowDefault) ||
								(hostingId &&
									availableModels.length === 0 &&
									!allowDefault &&
									!modelOptions.some(
										(opt) => opt.id === value && value !== "",
									)),
						)} // Disable if no hostingId/models and default not allowed
					/>
				)}
			/>
		</FieldContainer>
	);
};
