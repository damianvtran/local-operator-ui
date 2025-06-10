import {
	Box,
	IconButton,
	Paper,
	TextField,
	Tooltip,
	alpha,
	styled,
} from "@mui/material";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import type { AgentEditFileRequest } from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useConfig } from "@shared/hooks/use-config";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { Paperclip, Send, X } from "lucide-react";
import { type FC, useCallback, useState } from "react";

type InlineEditProps = {
	selection: string;
	position: { top: number; left: number };
	filePath: string;
	onClose: () => void;
	onApplyChanges: (newContent: string) => void;
};

const InputInnerContainer = styled(Paper)(({ theme }) => ({
	position: "absolute",
	zIndex: 1300, // Ensure it's above other elements
	width: 500,
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(1.5),
	outline: "none",
	borderRadius: theme.shape.borderRadius * 2,
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	backgroundImage: "none",
	padding: theme.spacing(1),
	transition: "box-shadow 0.2s ease-in-out, outline 0.2s ease-in-out",
	boxSizing: "border-box",
}));

const CloseButton = styled(IconButton)(({ theme }) => ({
	position: "absolute",
	top: theme.spacing(1),
	right: theme.spacing(1),
	width: 28,
	height: 28,
	zIndex: 1301,
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.1),
		color: theme.palette.text.primary,
	},
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
	flex: 1,
	"& .MuiOutlinedInput-root": {
		backgroundColor: "transparent",
		padding: "4px 6px",
		fontSize: "0.875rem",
		display: "flex",
		alignItems: "center",
		"& fieldset": {
			border: "none",
		},
		"&:hover fieldset": {
			border: "none",
		},
		"&.Mui-focused fieldset": {
			border: "none",
		},
		"&.Mui-focused": {
			backgroundColor: "transparent",
			boxShadow: "none",
		},
		"&:hover": {
			backgroundColor: "transparent",
		},
	},
	"& .MuiInputBase-input": {
		color: theme.palette.text.primary,
		overflowY: "auto",
		scrollbarWidth: "thin",
		scrollbarColor: `${alpha(theme.palette.text.primary, 0.5)} transparent`,
		/* Firefox */
		"&::-webkit-scrollbar": {
			width: "8px",
			height: "8px",
		},
		"&::-webkit-scrollbar-track": {
			background: "transparent",
		},
		"&::-webkit-scrollbar-thumb": {
			backgroundColor: alpha(theme.palette.text.primary, 0.5),
			borderRadius: "4px",
		},
		"&::-webkit-scrollbar-thumb:hover": {
			backgroundColor: alpha(theme.palette.text.primary, 0.7),
		},
	},
	"& .MuiInputBase-input::placeholder": {
		fontSize: "0.875rem",
		color:
			theme.palette.mode === "light"
				? alpha(theme.palette.text.secondary, 0.7)
				: alpha(theme.palette.text.secondary, 0.5),
		opacity: 1,
	},
}));

const ButtonsRow = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: theme.spacing(1),
}));

const AttachmentButton = styled(IconButton)(({ theme }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.1)
			: alpha(theme.palette.primary.main, 0.15),
	color: theme.palette.primary.main,
	width: 28,
	height: 28,
	borderRadius: "100%",
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.primary.main, 0.2)
				: alpha(theme.palette.primary.main, 0.25),
		transform: "scale(1.1)",
	},
	"&:active": {
		transform: "scale(1)",
	},
	"&.Mui-disabled": {
		backgroundColor: alpha(theme.palette.action.disabled, 0.1),
		color: theme.palette.action.disabled,
	},
}));

const SendButton = styled(IconButton)(({ theme }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.1)
			: alpha(theme.palette.primary.main, 0.15),
	color: theme.palette.primary.main,
	width: 28,
	height: 28,
	borderRadius: "100%",
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.primary.main, 0.2)
				: alpha(theme.palette.primary.main, 0.25),
		transform: "scale(1.1)",
	},
	"&:active": {
		transform: "scale(1)",
	},
	"&.Mui-disabled": {
		backgroundColor: alpha(theme.palette.action.disabled, 0.1),
		color: theme.palette.action.disabled,
	},
}));

const AttachmentsPreviewContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexWrap: "wrap",
	gap: theme.spacing(1),
	marginTop: theme.spacing(1),
}));

const AttachmentChip = styled(Box)(({ theme }) => ({
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
	color: theme.palette.primary.main,
	padding: theme.spacing(0.5, 1),
	borderRadius: theme.shape.borderRadius,
	fontSize: "0.8rem",
}));

export const InlineEdit: FC<InlineEditProps> = ({
	selection,
	position,
	filePath,
	onClose,
	onApplyChanges,
}) => {
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<string[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const { lastChatAgentId } = useAgentSelectionStore();
	const { data: config } = useConfig();

	const handleAttachmentClick = async () => {
		// const selectedFiles = await window.api.openFileDialog();
		// if (selectedFiles) {
		// 	setAttachments((prev) => [...prev, ...selectedFiles]);
		// }
		// TODO: Implement file dialog
		showSuccessToast("File attachments are not yet supported in this view.");
	};

	const handleSubmit = useCallback(async () => {
		if (!lastChatAgentId) {
			showSuccessToast("Please select an agent first.");
			return;
		}
		setIsLoading(true);
		try {
			const client = createLocalOperatorClient(apiConfig.baseUrl);
			const request: AgentEditFileRequest = {
				hosting: config?.values.hosting || "default",
				model: config?.values.model_name || "default",
				file_path: filePath,
				edit_prompt: prompt,
				selection,
				attachments,
			};

			const response = await client.chat.editFileWithAgent(
				lastChatAgentId,
				request,
			);

			if (response.result) {
				const originalContent = await window.api.readFile(filePath);
				if (originalContent.success) {
					let newContent = originalContent.data;
					for (const diff of response.result.edit_diffs) {
						newContent = newContent.replace(diff.find, diff.replace);
					}
					onApplyChanges(newContent);
					showSuccessToast("File edited successfully!");
				}
			}
		} catch (error) {
			console.error("Failed to edit file:", error);
			showSuccessToast("Failed to edit file.");
		} finally {
			setIsLoading(false);
			onClose();
		}
	}, [
		config,
		filePath,
		prompt,
		selection,
		attachments,
		lastChatAgentId,
		onApplyChanges,
		onClose,
	]);

	return (
		<InputInnerContainer
			elevation={4}
			sx={{
				top: position.top,
				left: 12,
				transform: "translateY(calc(-100% - 12px))",
			}}
		>
			<CloseButton onClick={onClose} disabled={isLoading}>
				<X size={18} />
			</CloseButton>
			<StyledTextField
				fullWidth
				multiline
				maxRows={8}
				placeholder="Describe your edit..."
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
				disabled={isLoading}
			/>
			{attachments.length > 0 && (
				<AttachmentsPreviewContainer>
					{attachments.map((att) => (
						<AttachmentChip key={att}>
							{att.split("/").pop()}
						</AttachmentChip>
					))}
				</AttachmentsPreviewContainer>
			)}
			<ButtonsRow>
				<Tooltip title="Add attachments">
					<AttachmentButton onClick={handleAttachmentClick} disabled={isLoading}>
						<Paperclip size={18} />
					</AttachmentButton>
				</Tooltip>
				<Tooltip title={isLoading ? "Editing..." : "Edit"}>
					<SendButton
						onClick={handleSubmit}
						disabled={isLoading || !prompt}
					>
						<Send size={18} />
					</SendButton>
				</Tooltip>
			</ButtonsRow>
		</InputInnerContainer>
	);
};
