import {
	Dialog,
	DialogContent,
	IconButton,
	InputAdornment,
	List,
	ListItem,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	TextField,
	Typography,
	Chip,
	Box,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentListResult } from "@shared/api/local-operator/types";
import { useAgents } from "@shared/hooks/use-agents";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	MessageSquare,
	Settings,
	FileText,
	Search as LucideSearch,
	Users,
	Store,
	X,
	Calendar,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";
import { DEFAULT_SETTINGS_SECTIONS } from "@features/settings/components/settings-sidebar";
import { getIconElement } from "@features/command-palette/components/command-palette-utils";


const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiDialog-paper": {
		width: "600px",
		maxWidth: "90vw",
		borderRadius: theme.shape.borderRadius * 2,
		backgroundColor: theme.palette.background.default,
    backgroundImage: "none",
		boxShadow: theme.shadows[8],
    border: `1px solid ${theme.palette.divider}`,
	},
}));

const SearchInputContainer = styled("div")(({ theme }) => ({
	padding: theme.spacing(2, 3),
	borderBottom: `1px solid ${theme.palette.divider}`,
}));

const ResultsListContainer = styled(List)(({ theme }) => ({
	maxHeight: "400px",
	overflowY: "auto",
	padding: 0,
	// Custom scrollbar styles
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-track": {
		background: "transparent",
	},
	"&::-webkit-scrollbar-thumb": {
		background: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.2)" : "rgba(0, 0, 0, 0.2)",
		borderRadius: "4px",
		"&:hover": {
			background: theme.palette.mode === "dark" ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.3)",
		},
	},
	// Firefox scrollbar styles
	scrollbarWidth: "thin",
	scrollbarColor: theme.palette.mode === "dark" 
		? "rgba(255, 255, 255, 0.2) transparent" 
		: "rgba(0, 0, 0, 0.2) transparent",
}));

const ResultItemStyled = styled(ListItemButton)(({ theme }) => ({
	padding: theme.spacing(0.5, 2),
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

const ActionChip = styled(Chip)(() => ({
	fontSize: "0.7rem",
	height: "20px",
	marginLeft: "auto",
}));

type CommandPaletteItemType = "page" | "agent-chat" | "agent-settings" | "settings-section";

interface CommandPaletteItem {
	id: string;
	type: CommandPaletteItemType;
	name: string;
	category: string;
	path: string;
	icon?: JSX.Element;
}

const PAGE_DEFINITIONS: Omit<CommandPaletteItem, "id" | "type">[] = [
	{
		name: "Chat",
		path: "/chat",
		category: "Navigation",
		icon: <MessageSquare size={16} />,
	},
	{
		name: "My Agents",
		path: "/agents",
		category: "Navigation",
		icon: <Users size={16} />,
	},
	{
		name: "Agent Hub",
		path: "/agent-hub",
		category: "Navigation",
		icon: <Store size={16} />,
	},
	{
		name: "Schedules",
		path: "/schedules",
		category: "Navigation",
		icon: <Calendar size={16} />,
	},
	{
		name: "Settings",
		path: "/settings",
		category: "Navigation",
		icon: <Settings size={16} />,
	},
];

const MAX_SUGGESTIONS = 15;

const getActionLabel = (type: CommandPaletteItemType): string => {
	switch (type) {
		case "page":
			return "Navigate";
		case "agent-chat":
			return "Chat";
		case "agent-settings":
			return "Configure";
		case "settings-section":
			return "Configure";
		default:
			return "Open";
	}
};

const getActionColor = (type: CommandPaletteItemType): "default" | "primary" | "secondary" | "success" | "warning" | "info" | "error" => {
	switch (type) {
		case "page":
			return "primary";
		case "agent-chat":
			return "success";
		case "agent-settings":
			return "warning";
		case "settings-section":
			return "info";
		default:
			return "default";
	}
};

export const CommandPalette: FC = () => {
	const navigate = useNavigate();
	const {
		isCommandPaletteOpen,
		closeCommandPalette,
		commandPaletteQuery,
		setCommandPaletteQuery,
	} = useUiPreferencesStore();

	const { data: agentsData } = useAgents(1, 20) as { data?: AgentListResult };
	const theme = useTheme();

	const [selectedIndex, setSelectedIndex] = useState(0);

	// useCallback for handleItemClick to stabilize its reference for the useEffect dependency array
	const handleItemClick = useCallback(
		(item: CommandPaletteItem) => {
			navigate(item.path);
			closeCommandPalette();
		},
		[navigate, closeCommandPalette],
	);

	const allItems = useMemo(() => {
		const pages: CommandPaletteItem[] = PAGE_DEFINITIONS.map((p, i) => ({
			...p,
			id: `page-${i}`,
			type: "page",
		}));

		const settingsSectionItems: CommandPaletteItem[] = DEFAULT_SETTINGS_SECTIONS.map(
			(section) => ({
				id: `settings-section-${section.id}`,
				type: "settings-section",
				name: section.label,
				category: "Settings Section",
				path: `/settings?section=${section.id}`,
				icon: getIconElement(section),
			}),
		);

		const agentItems: CommandPaletteItem[] = [];
		if (agentsData?.agents) {
			for (const agent of agentsData.agents) {
				agentItems.push({
					id: `agent-chat-${agent.id}`,
					type: "agent-chat",
					name: agent.name,
					category: "Agent",
					path: `/chat/${agent.id}`,
					icon: <MessageSquare size={16} />,
				});
				agentItems.push({
					id: `agent-settings-${agent.id}`,
					type: "agent-settings",
					name: agent.name,
					category: "Agent",
					path: `/agents/${agent.id}`, // Corrected path for agent settings
					icon: <Settings size={16} />,
				});
			}
		}
		return [...pages, ...settingsSectionItems, ...agentItems];
	}, [agentsData]);

	const filteredItems = useMemo(() => {
		let items = allItems;
		
		if (commandPaletteQuery) {
			const lowerCaseQuery = commandPaletteQuery.toLowerCase();
			items = allItems.filter(
				(item) =>
					item.name.toLowerCase().includes(lowerCaseQuery) ||
					item.category.toLowerCase().includes(lowerCaseQuery),
			);
		}
		
		// Limit to top 15 suggestions
		return items.slice(0, MAX_SUGGESTIONS);
	}, [allItems, commandPaletteQuery]);

	const displayedItems = useMemo(() => filteredItems, [filteredItems]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selected index when filtered items change or palette opens
	useEffect(() => {
		setSelectedIndex(0);
	}, [displayedItems, isCommandPaletteOpen]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: handle keyboard navigation
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isCommandPaletteOpen) return;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((prev) => (prev + 1) % displayedItems.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex(
					(prev) => (prev - 1 + displayedItems.length) % displayedItems.length,
				);
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (displayedItems[selectedIndex]) {
					handleItemClick(displayedItems[selectedIndex]);
				}
			} else if (event.key === "Escape") {
				closeCommandPalette();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isCommandPaletteOpen, displayedItems, selectedIndex, closeCommandPalette, navigate, handleItemClick]);


	if (!isCommandPaletteOpen) {
		return null;
	}

	return (
		<StyledDialog
			open={isCommandPaletteOpen}
			onClose={closeCommandPalette}
			aria-labelledby="command-palette-dialog-title"
			fullWidth
			disableRestoreFocus // Important to allow text field to autoFocus
		>
			<SearchInputContainer>
				<TextField
					autoFocus
					fullWidth
					variant="standard"
					placeholder="Search agents and pages..."
					value={commandPaletteQuery}
					onChange={(e) => setCommandPaletteQuery(e.target.value)}
					InputProps={{
						startAdornment: (
							<InputAdornment position="start">
								<LucideSearch size={20} color={theme.palette.action.active} />
							</InputAdornment>
						),
						endAdornment: commandPaletteQuery ? (
							<InputAdornment position="end">
								<IconButton
									aria-label="clear search"
									onClick={() => setCommandPaletteQuery("")}
									edge="end"
									size="small"
								>
									<X size={20} />
								</IconButton>
							</InputAdornment>
						) : null,
						disableUnderline: true, 
						style: { fontSize: "1rem" },
					}}
					autoComplete="off"
				/>
			</SearchInputContainer>
			<DialogContent sx={{ padding: 0 }}>
				{displayedItems.length === 0 && commandPaletteQuery && (
					<Typography sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
						No results found.
					</Typography>
				)}
				<ResultsListContainer>
					{displayedItems.map((item, index) => (
						<ListItem key={item.id} disablePadding dense>
							<ResultItemStyled
								selected={selectedIndex === index}
								onClick={() => handleItemClick(item)}
								onMouseMove={() => setSelectedIndex(index)} // Update selection on mouse hover
							>
								<ListItemIcon sx={{ minWidth: "20px", display: "flex", alignItems: "center", justifyContent: "center", mr: 1.5, color: "text.secondary" }}>
									{item.icon || <FileText size={16} />}
								</ListItemIcon>
								<ListItemText
									primary={
										<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
											<Typography variant="body2">{item.name}</Typography>
											<Typography variant="caption" color="text.secondary">
												{item.category}
											</Typography>
										</Box>
									}
								/>
								<ActionChip
									label={getActionLabel(item.type)}
									size="small"
									color={getActionColor(item.type)}
									variant="outlined"
								/>
							</ResultItemStyled>
						</ListItem>
					))}
				</ResultsListContainer>
			</DialogContent>
		</StyledDialog>
	);
};
