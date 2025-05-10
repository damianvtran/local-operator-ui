/**
 * Slider Setting Component
 *
 * A component for adjusting numeric settings with a slider and direct input
 */

import type { IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	CircularProgress,
	InputAdornment,
	Paper,
	Slider,
	TextField,
	Typography,
	styled,
	useTheme, // Import useTheme
} from "@mui/material";
import { alpha } from "@mui/material/styles"; // Import alpha from styles
import { useEffect, useState } from "react";
import type { ChangeEvent, FC, KeyboardEvent, SyntheticEvent } from "react";

type SliderSettingProps = {
	/**
	 * Current value of the setting
	 */
	value: number;

	/**
	 * Label for the setting
	 */
	label: string;

	/**
	 * Description of what the setting does
	 */
	description?: string;

	/**
	 * Minimum value for the slider
	 */
	min: number;

	/**
	 * Maximum value for the slider
	 */
	max: number;

	/**
	 * Step size for the slider
	 */
	step?: number;

	/**
	 * Unit label to display after the value (optional)
	 */
	unit?: string;

	/**
	 * Callback function when the value is changed
	 * @param value - The new value
	 */
	onChange: (value: number) => Promise<void>;

	/**
	 * Optional icon to display next to the label
	 */
	icon?: IconDefinition;

	/**
	 * Whether the setting is currently being saved
	 */
	isSaving?: boolean;
};

const SettingContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2), // Adjusted padding
	borderRadius: theme.shape.borderRadius * 1.5, // Adjusted border radius
	backgroundColor: theme.palette.background.paper, // Use paper background
	border: `1px solid ${theme.palette.divider}`, // Use theme divider color
	transition: "border-color 0.2s ease", // Simplified transition
	marginBottom: theme.spacing(2),
	// Removed hover effect for a cleaner look, consistent with shadcn cards
}));

// --- Label and Description ---

const LabelWrapper = styled(Box)(({ theme }) => ({
	marginBottom: theme.spacing(1), // Adjusted margin
}));

const LabelText = styled(Typography)(({ theme }) => ({
	// Use variant="subtitle1" or "h6" for consistency if needed elsewhere
	fontWeight: 500, // Slightly reduced weight
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
	marginBottom: theme.spacing(0.5), // Add small margin below label
}));

const IconWrapper = styled(Box)(({ theme }) => ({
	marginRight: theme.spacing(1), // Adjusted margin
	color: theme.palette.text.secondary, // Use secondary text color for icon
	display: "flex", // Ensure icon aligns well
	alignItems: "center",
}));

const DescriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.8rem", // Slightly smaller description
	color: theme.palette.text.secondary, // Use secondary text color
	lineHeight: 1.4,
	marginBottom: theme.spacing(1.5), // Adjusted margin
}));

// --- Slider ---

const SliderContainer = styled(Box)({
	flexGrow: 1,
	paddingRight: "8px", // Add slight padding to avoid thumb collision with input
});

const StyledSlider = styled(Slider)(({ theme }) => ({
	color: theme.palette.primary.main, // Use primary color
	height: 6, // Slightly thinner slider
	padding: "13px 0", // Adjust padding for interaction area
	"& .MuiSlider-thumb": {
		height: 16, // Slightly larger thumb
		width: 16,
		backgroundColor: theme.palette.primary.main, // Thumb color
		border: `2px solid ${theme.palette.background.paper}`, // Border to match background
		"&:focus, &:hover, &.Mui-active, &.Mui-focusVisible": {
			boxShadow: `0 0 0 6px ${alpha(theme.palette.primary.main, 0.16)}`, // Consistent focus/hover ring
		},
		"&:before": {
			display: "none", // Remove default pseudo-element
		},
	},
	"& .MuiSlider-valueLabel": {
		// Style value label if needed, similar to shadcn tooltip
		fontSize: 12,
		fontWeight: "normal",
		top: -6,
		backgroundColor: alpha(theme.palette.grey[900], 0.85),
		color: theme.palette.common.white,
		borderRadius: theme.shape.borderRadius,
		padding: "2px 6px",
		"&:before": {
			display: "none", // Remove arrow
		},
	},
	"& .MuiSlider-track": {
		height: 6,
		border: "none",
		borderRadius: theme.shape.borderRadius, // Rounded track
	},
	"& .MuiSlider-rail": {
		height: 6,
		opacity: 0.3, // Subtle rail
		backgroundColor: theme.palette.grey[400], // Use grey for rail
		borderRadius: theme.shape.borderRadius, // Rounded rail
	},
}));

// --- Input ---

const InputContainer = styled(Box)({
	display: "flex",
	alignItems: "center",
	minWidth: "110px", // Increased min-width for wider input
});

const StyledTextField = styled(TextField)(({ theme }) => ({
	width: "110px", // Increased width for wider input
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius, // Standard border radius
		backgroundColor: theme.palette.background.default, // Use default background
		fontSize: "0.875rem", // Match typical input text size
		height: "36px", // Consistent height
		"& fieldset": {
			borderColor: theme.palette.divider, // Use divider color for border
		},
		"&:hover fieldset": {
			borderColor: theme.palette.grey[500], // Slightly darker border on hover
		},
		"&.Mui-focused fieldset": {
			borderColor: theme.palette.primary.main, // Primary color border on focus
			borderWidth: "1px", // Ensure border width consistency
		},
		// Remove inner padding if adornment exists to prevent layout shift
		"& .MuiInputAdornment-root + .MuiOutlinedInput-input": {
			paddingRight: theme.spacing(0.5),
		},
	},
	"& .MuiOutlinedInput-input": {
		padding: theme.spacing(1, 1.5), // Adjust padding
		textAlign: "right",
	},
	"& input[type=number]": {
		// Improve number input appearance
		appearance: "textfield",
	},
	"& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button":
		{
			// Hide number spinners
			appearance: "none",
			margin: 0,
		},
}));

const UnitText = styled(Typography)(({ theme }) => ({
	fontSize: "0.8rem",
	color: theme.palette.text.secondary,
	paddingLeft: theme.spacing(0.5), // Add padding for spacing
	paddingRight: theme.spacing(1), // Ensure space after unit
}));

// --- Min/Max Labels ---

const MinMaxContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "space-between",
	marginTop: theme.spacing(0.5), // Reduced margin top
}));

const MinMaxText = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem", // Smaller text for min/max
	color: theme.palette.text.disabled, // Use disabled color for less emphasis
}));

/**
 * Slider Setting Component
 *
 * A component for adjusting numeric settings with a slider and direct input
 *
 * @param props - The component props.
 * @returns The SliderSetting component.
 */
export const SliderSetting: FC<SliderSettingProps> = ({
	value,
	label,
	description,
	min,
	max,
	step = 1,
	unit,
	onChange,
	icon,
	isSaving = false,
}) => {
	const theme = useTheme(); // Get theme for conditional styles if needed later
	const [sliderValue, setSliderValue] = useState<number>(value);
	const [inputValue, setInputValue] = useState<string>(value.toString());
	const [isEditing, setIsEditing] = useState(false); // Renamed state variable

	// Update local state when the external value prop changes
	useEffect(() => {
		// Only update if not currently editing the input to avoid overriding user input
		if (!isEditing) {
			setSliderValue(value);
			setInputValue(value.toString());
		}
	}, [value, isEditing]); // Add isEditing to dependency array

	/**
	 * Handles slider change events
	 */
	const handleSliderChange = (_event: Event, newValue: number | number[]) => {
		const numValue = newValue as number;
		setSliderValue(numValue);
		setInputValue(numValue.toString());
		// Optionally trigger onChange immediately for smoother feedback,
		// but handleSliderChangeCommitted is usually preferred for performance.
	};

	/**
	 * Handles slider change completion (when the user releases the slider).
	 */
	const handleSliderChangeCommitted = async (
		_event: Event | SyntheticEvent<Element, Event>,
		newValue: number | number[],
	) => {
		if (isSaving) return;

		const numValue = newValue as number;
		// Ensure the committed value is within bounds (Slider should handle this, but double-check)
		const clampedValue = Math.max(min, Math.min(max, numValue));

		setSliderValue(clampedValue);
		setInputValue(clampedValue.toString());

		if (clampedValue !== value) {
			try {
				await onChange(clampedValue);
			} catch (error) {
				console.error("Error updating setting via slider:", error);
				// Revert UI state on error
				setSliderValue(value);
				setInputValue(value.toString());
			}
		}
	};

	/**
	 * Handles direct input changes
	 */
	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
	};

	/**
	 * Handles input blur - validates and commits the change.
	 */
	const handleInputBlur = async () => {
		setIsEditing(false); // Mark editing as finished

		if (isSaving) return;

		let numValue = Number.parseFloat(inputValue); // Use parseFloat for potential decimal steps

		// Validate and clamp the input value
		if (Number.isNaN(numValue)) {
			numValue = value; // Reset to original value if invalid
		} else {
			numValue = Math.max(min, Math.min(max, numValue));
			// Optional: Snap to the nearest step
			if (step) {
				numValue = Math.round(numValue / step) * step;
				// Handle potential floating point inaccuracies if needed
				const precision = step.toString().split(".")[1]?.length || 0;
				numValue = Number.parseFloat(numValue.toFixed(precision));
			}
		}

		// Update state only if the clamped/validated value differs from the original prop
		if (numValue !== value) {
			setSliderValue(numValue);
			setInputValue(numValue.toString());
			try {
				await onChange(numValue);
			} catch (error) {
				console.error("Error updating setting via input:", error);
				// Revert UI state on error
				setSliderValue(value);
				setInputValue(value.toString());
			}
		} else {
			// If the value hasn't changed effectively, still reset the input
			// string representation to the official value (e.g., user typed "5.0" but value is 5)
			setSliderValue(value);
			setInputValue(value.toString());
		}
	};

	/**
	 * Handles input focus
	 */
	const handleInputFocus = () => {
		setIsEditing(true);
	};

	/**
	 * Handles key press in the input field
	 */
	const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			(e.target as HTMLInputElement).blur();
		}
	};

	return (
		<SettingContainer elevation={0}>
			{/* Label and Description */}
			<LabelWrapper>
				<LabelText variant="subtitle1">
					{icon && (
						<IconWrapper>
							{/* Ensure FontAwesomeIcon size/color is appropriate */}
							<FontAwesomeIcon icon={icon} size="sm" />
						</IconWrapper>
					)}
					{label}
				</LabelText>
				{description && (
					<DescriptionText variant="body2">{description}</DescriptionText>
				)}
			</LabelWrapper>

			{/* Slider and Input Row */}
			<Box
				sx={{ display: "flex", alignItems: "center", gap: theme.spacing(2) }}
			>
				<SliderContainer>
					<StyledSlider
						value={sliderValue}
						min={min}
						max={max}
						step={step}
						onChange={handleSliderChange}
						onChangeCommitted={handleSliderChangeCommitted}
						disabled={isSaving}
						valueLabelDisplay="auto" // Show label on hover/drag
					/>
					{/* MinMax Labels below Slider */}
					<MinMaxContainer>
						<MinMaxText>{min}</MinMaxText>
						<MinMaxText>{max}</MinMaxText>
					</MinMaxContainer>
				</SliderContainer>

				<InputContainer>
					{isSaving ? (
						// Consistent loading indicator size
						<CircularProgress size={20} sx={{ margin: "8px 12px" }} />
					) : (
						<StyledTextField
							value={inputValue}
							onChange={handleInputChange}
							onBlur={handleInputBlur}
							onFocus={handleInputFocus}
							onKeyDown={handleKeyPress} // Use onKeyDown for Enter
							variant="outlined"
							size="small" // Keep size small for compactness
							type="number"
							disabled={isSaving}
							inputProps={{
								min,
								max,
								step,
								// Removed inline styles, handled by StyledTextField
							}}
							InputProps={{
								endAdornment: unit ? (
									// Use position="end" correctly
									<InputAdornment position="end" sx={{ mr: 0, ml: -1 }}>
										<UnitText>{unit}</UnitText>
									</InputAdornment>
								) : undefined,
								// Removed sx padding, handled by StyledTextField
							}}
						/>
					)}
				</InputContainer>
			</Box>
		</SettingContainer>
	);
};
