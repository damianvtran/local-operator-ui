import {
	faCode,
	faFile,
	faFolder,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	CircularProgress,
	FormControl,
	ListSubheader,
	MenuItem,
	OutlinedInput,
	Select,
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
 * Styled OutlinedInput for Select to achieve shadcn/modern look
 */
const StyledOutlinedInput = styled(OutlinedInput)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 0.75,
	backgroundColor: theme.palette.background.paper,
	border: `1px solid ${theme.palette.divider}`,
	minHeight: "40px",
	height: "40px",
	fontSize: "0.875rem",
	paddingRight: 0,
	"& .MuiOutlinedInput-notchedOutline": {
		border: "none",
	},
	"& .MuiSelect-select": {
		display: "flex",
		alignItems: "center",
		gap: theme.spacing(1),
		fontSize: "0.875rem",
		padding: theme.spacing(1, 1.5),
		height: "calc(40px - 16px)",
		boxSizing: "border-box",
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
	"&:hover": {
		borderColor: theme.palette.text.secondary,
	},
	"&.Mui-focused": {
		borderColor: theme.palette.primary.main,
		boxShadow: `0 0 0 2px ${theme.palette.primary.main}33`,
	},
}));

/**
 * Shadcn-inspired menu props for Select dropdown
 */
const menuPropsSx = (theme: Theme) => ({
	PaperProps: {
		sx: {
			borderRadius: theme.shape.borderRadius * 0.75,
			boxShadow: theme.shadows[2],
			mt: 0.5,
			"& .MuiMenuItem-root": {
				fontSize: "0.875rem",
				minHeight: "40px",
				px: 2,
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

const fileTypeGroups = [
	{
		label: "General",
		options: [
			{ value: "md", text: "Markdown (.md)" },
			{ value: "txt", text: "Plain Text (.txt)" },
		],
	},
	{
		label: "Web Development",
		options: [
			{ value: "html", text: "HTML (.html)" },
			{ value: "css", text: "CSS (.css)" },
			{ value: "js", text: "JavaScript (.js)" },
			{ value: "jsx", text: "JSX (.jsx)" },
			{ value: "ts", text: "TypeScript (.ts)" },
			{ value: "tsx", text: "TSX (.tsx)" },
		],
	},
	{
		label: "Backend & Scripting",
		options: [
			{ value: "py", text: "Python (.py)" },
			{ value: "go", text: "Go (.go)" },
			{ value: "java", text: "Java (.java)" },
			{ value: "cs", text: "C# (.cs)" },
			{ value: "php", text: "PHP (.php)" },
			{ value: "rb", text: "Ruby (.rb)" },
			{ value: "rs", text: "Rust (.rs)" },
			{ value: "sh", text: "Shell Script (.sh)" },
		],
	},
	{
		label: "Configuration",
		options: [
			{ value: "json", text: "JSON (.json)" },
			{ value: "yaml", text: "YAML (.yaml)" },
			{ value: "yml", text: "YAML (.yml)" },
			{ value: "xml", text: "XML (.xml)" },
			{ value: "toml", text: "TOML (.toml)" },
			{ value: "ini", text: "INI (.ini)" },
			{ value: "env", text: ".env" },
			{ value: "dockerfile", text: "Dockerfile" },
		],
	},
	{
		label: "Other Languages",
		options: [
			{ value: "c", text: "C (.c)" },
			{ value: "cpp", text: "C++ (.cpp)" },
			{ value: "swift", text: "Swift (.swift)" },
			{ value: "kt", text: "Kotlin (.kt)" },
			{ value: "scala", text: "Scala (.scala)" },
		],
	},
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
					<Select
						value={fileType}
						onChange={(e) => setFileType(e.target.value as string)}
						input={<StyledOutlinedInput notched={false} label={undefined} />}
						MenuProps={menuPropsSx(theme)}
					>
						{fileTypeGroups.flatMap((group) => [
							<ListSubheader key={group.label}>{group.label}</ListSubheader>,
							...group.options.map((option) => (
								<MenuItem key={option.value} value={option.value}>
									{option.text}
								</MenuItem>
							)),
						])}
					</Select>
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
