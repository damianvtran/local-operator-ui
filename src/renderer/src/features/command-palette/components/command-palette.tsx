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
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { AgentListResult } from "@shared/api/local-operator/types";
import { useAgents } from "@shared/hooks/use-agents";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	BotMessageSquare,
	Cog,
	FileText,
	Search as LucideSearch, // Renamed to avoid conflict with HTML Search type
	Users,
	Waypoints,
	X,
	CalendarClock,
} from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "@mui/material/styles";

const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiDialog-paper": {
		width: "600px",
		maxWidth: "90vw",
		borderRadius: theme.shape.borderRadius * 2,
		backgroundColor: theme.palette.background.default, // Use default for a slightly different shade if paper is too similar
		boxShadow: theme.shadows[8],
	},
}));

const SearchInputContainer = styled("div")(({ theme }) => ({
	padding: theme.spacing(2, 3),
	borderBottom: `1px solid ${theme.palette.divider}`,
}));

const ResultsListContainer = styled(List)(() => ({
	maxHeight: "400px",
	overflowY: "auto",
	padding: 0,
}));

const ResultItemStyled = styled(ListItemButton)(({ theme }) => ({
	padding: theme.spacing(1, 3),
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

const ResultItemCategory = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
	marginLeft: theme.spacing(1),
}));

type CommandPaletteItemType = "page" | "agent-chat" | "agent-settings";

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
		icon: <BotMessageSquare size={20} />,
	},
	{
		name: "My Agents",
		path: "/agents",
		category: "Navigation",
		icon: <Users size={20} />,
	},
	{
		name: "Agent Hub",
		path: "/agent-hub",
		category: "Navigation",
		icon: <Waypoints size={20} />,
	},
	{
		name: "Schedules",
		path: "/schedules",
		category: "Navigation",
		icon: <CalendarClock size={20} />,
	},
	{
		name: "Settings",
		path: "/settings",
		category: "Navigation",
		icon: <Cog size={20} />,
	},
];

export const CommandPalette: FC = () => {
	const navigate = useNavigate();
	const {
		isCommandPaletteOpen,
		closeCommandPalette,
		commandPaletteQuery,
		setCommandPaletteQuery,
	} = useUiPreferencesStore();

	const { data: agentsData } = useAgents(1, 200) as { data?: AgentListResult }; // Fetch up to 200 agents
	const theme = useTheme(); // Get theme for icon color

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
			id: `page-${i}`, // Use index for unique page IDs
			type: "page",
		}));

		const agentItems: CommandPaletteItem[] = [];
		if (agentsData?.agents) {
			for (const agent of agentsData.agents) {
				agentItems.push({
					id: `agent-chat-${agent.id}`,
					type: "agent-chat",
					name: agent.name,
					category: "Chat with Agent",
					path: `/chat/${agent.id}`,
					icon: <BotMessageSquare size={20} />,
				});
				agentItems.push({
					id: `agent-settings-${agent.id}`,
					type: "agent-settings",
					name: `${agent.name} Settings`,
					category: "Agent Settings",
					path: `/agents/${agent.id}`, // Corrected path for agent settings
					icon: <Cog size={20} />,
				});
			}
		}
		return [...pages, ...agentItems];
	}, [agentsData]);

	const filteredItems = useMemo(() => {
		if (!commandPaletteQuery) {
			return allItems;
		}
		const lowerCaseQuery = commandPaletteQuery.toLowerCase();
		return allItems.filter(
			(item) =>
				item.name.toLowerCase().includes(lowerCaseQuery) ||
				item.category.toLowerCase().includes(lowerCaseQuery),
		);
	}, [allItems, commandPaletteQuery]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset selected index when filtered items change or palette opens
	useEffect(() => {
		setSelectedIndex(0);
	}, [filteredItems, isCommandPaletteOpen]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: handle keyboard navigation
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isCommandPaletteOpen) return;

			if (event.key === "ArrowDown") {
				event.preventDefault();
				setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				setSelectedIndex(
					(prev) => (prev - 1 + filteredItems.length) % filteredItems.length,
				);
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (filteredItems[selectedIndex]) {
					handleItemClick(filteredItems[selectedIndex]);
				}
			} else if (event.key === "Escape") {
				closeCommandPalette();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isCommandPaletteOpen, filteredItems, selectedIndex, closeCommandPalette, navigate, handleItemClick]);


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
					variant="standard" // More shadcn-like
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
						disableUnderline: true, // More shadcn-like
						style: { fontSize: "1.1rem" },
					}}
					autoComplete="off"
				/>
			</SearchInputContainer>
			<DialogContent sx={{ padding: 0 }}>
				{filteredItems.length === 0 && commandPaletteQuery && (
					<Typography sx={{ p: 3, textAlign: "center", color: "text.secondary" }}>
						No results found.
					</Typography>
				)}
				<ResultsListContainer>
					{filteredItems.map((item, index) => (
						<ListItem key={item.id} disablePadding dense>
							<ResultItemStyled
								selected={selectedIndex === index}
								onClick={() => handleItemClick(item)}
								onMouseMove={() => setSelectedIndex(index)} // Update selection on mouse hover
							>
								<ListItemIcon sx={{ minWidth: "auto", mr: 1.5, color: "text.secondary" }}>
									{item.icon || <FileText size={20} />}
								</ListItemIcon>
								<ListItemText
									primary={item.name}
									secondary={
										// The 'component' prop is valid for MUI Typography when used as a styled component
										// This should resolve the TS error if ResultItemCategory is correctly defined.
										// If ResultItemCategory is a direct styled(Typography), this is fine.
										<ResultItemCategory> 
											{item.category}
										</ResultItemCategory>
									}
								/>
							</ResultItemStyled>
						</ListItem>
					))}
				</ResultsListContainer>
			</DialogContent>
		</StyledDialog>
	);
};
