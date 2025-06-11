import {
	faCode,
	faFile,
	faFolder,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Autocomplete,
	Box,
	Button,
	CircularProgress,
	FormControl,
	MenuItem,
	TextField,
	Typography,
	styled,
	useTheme,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { useAgents } from "@shared/hooks/use-agents";
import { BaseDialog } from "@shared/components/common/base-dialog";
import { useEffect, useMemo, useState } from "react";
import type { FC } from "react";
import { ConfirmationModal } from "@shared/components/common/confirmation-modal";
import { DirectoryIndicator } from "../directory-indicator";

/**
 * Shadcn-inspired menu props for Select dropdown
 */
const menuPropsSx = (theme: Theme) => ({
	PaperProps: {
		sx: {
			borderRadius: theme.shape.borderRadius * 0.75,
			boxShadow: theme.shadows[2],
			mt: 0.5,
			maxHeight: 300, // Set a max height for the dropdown
			"& .MuiMenuItem-root": {
				fontSize: "0.8125rem", // Smaller font size
				minHeight: "32px", // More compact items
				padding: theme.spacing(0.5, 2),
			},
			"& .MuiListSubheader-root": {
				fontSize: "0.75rem",
				lineHeight: "2.5",
			},
			"&::-webkit-scrollbar": {
				width: "8px",
			},
			"&::-webkit-scrollbar-thumb": {
				backgroundColor:
					theme.palette.mode === "dark"
						? "rgba(255, 255, 255, 0.1)"
						: "rgba(0, 0, 0, 0.2)",
				borderRadius: "4px",
			},
		},
	},
});

/**
 * TextField input styles for custom key and credential value fields
 */
const textFieldInputSx = (theme: Theme) => ({
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius * 0.75,
		backgroundColor: theme.palette.background.paper,
		border: `1px solid ${theme.palette.divider}`,
		minHeight: "40px",
		height: "40px",
		transition: "border-color 0.2s ease, box-shadow 0.2s ease",
		"&:hover": {
			borderColor: theme.palette.text.secondary,
		},
		"&.Mui-focused": {
			borderColor: theme.palette.primary.main,
			boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
		},
		"& .MuiOutlinedInput-notchedOutline": {
			border: "none",
		},
	},
	"& .MuiInputBase-input": {
		padding: theme.spacing(1, 1.5),
		fontSize: "0.875rem",
		height: "calc(40px - 16px)",
		boxSizing: "border-box",
	},
	"& .MuiInputBase-input::placeholder": {
		color: theme.palette.text.disabled,
		opacity: 1,
	},
	"& .MuiFormHelperText-root": {
		fontSize: "0.75rem",
		mt: 0.5,
		ml: 0.5,
	},
});

/**
 * Styled label and icon (matches EditableField/GeneralSettings)
 */
const FieldLabel = styled("div")(({ theme }) => ({
	fontFamily: theme.typography.fontFamily,
	fontSize: "0.875rem",
	fontWeight: 500,
	color: theme.palette.text.secondary,
	marginBottom: 6,
	display: "flex",
	alignItems: "center",
}));

const LabelIcon = styled(Box)({
	marginRight: 8,
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
});

const fileTypeOptions = [
	// General
	{ value: "md", text: "Markdown (.md)", group: "General" },
	{ value: "txt", text: "Plain Text (.txt)", group: "General" },
	// Web Development
	{ value: "html", text: "HTML (.html)", group: "Web Development" },
	{ value: "css", text: "CSS (.css)", group: "Web Development" },
	{ value: "js", text: "JavaScript (.js)", group: "Web Development" },
	{ value: "jsx", text: "JSX (.jsx)", group: "Web Development" },
	{ value: "ts", text: "TypeScript (.ts)", group: "Web Development" },
	{ value: "tsx", text: "TSX (.tsx)", group: "Web Development" },
	// Backend & Scripting
	{ value: "py", text: "Python (.py)", group: "Backend & Scripting" },
	{ value: "go", text: "Go (.go)", group: "Backend & Scripting" },
	{ value: "java", text: "Java (.java)", group: "Backend & Scripting" },
	{ value: "cs", text: "C# (.cs)", group: "Backend & Scripting" },
	{ value: "php", text: "PHP (.php)", group: "Backend & Scripting" },
	{ value: "rb", text: "Ruby (.rb)", group: "Backend & Scripting" },
	{ value: "rs", text: "Rust (.rs)", group: "Backend & Scripting" },
	{ value: "sh", text: "Shell Script (.sh)", group: "Backend & Scripting" },
	// Configuration
	{ value: "json", text: "JSON (.json)", group: "Configuration" },
	{ value: "yaml", text: "YAML (.yaml)", group: "Configuration" },
	{ value: "yml", text: "YAML (.yml)", group: "Configuration" },
	{ value: "xml", text: "XML (.xml)", group: "Configuration" },
	{ value: "toml", text: "TOML (.toml)", group: "Configuration" },
	{ value: "ini", text: "INI (.ini)", group: "Configuration" },
	{ value: "env", text: ".env", group: "Configuration" },
	{ value: "dockerfile", text: "Dockerfile", group: "Configuration" },
	// Other Languages
	{ value: "c", text: "C (.c)", group: "Other Languages" },
	{ value: "cpp", text: "C++ (.cpp)", group: "Other Languages" },
	{ value: "swift", text: "Swift (.swift)", group: "Other Languages" },
	{ value: "kt", text: "Kotlin (.kt)", group: "Other Languages" },
	{ value: "scala", text: "Scala (.scala)", group: "Other Languages" },
];

export type CreateFileDialogProps = {
	open: boolean;
	onClose: () => void;
	onSave: (
		details: { name: string; type: string; location: string },
		overwrite?: boolean,
	) => void;
	isSaving: boolean;
	agentId: string;
};

export const CreateFileDialog: FC<CreateFileDialogProps> = ({
	open,
	onClose,
	onSave,
	isSaving,
	agentId,
}) => {
	const theme = useTheme();
	const [fileName, setFileName] = useState("");
	const [fileType, setFileType] = useState("md");
	const [isConfirmingOverwrite, setConfirmingOverwrite] = useState(false);

	// Reset state when the dialog opens to ensure a fresh form
	useEffect(() => {
		if (open) {
			setFileName("");
			setFileType("md");
		}
	}, [open]);

	const { data: agentListResult } = useAgents();
	const agent = useMemo(
		() => agentListResult?.agents.find((a) => a.id === agentId),
		[agentListResult, agentId],
	);
	const currentWorkingDirectory = agent?.current_working_directory ?? "~";

	const canSave = fileName.trim() !== "" && !isSaving;

	const handleSave = async (overwrite = false) => {
		if (!canSave) return;

		const filePath = `${currentWorkingDirectory}/${fileName}.${fileType}`;
		const exists = await window.api.fileExists(filePath);

		if (exists && !overwrite) {
			setConfirmingOverwrite(true);
			return;
		}

		onSave(
			{
				name: fileName,
				type: fileType,
				location: currentWorkingDirectory,
			},
			overwrite,
		);
	};

	const dialogActions = (
		<>
			<Button
				onClick={onClose}
				variant="outlined" // Secondary action
				size="small"
				sx={{
					borderColor: theme.palette.divider,
					color: theme.palette.text.secondary,
					textTransform: "none",
					fontSize: "0.8125rem",
					padding: theme.spacing(0.75, 2),
					borderRadius: theme.shape.borderRadius * 0.75,
					"&:hover": {
						backgroundColor: theme.palette.action.hover,
						borderColor: theme.palette.divider,
					},
				}}
			>
				Cancel
			</Button>
			<Button
				onClick={() => handleSave()}
				variant="contained" // Primary action
				color="primary"
				size="small"
				disabled={!canSave}
				startIcon={
					isSaving ? <CircularProgress size={16} color="inherit" /> : null
				}
				sx={{
					textTransform: "none",
					fontSize: "0.8125rem",
					padding: theme.spacing(0.75, 2),
					borderRadius: theme.shape.borderRadius * 0.75,
					boxShadow: "none",
					"&:hover": {
						boxShadow: "none",
						opacity: 0.9,
					},
				}}
			>
				{isSaving ? "Creating..." : "Create File"}
			</Button>
		</>
	);

	return (
		<>
			<BaseDialog
				open={open && !isConfirmingOverwrite}
				onClose={onClose}
				title="Create New File"
				actions={dialogActions}
				maxWidth="sm"
				fullWidth
			>
				<Box sx={{ pt: 2 }}>
					<FormControl fullWidth sx={{ mb: 2.5 }}>
						<FieldLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faFile} size="sm" />
						</LabelIcon>
						File Name
					</FieldLabel>
					<TextField
						fullWidth
						value={fileName}
						onChange={(e) => setFileName(e.target.value)}
						required
						autoFocus
						placeholder="Enter file name (e.g., my-new-script)"
						sx={textFieldInputSx(theme)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && canSave) {
								handleSave();
							}
						}}
					/>
				</FormControl>

				<FormControl fullWidth sx={{ mb: 2.5 }}>
					<FieldLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faCode} size="sm" />
						</LabelIcon>
						File Type
					</FieldLabel>
					<Autocomplete
						freeSolo
						value={fileType}
						onChange={(_, newValue) => {
							if (typeof newValue === "string") {
								setFileType(newValue);
							} else if (newValue) {
								setFileType(newValue.value);
							}
						}}
						options={fileTypeOptions}
						groupBy={(option) => option.group}
						getOptionLabel={(option) => {
							if (typeof option === "string") {
								const foundOption = fileTypeOptions.find(
									(o) => o.value === option,
								);
								return foundOption ? foundOption.text : option;
							}
							return option.text;
						}}
						// @ts-ignore - MUI's types for freeSolo Autocomplete are tricky.
						// This works at runtime.
						isOptionEqualToValue={(option, value) => option.value === value}
						renderInput={(params) => (
							<TextField
								{...params}
								placeholder="Select or type an extension"
								sx={textFieldInputSx(theme)}
							/>
						)}
						renderOption={(props, option) => (
							<MenuItem {...props} key={option.value}>
								{option.text}
							</MenuItem>
						)}
						slotProps={{
							paper: {
								sx: menuPropsSx(theme).PaperProps.sx,
							},
							listbox: {
								sx: {
									// Unset the maxHeight to prevent the listbox from scrolling internally.
									// The Paper component will handle the scrolling.
									maxHeight: "unset",
								},
							},
						}}
					/>
				</FormControl>

				<FormControl fullWidth>
					<FieldLabel>
						<LabelIcon>
							<FontAwesomeIcon icon={faFolder} size="sm" />
						</LabelIcon>
						Location
					</FieldLabel>
					<DirectoryIndicator
						agentId={agentId}
						currentWorkingDirectory={currentWorkingDirectory}
					/>
						<Typography
							variant="caption"
							color="text.secondary"
							sx={{ mt: 1 }}
						>
							The file will be created in the selected working directory.
						</Typography>
					</FormControl>
				</Box>
			</BaseDialog>
			<ConfirmationModal
				open={isConfirmingOverwrite}
				title="File Already Exists"
				message={`A file named "${fileName}.${fileType}" already exists. Do you want to overwrite it?`}
				confirmText="Overwrite"
				onConfirm={() => {
					setConfirmingOverwrite(false);
					handleSave(true);
				}}
				onCancel={() => setConfirmingOverwrite(false)}
				isDangerous
			/>
		</>
	);
};
