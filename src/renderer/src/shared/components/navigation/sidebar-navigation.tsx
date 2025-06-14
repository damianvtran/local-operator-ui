import {
	Box,
	Divider,
	Drawer,
	IconButton,
	List,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	Tooltip,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { CollapsibleAppLogo } from "@shared/components/navigation/collapsible-app-logo";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { LucideIcon } from "lucide-react";
import {
	Bot,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	MessageSquare,
	Settings,
	Store,
} from "lucide-react";
import type { FC } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Props for the SidebarNavigation component
 * No props needed as we use React Router hooks internally
 */
type SidebarNavigationProps = Record<string, never>;

const StyledDrawer = styled(Drawer, {
	shouldForwardProp: (prop) => prop !== "width",
})<{ width: number }>(({ theme, width }) => ({
	width,
	flexShrink: 0,
	"& .MuiDrawer-paper": {
		width,
		boxSizing: "border-box",
		background: theme.palette.sidebar.background,
		borderRight: `1px solid ${theme.palette.sidebar.border}`,
		boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
		transition: theme.transitions.create("width", {
			easing: theme.transitions.easing.sharp,
			duration: theme.transitions.duration.enteringScreen,
		}),
		overflowX: "hidden",
		display: "flex",
		flexDirection: "column",
		justifyContent: "space-between",
	},
}));

const LogoContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(2, 0),
	marginBottom: theme.spacing(1),
}));

const NavList = styled(List)(({ theme }) => ({
	padding: theme.spacing(1),
}));

const NavItemButton = styled(ListItemButton, {
	shouldForwardProp: (prop) =>
		!["isActive", "isExpanded"].includes(prop as string),
})<{ isActive: boolean; isExpanded: boolean }>(
	({ theme, isActive, isExpanded }) => ({
		borderRadius: 6,
		marginBottom: 4,
		padding: "4px 12px",
		minHeight: 36,
		justifyContent: isExpanded ? "initial" : "center",
		color: isActive
			? theme.palette.sidebar.itemActiveText
			: theme.palette.sidebar.itemText,
		backgroundColor: isActive
			? theme.palette.sidebar.itemActive
			: "transparent",
		transition: "background-color 0.2s ease-out, color 0.2s ease-out",
		"&:hover": {
			backgroundColor: isActive
				? theme.palette.sidebar.itemActiveHover
				: theme.palette.sidebar.itemHover,
		},
	}),
);

const NavItemIcon = styled(ListItemIcon, {
	shouldForwardProp: (prop) =>
		!["isActive", "isExpanded"].includes(prop as string),
})<{ isActive: boolean; isExpanded: boolean }>(
	({ theme, isActive, isExpanded }) => ({
		minWidth: 0,
		width: 20,
		height: 20,
		marginRight: isExpanded ? 12 : 0,
		justifyContent: "center",
		color: isActive
			? theme.palette.sidebar.itemActiveText
			: theme.palette.icon.text,
		display: "flex",
		alignItems: "center",
		transition: "color 0.2s ease",
	}),
);

const StyledTooltip = styled(Tooltip)(({ theme }) => ({
	"& .MuiTooltip-tooltip": {
		backgroundColor: theme.palette.tooltip.background,
		color: theme.palette.tooltip.text,
		fontSize: 12,
		fontWeight: 500,
		borderRadius: 8,
		padding: "8px 14px",
		boxShadow: "0 4px 14px rgba(0, 0, 0, 0.3)",
		border: `1px solid ${theme.palette.tooltip.border}`,
	},
	"& .MuiTooltip-arrow": {
		color: theme.palette.tooltip.background,
	},
}));

const ToggleButtonContainer = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isExpanded",
})<{ isExpanded: boolean }>(({ theme, isExpanded }) => ({
	display: "flex",
	justifyContent: isExpanded ? "flex-end" : "center",
	alignItems: "center",
	paddingRight: isExpanded ? theme.spacing(2) : 0,
	paddingLeft: isExpanded ? 0 : theme.spacing(1),
	paddingBottom: theme.spacing(2),
	width: "100%",
	marginTop: 8,
}));

const ToggleButton = styled(IconButton)(({ theme }) => ({
	borderRadius: 6,
	backgroundColor: "transparent",
	border: `1px solid ${theme.palette.sidebar.toggleButton.border}`,
	width: 28,
	height: 28,
	transition: "background-color 0.2s ease-out, border-color 0.2s ease-out",
	"&:hover": {
		backgroundColor: theme.palette.sidebar.toggleButton.hoverBackground,
		borderColor: theme.palette.sidebar.toggleButton.hoverBorder,
	},
}));

/**
 * SidebarNavigation component that provides a collapsible sidebar for application navigation
 * Uses React Router for navigation and persists sidebar state using the UI preferences store
 */
export const SidebarNavigation: FC<SidebarNavigationProps> = () => {
	const navigate = useNavigate();
	const currentView = useCurrentView();
	const { isSidebarCollapsed, toggleSidebar } = useUiPreferencesStore();

	// Invert the collapsed state to get expanded state
	const expanded = !isSidebarCollapsed;

	// Navigation items configuration
	const navItems: Array<{
		icon: LucideIcon;
		label: string;
		path: string;
		isActive: boolean;
		tourTag?: string;
	}> = [
		{
			icon: MessageSquare,
			label: "Chat",
			path: "/chat",
			isActive: currentView === "chat",
			tourTag: "nav-item-chat",
		},
		{
			icon: Bot,
			label: "My Agents",
			path: "/agents",
			isActive: currentView === "agents",
			tourTag: "nav-item-agents",
		},
		{
			icon: Store,
			label: "Agent Hub",
			path: "/agent-hub",
			isActive: currentView === "agent-hub",
			tourTag: "nav-item-agent-hub",
		},
		{
			icon: CalendarDays,
			label: "Schedules",
			path: "/schedules",
			isActive: currentView === "schedules",
			tourTag: "nav-item-schedules",
		},
		{
			icon: Settings,
			label: "Settings",
			path: "/settings",
			isActive: currentView === "settings",
			tourTag: "nav-item-settings",
		},
	];

	const drawerWidth = expanded ? 220 : 68;

	// Handle navigation
	const handleNavigate = (path: string) => {
		navigate(path);
	};

	// Render a navigation item with or without tooltip based on sidebar state
	const renderNavItem = (item: (typeof navItems)[0]) => {
		const navButton = (
			<NavItemButton
				onClick={() => handleNavigate(item.path)}
				isActive={item.isActive}
				isExpanded={expanded}
				data-tour-tag={item.tourTag}
			>
				<NavItemIcon isActive={item.isActive} isExpanded={expanded}>
					<item.icon
						size={18}
						strokeWidth={1.5}
						style={{ display: "block" }}
						aria-label={item.label}
					/>
				</NavItemIcon>
				{expanded && (
					<ListItemText
						primary={item.label}
						primaryTypographyProps={{
							fontWeight: item.isActive ? 500 : 400,
							fontSize: "0.875rem",
							whiteSpace: "nowrap",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					/>
				)}
			</NavItemButton>
		);

		// If sidebar is collapsed, use custom tooltip
		if (!expanded) {
			// @ts-ignore Tooltip type issue workaround
			return (
				<StyledTooltip
					key={item.path}
					title={item.label}
					placement="right"
					arrow
				>
					<Box sx={{ position: "relative" }}>{navButton}</Box>
				</StyledTooltip>
			);
		}

		// Otherwise return just the button
		return <Box key={item.path}>{navButton}</Box>;
	};

	return (
		<StyledDrawer variant="permanent" width={drawerWidth}>
			<Box>
				{/* App Logo */}
				<LogoContainer>
					<CollapsibleAppLogo expanded={expanded} />
				</LogoContainer>

				{/* Navigation Items */}
				<NavList>{navItems.map(renderNavItem)}</NavList>
			</Box>

			{/* User Profile and Toggle Button at Bottom */}
			<Box
				sx={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					width: "100%",
				}}
			>
				<Divider
					sx={{
						margin: "8px 0",
						width: "calc(100% - 16px)",
						borderColor: "divider",
					}}
				/>

				{/* User Profile */}
				<UserProfileSidebar expanded={expanded} />

				{/* Toggle Button - Now positioned below user profile */}
				<ToggleButtonContainer isExpanded={expanded}>
					<StyledTooltip
						title={expanded ? "Collapse sidebar" : "Expand sidebar"}
						placement="right"
						arrow
					>
						<ToggleButton
							onClick={toggleSidebar}
							size="small"
							aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
						>
							{expanded ? (
								<ChevronLeft size={16} aria-label="Collapse sidebar" />
							) : (
								<ChevronRight size={16} aria-label="Expand sidebar" />
							)}
						</ToggleButton>
					</StyledTooltip>
				</ToggleButtonContainer>
			</Box>
		</StyledDrawer>
	);
};
