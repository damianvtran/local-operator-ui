import type { FC } from "react";
import {
	TextField,
	Grid,
	FormControl,
	InputLabel,
	Select,
	MenuItem,
	FormControlLabel,
	Switch,
	CircularProgress,
	FormHelperText,
	Typography,
	Tooltip,
	Autocomplete, // Added Autocomplete
	Box, // Added Box for Autocomplete renderOption
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type {
	ScheduleCreateRequest,
	ScheduleResponse,
	ScheduleUnit,
	ScheduleUpdateRequest,
	AgentDetails, // Added AgentDetails
} from "@shared/api/local-operator";
import { useEffect, useState, useMemo } from "react"; // Added useMemo
import { styled } from "@mui/material/styles";
import { Save, XSquare } from "lucide-react"; // Using lucide-react icons
import { useAgents } from "@shared/hooks/use-agents"; // Import useAgents
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";

// Styled components from the original file, adapted for BaseDialog if needed
// or removed if BaseDialog's own styled components suffice.

const StyledFormGrid = styled(Grid)(({ theme }) => ({
	paddingTop: theme.spacing(1), // Add some top padding to the grid itself
	"& .MuiGrid-item": {
		// Keep specific item padding if needed, or rely on Grid spacing
		// paddingTop: theme.spacing(1),
		// paddingBottom: theme.spacing(1),
	},
}));

const FullWidthTextField = styled(TextField)({
	width: '100%',
	'& .MuiOutlinedInput-root': {
		borderRadius: 6,
		border: '1px solid var(--mui-palette-divider)',
		minHeight: '36px',
		transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
		'&:hover': {
			borderColor: 'var(--mui-palette-text-secondary)',
		},
		'&.Mui-focused': {
			borderColor: 'var(--mui-palette-primary-main)',
			boxShadow: '0 0 0 2px var(--mui-palette-primary-main)33',
		},
		'& .MuiOutlinedInput-notchedOutline': {
			border: 'none',
		},
	},
	'& .MuiInputBase-input': {
		padding: '8px 12px',
		fontSize: '0.875rem',
		lineHeight: 1.5,
	},
});

const FullWidthFormControl = styled(FormControl)({
	width: '100%',
	'& .MuiOutlinedInput-root': {
		borderRadius: 6,
		border: '1px solid var(--mui-palette-divider)',
		minHeight: '36px',
		transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
		'&:hover': {
			borderColor: 'var(--mui-palette-text-secondary)',
		},
		'&.Mui-focused': {
			borderColor: 'var(--mui-palette-primary-main)',
			boxShadow: '0 0 0 2px var(--mui-palette-primary-main)33',
		},
		'& .MuiOutlinedInput-notchedOutline': {
			border: 'none',
		},
	},
	'& .MuiSelect-select': {
		padding: '8px 12px',
		fontSize: '0.875rem',
		lineHeight: 1.5,
	},
});


type ScheduleFormDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (
		data: ScheduleCreateRequest | ScheduleUpdateRequest,
		agentId: string, // AgentId is now mandatory for submission from this form
	) => Promise<void>;
	initialData?: ScheduleResponse | null;
	// agentId prop is removed as it's now selected within the dialog
};

// Represents the form state.
type FormDataType = ScheduleCreateRequest & {
	selectedAgentId: string | null; // Add selectedAgentId to form data
};

const defaultFormState: FormDataType = {
	selectedAgentId: null, // Initialize selectedAgentId
	prompt: "",
	interval: 1,
	unit: "hours",
	is_active: true,
	one_time: false,
	start_time_utc: null,
	end_time_utc: null,
};

/**
 * ScheduleFormDialog component
 *
 * A dialog for creating or editing agent schedules.
 */
export const ScheduleFormDialog: FC<ScheduleFormDialogProps> = ({
	open,
	onClose,
	onSubmit,
	initialData,
	// agentId prop removed
}) => {
	const [formData, setFormData] = useState<FormDataType>(defaultFormState);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [agentSearchQuery, setAgentSearchQuery] = useState("");
	const [selectedAgentForForm, setSelectedAgentForForm] = useState<AgentDetails | null>(null);

	const isEditMode = !!initialData;

	// Fetch agents for the Autocomplete
	const {
		data: agentsListResult,
		isLoading: isLoadingAgents,
		isError: isAgentsError,
	} = useAgents(1, 50, 0, agentSearchQuery || undefined, "name", "asc");

	const agentOptions = useMemo(() => agentsListResult?.agents || [], [agentsListResult]);

	useEffect(() => {
		if (open) {
			if (initialData) {
				// Editing existing schedule
				setFormData({
					selectedAgentId: initialData.agent_id, // Pre-fill agent if editing
					prompt: initialData.prompt,
					interval: initialData.interval,
					unit: initialData.unit,
					is_active: initialData.is_active,
					one_time: initialData.one_time,
					start_time_utc: initialData.start_time_utc
						? new Date(initialData.start_time_utc).toISOString().slice(0, 16)
						: null,
					end_time_utc: initialData.end_time_utc
						? new Date(initialData.end_time_utc).toISOString().slice(0, 16)
						: null,
				});
				// Attempt to find and set the agent object for the Autocomplete if editing
				const currentAgent = agentOptions.find(agent => agent.id === initialData.agent_id);
				if (currentAgent) {
					setSelectedAgentForForm(currentAgent);
				} else if (initialData.agent_id && !isLoadingAgents && agentOptions.length > 0) {
					// If agent not in initial list (e.g. due to pagination/search),
					// this part might need enhancement to fetch the specific agent by ID if crucial for display.
					// For now, ID is set, Autocomplete might not show the name until list is broader.
				}

			} else {
				// Creating new schedule, reset to default
				setFormData(defaultFormState);
				setSelectedAgentForForm(null);
				setAgentSearchQuery(""); // Reset search
			}
		}
	}, [open, initialData, agentOptions, isLoadingAgents]);

	const handleChange = (
		event:
			| React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
			| SelectChangeEvent<ScheduleUnit>,
	) => {
		const { name, value } = event.target;
		let processedValue: string | number | boolean = value;

		// Check if the event target has a 'type' property (like HTMLInputElement)
		if ("type" in event.target) {
			const targetType = (event.target as HTMLInputElement).type;
			if (targetType === "number" && name === "interval") {
				processedValue = value === "" ? "" : Number.parseInt(value, 10); // Allow empty string for temporary input state
			}
		}

		setFormData((prev) => ({
			...prev,
			[name]: processedValue,
		}));
	};

	const handleSwitchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		setFormData((prev) => ({
			...prev,
			[event.target.name]: event.target.checked,
		}));
	};

	const handleDateTimeChange = (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const { name, value } = event.target;
		setFormData((prev) => ({
			...prev,
			[name]: value ? new Date(value).toISOString() : null,
		}));
	};

	const handleSubmit = async () => {
		setIsSubmitting(true);
		try {
			if (!isEditMode && !formData.selectedAgentId) {
				// This should ideally be caught by form validation (e.g. making Autocomplete required)
				console.error("Agent ID is required to create a schedule.");
				setIsSubmitting(false);
				return;
			}

			const scheduleData: ScheduleCreateRequest | ScheduleUpdateRequest = {
				prompt: formData.prompt,
				interval: Number(formData.interval),
				unit: formData.unit,
				is_active: formData.is_active,
				one_time: formData.one_time,
				start_time_utc: formData.start_time_utc || null,
				end_time_utc: formData.end_time_utc || null,
			};
			
			// Clean up empty optional fields that should be null
			if (scheduleData.start_time_utc === "") scheduleData.start_time_utc = null;
			if (scheduleData.end_time_utc === "") scheduleData.end_time_utc = null;

			// For new schedules, agentId comes from formData.selectedAgentId
			// For edits, agentId is inherent to initialData and not changed here.
			const agentForSubmit = isEditMode ? initialData.agent_id : formData.selectedAgentId;

			if (!agentForSubmit) {
				// Should not happen if validation and button disabled state are correct
				console.error("Agent ID is missing for submission.");
				setIsSubmitting(false);
				return;
			}

			await onSubmit(scheduleData, agentForSubmit);
			onClose();
		} catch (error) {
			console.error("Failed to submit schedule:", error);
			// Consider showing an error toast to the user
		} finally {
			setIsSubmitting(false);
		}
	};
	
	const dialogTitle = isEditMode ? "Edit Schedule" : "Create New Schedule";

	const dialogActions = (
		<>
			<SecondaryButton onClick={onClose} disabled={isSubmitting} startIcon={<XSquare size={18} />}>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={handleSubmit}
				disabled={
					isSubmitting ||
					!formData.prompt ||
					(formData.interval != null && formData.interval < 1) ||
					(!isEditMode && !formData.selectedAgentId) // Disable if creating and no agent selected
				}
				startIcon={isSubmitting ? <CircularProgress size={18} color="inherit" /> : <Save size={18} />}
			>
				{isSubmitting ? "Saving..." : isEditMode ? "Save Changes" : "Create Schedule"}
			</PrimaryButton>
		</>
	);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm" // Consider "md" if agent selection makes it crowded
			fullWidth
		>
			<StyledFormGrid container spacing={2}>
				{!isEditMode && (
					<Grid item xs={12}>
						<Autocomplete
							id="agent-select-for-schedule"
							options={agentOptions}
							value={selectedAgentForForm}
							getOptionLabel={(option) => option.name || `Agent ID: ${option.id.substring(0,8)}...`}
							isOptionEqualToValue={(option, value) => option.id === value.id}
							onChange={(_event, newValue) => {
								setSelectedAgentForForm(newValue);
								setFormData((prev) => ({ ...prev, selectedAgentId: newValue ? newValue.id : null }));
							}}
							onInputChange={(_event, newInputValue) => {
								// Debounced search
								const timer = setTimeout(() => {
									setAgentSearchQuery(newInputValue);
								}, 300);
								return () => clearTimeout(timer);
							}}
							loading={isLoadingAgents}
							disabled={isSubmitting || isEditMode} // Disable if editing (agent is fixed)
							renderInput={(params) => (
								<TextField
									{...params}
									label="Select Agent"
									variant="outlined"
									required={!isEditMode} // Required only for new schedules
									error={isAgentsError}
									helperText={isAgentsError ? "Failed to load agents" : (!isEditMode && !formData.selectedAgentId ? "Agent selection is required." : "")}
									InputProps={{
										...params.InputProps,
										endAdornment: (
											<>
												{isLoadingAgents ? <CircularProgress color="inherit" size={20} /> : null}
												{params.InputProps.endAdornment}
											</>
										),
									}}
								/>
							)}
							renderOption={(props, option) => (
								<Box component="li" {...props} key={option.id}>
									{option.name || "Unnamed Agent"} ({option.id.substring(0, 8)})
								</Box>
							)}
						/>
						{isAgentsError && <FormHelperText error>Error loading agents. Try searching or check connection.</FormHelperText>}
					</Grid>
				)}
				 {isEditMode && initialData && (
					 <Grid item xs={12}>
						 <Typography variant="body2" color="text.secondary">
							 Editing schedule for Agent: {initialData.agent_id.substring(0,8)}... (Agent cannot be changed)
						 </Typography>
					 </Grid>
				 )}
				<Grid item xs={12}>
					<Tooltip
						title={
							<>
								<Typography variant="caption" display="block" gutterBottom>
									This is the message that will be sent to the agent on the schedule.
								</Typography>
								<Typography variant="caption" display="block">
									Example: "Send me an email with a detailed world news breakdown with key events"
								</Typography>
							</>
						}
						placement="top-start"
						arrow
					>
						<FullWidthTextField
							label="Prompt"
							name="prompt"
							value={formData.prompt}
							onChange={handleChange}
							required
							multiline
							rows={3}
							disabled={isSubmitting}
							placeholder="e.g., Send me an email with a detailed world news breakdown..."
						/>
					</Tooltip>
				</Grid>
				{/* Name and Description fields removed */}
				<Grid item xs={6}>
					<FullWidthTextField
						label="Interval"
						name="interval"
						type="number"
						value={formData.interval || 1}
						onChange={handleChange}
						required
						disabled={isSubmitting}
						InputProps={{ inputProps: { min: 1 } }}
					/>
				</Grid>
				<Grid item xs={6}>
					<FullWidthFormControl required disabled={isSubmitting}>
						<InputLabel id="unit-select-label">Unit</InputLabel>
						<Select
							labelId="unit-select-label"
							name="unit"
							value={formData.unit || "hours"}
							label="Unit"
							onChange={handleChange}
						>
							<MenuItem value="minutes">Minutes</MenuItem>
							<MenuItem value="hours">Hours</MenuItem>
							<MenuItem value="days">Days</MenuItem>
						</Select>
					</FullWidthFormControl>
				</Grid>
				<Grid item xs={12} sm={6}>
					<FullWidthTextField
						label="Start Time (UTC, Optional)"
						name="start_time_utc"
						type="datetime-local"
						value={
							formData.start_time_utc
								? formData.start_time_utc.slice(0, 16)
								: ""
						}
						onChange={handleDateTimeChange}
						InputLabelProps={{ shrink: true }}
						disabled={isSubmitting}
					/>
					<FormHelperText>If not set, starts immediately or on next interval.</FormHelperText>
				</Grid>
				<Grid item xs={12} sm={6}>
					<FullWidthTextField
						label="End Time (UTC, Optional)"
						name="end_time_utc"
						type="datetime-local"
						value={
							formData.end_time_utc ? formData.end_time_utc.slice(0, 16) : ""
						}
						onChange={handleDateTimeChange}
						InputLabelProps={{ shrink: true }}
						disabled={isSubmitting}
					/>
					<FormHelperText>If not set, schedule runs indefinitely.</FormHelperText>
				</Grid>
				<Grid item xs={6}>
					<FormControlLabel
						control={
							<Switch
								checked={formData.is_active || false}
								onChange={handleSwitchChange}
								name="is_active"
								disabled={isSubmitting}
							/>
						}
						label="Active"
					/>
				</Grid>
				<Grid item xs={6}>
					<FormControlLabel
						control={
							<Switch
								checked={formData.one_time || false}
								onChange={handleSwitchChange}
								name="one_time"
								disabled={isSubmitting}
							/>
						}
						label="One-time"
					/>
				</Grid>
			</StyledFormGrid>
		</BaseDialog>
	);
};
