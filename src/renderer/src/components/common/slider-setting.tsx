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
	alpha,
	styled,
} from "@mui/material";
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
	padding: theme.spacing(2.5),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor: alpha(theme.palette.background.default, 0.7),
	transition: "all 0.2s ease",
	marginBottom: theme.spacing(2),
	"&:hover": {
		backgroundColor: alpha(theme.palette.background.default, 0.9),
		boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
	},
}));

const LabelWrapper = styled(Box)({
	marginBottom: 8,
});

const LabelText = styled(Typography)(({ theme }) => ({
	marginBottom: 4,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
	fontWeight: 600,
}));

const IconWrapper = styled(Box)(({ theme }) => ({
	marginRight: theme.spacing(1.5),
	opacity: 0.8,
}));

const DescriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem",
	lineHeight: 1.5,
	marginBottom: theme.spacing(2),
}));

const SliderContainer = styled(Box)({
	flexGrow: 1,
});

const StyledSlider = styled(Slider)({
	"& .MuiSlider-thumb": {
		width: 14,
		height: 14,
		transition: "0.2s cubic-bezier(.47,1.64,.41,.8)",
		"&:before": {
			boxShadow: "0 2px 12px 0 rgba(0,0,0,0.4)",
		},
		"&:hover, &.Mui-focusVisible": {
			boxShadow: "0px 0px 0px 8px rgb(255 255 255 / 16%)",
		},
		"&.Mui-active": {
			width: 20,
			height: 20,
		},
	},
	"& .MuiSlider-rail": {
		opacity: 0.28,
	},
});

const InputContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "hasUnit",
})<{ hasUnit?: boolean }>(({ hasUnit }) => ({
	display: "flex",
	alignItems: "center",
	minWidth: hasUnit ? "130px" : "100px",
}));

const StyledTextField = styled(TextField, {
	shouldForwardProp: (prop) => prop !== "hasUnit",
})<{ hasUnit?: boolean }>(({ theme, hasUnit }) => ({
	width: hasUnit ? "130px" : "100px",
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius * 1.5,
	},
	"& .MuiInputAdornment-root": {
		marginLeft: 0,
	},
}));

const UnitText = styled(Typography)({
	fontSize: "0.9rem",
	marginLeft: -4,
	marginRight: 12,
});

const MinMaxContainer = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	marginTop: 8,
});

const MinMaxText = styled(Typography)({
	variant: "caption",
	color: "text.secondary",
});

/**
 * Slider Setting Component
 *
 * A component for adjusting numeric settings with a slider and direct input
 *
 * @param props - SliderSettingProps
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
	const [sliderValue, setSliderValue] = useState<number>(value);
	const [inputValue, setInputValue] = useState<string>(value.toString());
	const [_isEditing, setIsEditing] = useState(false);

	// Update local state when prop value changes
	useEffect(() => {
		setSliderValue(value);
		setInputValue(value.toString());
	}, [value]);

	/**
	 * Handles slider change events
	 */
	const handleSliderChange = (_: Event, newValue: number | number[]) => {
		const numValue = newValue as number;
		setSliderValue(numValue);
		setInputValue(numValue.toString());
	};

	/**
	 * Handles slider change completion
	 */
	const handleSliderChangeCommitted = (
		_: Event | SyntheticEvent<Element, Event>,
		newValue: number | number[],
	) => {
		if (isSaving) return;

		const numValue = newValue as number;
		try {
			void onChange(numValue);
		} catch (error) {
			// If there's an error, revert the UI state
			setSliderValue(value);
			setInputValue(value.toString());
			console.error("Error updating setting:", error);
		}
	};

	/**
	 * Handles direct input changes
	 */
	const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
		setInputValue(e.target.value);
	};

	/**
	 * Handles input blur - commits the change
	 */
	const handleInputBlur = async () => {
		setIsEditing(false);

		if (isSaving) return;

		const numValue = Number.parseInt(inputValue, 10);

		if (Number.isNaN(numValue)) {
			// Reset to current value if invalid
			setInputValue(value.toString());
			setSliderValue(value);
			return;
		}

		// Clamp value to min/max range
		const clampedValue = Math.max(min, Math.min(max, numValue));
		setSliderValue(clampedValue);
		setInputValue(clampedValue.toString());

		if (clampedValue !== value) {
			try {
				await onChange(clampedValue);
			} catch (error) {
				// If there's an error, revert the UI state
				setSliderValue(value);
				setInputValue(value.toString());
				console.error("Error updating setting:", error);
			}
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
			<LabelWrapper>
				<LabelText variant="subtitle2">
					{icon && (
						<IconWrapper>
							<FontAwesomeIcon icon={icon} />
						</IconWrapper>
					)}
					{label}
				</LabelText>

				{description && (
					<DescriptionText variant="body2" color="text.secondary">
						{description}
					</DescriptionText>
				)}
			</LabelWrapper>

			<Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
				<SliderContainer>
					<StyledSlider
						value={sliderValue}
						min={min}
						max={max}
						step={step}
						onChange={handleSliderChange}
						onChangeCommitted={handleSliderChangeCommitted}
						disabled={isSaving}
					/>
				</SliderContainer>

				<InputContainer hasUnit={!!unit}>
					{isSaving ? (
						<CircularProgress size={24} sx={{ mr: 1 }} />
					) : (
						<StyledTextField
							hasUnit={!!unit}
							value={inputValue}
							onChange={handleInputChange}
							onBlur={handleInputBlur}
							onFocus={handleInputFocus}
							onKeyPress={handleKeyPress}
							variant="outlined"
							size="small"
							type="number"
							inputProps={{
								min,
								max,
								step,
								style: {
									textAlign: "right",
									paddingRight: unit ? "8px" : "0",
								},
							}}
							InputProps={{
								endAdornment: unit ? (
									<InputAdornment position="end">
										<UnitText variant="caption">{unit}</UnitText>
									</InputAdornment>
								) : undefined,
								sx: {
									pr: unit ? 0.5 : 1,
								},
							}}
						/>
					)}
				</InputContainer>
			</Box>

			<MinMaxContainer>
				<MinMaxText variant="caption" color="text.secondary">
					{min}
				</MinMaxText>
				<MinMaxText variant="caption" color="text.secondary">
					{max}
				</MinMaxText>
			</MinMaxContainer>
		</SettingContainer>
	);
};
