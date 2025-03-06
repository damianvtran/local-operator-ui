import { CollapsibleAppLogo } from "@components/navigation/collapsible-app-logo";
import { UserProfileSidebar } from "@components/navigation/user-profile-sidebar";
import {
	faChevronLeft,
	faChevronRight,
	faCode,
	faGear,
	faRobot,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
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
import React, { useState } from "react";
import type { FC } from "react";

type SidebarNavigationProps = {
	currentView: string;
	onNavigate: (view: string) => void;
};

const StyledDrawer = styled(Drawer, {
	shouldForwardProp: (prop) => prop !== "width",
})<{ width: number }>(({ theme, width }) => ({
	width,
	flexShrink: 0,
	"& .MuiDrawer-paper": {
		width,
		boxSizing: "border-box",
		background: "#0a0a0a",
		borderRight: "1px solid rgba(255,255,255,0.08)",
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
})<{ isActive: boolean; isExpanded: boolean }>(({ isActive, isExpanded }) => ({
	borderRadius: 8,
	marginBottom: 8,
	paddingTop: 12,
	paddingBottom: 12,
	minHeight: 48,
	justifyContent: isExpanded ? "initial" : "center",
	color: isActive ? "#38C96A" : "rgba(255,255,255,0.85)",
	backgroundColor: isActive ? alpha("#38C96A", 0.1) : "transparent",
	transition: "all 0.2s ease-out",
	position: "relative",
	overflow: "hidden",
	"&:hover": {
		backgroundColor: isActive
			? alpha("#38C96A", 0.15)
			: "rgba(255,255,255,0.07)",
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
			backgroundColor: "#38C96A",
			borderRadius: "0 4px 4px 0",
		},
	}),
}));

const NavItemIcon = styled(ListItemIcon, {
	shouldForwardProp: (prop) =>
		!["isActive", "isExpanded"].includes(prop as string),
})<{ isActive: boolean; isExpanded: boolean }>(({ isActive, isExpanded }) => ({
	minWidth: isExpanded ? 40 : 0,
	width: 24,
	marginRight: isExpanded ? 16 : "auto",
	justifyContent: "center",
	color: isActive ? "#38C96A" : "inherit",
	display: "flex",
	alignItems: "center",
	transition: "transform 0.2s ease, color 0.2s ease",
	...(isActive && {
		transform: "scale(1.1)",
	}),
}));

const StyledTooltip = styled(Tooltip)(() => ({
	"& .MuiTooltip-tooltip": {
		backgroundColor: "#1E1E1E",
		color: "white",
		fontSize: 12,
		fontWeight: 500,
		borderRadius: 8,
		padding: "8px 14px",
		boxShadow: "0 4px 14px rgba(0, 0, 0, 0.3)",
		border: "1px solid rgba(255,255,255,0.1)",
	},
	"& .MuiTooltip-arrow": {
		color: "#1E1E1E",
	},
}));

const ToggleButtonContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	marginTop: theme.spacing(1),
	marginBottom: theme.spacing(2),
}));

const ToggleButton = styled(IconButton)(() => ({
	borderRadius: "50%",
	backgroundColor: "rgba(255,255,255,0.05)",
	border: "1px solid rgba(255,255,255,0.1)",
	width: 36,
	height: 36,
	transition: "all 0.2s ease-out",
	"&:hover": {
		backgroundColor: "rgba(56, 201, 106, 0.1)",
		borderColor: "rgba(56, 201, 106, 0.3)",
		transform: "scale(1.05)",
		boxShadow: "0 2px 8px rgba(56, 201, 106, 0.2)",
	},
}));

/**
 * SidebarNavigation component that provides a collapsible sidebar for application navigation
 *
 * @param currentView - The current active view/page
 * @param onNavigate - Function to handle navigation between views
 */
export const SidebarNavigation: FC<SidebarNavigationProps> = ({
	currentView,
	onNavigate,
}) => {
	const [expanded, setExpanded] = useState(true);

	const toggleSidebar = () => {
		setExpanded(!expanded);
	};

	// Navigation items configuration
	const navItems = [
		{
			icon: faCode,
			label: "Chat",
			view: "chat",
			isActive: currentView === "chat",
		},
		{
			icon: faRobot,
			label: "Agents",
			view: "agents",
			isActive: currentView === "agents",
		},
		{
			icon: faGear,
			label: "Settings",
			view: "settings",
			isActive: currentView === "settings",
		},
	];

	const drawerWidth = expanded ? 240 : 72;

	// Render a navigation item with or without tooltip based on sidebar state
	const renderNavItem = (item: (typeof navItems)[0]) => {
		const navButton = (
			<NavItemButton
				onClick={() => onNavigate(item.view)}
				isActive={item.isActive}
				isExpanded={expanded}
			>
				<NavItemIcon isActive={item.isActive} isExpanded={expanded}>
					<FontAwesomeIcon icon={item.icon} fixedWidth />
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
			return (
				<StyledTooltip
					key={item.view}
					title={item.label}
					placement="right"
					arrow
				>
					<Box sx={{ position: "relative" }}>{navButton}</Box>
				</StyledTooltip>
			);
		}

		// Otherwise return just the button
		return <Box key={item.view}>{navButton}</Box>;
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
				<UserProfileSidebar expanded={expanded} onNavigate={onNavigate} />

				{/* Toggle Button - Now positioned below user profile */}
				<ToggleButtonContainer>
					<ToggleButton
						onClick={toggleSidebar}
						size="small"
						title={expanded ? "Collapse sidebar" : "Expand sidebar"}
					>
						<FontAwesomeIcon
							icon={expanded ? faChevronLeft : faChevronRight}
							size="xs"
						/>
					</ToggleButton>
				</ToggleButtonContainer>
			</Box>
		</StyledDrawer>
	);
};
