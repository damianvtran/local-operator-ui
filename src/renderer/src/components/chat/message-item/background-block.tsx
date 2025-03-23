import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
	faCheck,
	faCommentDots,
	faLightbulb,
	faQuestion,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Collapse, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { ExecutionType } from "@renderer/api/local-operator/types";
import { type FC, useState } from "react";
import { MarkdownRenderer } from "../markdown-renderer";
import type { BackgroundBlockProps } from "./types";

const BlockContainer = styled(Box)(() => ({
	width: "95%",
	cursor: "pointer",
	transition: "all 0.2s ease",
	marginLeft: 56,
	"&:hover": {
		opacity: 0.9,
	},
}));

const BlockHeader = styled(Box, {
	shouldForwardProp: (prop) => prop !== "executionType" && prop !== "isUser",
})<{ executionType: ExecutionType; isUser: boolean }>(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 12px",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.2 : 0.05,
	),
	borderLeft: `3px solid ${
		theme.palette.grey[theme.palette.mode === "dark" ? 600 : 400]
	}`,
}));

const BlockIcon = styled(Box)(({ theme }) => ({
	marginRight: 8,
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-start",
	color: theme.palette.icon.text,
}));

const BlockTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
}));

const BlockContent = styled(Box)(({ theme }) => ({
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	overflow: "hidden",
	textOverflow: "ellipsis",
	marginTop: 2,
}));

const ExpandedContent = styled(Box)(({ theme }) => ({
	padding: "12px 16px",
	backgroundColor: alpha(
		theme.palette.common.black,
		theme.palette.mode === "dark" ? 0.2 : 0.05,
	),
	borderBottomLeftRadius: 4,
	borderBottomRightRadius: 4,
	fontSize: "0.85rem",
	color: theme.palette.text.primary,
	borderLeft: `3px solid ${theme.palette.grey[theme.palette.mode === "dark" ? 600 : 400]}`,
	marginLeft: 0,
}));

/**
 * Component for displaying plan and reflection execution types
 * Shows as a single line with truncation when collapsed
 */
export const BackgroundBlock: FC<BackgroundBlockProps> = ({
	content,
	action,
	executionType,
	isUser,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const toggleExpand = () => {
		setIsExpanded(!isExpanded);
	};

	const getTitle = () => {
		switch (action) {
			case "DONE":
				return "Task Complete";
			case "ASK":
				return "Asking a Question";
			default:
				return executionType === "plan" ? "Planning" : "Reflection";
		}
	};

	const getIcon = (): IconDefinition => {
		switch (action) {
			case "DONE":
				return faCheck;
			case "ASK":
				return faQuestion;
			default:
				return executionType === "plan" ? faLightbulb : faCommentDots;
		}
	};

	const getTruncatedContent = (content: string, maxLength = 140) => {
		return content.length > maxLength
			? `${content.slice(0, maxLength)}...`
			: content;
	};

	return (
		<BlockContainer onClick={toggleExpand}>
			<BlockHeader executionType={executionType} isUser={isUser}>
				<BlockIcon>
					<FontAwesomeIcon icon={getIcon()} size="sm" />
				</BlockIcon>
				<Box sx={{ flexGrow: 1 }}>
					<BlockTitle variant="subtitle2">{getTitle()}</BlockTitle>
					{!isExpanded && (
						<BlockContent>
							<MarkdownRenderer
								content={getTruncatedContent(content)}
								styleProps={{
									fontSize: "0.85rem",
									lineHeight: 1.5,
									paragraphSpacing: "4px",
									headingScale: 0.9,
									codeSize: "0.85em",
								}}
							/>
						</BlockContent>
					)}
				</Box>
			</BlockHeader>
			<Collapse in={isExpanded} timeout="auto">
				<ExpandedContent>
					<MarkdownRenderer
						content={content}
						styleProps={{
							fontSize: "0.85rem",
							lineHeight: 1.5,
							paragraphSpacing: "4px",
							headingScale: 0.9,
							codeSize: "0.85em",
						}}
					/>
				</ExpandedContent>
			</Collapse>
		</BlockContainer>
	);
};
