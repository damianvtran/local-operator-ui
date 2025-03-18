import { faLightbulb, faPencil } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Collapse, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useState } from "react";
import type { PlanReflectionBlockProps } from "./types";

const BlockContainer = styled(Box)(() => ({
	width: "100%",
	marginBottom: 16,
	borderRadius: 8,
	overflow: "hidden",
	cursor: "pointer",
	transition: "all 0.2s ease",
	"&:hover": {
		boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
	},
}));

const BlockHeader = styled(Box, {
	shouldForwardProp: (prop) => prop !== "executionType" && prop !== "isUser",
})<{ executionType: string; isUser: boolean }>(({ theme, executionType }) => ({
	display: "flex",
	alignItems: "center",
	padding: "8px 12px",
	backgroundColor:
		executionType === "plan"
			? "rgba(25, 118, 210, 0.15)"
			: "rgba(156, 39, 176, 0.15)",
	borderLeft: `3px solid ${
		executionType === "plan"
			? theme.palette.primary.main
			: theme.palette.secondary.main
	}`,
	borderRadius: "4px",
}));

const BlockIcon = styled(Box)(() => ({
	marginRight: 8,
	display: "flex",
	alignItems: "center",
}));

const BlockTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	fontSize: "0.9rem",
	color: theme.palette.text.primary,
}));

const BlockContent = styled(Typography)(({ theme }) => ({
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
}));

const ExpandedContent = styled(Box)(({ theme }) => ({
	padding: "12px 16px",
	backgroundColor: "rgba(0, 0, 0, 0.2)",
	borderBottomLeftRadius: 8,
	borderBottomRightRadius: 8,
	whiteSpace: "pre-wrap",
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
}));

/**
 * Component for displaying plan and reflection execution types
 * Shows as a single line with truncation when collapsed
 */
export const PlanReflectionBlock: FC<PlanReflectionBlockProps> = ({
	content,
	executionType,
	isUser,
}) => {
	const [isExpanded, setIsExpanded] = useState(false);

	const toggleExpand = () => {
		setIsExpanded(!isExpanded);
	};

	const getTitle = () => {
		return executionType === "plan" ? "Planning" : "Reflection";
	};

	const getIcon = () => {
		return executionType === "plan" ? faLightbulb : faPencil;
	};

	return (
		<BlockContainer onClick={toggleExpand}>
			<BlockHeader executionType={executionType} isUser={isUser}>
				<BlockIcon>
					<FontAwesomeIcon icon={getIcon()} size="sm" />
				</BlockIcon>
				<Box sx={{ flexGrow: 1 }}>
					<BlockTitle variant="subtitle2">{getTitle()}</BlockTitle>
					{!isExpanded && <BlockContent>{content}</BlockContent>}
				</Box>
			</BlockHeader>
			<Collapse in={isExpanded} timeout="auto">
				<ExpandedContent>{content}</ExpandedContent>
			</Collapse>
		</BlockContainer>
	);
};
