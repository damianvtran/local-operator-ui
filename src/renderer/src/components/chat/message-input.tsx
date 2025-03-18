import {
	faPaperPlane,
	faPaperclip,
	faStop,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Button, IconButton, TextField, Tooltip, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { AttachmentsPreview } from "@renderer/components/chat/attachments-preview";
import { ScrollToBottomButton } from "@renderer/components/chat/scroll-to-bottom-button";
import type { Message } from "@renderer/components/chat/message-item/types";
import { useMessageInput } from "@renderer/hooks/use-message-input";
import { useRef, useState } from "react";
import type { ChangeEvent, FC, FormEvent } from "react";

type MessageInputProps = {
	onSendMessage: (content: string, attachments: string[]) => void;
	isLoading: boolean;
	conversationId?: string;
	messages: Message[];
	currentJobId?: string | null;
	onCancelJob?: (jobId: string) => void;
	isFarFromBottom?: boolean;
	scrollToBottom?: () => void;
};

const FormContainer = styled("form")(({ theme }) => ({
	padding: theme.spacing(3),
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(2),
	borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	backgroundColor: alpha(theme.palette.background.paper, 0.4),
	minHeight: 100,
	position: "relative", // Add position relative for the scroll button
}));

const AttachmentButton = styled(IconButton)(({ theme }) => ({
	backgroundColor: alpha(theme.palette.primary.main, 0.08),
	width: 52,
	height: 52,
	borderRadius: theme.shape.borderRadius * 1.5,
	marginRight: theme.spacing(1),
	transition: "all 0.2s ease-in-out",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.15),
		transform: "translateY(-2px)",
	},
	"&:active": {
		transform: "translateY(0px)",
	},
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
	flex: 1,
	"& .MuiOutlinedInput-root": {
		borderRadius: theme.shape.borderRadius * 1.5,
		backgroundColor: alpha(theme.palette.background.paper, 0.6),
		border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
		transition: "all 0.2s ease-in-out",
		"&.Mui-focused": {
			backgroundColor: alpha(theme.palette.background.paper, 0.8),
			boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.15)}`,
		},
		"&:hover": {
			backgroundColor: alpha(theme.palette.background.paper, 0.7),
		},
		padding: "14px 18px",
		fontSize: "1rem",
		minHeight: 48,
		display: "flex",
		alignItems: "center",
	},
}));

const SendButton = styled(Button)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 1.5,
	minWidth: "auto",
	width: 48,
	height: 48,
	padding: 0,
	marginLeft: theme.spacing(1),
	boxShadow: theme.shadows[2],
	transition: "all 0.2s ease-in-out",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	"&:not(:disabled):hover": {
		transform: "translateY(-2px)",
		boxShadow: theme.shadows[4],
	},
	"&:not(:disabled):active": {
		transform: "translateY(0px)",
	},
	"&.Mui-disabled": {
		backgroundColor: alpha(theme.palette.action.disabled, 0.2),
	},
}));

export const MessageInput: FC<MessageInputProps> = ({
	onSendMessage,
	isLoading,
	conversationId,
	messages,
	currentJobId,
	onCancelJob,
	isFarFromBottom = false,
	scrollToBottom = () => {},
}) => {
	const [attachments, setAttachments] = useState<string[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Use our custom hook for message input handling
	const {
		inputValue: newMessage,
		setInputValue: setNewMessage,
		handleKeyDown,
		handleSubmit: submitMessage,
		textareaRef,
	} = useMessageInput({
		conversationId,
		messages,
		onSubmit: (message) => {
			onSendMessage(message, attachments);
			setAttachments([]);
		},
	});

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!newMessage.trim() && attachments.length === 0) return;
		submitMessage();
	};

	const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			const newAttachments = Array.from(e.target.files).map((file) => {
				// Use the actual file path without file:// protocol
				// @ts-ignore - path is available in Electron but not in standard web File API
				const filePath = file.path;
				if (filePath) {
					// Return the file path directly without file:// protocol
					// This is what the backend expects
					return filePath;
				}
				// Fallback to object URL if path is not available
				return URL.createObjectURL(file);
			});
			setAttachments((prev) => [...prev, ...newAttachments]);

			// Reset the file input so the same file can be selected again
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleRemoveAttachment = (index: number) => {
		setAttachments((prev) => {
			const newAttachments = [...prev];
			// Revoke the object URL to avoid memory leaks if it's a blob URL
			if (newAttachments[index].startsWith("blob:")) {
				URL.revokeObjectURL(newAttachments[index]);
			}
			newAttachments.splice(index, 1);
			return newAttachments;
		});
	};

	const triggerFileInput = () => {
		fileInputRef.current?.click();
	};

	const isInputDisabled = Boolean(isLoading && currentJobId);

	return (
		<>
			<FormContainer onSubmit={handleSubmit}>
				{/* Scroll to bottom button */}
				<ScrollToBottomButton
					visible={isFarFromBottom}
					onClick={scrollToBottom}
				/>
				<input
					type="file"
					ref={fileInputRef}
					onChange={handleFileSelect}
					style={{ display: "none" }}
					accept="image/*,.pdf,.doc,.docx,.txt"
					disabled={isInputDisabled}
					multiple
				/>

				<Tooltip title="Attach file">
					<span>
						<AttachmentButton
							onClick={triggerFileInput}
							color="primary"
							size="medium"
							aria-label="Attach file"
							disabled={isInputDisabled}
						>
							<FontAwesomeIcon icon={faPaperclip} />
						</AttachmentButton>
					</span>
				</Tooltip>

				<StyledTextField
					fullWidth
					placeholder={
						isInputDisabled
							? "⌛ Agent is busy..."
							: "✨ Type to Chat! Press ↵ to send, Shift+↵ for new line 📝"
					}
					value={newMessage}
					onChange={(e) => setNewMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					multiline
					maxRows={4}
					variant="outlined"
					inputRef={textareaRef}
					disabled={isInputDisabled}
				/>

				{isLoading && currentJobId ? (
					<Tooltip title="Stop agent">
						<span>
							<SendButton
								type="button"
								variant="contained"
								color="error"
								onClick={() => onCancelJob?.(currentJobId)}
								aria-label="Stop agent"
							>
								<FontAwesomeIcon icon={faStop} />
							</SendButton>
						</span>
					</Tooltip>
				) : (
					<Tooltip title="Send message">
						<span>
							<SendButton
								type="submit"
								variant="contained"
								color="primary"
								disabled={
									isLoading || (!newMessage.trim() && attachments.length === 0)
								}
								aria-label="Send message"
							>
								<FontAwesomeIcon icon={faPaperPlane} />
							</SendButton>
						</span>
					</Tooltip>
				)}
			</FormContainer>
			{attachments.length > 0 && (
				<AttachmentsPreview
					attachments={attachments}
					onRemoveAttachment={handleRemoveAttachment}
					disabled={isInputDisabled}
				/>
			)}
		</>
	);
};
