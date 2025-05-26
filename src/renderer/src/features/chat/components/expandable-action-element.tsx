import {
	Box,
	CircularProgress,
	Collapse,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type {
	ActionType,
	ExecutionType,
} from "@shared/api/local-operator/types";
import {
	Book,
	Check,
	ChevronDown,
	ChevronUp,
	Code2,
	HelpCircle,
	Lightbulb,
	MessageSquare,
	Pencil,
	PencilLine,
	Share2,
} from "lucide-react";
import type { FC, ReactNode } from "react";

/**
 * Props for the ExpandableActionElement component
 */
export type ExpandableActionElementProps = {
	/** The execution type (plan, action, reflection) */
	executionType: ExecutionType;
	/** The action type if available */
	action?: ActionType;
	/** Whether this is a user message */
	isUser: boolean;
	/** Whether the element is currently expanded */
	isExpanded: boolean;
	/** Handler for expanding the element */
	onExpand: () => void;
	/** Handler for collapsing the element */
	onCollapse: (e: React.MouseEvent) => void;
	/** Content to display when expanded */
	children: ReactNode;
	/** Whether there is any collapsible content */
	hasCollapsibleContent: boolean;
	/** Whether the action is loading */
	isLoading: boolean;
};

/**
 * Styled container for the expandable action element
 */
const BlockContainer = styled(Box)(() => ({
	width: "100%",
}));

/**
 * Styled header for the expandable block
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
		padding: "4px 12px 4px 8px",
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
 * Styled icon container with subtle styling
 */
const BlockIcon = styled(Box)(({ theme }) => ({
	marginRight: 6,
	width: 28,
	height: 28,
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
}));

/**
 * Styled title text
 */
const BlockTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 500,
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
}));

/**
 * Styled content container
 */
const BlockContent = styled(Box)(({ theme }) => ({
	fontSize: "0.85rem",
	color: theme.palette.text.secondary,
	overflow: "hidden",
}));

/**
 * Styled expanded content container
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
			theme.palette.mode === "dark" ? 0.15 : 0.07,
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
 * Gets the appropriate title based on action and execution type
 */
const getTitle = (
	action?: ActionType,
	executionType?: ExecutionType,
): string => {
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

/**
 * Gets the appropriate icon based on action and execution type
 */
const getIcon = (
	action?: ActionType,
	executionType?: ExecutionType,
): ReactNode => {
	switch (action) {
		case "DONE":
			return <Check size={16} />;
		case "ASK":
			return <HelpCircle size={16} />;
		case "CODE":
			return <Code2 size={16} />;
		case "WRITE":
			return <Pencil size={14} />;
		case "EDIT":
			return <PencilLine size={16} />;
		case "READ":
			return <Book size={16} />;
		case "DELEGATE":
			return <Share2 size={16} />;
		default:
			return executionType === "plan" ? (
				<Lightbulb size={16} />
			) : executionType === "action" ? (
				<Code2 size={16} />
			) : (
				<MessageSquare size={16} />
			);
	}
};

/**
 * Reusable expandable action element component
 * Provides a consistent interface for collapsible technical details
 *
 * @param executionType - The execution type (plan, action, reflection)
 * @param action - The action type if available
 * @param isUser - Whether this is a user message
 * @param isExpanded - Whether the element is currently expanded
 * @param onExpand - Handler for expanding the element
 * @param onCollapse - Handler for collapsing the element
 * @param children - Content to display when expanded
 * @param hasCollapsibleContent - Whether there is any collapsible content
 * @param isLoading - Whether the action is loading
 * @returns The expandable action element or null if not applicable
 */
export const ExpandableActionElement: FC<ExpandableActionElementProps> = ({
	executionType,
	action,
	isUser,
	isExpanded,
	onExpand,
	onCollapse,
	children,
	hasCollapsibleContent,
	isLoading,
}) => {
	if (!hasCollapsibleContent) {
		return null;
	}

	const title = getTitle(action, executionType);
	const icon = getIcon(action, executionType);

	return (
		<BlockContainer>
			<BlockHeader
				executionType={executionType}
				isUser={isUser}
				isExpanded={isExpanded}
				onClick={isExpanded ? onCollapse : onExpand}
			>
				<BlockIcon>{icon}</BlockIcon>
				<Box
					sx={{
						flexGrow: 1,
						position: "relative",
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
					}}
				>
					<Box sx={{ display: "flex", alignItems: "center" }}>
						<BlockTitle variant="subtitle2">{title}</BlockTitle>
						{isLoading && (
							<Box sx={{ ml: 1, display: "flex", alignItems: "center" }}>
								<CircularProgress size={14} thickness={2} />
							</Box>
						)}
					</Box>
					{!isExpanded ? (
						<Tooltip title="View Details">
							<BlockContent>
								<ChevronDown size={18} style={{ marginTop: 6 }} />
							</BlockContent>
						</Tooltip>
					) : (
						<Tooltip title="Collapse Details">
							<BlockContent>
								<ChevronUp size={18} style={{ marginTop: 6 }} />
							</BlockContent>
						</Tooltip>
					)}
				</Box>
			</BlockHeader>
			<Collapse in={isExpanded} timeout="auto">
				<ExpandedContent>
					{children}
					<CollapseButton onClick={onCollapse}>
						<ChevronUp size={16} />
						<Typography variant="caption" sx={{ ml: 1 }}>
							Collapse
						</Typography>
					</CollapseButton>
				</ExpandedContent>
			</Collapse>
		</BlockContainer>
	);
};
