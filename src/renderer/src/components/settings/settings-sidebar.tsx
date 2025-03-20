import {
	faAdjust,
	faDownload,
	faGear,
	faKey,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	List,
	ListItemButton,
	ListItemIcon,
	ListItemText,
	Paper,
	Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";

/**
 * Type definition for settings sections
 */
export type SettingsSection = {
	id: string;
	label: string;
	icon: typeof faGear | typeof faKey | typeof faDownload | typeof faAdjust;
};

/**
 * Props for the SettingsSidebar component
 */
type SettingsSidebarProps = {
	/** The currently active settings section */
	activeSection: string;
	/** Callback function when a section is selected */
	onSelectSection: (sectionId: string) => void;
	/** List of available settings sections */
	sections: SettingsSection[];
};

const SidebarContainer = styled(Paper)(() => ({
	width: "100%",
	height: "100%",
	borderRadius: 8,
	backgroundColor: "background.paper",
	boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
}));

const SidebarHeader = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	borderBottom: "1px solid rgba(255,255,255,0.08)",
}));

const SidebarTitle = styled(Typography)({
	fontWeight: 600,
	fontSize: "1rem",
});

const SidebarList = styled(List)({
	padding: "8px",
	flexGrow: 1,
});

const SidebarItemButton = styled(ListItemButton, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive: boolean }>(({ theme, isActive }) => ({
	borderRadius: 8,
	marginBottom: 4,
	paddingTop: 10,
	paddingBottom: 10,
	color: isActive ? theme.palette.primary.main : "rgba(255,255,255,0.85)",
	backgroundColor: isActive ? `${theme.palette.primary.main}15` : "transparent",
	transition: "all 0.2s ease-out",
	position: "relative",
	overflow: "hidden",
	"&:hover": {
		backgroundColor: isActive
			? `${theme.palette.primary.main}20`
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
			backgroundColor: theme.palette.primary.main,
			borderRadius: "0 4px 4px 0",
		},
	}),
}));

const SidebarItemIcon = styled(ListItemIcon, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive: boolean }>(({ theme, isActive }) => ({
	minWidth: 40,
	color: isActive ? theme.palette.primary.main : "inherit",
	transition: "transform 0.2s ease, color 0.2s ease",
	...(isActive && {
		transform: "scale(1.1)",
	}),
}));

/**
 * SettingsSidebar component
 *
 * Displays a sidebar with navigation for different settings sections
 */
export const SettingsSidebar: FC<SettingsSidebarProps> = ({
	activeSection,
	onSelectSection,
	sections,
}) => {
	return (
		<SidebarContainer elevation={0}>
			<SidebarHeader>
				<SidebarTitle variant="subtitle1">Settings Navigation</SidebarTitle>
			</SidebarHeader>

			<SidebarList>
				{sections.map((section) => (
					<SidebarItemButton
						key={section.id}
						isActive={activeSection === section.id}
						onClick={() => onSelectSection(section.id)}
					>
						<SidebarItemIcon isActive={activeSection === section.id}>
							<FontAwesomeIcon icon={section.icon} fixedWidth />
						</SidebarItemIcon>
						<ListItemText
							primary={section.label}
							primaryTypographyProps={{
								fontWeight: activeSection === section.id ? 600 : 500,
								fontSize: "0.95rem",
							}}
						/>
					</SidebarItemButton>
				))}
			</SidebarList>
		</SidebarContainer>
	);
};

/**
 * Default settings sections
 */
export const DEFAULT_SETTINGS_SECTIONS: SettingsSection[] = [
	{
		id: "general",
		label: "General Settings",
		icon: faGear,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: faAdjust,
	},
	{
		id: "credentials",
		label: "API Credentials",
		icon: faKey,
	},
	{
		id: "updates",
		label: "Application Updates",
		icon: faDownload,
	},
	// Future sections can be added here
	// {
	//   id: 'security',
	//   label: 'Security & Privacy',
	//   icon: faShield
	// },
	// {
	//   id: 'data',
	//   label: 'Data Management',
	//   icon: faDatabase
	// },
	// {
	//   id: 'network',
	//   label: 'Network Settings',
	//   icon: faGlobe
	// },
	// {
	//   id: 'integrations',
	//   label: 'Integrations',
	//   icon: faPlug
	// }
];
