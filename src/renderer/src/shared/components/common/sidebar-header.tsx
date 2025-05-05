/**
 * Sidebar Header Component
 *
 * A reusable component for sidebar headers with search functionality
 */

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
import { Plus, Import, Search as LucideSearch } from "lucide-react";

const SidebarHeaderContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(2),
	borderBottom: `1px solid ${theme.palette.sidebar.border}`,
}));

const HeaderRow = styled(Box)({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 12,
});

const ActionsContainer = styled(Box)({
	display: "flex",
	gap: 4,
});

const SidebarTitle = styled(Typography)({
	fontWeight: 600,
	fontSize: "1rem",
});

const ActionButton = styled(IconButton)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 2,
	padding: 8,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.primary.dark, 0.15)
			: alpha(theme.palette.primary.main, 0.1),
	color:
		theme.palette.mode === "light"
			? theme.palette.primary.dark
			: theme.palette.primary.main,
	border:
		theme.palette.mode === "light"
			? `1px solid ${alpha(theme.palette.primary.dark, 0.5)}`
			: "none",
	transition: "all 0.2s ease-in-out",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.primary.dark, 0.25)
				: alpha(theme.palette.primary.main, 0.2),
		transform: "translateY(-2px)",
		boxShadow:
			theme.palette.mode === "light"
				? `0 4px 8px ${alpha(theme.palette.primary.dark, 0.3)}`
				: `0 4px 8px ${alpha(theme.palette.primary.main, 0.25)}`,
	},
	"&:active": {
		transform: "translateY(0)",
		boxShadow:
			theme.palette.mode === "light"
				? `0 2px 4px ${alpha(theme.palette.primary.dark, 0.25)}`
				: `0 2px 4px ${alpha(theme.palette.primary.main, 0.2)}`,
	},
}));

const SearchField = styled(TextField)(({ theme }) => ({
	"& .MuiOutlinedInput-root": {
		height: 36,
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
								<Import size={18} strokeWidth={2} />
							</ActionButton>
						</Tooltip>
					)}
					<Tooltip title={newAgentTooltip} arrow placement="top">
						<ActionButton
							onClick={onNewAgentClick}
							size="small"
							aria-label="New agent"
						>
							<Plus size={18} strokeWidth={2} />
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
							<LucideSearch size={16} strokeWidth={2} />
						</InputAdornment>
					),
				}}
			/>
		</SidebarHeaderContainer>
	);
};
