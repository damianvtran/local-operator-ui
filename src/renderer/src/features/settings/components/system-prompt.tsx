import { faRobot, faSave } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	TextField,
	Typography,
	styled,
	useTheme, // Import useTheme
} from "@mui/material";
import type { SystemPromptUpdate } from "@shared/api/local-operator/types";
import { useSystemPrompt } from "@shared/hooks/use-system-prompt";
import { useUpdateSystemPrompt } from "@shared/hooks/use-update-system-prompt";
import { useEffect, useState } from "react";
import type { FC } from "react";
import { SettingsSectionCard } from "./settings-section-card"; // Import the reusable card

// Shadcn-inspired TextField styling
const StyledTextField = styled(TextField)(({ theme }) => ({
	width: "100%",
	"& .MuiInputBase-root": {
		// Base styles for the input area
		borderRadius: theme.shape.borderRadius * 0.75, // Slightly less rounded
		backgroundColor: theme.palette.background.paper, // Match card background
		minHeight: 200, // Adjust min height as needed
		display: "flex", // Ensure flex properties work
		flexDirection: "column", // Stack elements vertically
		alignItems: "stretch", // Stretch items to fill width
	},
	"& .MuiOutlinedInput-root": {
		// Specific styles for outlined variant
		padding: 0, // Remove default padding
		"& .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.divider, // Use divider color for border
		},
		"&:hover .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.text.secondary, // Slightly darker border on hover
		},
		"&.Mui-focused .MuiOutlinedInput-notchedOutline": {
			borderColor: theme.palette.primary.main, // Primary color border when focused
			borderWidth: "1px", // Ensure border width stays consistent
		},
	},
	"& .MuiInputBase-inputMultiline": {
		// Styles for the actual multiline input element
		padding: theme.spacing(1.5, 2), // Add internal padding
		flexGrow: 1, // Allow input to grow
		height: "auto", // Let height be determined by content and rows
		overflow: "auto", // Enable scrolling
		fontSize: "0.875rem", // Consistent font size
		lineHeight: 1.5,
		whiteSpace: "pre-wrap", // Ensure text wraps within the input
		wordBreak: "break-word", // Break long words to prevent overflow
		// Shadcn-like scrollbar
		"&::-webkit-scrollbar": {
			width: "8px",
			height: "8px",
		},
		"&::-webkit-scrollbar-track": {
			backgroundColor: "transparent",
		},
		"&::-webkit-scrollbar-thumb": {
			backgroundColor: theme.palette.divider,
			borderRadius: "4px",
			border: `2px solid ${theme.palette.background.paper}`, // Match input background
			"&:hover": {
				backgroundColor: theme.palette.text.disabled,
			},
		},
	},
	"& .MuiInputLabel-root": {
		// Style label if needed
		fontSize: "0.875rem",
		"&.Mui-focused": {
			color: theme.palette.primary.main,
		},
	},
}));

// Container for action buttons
const ButtonContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	gap: theme.spacing(1.5), // Consistent spacing (12px)
	marginTop: theme.spacing(2), // Space above buttons (16px)
}));

// Styling for the last modified text
const LastModifiedText = styled(Typography)(({ theme }) => ({
	marginTop: theme.spacing(2), // Space above text (16px)
	display: "block",
	fontSize: "0.75rem", // Smaller font size (12px)
}));

// Loading container centered within the card
const LoadingContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	minHeight: 200, // Match TextField min height
});

/**
 * Displays and allows editing of the system prompt using shadcn-inspired styling.
 */
export const SystemPrompt: FC = () => {
	const theme = useTheme(); // Get theme for button styling
	const {
		data: systemPromptData,
		isLoading,
		error,
		refetch,
	} = useSystemPrompt();
	const updateSystemPromptMutation = useUpdateSystemPrompt();
	const [systemPrompt, setSystemPrompt] = useState("");
	const [isEdited, setIsEdited] = useState(false);

	// Initialize the system prompt when data is loaded or reset
	useEffect(() => {
		setSystemPrompt(systemPromptData?.content ?? "");
		setIsEdited(false); // Reset edited state when data changes
	}, [systemPromptData]);

	// Handle input change
	const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const newValue = e.target.value;
		setSystemPrompt(newValue);
		// Check if edited compared to original data or empty string if no data
		setIsEdited(newValue !== (systemPromptData?.content ?? ""));
	};

	// Handle save
	const handleSave = async () => {
		if (!isEdited || updateSystemPromptMutation.isPending) return;

		try {
			const update: SystemPromptUpdate = {
				content: systemPrompt,
			};
			await updateSystemPromptMutation.mutateAsync(update);
			await refetch(); // Refetch after successful save
			setIsEdited(false); // Reset edited state
		} catch (err) {
			console.error("Error updating system prompt:", err);
			// Consider adding user feedback (e.g., toast notification)
		}
	};

	// Handle reset to original value
	const handleReset = () => {
		setSystemPrompt(systemPromptData?.content ?? "");
		setIsEdited(false);
	};

	const isSaving = updateSystemPromptMutation.isPending;

	// Common content rendering logic
	const renderContent = () => (
		<>
			<StyledTextField
				label="System Prompt"
				name="systemPrompt"
				value={systemPrompt}
				onChange={handleInputChange}
				variant="outlined"
				multiline
				minRows={8} // Use minRows for flexibility
				fullWidth
				placeholder="Enter instructions for how all agents should behave and respond to your requests..."
				InputLabelProps={{ shrink: true }} // Keep label floated
			/>

			<ButtonContainer>
				<Button
					variant="contained" // Primary action button
					color="primary"
					size="small"
					startIcon={
						isSaving ? (
							<CircularProgress size={16} color="inherit" />
						) : (
							<FontAwesomeIcon icon={faSave} size="sm" />
						)
					}
					onClick={handleSave}
					disabled={!isEdited || isSaving}
					sx={{
						// Shadcn primary button style
						textTransform: "none",
						fontSize: "0.8125rem", // ~13px
						padding: theme.spacing(0.75, 2),
						borderRadius: theme.shape.borderRadius * 0.75,
						boxShadow: "none",
						"&:hover": {
							boxShadow: "none",
							opacity: 0.9,
						},
					}}
				>
					{isSaving ? "Saving..." : "Save Changes"}
				</Button>

				<Button
					variant="outlined" // Secondary action button
					size="small"
					onClick={handleReset}
					disabled={!isEdited || isSaving}
					sx={{
						// Shadcn secondary/outline button style
						borderColor: theme.palette.divider,
						color: theme.palette.text.secondary,
						textTransform: "none",
						fontSize: "0.8125rem", // ~13px
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
			</ButtonContainer>

			{systemPromptData?.last_modified && (
				<LastModifiedText variant="caption" color="text.secondary">
					Last modified:{" "}
					{new Date(systemPromptData.last_modified).toLocaleString()}
				</LastModifiedText>
			)}
		</>
	);

	return (
		<SettingsSectionCard
			title="System Prompt"
			icon={faRobot}
			description="This system prompt is given to all Local Operator agents. It is useful to define baseline expectations for the behavior of every agent in your environment. These instructions are provided in addition to any specific instructions defined for each agent."
		>
			{isLoading ? (
				<LoadingContainer>
					<CircularProgress />
				</LoadingContainer>
			) : error ? (
				<Alert severity="error" sx={{ width: "100%" }}>
					Failed to load system prompt:{" "}
					{error instanceof Error ? error.message : "Unknown error"}
				</Alert>
			) : (
				renderContent() // Render the main content (TextField, Buttons, etc.)
			)}
		</SettingsSectionCard>
	);
};
