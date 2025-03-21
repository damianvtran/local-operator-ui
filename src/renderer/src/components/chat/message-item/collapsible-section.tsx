import {
	faChevronDown,
	faChevronRight,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Collapse, IconButton, Typography, alpha } from "@mui/material";
import { styled } from "@mui/material/styles";
import { type FC, useState } from "react";
import type { CollapsibleSectionProps } from "./types";

const SectionHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	marginBottom: 4,
	cursor: "pointer",
	userSelect: "none",
	"&:hover": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			theme.palette.mode === "dark" ? 0.05 : 0.03,
		),
	},
	borderRadius: 4,
	padding: "2px 4px",
}));

const SectionLabel = styled(Typography)(({ theme }) => ({
	display: "block",
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.85rem",
}));

const ToggleButton = styled(IconButton)({
	padding: 2,
	marginRight: 4,
});

/**
 * A collapsible section component for code, output, and error blocks
 * Used to make action type executions collapsible
 */
export const CollapsibleSection: FC<CollapsibleSectionProps> = ({
	title,
	children,
	defaultCollapsed = true,
}) => {
	const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

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
				<SectionLabel variant="caption">{title}</SectionLabel>
			</SectionHeader>
			<Collapse in={!isCollapsed} timeout="auto">
				{children}
			</Collapse>
		</Box>
	);
};
