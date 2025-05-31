import {
	CircularProgress,
	FormControl,
	Grid,
	IconButton,
	MenuItem,
	Select,
	TextField,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { ExecutionVariable } from "@shared/api/local-operator/types";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { showErrorToast } from "@shared/utils/toast-manager";
import { Info, Save, XSquare } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";

// Styled components (similar to ScheduleFormDialog)
const StyledFormGrid = styled(Grid)(({ theme }) => ({
	paddingTop: theme.spacing(1),
}));

const FieldLabel = styled("label")(({ theme }) => ({
	display: "block",
	marginBottom: theme.spacing(0.75),
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
	lineHeight: 1.5,
}));

const FullWidthTextField = styled(TextField)(({ theme }) => ({
	width: "100%",
	"& .MuiOutlinedInput-root": {
		borderRadius: 6,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: theme.palette.background.paper,
		minHeight: "36px",
		// height: "36px", // Allow dynamic height for multiline
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
		"&:not(.MuiInputBase-multiline) .MuiInputBase-input": {
			height: "calc(36px - 16px)",
			padding: "8px 12px",
		},
		"&.MuiInputBase-multiline": {
			minHeight: "36px",
			height: "auto",
			padding: "8px 12px", // Ensure padding for multiline input area
		},
	},
	"& .MuiInputBase-input": {
		fontSize: "0.875rem",
		lineHeight: 1.5,
		boxSizing: "border-box",
		"&.MuiInputBase-inputMultiline": {
			padding: "0px", // Padding is handled by the root's multiline style
			height: "auto",
		},
	},
}));

const FullWidthFormControl = styled(FormControl)(({ theme }) => ({
	width: "100%",
	"& .MuiOutlinedInput-root": {
		borderRadius: 6,
		border: `1px solid ${theme.palette.divider}`,
		backgroundColor: theme.palette.background.paper,
		minHeight: "36px",
		height: "36px",
		padding: "0 !important",
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
	},
	"& .MuiSelect-select": {
		padding: "8px 12px !important",
		fontSize: "0.875rem",
		lineHeight: 1.5,
		height: "calc(36px - 16px) !important",
		boxSizing: "border-box",
		display: "flex",
		alignItems: "center",
	},
}));

const StyledMenuItem = styled(MenuItem)(({ theme }) => ({
	fontSize: "0.875rem",
	paddingTop: theme.spacing(1),
	paddingBottom: theme.spacing(1),
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.08),
	},
	"&.Mui-selected": {
		backgroundColor: alpha(theme.palette.primary.main, 0.12),
		"&:hover": {
			backgroundColor: alpha(theme.palette.primary.main, 0.16),
		},
	},
}));

const VARIABLE_TYPES: ExecutionVariable["type"][] = [
	"string",
	"int",
	"float",
	"bool",
	"dict",
	"list",
];

type VariableFormDialogProps = {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: ExecutionVariable) => Promise<void>;
	initialData?: ExecutionVariable | null;
};

// Represents the form state.
type FormDataType = Omit<ExecutionVariable, "value" | "type"> & {
	value: string; // Store value as string initially for text input
	type: ExecutionVariable["type"];
};

const getDefaultFormState = (
	initialData?: ExecutionVariable | null,
): FormDataType => {
	if (initialData) {
		let valueString: string;
		if (initialData.type === "object" || initialData.type === "array") {
			try {
				valueString = JSON.stringify(initialData.value, null, 2);
			} catch (_) {
				valueString = String(initialData.value); // Fallback
			}
		} else if (initialData.type === "boolean") {
			valueString = String(initialData.value);
		} else {
			valueString = String(initialData.value);
		}
		return {
			key: initialData.key,
			type: initialData.type,
			value: valueString,
		};
	}
	return {
		key: "",
		type: "string",
		value: "",
	};
};

/**
 * VariableFormDialog component
 * A dialog for creating or editing agent execution variables.
 */
export const VariableFormDialog: FC<VariableFormDialogProps> = ({
	open,
	onClose,
	onSubmit,
	initialData,
}) => {
	const [formData, setFormData] = useState<FormDataType>(
		getDefaultFormState(initialData),
	);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const isEditMode = !!initialData;

	useEffect(() => {
		if (open) {
			setFormData(getDefaultFormState(initialData));
		}
	}, [open, initialData]);

	const handleChange = (
		event:
			| React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
			| SelectChangeEvent<ExecutionVariable["type"]>,
	) => {
		const { name, value } = event.target;
		setFormData((prev) => ({
			...prev,
			[name]: value,
		}));
	};

	const handleSubmit = async () => {
		setIsSubmitting(true);
		try {
			const variableToSubmit: ExecutionVariable = {
				key: formData.key,
				type: formData.type,
				value: formData.value,
			};

			await onSubmit(variableToSubmit);
			onClose(); // Success toast is handled by the mutation hooks
		} catch (error) {
			console.error("Failed to submit variable:", error);
			showErrorToast(
				`Failed to save variable: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	const dialogTitle = isEditMode
		? "Edit Execution Variable"
		: "Create Execution Variable";

	const dialogActions = (
		<>
			<SecondaryButton
				onClick={onClose}
				disabled={isSubmitting}
				startIcon={<XSquare size={18} />}
			>
				Cancel
			</SecondaryButton>
			<PrimaryButton
				onClick={handleSubmit}
				disabled={isSubmitting || !formData.key.trim()}
				startIcon={
					isSubmitting ? (
						<CircularProgress size={18} color="inherit" />
					) : (
						<Save size={18} />
					)
				}
			>
				{isSubmitting
					? "Saving..."
					: isEditMode
						? "Save Changes"
						: "Create Variable"}
			</PrimaryButton>
		</>
	);

	const valueFieldLabel = useMemo(() => {
		switch (formData.type) {
			case "object":
				return "Value (JSON Object)";
			case "array":
				return "Value (JSON Array)";
			case "boolean":
				return "Value (true/false)";
			default:
				return "Value";
		}
	}, [formData.type]);

	return (
		<BaseDialog
			open={open}
			onClose={onClose}
			title={dialogTitle}
			actions={dialogActions}
			maxWidth="sm"
			fullWidth
		>
			<StyledFormGrid container spacing={2.5}>
				<Grid item xs={12}>
					<FieldLabel htmlFor="variable-key">
						Name (Key){" "}
						<Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
							*
						</Typography>
						<Tooltip
							title="The unique identifier for the variable (e.g., 'api_key', 'user_preference'). Cannot be changed after creation."
							placement="top-start"
							arrow
						>
							<IconButton size="small" sx={{ color: "info.main", ml: 0.5 }}>
								<Info size={14} />
							</IconButton>
						</Tooltip>
					</FieldLabel>
					<FullWidthTextField
						id="variable-key"
						name="key"
						value={formData.key}
						onChange={handleChange}
						required
						disabled={isSubmitting || isEditMode} // Key is not editable
						placeholder="e.g., my_variable_name"
					/>
				</Grid>

				<Grid item xs={12}>
					<FieldLabel htmlFor="variable-type-select">
						Type{" "}
						<Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
							*
						</Typography>
					</FieldLabel>
					<FullWidthFormControl
						required
						disabled={isSubmitting}
						id="variable-type-select-formcontrol"
					>
						<Select
							id="variable-type-select"
							name="type"
							value={formData.type}
							onChange={handleChange} // Removed problematic cast
						>
							{VARIABLE_TYPES.map((type) => (
								<StyledMenuItem key={type} value={type}>
									{type.charAt(0).toUpperCase() + type.slice(1)}
								</StyledMenuItem>
							))}
						</Select>
					</FullWidthFormControl>
				</Grid>

				<Grid item xs={12}>
					<FieldLabel htmlFor="variable-value">
						{valueFieldLabel}{" "}
						<Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
							*
						</Typography>
					</FieldLabel>
					<FullWidthTextField
						id="variable-value"
						name="value"
						value={formData.value}
						onChange={handleChange}
						required
						disabled={isSubmitting}
						multiline
						rows={
							formData.type === "object" || formData.type === "array" ? 5 : 2
						}
						placeholder={
							formData.type === "object"
								? `{ "example_key": "example_value" }`
								: formData.type === "array"
									? `[ "item1", "item2" ]`
									: formData.type === "boolean"
										? "true or false"
										: "Enter variable value"
						}
					/>
					{(formData.type === "object" || formData.type === "array") && (
						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ mt: 0.5, display: "block" }}
						>
							Enter a valid JSON structure.
						</Typography>
					)}
				</Grid>
			</StyledFormGrid>
		</BaseDialog>
	);
};
