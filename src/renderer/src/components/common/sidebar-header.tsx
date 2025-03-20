/**
 * Sidebar Header Component
 *
 * A reusable component for sidebar headers with search functionality
 */

import {
	faFileImport,
	faPlus,
	faSearch,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	IconButton,
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

const ActionsContainer = styled(Box)({
	display: "flex",
	gap: 8,
});

const SidebarTitle = styled(Typography)({
	fontWeight: 600,
	fontSize: "1rem",
});

const ActionButton = styled(IconButton)(({ theme }) => ({
	borderRadius: 10,
	padding: 8,
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
	color: theme.palette.primary.main,
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.2),
		transform: "translateY(-2px)",
		boxShadow: `0 4px 8px ${alpha(theme.palette.primary.main, 0.25)}`,
	},
	"&:active": {
		transform: "translateY(0)",
		boxShadow: `0 2px 4px ${alpha(theme.palette.primary.main, 0.2)}`,
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
	/** Callback for when the import agent button is clicked */
	onImportAgentClick?: () => void;
	/** Tooltip text for the import agent button */
	importAgentTooltip?: string;
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
	onImportAgentClick,
	importAgentTooltip = "Import an agent from a ZIP file",
}) => {
	return (
		<SidebarHeaderContainer>
			<HeaderRow>
				<SidebarTitle variant="subtitle1">{title}</SidebarTitle>
				<ActionsContainer>
					{onImportAgentClick && (
						<Tooltip title={importAgentTooltip} arrow placement="top">
							<ActionButton
								onClick={onImportAgentClick}
								size="small"
								aria-label="Import agent"
							>
								<FontAwesomeIcon icon={faFileImport} />
							</ActionButton>
						</Tooltip>
					)}
					<Tooltip title={newAgentTooltip} arrow placement="top">
						<ActionButton
							onClick={onNewAgentClick}
							size="small"
							aria-label="New agent"
						>
							<FontAwesomeIcon icon={faPlus} />
						</ActionButton>
					</Tooltip>
				</ActionsContainer>
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
