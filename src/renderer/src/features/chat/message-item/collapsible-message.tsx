import {
	faChevronDown,
	faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Collapse, IconButton, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useState } from "react";

const SectionHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: 8,
	cursor: "pointer",
	userSelect: "none",
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.primary.main,
			theme.palette.mode === "dark" ? 0.05 : 0.05,
		),
	},
	borderRadius: 4,
	padding: "4px 8px",
	color: theme.palette.primary.main,
	transition: "all 0.2s ease",
}));

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	color: theme.palette.primary.main,
	fontWeight: 500,
	fontSize: "0.85rem",
}));

const ToggleButton = styled(IconButton)({
	padding: 2,
	marginRight: 4,
});

/**
 * A collapsible message component that wraps all content blocks
 * Used to make action type executions collapsible as a whole
 */
export const CollapsibleMessage: FC<{
	children: React.ReactNode;
	defaultCollapsed?: boolean;
	hasContent: boolean | string | undefined;
}> = ({ children, defaultCollapsed = true, hasContent }) => {
	const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

	// If there's no content to collapse, just render the children
	if (!hasContent) {
		return <>{children}</>;
	}

	const toggleCollapse = () => {
		setIsCollapsed(!isCollapsed);
	};

	return (
		<Box sx={{ width: "100%" }}>
			<SectionHeader onClick={toggleCollapse}>
				<ToggleButton size="small" disableRipple>
					<FontAwesomeIcon
						icon={isCollapsed ? faChevronRight : faChevronDown}
						size="sm"
					/>
				</ToggleButton>
				<SectionLabel variant="caption">
					{isCollapsed ? "Show technical details" : "Hide technical details"}
				</SectionLabel>
			</SectionHeader>
			<Collapse in={!isCollapsed} timeout="auto">
				{children}
			</Collapse>
		</Box>
	);
};
