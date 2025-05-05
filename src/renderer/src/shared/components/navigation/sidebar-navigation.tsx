import type { LucideIcon } from "lucide-react";
import {
	Bot,
	Store,
	Settings,
	ChevronLeft,
	ChevronRight,
	MessageCircle,
} from "lucide-react";
import {
	Box,
	Drawer,
	IconButton,
	List,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	Tooltip,
	alpha,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import { CollapsibleAppLogo } from "@shared/components/navigation/collapsible-app-logo";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
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
	padding: theme.spacing(3),
	marginBottom: theme.spacing(1),
}));

const NavList = styled(List)(({ theme }) => ({
	paddingLeft: theme.spacing(1.5),
	paddingRight: theme.spacing(1.5),
}));

const NavItemButton = styled(ListItemButton, {
	shouldForwardProp: (prop) =>
		!["isActive", "isExpanded"].includes(prop as string),
})<{ isActive: boolean; isExpanded: boolean }>(
	({ theme, isActive, isExpanded }) => ({
		borderRadius: 8,
		marginBottom: 8,
		paddingTop: 12,
		paddingBottom: 12,
		minHeight: 48,
		justifyContent: isExpanded ? "initial" : "center",
		color: isActive
			? theme.palette.sidebar.itemActiveText
			: theme.palette.sidebar.itemText,
		backgroundColor: isActive
			? theme.palette.sidebar.itemActive
			: "transparent",
		transition: "all 0.2s ease-out",
		position: "relative",
		overflow: "hidden",
		"&:hover": {
			backgroundColor: isActive
				? theme.palette.sidebar.itemActiveHover
				: theme.palette.sidebar.itemHover,
			transform: "translateX(4px)",
		},
		...(isActive && {
			"&::before": {
				content: '""',
				position: "absolute",
				left: 0,
				top: "50%",
				transform: "translateY(-50%)",
				width: 4,
				height: "60%",
				backgroundColor: theme.palette.sidebar.itemActiveText,
				borderRadius: "0 4px 4px 0",
			},
		}),
	}),
);

const NavItemIcon = styled(ListItemIcon, {
	shouldForwardProp: (prop) =>
		!["isActive", "isExpanded"].includes(prop as string),
})<{ isActive: boolean; isExpanded: boolean }>(
	({ theme, isActive, isExpanded }) => ({
		minWidth: isExpanded ? 40 : 0,
		width: 24,
		marginRight: isExpanded ? 16 : "auto",
		justifyContent: "center",
		color: isActive
			? theme.palette.sidebar.itemActiveText
			: theme.palette.icon.text,
		display: "flex",
		alignItems: "center",
		transition: "transform 0.2s ease, color 0.2s ease",
		...(isActive && {
			transform: "scale(1.1)",
		}),
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

const ToggleButtonContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	marginTop: theme.spacing(1),
	marginBottom: theme.spacing(2),
}));

const ToggleButton = styled(IconButton)(({ theme }) => ({
	borderRadius: "50%",
	backgroundColor: theme.palette.sidebar.toggleButton.background,
	border: `1px solid ${theme.palette.sidebar.toggleButton.border}`,
	width: 36,
	height: 36,
	transition: "all 0.2s ease-out",
	"&:hover": {
		backgroundColor: theme.palette.sidebar.toggleButton.hoverBackground,
		borderColor: theme.palette.sidebar.toggleButton.hoverBorder,
		transform: "scale(1.05)",
		boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.2)}`,
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
	}> = [
		{
		icon: MessageCircle,
		label: "Chat",
		path: "/chat",
		isActive: currentView === "chat",
	},
		{
			icon: Bot,
			label: "My Agents",
			path: "/agents",
			isActive: currentView === "agents",
		},
		{
			icon: Store,
			label: "Agent Hub",
			path: "/agent-hub",
			isActive: currentView === "agent-hub",
		},
		{
			icon: Settings,
			label: "Settings",
			path: "/settings",
			isActive: currentView === "settings",
		},
	];

	const drawerWidth = expanded ? 240 : 72;

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
			>
				<NavItemIcon isActive={item.isActive} isExpanded={expanded}>
					<item.icon
						size={22}
						strokeWidth={2.1}
						style={{ display: "block" }}
						aria-label={item.label}
					/>
				</NavItemIcon>
				{expanded && (
					<ListItemText
						primary={item.label}
						primaryTypographyProps={{
							fontWeight: item.isActive ? 600 : 500,
							letterSpacing: item.isActive ? "0.02em" : "normal",
							fontSize: "0.95rem",
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
			<Box>
				{/* User Profile */}
				<UserProfileSidebar expanded={expanded} />

				{/* Toggle Button - Now positioned below user profile */}
				<ToggleButtonContainer>
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
								<ChevronLeft size={18} aria-label="Collapse sidebar" />
							) : (
								<ChevronRight size={18} aria-label="Expand sidebar" />
							)}
						</ToggleButton>
					</StyledTooltip>
				</ToggleButtonContainer>
			</Box>
		</StyledDrawer>
	);
};
