import { Box, Collapse, IconButton, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { FC } from "react";
import { MarkdownRenderer } from "../markdown-renderer";

const ThinkingHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	cursor: "pointer",
	padding: theme.spacing(0.5, 1),
	borderRadius: theme.shape.borderRadius,
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
	marginBottom: theme.spacing(1),
}));

const ThinkingTitle = styled(Typography)(({ theme }) => ({
	fontWeight: "bold",
	marginLeft: theme.spacing(1),
	color: theme.palette.text.secondary,
}));

type ExpandableThinkingContentProps = {
	thinking?: string;
	isExpanded: boolean;
	onExpand: () => void;
	onCollapse: (e: React.MouseEvent) => void;
};

export const ExpandableThinkingContent: FC<ExpandableThinkingContentProps> = ({
	thinking,
	isExpanded,
	onExpand,
	onCollapse,
}) => {
	if (!thinking) {
		return null;
	}

	const handleToggle = (e: React.MouseEvent) => {
		if (isExpanded) {
			onCollapse(e);
		} else {
			onExpand();
		}
	};

	return (
		<Box sx={{ width: "100%" }}>
			<ThinkingHeader onClick={handleToggle}>
				<IconButton size="small" onClick={handleToggle} sx={{ p: 0.5 }}>
					{isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
				</IconButton>
				<ThinkingTitle variant="caption">Thinking</ThinkingTitle>
			</ThinkingHeader>
			<Collapse in={isExpanded} timeout="auto" unmountOnExit>
				<Box sx={{ pl: 4.5, pb: 1 }}>
					{" "}
					{/* Indent content slightly */}
					<MarkdownRenderer content={thinking} />
				</Box>
			</Collapse>
		</Box>
	);
};

ExpandableThinkingContent.displayName = "ExpandableThinkingContent";
