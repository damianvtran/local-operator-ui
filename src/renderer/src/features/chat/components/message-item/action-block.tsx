import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
	faBook,
	faCheck,
	faChevronUp,
	faCode,
	faCommentDots,
	faEdit,
	faLightbulb,
	faPencilAlt,
	faQuestion,
	faShare,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Collapse, Tooltip, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { createLocalOperatorClient } from "@shared/api/local-operator";
import type {
	ActionType,
	ExecutionType,
} from "@shared/api/local-operator/types";
import { apiConfig } from "@shared/config";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { MarkdownRenderer } from "../markdown-renderer";
import { CodeBlock } from "./code-block";
import { ErrorBlock } from "./error-block";
import { FileAttachment } from "./file-attachment";
import { ImageAttachment } from "./image-attachment";
import { LogBlock } from "./log-block";
import { OutputBlock } from "./output-block";
import { VideoAttachment } from "./video-attachment";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Props for the ActionBlock component
 */
export type ActionBlockProps = {
	content: string;
	action?: ActionType;
	executionType: ExecutionType;
	isUser: boolean;
	code?: string;
	stdout?: string;
	stderr?: string;
	logging?: string;
	files?: string[]; // URLs to attachments
	conversationId: string;
};

/**
 * Styled container for the background block with mount animation
 * Uses keyframes for a smooth entrance animation
 */
const BlockContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "mounted",
})<{ mounted: boolean }>(({ theme, mounted }) => ({
	width: "calc(100% - 2*56px)",
	marginLeft: 56,
	opacity: mounted ? 1 : 0, // Start invisible before animation
	transform: mounted ? "translateY(0)" : "translateY(20px)",
	transition: `opacity 0.4s ${theme.transitions.easing.easeOut}, transform 0.4s ${theme.transitions.easing.easeOut}`,
}));

/**
 * Styled header for the background block
 * Includes hover effect and adapts to expanded state
 */
const BlockHeader = styled(Box, {
	shouldForwardProp: (prop) =>
		prop !== "executionType" && prop !== "isUser" && prop !== "isExpanded",
})<{ executionType: ExecutionType; isUser: boolean; isExpanded: boolean }>(
	({ theme, isExpanded }) => ({
		cursor: "pointer",
		"&:hover": {
			opacity: 0.9,
		},
		display: "flex",
		alignItems: "center",
		padding: "4px 22px 4px 12px",
		backgroundColor: alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.2 : 0.05,
		),
		borderRadius: isExpanded ? "8px 8px 0 0" : "8px",
    borderColor: theme.palette.divider,
    borderWidth: 1,
    borderStyle: "solid",
    borderBottomColor: isExpanded ? "transparent" : theme.palette.divider,
		transition: `background-color 0.3s ${theme.transitions.easing.easeInOut}, 
                   border-radius 0.3s ${theme.transitions.easing.easeInOut}`,
	}),
);

/**
 * Styled icon container with subtle animation
 * Animates with a slight rotation and scale effect
 */
const BlockIcon = styled(Box)(({ theme }) => ({
	marginRight: 8,
	width: 40,
	height: 40,
	flexShrink: 0,
	borderRadius: "100%",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.2 : 0.05,
	),
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: theme.palette.icon.text,
	transform: "scale(1) rotate(0deg)",
	transition: `transform 0.4s ${theme.transitions.easing.easeOut}`,
	"&.animate": {
		animation: "iconAppear 0.4s forwards",
	},
	"@keyframes iconAppear": {
		"0%": {
			transform: "scale(0.8) rotate(-10deg)",
		},
		"100%": {
			transform: "scale(1) rotate(0deg)",
		},
	},
}));

/**
 * Styled title with fade-in animation
 */
const BlockTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	transform: "translateX(0)",
	transition: `transform 0.4s ${theme.transitions.easing.easeOut}`,
	"&.animate": {
		animation: "titleFadeIn 0.4s forwards",
	},
	"@keyframes titleFadeIn": {
		"0%": {
			transform: "translateX(-5px)",
		},
		"100%": {
			transform: "translateX(0)",
		},
	},
}));

/**
 * Styled content with fade-in animation
 */
const BlockContent = styled(Box)(({ theme }) => ({
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	overflow: "hidden",
	transform: "translateY(0)",
	transition: `transform 0.4s ${theme.transitions.easing.easeOut}`,
	"&.animate": {
		animation: "contentFadeIn 0.4s forwards",
	},
	"@keyframes contentFadeIn": {
		"0%": {
			transform: "translateY(5px)",
		},
		"100%": {
			transform: "translateY(0)",
		},
	},
}));

/**
 * Styled expanded content with subtle animation
 * Animates the border and background when expanded
 */
const ExpandedContent = styled(Box)(({ theme }) => ({
	padding: "12px 16px",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.2 : 0.05,
	),
	borderBottomLeftRadius: 8,
	borderBottomRightRadius: 8,
  borderColor: theme.palette.divider,
  borderWidth: 1,
  borderStyle: "solid",
  borderTop: "none",
	fontSize: "0.85rem",
	color: theme.palette.text.primary,
	marginLeft: 0,
}));

/**
 * Styled collapse button with hover animation
 */
const CollapseButton = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	padding: "8px",
	marginTop: "8px",
	cursor: "pointer",
	borderRadius: "4px",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.1 : 0.03,
	),
	transition: `all 0.2s ${theme.transitions.easing.easeInOut}`,
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.15 : 0.05,
		),
		transform: "translateY(-1px)",
		boxShadow: `0 2px 4px ${alpha(theme.palette.common.black, 0.1)}`,
	},
	"&:active": {
		transform: "translateY(0px)",
		boxShadow: "none",
	},
}));

/**
 * Checks if a file is a web URL
 * @param path - The file path or URL to check
 * @returns True if the path is a web URL, false otherwise
 */
const isWebUrl = (path: string): boolean => {
	return path.startsWith("http://") || path.startsWith("https://");
};

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
 * Checks if a file is a video based on its extension
 * @param path - The file path or URL to check
 * @returns True if the file is a video, false otherwise
 */
const isVideo = (path: string): boolean => {
	const videoExtensions = [
		".mp4",
		".webm",
		".ogg",
		".mov",
		".avi",
		".wmv",
		".flv",
		".mkv",
		".m4v",
		".3gp",
		".3g2",
	];
	const lowerPath = path.toLowerCase();
	return videoExtensions.some((ext) => lowerPath.endsWith(ext));
};

/**
 * Gets the appropriate URL for an attachment
 * Uses the static image endpoint for local image files
 * and the static video endpoint for local video files
 * @param client - The Local Operator client
 * @param path - The file path or URL
 * @returns The URL to access the attachment
 */
const getAttachmentUrl = (
	client: ReturnType<typeof createLocalOperatorClient>,
	path: string,
): string => {
	// If it's a web URL, return it as is
	if (path.startsWith("http")) {
		return path;
	}

	// For local files, normalize the path and use appropriate endpoint
	const normalizedPath = path.startsWith("file://") ? path : `file://${path}`;

	if (isImage(path)) {
		return client.static.getImageUrl(normalizedPath);
	}

	if (isVideo(path)) {
		return client.static.getVideoUrl(normalizedPath);
	}

	// For other file types, return the original path
	return path;
};

/**
 * Component for displaying plan, reflection, and action execution types
 * Shows as a single line with truncation when collapsed
 * For action types, also shows code, output, and errors when expanded
 * Attachments (images and files) are always visible outside the collapsible element
 */
export const ActionBlock: FC<ActionBlockProps> = ({
	content,
	action,
	executionType,
	isUser,
	code,
	stdout,
	stderr,
	logging,
	files,
	conversationId,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const [mounted, setMounted] = useState(false);
	const mountedRef = useRef(false);

	// Handle mount animation
	useEffect(() => {
		// Only trigger animation if it hasn't been mounted before
		if (!mountedRef.current) {
			mountedRef.current = true;
			// Small delay to ensure DOM is ready and for a staggered effect if multiple blocks appear
			const timer = setTimeout(() => {
				setMounted(true);
			}, 50);
			return () => clearTimeout(timer);
		}

		return undefined;
	}, []);

	const handleExpand = () => {
		setIsExpanded(true);
	};

	const handleCollapse = (e: React.MouseEvent) => {
		e.stopPropagation();
		setIsExpanded(false);
	};

	const getTitle = () => {
		switch (action) {
			case "DONE":
				return "Task Complete";
			case "ASK":
				return "Asking a Question";
			case "CODE":
				return "Executing Code";
			case "WRITE":
				return "Writing Content";
			case "EDIT":
				return "Editing Content";
			case "READ":
				return "Reading Content";
			case "DELEGATE":
				return "Delegating Task";
			default:
				return executionType === "plan"
					? "Planning"
					: executionType === "action"
						? "Action"
						: "Reflection";
		}
	};

	const getIcon = (): IconDefinition => {
		switch (action) {
			case "DONE":
				return faCheck;
			case "ASK":
				return faQuestion;
			case "CODE":
				return faCode;
			case "WRITE":
				return faPencilAlt;
			case "EDIT":
				return faEdit;
			case "READ":
				return faBook;
			case "DELEGATE":
				return faShare;
			default:
				return executionType === "plan"
					? faLightbulb
					: executionType === "action"
						? faCode
						: faCommentDots;
		}
	};

	// Create a Local Operator client using the API config
	const client = useMemo(() => {
		return createLocalOperatorClient(apiConfig.baseUrl);
	}, []);

	// Get the URL for an attachment
	const getUrl = useCallback(
		(path: string) => getAttachmentUrl(client, path),
		[client],
	);

	/**
	 * Handles clicking on a file attachment
	 * Opens local files with the system's default application
	 * Opens web URLs in the default browser
	 * @param filePath - The path or URL of the file to open
	 */
	const handleFileClick = useCallback((filePath: string) => {
		try {
			// If it's a web URL
			if (isWebUrl(filePath)) {
				// Open in default browser
				window.api.openExternal(filePath);
			} else {
				// It's a local file, open with default application
				// Remove file:// prefix if present
				const normalizedPath = filePath.startsWith("file://")
					? filePath.substring(7)
					: filePath;

				window.api.openFile(normalizedPath);
			}
		} catch (error) {
			console.error("Error opening file:", error);
			// Could add a toast notification here to inform the user
		}
	}, []);

	// Determine if we have any collapsible technical content
	const hasCollapsibleContent =
		executionType === "action" && (code || stdout || stderr || logging);

	// Set mounted to true immediately to ensure elements are visible
	useEffect(() => {
		setMounted(true);
	}, []);

	return (
		<BlockContainer sx={{ position: "relative" }} mounted={mounted}>
			{/* Message content displayed outside and above the collapsible block */}
			{content && (
				<Box
					sx={{
						borderRadius: 2,
						color: (theme) => theme.palette.text.primary,
						width: "100%",
						wordBreak: "break-word",
						overflowWrap: "break-word",
            position: "relative",
            mb: 2,
				}}
				>
					<MarkdownRenderer content={content} />
				</Box>
			)}

			{/* Collapsible block for technical details only */}
			{hasCollapsibleContent && (
				<>
					<BlockHeader
						executionType={executionType}
						isUser={isUser}
						isExpanded={isExpanded}
						onClick={isExpanded ? handleCollapse : handleExpand}
					>
						<BlockIcon className={mounted ? "animate" : ""}>
							<FontAwesomeIcon icon={getIcon()} size="sm" />
						</BlockIcon>
						<Box sx={{ flexGrow: 1, position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
							<BlockTitle variant="subtitle2" className={mounted ? "animate" : ""}>
								{getTitle()}
							</BlockTitle>
							{!isExpanded ? (
                <Tooltip title="View Details">
                  <BlockContent className={mounted ? "animate" : ""}>
                    <ChevronDown size={22} style={{ marginTop: 4 }} />
                  </BlockContent>
                </Tooltip>
							) : (
                <Tooltip title="Collapse Details">
                  <BlockContent className={mounted ? "animate" : ""}>
                    <ChevronUp size={22} style={{ marginTop: 4 }} />
                  </BlockContent>
                </Tooltip>
							)}
						</Box>
					</BlockHeader>
					<Collapse in={isExpanded} timeout="auto">
						<ExpandedContent className={isExpanded ? "animate" : ""}>
							{/* Technical details for action messages */}
							{/* Render code with syntax highlighting */}
							{code && <CodeBlock code={code} isUser={isUser} />}

							{/* Render stdout */}
							{stdout && <OutputBlock output={stdout} isUser={isUser} />}

							{/* Render stderr */}
							{stderr && <ErrorBlock error={stderr} isUser={isUser} />}

							{/* Render logging */}
							{logging && <LogBlock log={logging} isUser={isUser} />}

							<CollapseButton onClick={handleCollapse}>
								<FontAwesomeIcon icon={faChevronUp} size="sm" />
								<Typography variant="caption" sx={{ ml: 1 }}>
									Collapse
								</Typography>
							</CollapseButton>
						</ExpandedContent>
					</Collapse>
				</>
			)}

			{/* Render image attachments if any - always visible */}
			{files && files.length > 0 && (
				<Box sx={{ mb: 2, mt: 2 }}>
					{files
						.filter((file) => isImage(file))
						.map((file) => (
							<ImageAttachment
								key={`${file}`}
								file={file}
								src={getUrl(file)}
								onClick={handleFileClick}
							/>
						))}
				</Box>
			)}

			{/* Render video attachments if any - always visible */}
			{files && files.length > 0 && (
				<Box sx={{ mb: 2 }}>
					{files
						.filter((file) => isVideo(file))
						.map((file) => (
							<VideoAttachment
								key={`${file}`}
								file={file}
								src={getUrl(file)}
								onClick={handleFileClick}
							/>
						))}
				</Box>
			)}

			{/* Render non-media file attachments if any - always visible */}
			{files && files.length > 0 && (
				<Box sx={{ mt: 2 }}>
					{files
						.filter((file) => !isImage(file) && !isVideo(file))
						.map((file) => (
							<FileAttachment
								key={`${file}`}
								file={file}
								onClick={handleFileClick}
								conversationId={conversationId}
							/>
						))}
				</Box>
			)}
		</BlockContainer>
	);
};
