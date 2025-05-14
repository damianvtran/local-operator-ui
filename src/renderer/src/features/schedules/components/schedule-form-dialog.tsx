import type { FC } from "react";
import {
	TextField,
	Grid,
	FormControl,
	Select,
	MenuItem,
	FormControlLabel,
	Switch,
	CircularProgress,
	Typography,
	Tooltip,
	Autocomplete,
	Box,
	alpha,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type {
	ScheduleCreateRequest,
	ScheduleResponse,
	ScheduleUnit,
	ScheduleUpdateRequest,
	AgentDetails,
} from "@shared/api/local-operator";
import { useEffect, useState, useMemo } from "react";
import { styled } from "@mui/material/styles";
import { Save, XSquare } from "lucide-react";
import { useAgents } from "@shared/hooks/use-agents";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";

// Styled components
const StyledFormGrid = styled(Grid)(({ theme }) => ({
	paddingTop: theme.spacing(1),
}));

// FieldLabel for external labels, similar to other shadcn-styled components
const FieldLabel = styled('label')(({ theme }) => ({
	display: 'block',
	marginBottom: theme.spacing(0.75),
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: '0.875rem',
	lineHeight: 1.5,
}));

// FullWidthTextField remains largely the same, but label prop will not be used.
const FullWidthTextField = styled(TextField)(({ theme }) => ({
	width: '100%',
	'& .MuiOutlinedInput-root': {
		borderRadius: 6,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: theme.palette.background.paper,
		minHeight: '36px',
		height: '36px',
		padding: 0,
		transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
		'&:hover': {
			borderColor: theme.palette.text.secondary,
		},
		'&.Mui-focused': {
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
		},
		'& .MuiOutlinedInput-notchedOutline': {
			border: 'none',
		},
		'&:not(.MuiInputBase-multiline) .MuiInputBase-input': {
			height: 'calc(36px - 16px)',
			padding: '8px 12px',
		},
		'&.MuiInputBase-multiline': {
			minHeight: '36px',
			height: 'auto',
			padding: '8px 12px',
		},
	},
	'& .MuiInputBase-input': {
		fontSize: '0.875rem',
		lineHeight: 1.5,
		boxSizing: 'border-box',
		'&.MuiInputBase-inputMultiline': {
			padding: '0px',
			height: 'auto',
		},
	},
}));

// FullWidthFormControl for Select, label prop will not be used.
const FullWidthFormControl = styled(FormControl)(({ theme }) => ({
	width: '100%',
	'& .MuiOutlinedInput-root': {
		borderRadius: 6,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: theme.palette.background.paper,
		minHeight: '36px',
		height: '36px',
		padding: '0 !important',
		transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
		'&:hover': {
			borderColor: theme.palette.text.secondary,
		},
		'&.Mui-focused': {
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
		},
		'& .MuiOutlinedInput-notchedOutline': {
			border: 'none',
		},
	},
	'& .MuiSelect-select': {
		padding: '8px 12px !important',
		fontSize: '0.875rem',
		lineHeight: 1.5,
		height: 'calc(36px - 16px) !important',
		boxSizing: 'border-box',
		display: 'flex',
		alignItems: 'center',
	},
}));

// Styled Autocomplete (for agent selection)
// No need for AgentAutocompleteProps type alias if styled() handles generics correctly
const StyledAutocomplete = styled(Autocomplete<AgentDetails, false, false, false>)(({ theme }) => ({
  '& .MuiOutlinedInput-root': {
    borderRadius: 6,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor: theme.palette.background.paper,
    minHeight: '36px',
    height: '36px',
    padding: '0 !important',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
    '&:hover': {
      borderColor: theme.palette.text.secondary,
    },
    '&.Mui-focused': {
      borderColor: theme.palette.primary.main,
      boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
    },
    '& .MuiOutlinedInput-notchedOutline': {
      border: 'none',
    },
    '& .MuiInputBase-input': {
      padding: '8px 12px !important',
      fontSize: '0.875rem',
      lineHeight: 1.5,
      height: 'calc(36px - 16px)',
      boxSizing: 'border-box',
    },
  },
  '& .MuiAutocomplete-endAdornment': {
    right: '8px',
    top: '50%',
    transform: 'translateY(-50%)',
  },
  '& .MuiAutocomplete-clearIndicator, & .MuiAutocomplete-popupIndicator': {
    color: theme.palette.text.secondary,
    '&:hover': {
      color: theme.palette.text.primary,
      backgroundColor: alpha(theme.palette.action.active, 0.04),
    }
  },
}));

// Styled FormHelperText using Typography for more control over error class
const StyledFormHelperText = styled(Typography, {
  shouldForwardProp: (prop) => prop !== 'error',
})<{ error?: boolean }>(({ theme, error }) => ({
  fontSize: '0.75rem',
  marginTop: theme.spacing(0.5),
  marginLeft: theme.spacing(0.25),
  color: error ? theme.palette.error.main : theme.palette.text.secondary,
}));


// Styled Switch and FormControlLabel
const StyledSwitch = styled(Switch)(({ theme }) => ({
  width: 42,
  height: 26,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0,
    margin: 2,
    transitionDuration: '300ms',
    '&.Mui-checked': {
      transform: 'translateX(16px)',
      color: '#fff',
      '& + .MuiSwitch-track': {
        backgroundColor: theme.palette.primary.main,
        opacity: 1,
        border: 0,
      },
      '&.Mui-disabled + .MuiSwitch-track': {
        opacity: 0.5,
      },
    },
    '&.Mui-focusVisible .MuiSwitch-thumb': {
      color: theme.palette.primary.main,
      border: '6px solid #fff',
    },
    '&.Mui-disabled .MuiSwitch-thumb': {
      color:
        theme.palette.mode === 'light'
          ? theme.palette.grey[100]
          : theme.palette.grey[600],
    },
    '&.Mui-disabled + .MuiSwitch-track': {
      opacity: theme.palette.mode === 'light' ? 0.7 : 0.3,
    },
  },
  '& .MuiSwitch-thumb': {
    boxSizing: 'border-box',
    width: 22,
    height: 22,
    boxShadow: 'none',
  },
  '& .MuiSwitch-track': {
    borderRadius: 26 / 2,
    backgroundColor: theme.palette.mode === 'light' ? '#E9E9EA' : theme.palette.grey[700],
    opacity: 1,
    transition: theme.transitions.create(['background-color'], {
      duration: 500,
    }),
  },
}));

const StyledFormControlLabel = styled(FormControlLabel)(({ theme }) => ({
  marginLeft: 0,
  marginRight: theme.spacing(1),
  '& .MuiTypography-root': {
    fontSize: '0.875rem',
    color: theme.palette.text.primary,
    paddingLeft: theme.spacing(1),
  },
}));

// Styled MenuItem for Select
const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
	fontSize: '0.875rem',
	paddingTop: theme.spacing(1),
	paddingBottom: theme.spacing(1),
	'&:hover': {
		backgroundColor: alpha(theme.palette.action.hover, 0.08),
	},
	'&.Mui-selected': {
		backgroundColor: alpha(theme.palette.primary.main, 0.12),
		'&:hover': {
			backgroundColor: alpha(theme.palette.primary.main, 0.16),
		}
	},
}));

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
					(!isEditMode && !formData.selectedAgentId)
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
			maxWidth="sm"
			fullWidth
		>
			<StyledFormGrid container spacing={2}>
				{!isEditMode && (
					<Grid item xs={12}>
						<FieldLabel htmlFor="agent-select-for-schedule">Select Agent {isEditMode ? "" : <Typography component="span" color="error.main" sx={{ml: 0.5}}>*</Typography>}</FieldLabel>
						<StyledAutocomplete
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
									const timer = setTimeout(() => {
										setAgentSearchQuery(newInputValue);
									}, 300);
									return () => clearTimeout(timer);
								}}
								loading={isLoadingAgents}
								disabled={isSubmitting || isEditMode}
								renderInput={(params) => (
									<TextField
										{...params}
										placeholder="Search or select an agent..."
										error={isAgentsError || (!isEditMode && !formData.selectedAgentId && isSubmitting)}
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
								renderOption={(props, option: AgentDetails) => (
									<Box component="li" {...props} key={option.id} sx={(theme) => ({
										display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
										'&:hover': { backgroundColor: alpha(theme.palette.action.hover, 0.08)},
										'&[aria-selected="true"]': { backgroundColor: alpha(theme.palette.primary.main, 0.12)},
									})}>
										<Typography variant="body2" component="span" sx={{ fontWeight: 500 }}>{option.name || "Unnamed Agent"}</Typography>
										<Typography variant="caption" color="text.secondary">ID: {option.id.substring(0, 8)}...</Typography>
									</Box>
								)}
							/>
							{(isAgentsError || (!isEditMode && !formData.selectedAgentId && isSubmitting)) && (
								<StyledFormHelperText error={!!isAgentsError || (!isEditMode && !formData.selectedAgentId && !!isSubmitting)}>
									{isAgentsError ? "Failed to load agents." : "Agent selection is required."}
								</StyledFormHelperText>
							)}
					</Grid>
				)}
				 {isEditMode && initialData && (
					 <Grid item xs={12}>
						 <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
							 Editing schedule for Agent: <Typography component="span" sx={{ fontWeight: 500 }}>{selectedAgentForForm?.name || `${initialData.agent_id.substring(0,8)}...`}</Typography> (Agent cannot be changed)
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
							<div>
								<FieldLabel htmlFor="prompt">Prompt <Typography component="span" color="error.main" sx={{ml: 0.5}}>*</Typography></FieldLabel>
								<FullWidthTextField
									id="prompt"
									name="prompt"
									value={formData.prompt}
									onChange={handleChange}
									required
									multiline
									rows={3}
									disabled={isSubmitting}
									placeholder="e.g., Send me an email with a detailed world news breakdown..."
								/>
							</div>
						</Tooltip>
				</Grid>
				<Grid item xs={6}>
					<FieldLabel htmlFor="interval">Interval <Typography component="span" color="error.main" sx={{ml: 0.5}}>*</Typography></FieldLabel>
					<FullWidthTextField
						id="interval"
						name="interval"
						type="number"
						value={formData.interval === null ? "" : formData.interval}
						onChange={handleChange}
						required
						disabled={isSubmitting}
						InputProps={{ inputProps: { min: 1 } }}
						placeholder="e.g., 1"
					/>
				</Grid>
				<Grid item xs={6}>
					<FieldLabel htmlFor="unit-select">Unit <Typography component="span" color="error.main" sx={{ml: 0.5}}>*</Typography></FieldLabel>
					<FullWidthFormControl required disabled={isSubmitting} id="unit-select-formcontrol">
						<Select
							id="unit-select"
							name="unit"
							value={formData.unit || "hours"}
							onChange={handleChange}
							displayEmpty
						>
							<StyledMenuItem value="minutes">Minutes</StyledMenuItem>
							<StyledMenuItem value="hours">Hours</StyledMenuItem>
							<StyledMenuItem value="days">Days</StyledMenuItem>
						</Select>
					</FullWidthFormControl>
				</Grid>
				<Grid item xs={12} sm={6}>
					<FieldLabel htmlFor="start_time_utc">Start Time (UTC, Optional)</FieldLabel>
					<FullWidthTextField
						id="start_time_utc"
						name="start_time_utc"
						type="datetime-local"
						value={
							formData.start_time_utc
								? formData.start_time_utc.slice(0, 16)
								: ""
						}
						onChange={handleDateTimeChange}
						disabled={isSubmitting}
					/>
					<StyledFormHelperText>If not set, starts immediately or on next interval.</StyledFormHelperText>
				</Grid>
				<Grid item xs={12} sm={6}>
					<FieldLabel htmlFor="end_time_utc">End Time (UTC, Optional)</FieldLabel>
					<FullWidthTextField
						id="end_time_utc"
						name="end_time_utc"
						type="datetime-local"
						value={
							formData.end_time_utc ? formData.end_time_utc.slice(0, 16) : ""
						}
						onChange={handleDateTimeChange}
						disabled={isSubmitting}
					/>
					<StyledFormHelperText>If not set, schedule runs indefinitely.</StyledFormHelperText>
				</Grid>
				<Grid item xs={6} sx={{ display: 'flex', alignItems: 'center', mt:1 }}>
					<StyledFormControlLabel
						control={
							<StyledSwitch
								checked={formData.is_active || false}
								onChange={handleSwitchChange}
								name="is_active"
								disabled={isSubmitting}
							/>
						}
						label="Active"
					/>
				</Grid>
				<Grid item xs={6} sx={{ display: 'flex', alignItems: 'center', mt:1 }}>
					<StyledFormControlLabel
						control={
							<StyledSwitch
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
