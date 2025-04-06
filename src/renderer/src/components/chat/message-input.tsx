import {
	faPaperPlane,
	faPaperclip,
	faStop,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	IconButton,
	TextField,
	Tooltip,
	Typography,
	alpha,
	darken,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { AttachmentsPreview } from "@renderer/components/chat/attachments-preview";
import { ScrollToBottomButton } from "@renderer/components/chat/scroll-to-bottom-button";
import type { Message } from "@renderer/components/chat/types";
import { useMessageInput } from "@renderer/hooks/use-message-input";
import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, FC, FormEvent } from "react";

/**
 * Props for the MessageInput component
 */
type MessageInputProps = {
	onSendMessage: (content: string, attachments: string[]) => void;
	isLoading: boolean;
	conversationId?: string;
	messages: Message[];
	currentJobId?: string | null;
	onCancelJob?: (jobId: string) => void;
	isFarFromBottom?: boolean;
	scrollToBottom?: () => void;
	initialSuggestions?: string[];
};

/**
 * Outer container that wraps the entire input area
 */
const InputOuterContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	flexGrow: 1,
	flexShrink: 0,
	minHeight: 0,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(1),
	paddingBottom: theme.spacing(2),
	backgroundColor: theme.palette.messagesView.background,
}));

/**
 * Constrains the input area to the same max width as messages
 * and centers it horizontally
 *
 * When the text input inside is focused, increase border thickness and style
 * without changing the container size by using outline instead of border change
 */
const InputInnerContainer = styled(Box)(({ theme }) => ({
	width: "900px",
	maxWidth: "900px",
	margin: "0 auto",
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(1.5),
	outline: "none",
	borderRadius: theme.shape.borderRadius * 4,
	border: `1px solid ${alpha(theme.palette.divider, theme.palette.mode === "light" ? 0.3 : 0.1)}`,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.background.paper, 0.9)
			: alpha(theme.palette.background.paper, 0.6),
	padding: theme.spacing(2),
	transition: "box-shadow 0.2s ease-in-out, outline 0.2s ease-in-out",
	boxSizing: "border-box",
	[theme.breakpoints.down("sm")]: {
		maxWidth: "100%",
		width: "100%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "90%",
		width: "90%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "900px",
		width: "900px",
	},
	// When the input inside is focused, add an outline instead of increasing border thickness
	"&:has(.MuiOutlinedInput-root.Mui-focused)": {
		outline: `2px solid ${theme.palette.primary.main}`,
		outlineOffset: "0px",
		boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.2)}`,
	},
}));

const SuggestionsContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	maxWidth: "900px",
	margin: "0 auto",
	marginTop: theme.spacing(4),
	[theme.breakpoints.down("sm")]: {
		maxWidth: "100%",
		width: "100%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "90%",
		width: "90%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "900px",
		width: "900px",
	},
}));

/**
 * Styled suggestion chip button
 */
const SuggestionChip = styled(Button)(({ theme }) => ({
	borderRadius: 999,
	textTransform: "none",
	fontSize: "0.85rem",
	paddingLeft: theme.spacing(1.5),
	paddingRight: theme.spacing(1.5),
	paddingTop: theme.spacing(0.5),
	paddingBottom: theme.spacing(0.5),
	whiteSpace: "nowrap",
	variant: "outlined",
	size: "small",
	...(theme.palette.mode === "light" && {
		backgroundColor: alpha(theme.palette.primary.main, 0.15),
		color: darken(theme.palette.primary.main, 0.4),
		borderColor: alpha(theme.palette.primary.main, 0.5),
		"&:hover": {
			backgroundColor: alpha(theme.palette.primary.main, 0.25),
			borderColor: alpha(theme.palette.primary.main, 0.7),
		},
	}),
}));

/**
 * Styled text input with no visible border
 *
 * This component customizes the MUI TextField to remove all borders,
 * including the default outlined border, focused border, and hover border.
 *
 * Also customizes the scrollbar appearance when multiline text causes overflow.
 */
const StyledTextField = styled(TextField)(({ theme }) => ({
	flex: 1,
	"& .MuiOutlinedInput-root": {
		backgroundColor: "transparent",
		padding: "6px 8px",
		fontSize: "1rem",
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
		color:
			theme.palette.mode === "light"
				? alpha(theme.palette.text.secondary, 0.7)
				: alpha(theme.palette.text.secondary, 0.5),
		opacity: 1,
	},
}));

/**
 * Container for buttons below the input
 */
const ButtonsRow = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: theme.spacing(1),
}));

/**
 * Styled attachment button
 */
const AttachmentButton = styled(IconButton)(({ theme }) => ({
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.main, 0.1)
			: alpha(theme.palette.primary.main, 0.15),
	color: theme.palette.primary.main,
	width: 40,
	height: 40,
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

/**
 * Styled send/stop button
 */
const SendButton = styled(Button)(({ theme }) => ({
	minWidth: 40,
	height: 40,
	borderRadius: "100%",
	padding: 0,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		transform: "scale(1.1)",
	},
	"&:active": {
		transform: "scale(1)",
	},
	"&.Mui-disabled": {
		backgroundColor: alpha(theme.palette.action.disabled, 0.1),
		color: alpha(theme.palette.common.white, 0.5),
	},
}));

/**
 * Container for empty state with title and centered input
 */
const EmptyStateContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(4),
	gap: theme.spacing(2),
}));

/**
 * Styled empty state title text
 */
const EmptyStateTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 500,
	color: theme.palette.text.secondary,
	textAlign: "center",
	marginBottom: theme.spacing(1),
	[theme.breakpoints.up("sm")]: {
		fontSize: "1.5rem",
		marginBottom: theme.spacing(2),
	},
}));

/**
 * MessageInput component
 */
export const MessageInput: FC<MessageInputProps> = ({
	onSendMessage,
	isLoading,
	conversationId,
	messages,
	currentJobId,
	onCancelJob,
	isFarFromBottom = false,
	scrollToBottom = () => {},
	initialSuggestions,
}) => {
	const [attachments, setAttachments] = useState<string[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const MAX_SUGGESTIONS = 7;

	const suggestions = useMemo(() => {
		if (!initialSuggestions || initialSuggestions.length === 0) return [];
		if (initialSuggestions.length <= MAX_SUGGESTIONS) {
			return initialSuggestions;
		}
		// Randomly select MAX_SUGGESTIONS unique suggestions
		const shuffled = [...initialSuggestions].sort(() => Math.random() - 0.5);
		return shuffled.slice(0, MAX_SUGGESTIONS);
	}, [initialSuggestions]);

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
		scrollToBottom,
		forceScrollToBottom: scrollToBottom,
	});

	const handleSubmit = (e: FormEvent) => {
		e.preventDefault();
		if (!newMessage.trim() && attachments.length === 0) return;
		submitMessage();
	};

	const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
		if (e.target.files && e.target.files.length > 0) {
			const newAttachments = Array.from(e.target.files).map((file) => {
				// @ts-ignore Electron file path
				const filePath = file.path;
				if (filePath) {
					return filePath;
				}
				return URL.createObjectURL(file);
			});
			setAttachments((prev) => [...prev, ...newAttachments]);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleRemoveAttachment = (index: number) => {
		setAttachments((prev) => {
			const newAttachments = [...prev];
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

	const handleSuggestionClick = (suggestion: string) => {
		if (isInputDisabled) return;
		onSendMessage(suggestion, attachments);
		setAttachments([]);
		setNewMessage("");
	};

	const inputContent = (
		<form onSubmit={handleSubmit} style={{ width: "100%" }}>
			<InputInnerContainer>
				{attachments.length > 0 && (
					<AttachmentsPreview
						attachments={attachments}
						onRemoveAttachment={handleRemoveAttachment}
						disabled={isInputDisabled}
					/>
				)}

				<StyledTextField
					fullWidth
					placeholder={isInputDisabled ? "⌛ Agent is busy" : "Ask me for help"}
					value={newMessage}
					onChange={(e) => setNewMessage(e.target.value)}
					onKeyDown={handleKeyDown}
					multiline
					maxRows={4}
					variant="outlined"
					inputRef={textareaRef}
					disabled={isInputDisabled}
				/>

				<ButtonsRow>
					{/* Left side: attachment button */}
					<Box display="flex" alignItems="center" gap={1}>
						<input
							type="file"
							ref={fileInputRef}
							onChange={handleFileSelect}
							style={{ display: "none" }}
							disabled={isInputDisabled}
							multiple
						/>
						{/* @ts-ignore Tooltip type issue */}
						<Tooltip title="Attach file">
							<span>
								<AttachmentButton
									onClick={triggerFileInput}
									color="primary"
									size="small"
									aria-label="Attach file"
									disabled={isInputDisabled}
								>
									<FontAwesomeIcon icon={faPaperclip} />
								</AttachmentButton>
							</span>
						</Tooltip>
					</Box>

					{/* Right side: send or stop button */}
					<Box display="flex" alignItems="center" gap={1}>
						{isLoading && currentJobId ? (
							// @ts-ignore Tooltip type issue
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
							// @ts-ignore Tooltip type issue
							<Tooltip title="Send message">
								<span>
									<SendButton
										type="submit"
										variant="contained"
										color="primary"
										disabled={
											isLoading ||
											(!newMessage.trim() && attachments.length === 0)
										}
										aria-label="Send message"
									>
										<FontAwesomeIcon icon={faPaperPlane} />
									</SendButton>
								</span>
							</Tooltip>
						)}
					</Box>
				</ButtonsRow>
			</InputInnerContainer>

			{messages.length === 0 && (
				<SuggestionsContainer>
					<Box
						sx={{
							display: "flex",
							flexWrap: "wrap",
							gap: 1,
							marginTop: 1.5,
							justifyContent: "center",
						}}
					>
						{suggestions.map((suggestion) => (
							<SuggestionChip
								key={suggestion}
								variant="outlined"
								size="small"
								onClick={() => handleSuggestionClick(suggestion)}
								disabled={isInputDisabled}
							>
								{suggestion}
							</SuggestionChip>
						))}
					</Box>
				</SuggestionsContainer>
			)}
		</form>
	);

	return (
		<>
			<InputOuterContainer>
				{messages.length === 0 ? (
					<EmptyStateContainer>
						<EmptyStateTitle variant="h6">
							What can I help you with today?
						</EmptyStateTitle>
						{inputContent}
					</EmptyStateContainer>
				) : (
					inputContent
				)}
			</InputOuterContainer>

			<ScrollToBottomButton
				visible={isFarFromBottom}
				onClick={scrollToBottom}
			/>
		</>
	);
};
