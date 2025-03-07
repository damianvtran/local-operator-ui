/**
 * Sidebar Header Component
 *
 * A reusable component for sidebar headers with search functionality
 */

import { faPlus, faSearch } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	InputAdornment,
	TextField,
	Tooltip,
	Typography,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import React from "react";

const SidebarHeaderContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	borderBottom: "1px solid rgba(255,255,255,0.08)",
}));

const HeaderRow = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 16,
});

const SidebarTitle = styled(Typography)({
	fontWeight: 600,
	fontSize: "1rem",
});

const NewAgentButton = styled(Button)(({ theme }) => ({
	borderRadius: 8,
	textTransform: "none",
	fontWeight: 600,
	paddingLeft: 16,
	paddingRight: 16,
	paddingTop: 6.4,
	paddingBottom: 6.4,
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		boxShadow: `0 2px 8px ${theme.palette.primary.main}33`,
		transform: "translateY(-1px)",
	},
	"&:active": {
		transform: "translateY(0)",
	},
}));

const SearchField = styled(TextField)(({ theme }) => ({
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
		padding: "8px 12px",
		fontSize: "0.875rem",
	},
	"& .MuiInputBase-input": {
		fontSize: "0.875rem",
	},
	"& .MuiInputAdornment-root": {
		color: alpha(theme.palette.text.primary, 0.6),
	},
}));

/**
 * Props for the SidebarHeader component
 */
type SidebarHeaderProps = {
	/** Title to display in the header */
	title: string;
	/** Current search query */
	searchQuery: string;
	/** Callback for when search query changes */
	onSearchChange: (query: string) => void;
	/** Callback for when the new agent button is clicked */
	onNewAgentClick: () => void;
	/** Placeholder text for the search field */
	searchPlaceholder?: string;
	/** Tooltip text for the new agent button */
	newAgentTooltip?: string;
};

/**
 * Sidebar Header Component
 *
 * A reusable component for sidebar headers with search functionality
 */
export const SidebarHeader: FC<SidebarHeaderProps> = ({
	title,
	searchQuery,
	onSearchChange,
	onNewAgentClick,
	searchPlaceholder = "Search agents",
	newAgentTooltip = "Create a new agent",
}) => {
	return (
		<SidebarHeaderContainer>
			<HeaderRow>
				<SidebarTitle variant="subtitle1">{title}</SidebarTitle>
				{/* @ts-ignore - MUI Tooltip requires children but we're providing it */}
				<Tooltip title={newAgentTooltip} arrow placement="top">
					<NewAgentButton
						variant="outlined"
						color="primary"
						size="small"
						startIcon={<FontAwesomeIcon icon={faPlus} />}
						onClick={onNewAgentClick}
					>
						New Agent
					</NewAgentButton>
				</Tooltip>
			</HeaderRow>

			<SearchField
				fullWidth
				size="small"
				placeholder={searchPlaceholder}
				value={searchQuery}
				onChange={(e) => onSearchChange(e.target.value)}
				InputProps={{
					startAdornment: (
						<InputAdornment position="start">
							<FontAwesomeIcon icon={faSearch} size="sm" />
						</InputAdornment>
					),
				}}
			/>
		</SidebarHeaderContainer>
	);
};
