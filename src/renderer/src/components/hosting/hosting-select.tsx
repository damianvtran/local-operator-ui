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
	styled,
} from "@mui/material";
import type { FC, SyntheticEvent } from "react";
import { useMemo, useState, useEffect } from "react";
import { useCredentials } from "@renderer/hooks/use-credentials";
import {
	HOSTING_PROVIDERS,
	getAvailableHostingProviders,
	getHostingProviderById,
	type HostingProvider,
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

	// State for tracking input value and editing state
	const [inputValue, setInputValue] = useState(value || "");
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Get available hosting providers based on user credentials
	const availableHostingProviders = useMemo(() => {
		if (!filterByCredentials) {
			return HOSTING_PROVIDERS;
		}
		return getAvailableHostingProviders(userCredentials);
	}, [userCredentials, filterByCredentials]);

	// Convert hosting providers to autocomplete options
	const hostingOptions: HostingOption[] = useMemo(() => {
		// Map available hosting providers to options
		const options = availableHostingProviders.map((provider) => ({
			id: provider.id,
			name: provider.name,
			description: provider.description,
			provider,
		}));

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
		
		return hostingOptions.find(option => option.id === value) || {
			id: value,
			name: value,
			description: "Custom hosting provider",
			provider: undefined,
		};
	}, [value, hostingOptions]);

	// Reset input value when value prop changes
	useEffect(() => {
		// Find the option that matches the current value
		const option = hostingOptions.find(opt => opt.id === value);
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
	}, [value, hostingOptions]);

	// Handle option change
	const handleChange = async (
		_event: SyntheticEvent,
		newValue: unknown,
	) => {
		if (!newValue) return;
		
		try {
			setIsSubmitting(true);
			// Type assertion since we know the structure
			const option = newValue as HostingOption;
			await onSave(option.id);
		} catch (error) {
			console.error("Error saving hosting provider:", error);
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
		const matchingOption = hostingOptions.find(
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
				key={`hosting-select-${value}-${hostingOptions.length}`}
				value={selectedOption}
				inputValue={inputValue}
				onChange={handleChange}
				onInputChange={handleInputChange}
				options={hostingOptions}
				getOptionLabel={(option) => (option as HostingOption).name}
				isOptionEqualToValue={(option, value) => 
					(option as HostingOption).id === (value as HostingOption).id
				}
				renderOption={(props, option) => (
					<li {...props}>
						<OptionContainer>
							<OptionLabel>{(option as HostingOption).name}</OptionLabel>
							{(option as HostingOption).description && (
								<OptionDescription>{(option as HostingOption).description}</OptionDescription>
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
