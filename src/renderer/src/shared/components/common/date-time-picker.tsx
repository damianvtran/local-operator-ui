import { Box, IconButton, TextField, Tooltip, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { isValid, parseISO } from "date-fns";
import { Clock, CalendarDays, History } from "lucide-react";
import type { FC } from "react";
import { useState, useEffect } from "react";

const StyledTextField = styled(TextField)(({ theme }) => ({
	width: "100%",
	"& .MuiOutlinedInput-root": {
		borderRadius: 6,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: theme.palette.background.paper,
		minHeight: "36px",
		height: "36px",
		padding: 0,
		transition: "border-color 0.2s ease, box-shadow 0.2s ease",
		"&:hover": {
			borderColor: theme.palette.text.secondary,
		},
		"&.Mui-focused": {
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
		},
		"& .MuiOutlinedInput-notchedOutline": {
			border: "none",
		},
		"& .MuiInputBase-input": {
			padding: "8px 12px",
			fontSize: "0.875rem",
			lineHeight: 1.5,
			height: "calc(36px - 16px)",
			boxSizing: "border-box",
		},
	},
	"& .MuiInputAdornment-root .MuiIconButton-root": {
		color: theme.palette.text.secondary,
		padding: theme.spacing(0.5),
	},
}));

const DateTimePickerContainer = styled(Box)({
	display: "flex",
	alignItems: "flex-start",
	gap: "8px",
});

const PickerWrapper = styled(Box)({
	flexGrow: 1,
	minWidth: 0,
});

// Styled FormHelperText for consistency
const StyledFormHelperText = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "error",
})<{ error?: boolean }>(({ theme, error }) => ({
	fontSize: "0.75rem",
	marginTop: theme.spacing(0.5),
	marginLeft: theme.spacing(0.25),
	color: error ? theme.palette.error.main : theme.palette.text.secondary,
}));

// FieldLabel for static label above the input, similar to other components
const FieldLabel = styled("label")(({ theme }) => ({
	display: "block",
	marginBottom: theme.spacing(0.75),
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
	lineHeight: 1.5,
}));

type DateTimePickerProps = {
	label: string; // This will be the static label
	value: string | null; // ISO string or null
	onChange: (isoDateString: string | null) => void;
	disabled?: boolean;
	helperText?: string;
};

export const DateTimePicker: FC<DateTimePickerProps> = ({
	label,
	value,
	onChange,
	disabled,
	helperText,
}) => {
	const [selectedDate, setSelectedDate] = useState<Date | null>(null);
	const [selectedTime, setSelectedTime] = useState<Date | null>(null);

	useEffect(() => {
		if (value && isValid(parseISO(value))) {
			const dateValue = parseISO(value);
			setSelectedDate(dateValue);
			setSelectedTime(dateValue);
		} else {
			setSelectedDate(null);
			setSelectedTime(null);
		}
	}, [value]);

	const handleDateChange = (date: Date | null) => {
		setSelectedDate(date);
		if (date && isValid(date)) {
			const newDateTime = new Date(date);
			if (selectedTime && isValid(selectedTime)) {
				newDateTime.setHours(selectedTime.getHours());
				newDateTime.setMinutes(selectedTime.getMinutes());
				newDateTime.setSeconds(selectedTime.getSeconds());
			} else {
				// Default to midnight if no time is set
				newDateTime.setHours(0, 0, 0, 0);
			}
			onChange(newDateTime.toISOString());
		} else if (date === null && selectedTime) {
			// Date cleared, but time exists - this case might need specific handling
			// For now, if date is cleared, consider the whole value cleared or invalid
			onChange(null);
		} else {
			onChange(null);
		}
	};

	const handleTimeChange = (time: Date | null) => {
		setSelectedTime(time);
		if (time && isValid(time)) {
			const newDateTime = selectedDate ? new Date(selectedDate) : new Date(); // Use current date if no date selected
			newDateTime.setHours(time.getHours());
			newDateTime.setMinutes(time.getMinutes());
			newDateTime.setSeconds(time.getSeconds());
			if (!selectedDate) {
				// If no date was selected, also set the date part of newDateTime to today
				// This ensures that if only time is picked, it's for today.
				// However, the primary flow expects a date to be picked first or concurrently.
				setSelectedDate(new Date(newDateTime.getFullYear(), newDateTime.getMonth(), newDateTime.getDate()));
			}
			onChange(newDateTime.toISOString());
		} else if (time === null && selectedDate) {
			// Time cleared, but date exists. Set time to midnight.
			const newDateTime = new Date(selectedDate);
			newDateTime.setHours(0,0,0,0);
			setSelectedTime(newDateTime); // update time state to midnight
			onChange(newDateTime.toISOString());
		}
		 else {
			onChange(null);
		}
	};

	const handleSetToCurrent = () => {
		const now = new Date();
		setSelectedDate(now);
		setSelectedTime(now);
		onChange(now.toISOString());
	};

	return (
		<LocalizationProvider dateAdapter={AdapterDateFns}>
			<Box>
				{/* Static FieldLabel above the pickers */}
				<FieldLabel htmlFor={`${label.toLowerCase().replace(/\s/g, "-")}-date-field`}>{label}</FieldLabel>
				<DateTimePickerContainer>
					<PickerWrapper>
						<DatePicker
							// label prop removed to prevent floating label
							value={selectedDate}
							onChange={handleDateChange}
							disabled={disabled}
							enableAccessibleFieldDOMStructure={false}
							slots={{
								textField: (params) => (
									<StyledTextField
										{...params}
										id={`${label.toLowerCase().replace(/\s/g, "-")}-date-field`} // Keep id for FieldLabel htmlFor
										placeholder="Select Date" // Placeholder instead of label
									/>
								),
								openPickerIcon: () => <CalendarDays size={18} />, // Use Lucide icon
							}}
							slotProps={{
								openPickerButton: {
									"aria-label": `Choose ${label} Date`,
									size: "small",
								},
								desktopPaper: {
									sx: (theme) => ({
										borderRadius: "6px",
										boxShadow: theme.shadows[2],
										border: `1px solid ${theme.palette.divider}`,
										backgroundColor: theme.palette.background.paper,
										backgroundImage: "none",
									}),
								},
							}}
						/>
					</PickerWrapper>
					<PickerWrapper>
						<TimePicker
							// label prop removed
							value={selectedTime}
							onChange={handleTimeChange}
							disabled={disabled}
							enableAccessibleFieldDOMStructure={false}
							slots={{
								textField: (params) => (
									<StyledTextField
										{...params}
										id={`${label.toLowerCase().replace(/\s/g, "-")}-time-field`} 
										placeholder="Select Time" 
									/>
								),
								openPickerIcon: () => <Clock size={18} />, // Use Lucide icon
							}}
							slotProps={{
								textField: {
									// id is on the StyledTextField itself
								},
								openPickerButton: {
									"aria-label": `Choose ${label} Time`,
									size: "small",
								},
								desktopPaper: {
									sx: (theme) => ({
										borderRadius: "6px",
										boxShadow: theme.shadows[2],
										border: `1px solid ${theme.palette.divider}`,
										backgroundColor: theme.palette.background.paper,
                    backgroundImage: "none",
									}),
								},
							}}
						/>
					</PickerWrapper>
					<Tooltip title="Set to current time">
						<IconButton onClick={handleSetToCurrent} disabled={disabled} size="small" sx={{ mt: "4px" /* Align with top of text fields */ }}>
							<History size={20} />
						</IconButton>
					</Tooltip>
				</DateTimePickerContainer>
				{helperText && <StyledFormHelperText>{helperText}</StyledFormHelperText>}
			</Box>
		</LocalizationProvider>
	);
};
