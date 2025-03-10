import { faFile, faRobot, faUser } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Avatar, Box, Paper, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { memo, useCallback, useMemo } from "react";
import SyntaxHighlighter from "react-syntax-highlighter";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { createGlobalStyle } from "styled-components";
import { createLocalOperatorClient } from "../../api/local-operator";
import { apiConfig } from "../../config";
import { MarkdownRenderer } from "./markdown-renderer";
import type { Message } from "./types";

type MessageItemProps = {
	message: Message;
};

type StyledComponentProps = {
	isUser: boolean;
};

const MessageContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<StyledComponentProps>(({ isUser }) => ({
	display: "flex",
	flexDirection: isUser ? "row-reverse" : "row",
	alignItems: "flex-start",
	gap: 16,
	marginBottom: 16,
}));

const UserAvatar = styled(Avatar, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<StyledComponentProps>(({ isUser, theme }) => ({
	backgroundColor: isUser
		? "rgba(66, 133, 244, 0.9)"
		: "rgba(56, 201, 106, 0.2)",
	color: isUser ? "white" : theme.palette.primary.main,
	boxShadow: isUser ? "0 2px 8px rgba(66, 133, 244, 0.25)" : "none",
}));

// Create a Paper component with custom styling
const StyledPaper = styled(Paper)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		maxWidth: "85%",
	},
	[theme.breakpoints.between("sm", "md")]: {
		maxWidth: "75%",
	},
	[theme.breakpoints.up("md")]: {
		maxWidth: "65%",
	},
	width: "auto",
	padding: 16,
	borderRadius: 8,
	wordBreak: "break-word",
	overflowWrap: "break-word",
	position: "relative",
}));

// Create a wrapper component to handle the isUser prop
const MessagePaper: FC<{
	isUser: boolean;
	elevation: number;
	children: React.ReactNode;
}> = ({ isUser, elevation, children }) => {
	return (
		<StyledPaper
			elevation={elevation}
			sx={{
				backgroundColor: isUser
					? "rgba(66, 133, 244, 0.15)"
					: (theme) => theme.palette.background.paper,
				border: isUser
					? "1px solid rgba(66, 133, 244, 0.3)"
					: "1px solid rgba(255, 255, 255, 0.1)",
				boxShadow: isUser
					? "0 4px 12px rgba(0, 0, 0, 0.15)"
					: "0 2px 8px rgba(0, 0, 0, 0.1)",
				color: isUser ? (theme) => theme.palette.text.primary : "inherit",
			}}
		>
			{children}
		</StyledPaper>
	);
};

const AttachmentImage = styled("img")({
	maxWidth: "100%",
	maxHeight: 200,
	borderRadius: 8,
	marginBottom: 8,
	boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
});

/**
 * Styled component for non-image file attachments
 * Displays a file icon and filename in a container
 */
const FileAttachment = styled(Box)(() => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 12px",
	marginTop: 8,
	backgroundColor: "rgba(0, 0, 0, 0.1)",
	borderRadius: 8,
	boxShadow: "0 1px 4px rgba(0, 0, 0, 0.1)",
	width: "fit-content",
	maxWidth: "100%",
	"&:hover": {
		backgroundColor: "rgba(0, 0, 0, 0.15)",
	},
}));

const FileIcon = styled(Box)(({ theme }) => ({
	marginRight: 8,
	color: theme.palette.primary.main,
}));

const FileName = styled(Typography)({
	fontSize: "0.85rem",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	maxWidth: "100%",
});

/**
 * Checks if a file is an image based on its extension
 * @param path - The file path or URL to check
 * @returns True if the file is an image, false otherwise
 */
const isImage = (path: string): boolean => {
	const imageExtensions = [
		".jpg",
		".jpeg",
		".png",
		".gif",
		".webp",
		".bmp",
		".svg",
		".tiff",
		".tif",
		".ico",
		".heic",
		".heif",
		".avif",
		".jfif",
		".pjpeg",
		".pjp",
	];
	const lowerPath = path.toLowerCase();
	return imageExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Extracts the filename from a path
 * @param path - The file path or URL
 * @returns The extracted filename
 */
const getFileName = (path: string): string => {
	// Handle both local paths and URLs
	const parts = path.split(/[/\\]/);
	return parts[parts.length - 1];
};

/**
 * Gets the appropriate URL for an attachment
 * Uses the static image endpoint for local image files
 * @param client - The Local Operator client
 * @param path - The file path or URL
 * @returns The URL to access the attachment
 */
const getAttachmentUrl = (
	client: ReturnType<typeof createLocalOperatorClient>,
	path: string,
): string => {
	// If it's an image and looks like a local file path
	if (isImage(path) && !path.startsWith("http")) {
		// Check if path already has file:// protocol
		const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;
		// Use the static image endpoint
		return client.static.getImageUrl(normalizedPath);
	}
	// Otherwise return the original path
	return path;
};

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	marginBottom: 4,
	color: theme.palette.text.secondary,
}));

const CodeContainer = styled(Box)({
	marginBottom: 16,
	width: "100%",
});

const OutputContainer = styled(Box)({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: "rgba(0, 0, 0, 0.3)",
	borderRadius: "8px",
	padding: 12,
	maxHeight: "300px",
	overflow: "auto",
	whiteSpace: "pre",
	width: "100%",
	boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
	color: "inherit",
	overflowX: "auto",
	"&::-webkit-scrollbar": {
		width: "6px",
		height: "6px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "3px",
	},
	"&::-webkit-scrollbar-corner": {
		backgroundColor: "rgba(0, 0, 0, 0.3)",
	},
});

const ErrorContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<StyledComponentProps>(({ isUser }) => ({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: "rgba(255, 0, 0, 0.1)",
	borderRadius: "8px",
	padding: 12,
	maxHeight: "200px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	color: isUser ? "error.main" : "error.light",
	width: "100%",
	boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "3px",
	},
}));

const LogContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<StyledComponentProps>(({ isUser }) => ({
	fontFamily: '"Roboto Mono", monospace',
	fontSize: "0.85rem",
	backgroundColor: "rgba(0, 0, 0, 0.3)",
	borderRadius: "8px",
	padding: 12,
	maxHeight: "200px",
	overflow: "auto",
	whiteSpace: "pre-wrap",
	color: isUser ? "info.main" : "info.light",
	width: "100%",
	boxShadow: "0 2px 6px rgba(0, 0, 0, 0.15)",
	"&::-webkit-scrollbar": {
		width: "6px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "3px",
	},
}));

// Global style to ensure Roboto Mono is applied to syntax highlighter
const SyntaxHighlighterStyles = createGlobalStyle`
  .react-syntax-highlighter-code-block * {
    font-family: 'Roboto Mono', monospace !important;
  }
`;

const StatusIndicator = styled(Box, {
	shouldForwardProp: (prop) => prop !== "status",
})<{ status?: string }>(({ status }) => ({
	marginTop: 8,
	display: "inline-block",
	paddingLeft: 8,
	paddingRight: 8,
	paddingTop: 4,
	paddingBottom: 4,
	borderRadius: "4px",
	fontSize: "0.75rem",
	backgroundColor:
		status === "error"
			? "error.dark"
			: status === "success"
				? "success.dark"
				: "info.dark",
	color: "white",
	boxShadow: "0 2px 4px rgba(0, 0, 0, 0.1)",
}));

const Timestamp = styled(Typography, {
	shouldForwardProp: (prop) => prop !== "isUser",
})<StyledComponentProps>(({ isUser, theme }) => ({
	display: "block",
	marginTop: 8,
	textAlign: isUser ? "left" : "right",
	color: theme.palette.text.secondary,
	fontSize: "0.7rem",
}));

/**
 * Memoized message item component to prevent unnecessary re-renders
 * Only re-renders when the message content changes
 */
export const MessageItem: FC<MessageItemProps> = memo(
	({ message }) => {
		const isUser = message.role === "user";

		// Create a Local Operator client using the API config
		const client = useMemo(() => {
			return createLocalOperatorClient(apiConfig.baseUrl);
		}, []);

		// Memoize the formatted timestamp to prevent recalculation on re-renders
		const formattedTimestamp = useMemo(() => {
			return message.timestamp.toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			});
		}, [message.timestamp]);

		// Get the URL for an attachment
		const getUrl = useCallback(
			(path: string) => getAttachmentUrl(client, path),
			[client],
		);

		return (
			<MessageContainer isUser={isUser}>
				<UserAvatar isUser={isUser}>
					<FontAwesomeIcon icon={isUser ? faUser : faRobot} size="sm" />
				</UserAvatar>

				<MessagePaper elevation={isUser ? 2 : 1} isUser={isUser}>
					{/* Render image attachments if any */}
					{message.files && message.files.length > 0 && (
						<Box sx={{ mb: 2 }}>
							{message.files
								.filter((file) => isImage(file))
								.map((file) => (
									<AttachmentImage
										key={`${message.id}-${file}`}
										src={getUrl(file)}
										alt={getFileName(file)}
									/>
								))}
						</Box>
					)}

					{/* Render message content with markdown support */}
					{message.message && (
						<Box
							sx={{
								mb:
									message.code ||
									message.stdout ||
									message.stderr ||
									message.logging
										? 2
										: 0,
							}}
						>
							<MarkdownRenderer content={message.message} />
						</Box>
					)}

					{/* Render code with syntax highlighting */}
					{message.code && (
						<CodeContainer
							sx={{
								mb: message.stdout || message.stderr || message.logging ? 2 : 0,
							}}
						>
							<SyntaxHighlighterStyles />
							<SectionLabel variant="caption">Code</SectionLabel>
							<SyntaxHighlighter
								language="python"
								style={atomOneDark}
								customStyle={{
									borderRadius: "8px",
									fontSize: "0.85rem",
									width: "100%",
									boxShadow: "0 2px 6px rgba(0, 0, 0, 0.2)",
									padding: "0.75rem",
								}}
								codeTagProps={{
									style: {
										fontFamily: '"Roboto Mono", monospace !important',
									},
								}}
								className="react-syntax-highlighter-code-block"
								wrapLines={true}
								wrapLongLines={true}
							>
								{message.code}
							</SyntaxHighlighter>
						</CodeContainer>
					)}

					{/* Render stdout */}
					{message.stdout && (
						<CodeContainer
							sx={{ mb: message.stderr || message.logging ? 2 : 0 }}
						>
							<SectionLabel variant="caption">Output</SectionLabel>
							<OutputContainer>{message.stdout}</OutputContainer>
						</CodeContainer>
					)}

					{/* Render stderr */}
					{message.stderr && message.stderr !== "[No error output]" && (
						<CodeContainer sx={{ mb: message.logging ? 2 : 0 }}>
							<SectionLabel
								variant="caption"
								sx={{ color: isUser ? "error.main" : "error.light" }}
							>
								Error
							</SectionLabel>
							<ErrorContainer isUser={isUser}>{message.stderr}</ErrorContainer>
						</CodeContainer>
					)}

					{/* Render logging */}
					{message.logging && message.logging !== "[No logger output]" && (
						<CodeContainer sx={{ mb: message.formatted_print ? 2 : 0 }}>
							<SectionLabel variant="caption">Logs</SectionLabel>
							<LogContainer isUser={isUser}>{message.logging}</LogContainer>
						</CodeContainer>
					)}

					{/* Status indicator if present */}
					{message.status && (
						<StatusIndicator status={message.status}>
							{message.status}
						</StatusIndicator>
					)}

					{/* Render non-image file attachments if any */}
					{message.files && message.files.length > 0 && (
						<Box sx={{ mt: 2 }}>
							{message.files
								.filter((file) => !isImage(file))
								.map((file) => (
									<FileAttachment key={`${message.id}-${file}`}>
										<FileIcon>
											<FontAwesomeIcon icon={faFile} size="sm" />
										</FileIcon>
										<FileName variant="body2">{getFileName(file)}</FileName>
									</FileAttachment>
								))}
						</Box>
					)}

					{/* Message timestamp */}
					<Timestamp variant="caption" isUser={isUser}>
						{formattedTimestamp}
					</Timestamp>
				</MessagePaper>
			</MessageContainer>
		);
	},
	(prevProps, nextProps) => {
		// Custom comparison function for memo
		// Only re-render if the message ID or content has changed
		return (
			prevProps.message.id === nextProps.message.id &&
			prevProps.message.message === nextProps.message.message &&
			prevProps.message.status === nextProps.message.status
		);
	},
);
