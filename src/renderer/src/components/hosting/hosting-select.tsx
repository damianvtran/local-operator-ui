/**
 * Hosting Select Component
 *
 * A component for selecting a hosting provider with autocomplete functionality.
 * Filters available options based on user credentials.
 */

import { faServer } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Autocomplete,
	Box,
	CircularProgress,
	TextField,
	Typography,
	alpha,
	createFilterOptions,
	styled,
} from "@mui/material";
import { useCredentials } from "@renderer/hooks/use-credentials";
import type { FC, SyntheticEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	type HostingProvider,
	getAvailableHostingProviders,
	getHostingProviderById,
	getHostingProviders,
} from "./hosting-model-manifest";

/**
 * Type for hosting provider option in the autocomplete
 */
type HostingOption = {
	id: string;
	name: string;
	description: string;
	provider?: HostingProvider;
};

type HostingSelectProps = {
	/**
	 * Current hosting provider ID
	 */
	value: string;

	/**
	 * Callback function when the hosting provider is changed
	 * @param value - The new hosting provider ID
	 */
	onSave: (value: string) => Promise<void>;

	/**
	 * Whether the field is currently being saved
	 */
	isSaving?: boolean;

	/**
	 * Whether to show all hosting providers or only those available with current credentials
	 * Default: true (only show available providers)
	 */
	filterByCredentials?: boolean;

	/**
	 * Whether to allow custom hosting provider entries
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

const OptionLabel = styled(Typography)({
	fontWeight: 500,
});

const OptionDescription = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
}));

/**
 * Hosting Select Component
 *
 * A component for selecting a hosting provider with autocomplete functionality.
 * Filters available options based on user credentials.
 */
export const HostingSelect: FC<HostingSelectProps> = ({
	value,
	onSave,
	isSaving = false,
	filterByCredentials = true,
	allowCustom = true,
}) => {
	// Get user credentials
	const { data: credentialsData } = useCredentials();
	const userCredentials = useMemo(
		() => credentialsData?.keys || [],
		[credentialsData],
	);

	// State for tracking if user is typing or just clicking
	const [isUserTyping, setIsUserTyping] = useState(false);
	const [inputValue, setInputValue] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Flag to track if the dropdown should show all options (no filtering)
	const showAllOptions = useRef(false);

	// Get available hosting providers based on user credentials
	const availableHostingProviders = useMemo(() => {
		if (!filterByCredentials) {
			return getHostingProviders();
		}
		return getAvailableHostingProviders(userCredentials);
	}, [userCredentials, filterByCredentials]);

	// Convert hosting providers to autocomplete options
	const hostingOptions: HostingOption[] = useMemo(() => {
		// Start with Default option
		const options: HostingOption[] = [
			{
				id: "",
				name: "Default",
				description: "Clear hosting provider selection",
				provider: undefined,
			},
		];

		// Map available hosting providers to options
		availableHostingProviders.forEach((provider) => {
			options.push({
				id: provider.id,
				name: provider.name,
				description: provider.description,
				provider,
			});
		});

		// If the current value is not in the available options, add it as a custom option
		if (
			value &&
			!availableHostingProviders.some((provider) => provider.id === value)
		) {
			const customProvider = getHostingProviderById(value);
			if (customProvider) {
				// If it's a known provider but not available with current credentials
				options.push({
					id: customProvider.id,
					name: customProvider.name,
					description: `${customProvider.description} (Requires additional credentials)`,
					provider: customProvider,
				});
			} else if (allowCustom) {
				// If it's a completely custom provider
				options.push({
					id: value,
					name: value,
					description: "Custom hosting provider",
					provider: {
						id: value,
						name: value,
						description: "Custom hosting provider",
						url: "",
						requiredCredentials: [],
						supportedModels: [],
					},
				});
			}
		}

		return options;
	}, [availableHostingProviders, value, allowCustom]);

	// Helper text to show when no credentials are available
	const helperText = useMemo(() => {
		if (filterByCredentials && availableHostingProviders.length === 0) {
			return "No hosting providers available. Add credentials in Settings.";
		}
		return undefined;
	}, [availableHostingProviders.length, filterByCredentials]);

	// Find the current selected option
	const selectedOption = useMemo(() => {
		if (!value) return null;

		return (
			hostingOptions.find((option) => option.id === value) || {
				id: value,
				name: value,
				description: "Custom hosting provider",
				provider: undefined,
			}
		);
	}, [value, hostingOptions]);

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
			const option = newValue as HostingOption;
			await onSave(option.id);

			// User has selected an option, so they're no longer typing
			setIsUserTyping(false);

			// When a selection is made, set the input value to the display name
			setInputValue(option.name);
		} catch (error) {
			console.error("Error saving hosting provider:", error);
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
		const matchingOption = hostingOptions.find(
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
				console.error("Error saving custom hosting provider:", error);
			} finally {
				setIsSubmitting(false);
			}
		}
	};

	return (
		<FieldContainer>
			<FieldLabel variant="subtitle2">
				<LabelIcon>
					<FontAwesomeIcon icon={faServer} />
				</LabelIcon>
				Hosting Provider
			</FieldLabel>

			<StyledAutocomplete
				key={`hosting-select-${hostingOptions.length}`}
				value={selectedOption}
				inputValue={inputValue}
				onChange={handleChange}
				onInputChange={handleInputChange}
				onOpen={handleOpen}
				onClose={handleClose}
				options={hostingOptions}
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
				getOptionLabel={(option) => (option as HostingOption).name}
				isOptionEqualToValue={(option, value) =>
					(option as HostingOption).id === (value as HostingOption).id
				}
				renderOption={(props, option) => (
					<li {...props}>
						<OptionContainer>
							<OptionLabel>{(option as HostingOption).name}</OptionLabel>
							{(option as HostingOption).description && (
								<OptionDescription>
									{(option as HostingOption).description}
								</OptionDescription>
							)}
						</OptionContainer>
					</li>
				)}
				freeSolo={allowCustom}
				renderInput={(params) => (
					<TextField
						{...params}
						placeholder="Select a hosting provider..."
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
