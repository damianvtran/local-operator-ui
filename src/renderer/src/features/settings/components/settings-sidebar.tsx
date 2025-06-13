import radientIcon from "@assets/radient-icon-1024x1024.png";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
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
import type { LucideIcon } from "lucide-react";
import { Download, Key, Paintbrush, Puzzle, Settings } from "lucide-react";
import type { FC } from "react";

/**
 * Type definition for settings sections
 */
export type SettingsSection = {
	id: string;
	label: string;
	icon: LucideIcon | IconDefinition | string;
	isImage?: boolean;
	isFontAwesome?: boolean;
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

const SidebarContainer = styled(Paper)(({ theme }) => ({
	width: "100%",
	height: "100%",
	borderRadius: 0,
	backgroundColor: theme.palette.sidebar.background,
	boxShadow: "none",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	borderRight: `1px solid ${theme.palette.sidebar.border}`,
}));

const SidebarHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "flex-start",
	padding: theme.spacing(3, 2, 2, 2),
	borderBottom: `1px solid ${theme.palette.sidebar.border}`,
}));

const SidebarTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.125rem",
	fontWeight: 600,
	color: theme.palette.text.primary,
	letterSpacing: "-0.025em",
}));

const SidebarList = styled(List)(({ theme }) => ({
	padding: theme.spacing(2, 1),
	flexGrow: 1,
	"& > *:not(:last-child)": {
		marginBottom: theme.spacing(0.5),
	},
}));

const SectionGroup = styled(Box)(({ theme }) => ({
	marginBottom: theme.spacing(3),
	"&:last-child": {
		marginBottom: 0,
	},
}));

const SectionLabel = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	fontWeight: 600,
	color: theme.palette.text.secondary,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	padding: theme.spacing(0, 1.5, 1, 1.5),
	marginBottom: theme.spacing(0.5),
}));

const SidebarItemButton = styled(ListItemButton, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive: boolean }>(({ theme, isActive }) => ({
	borderRadius: 6,
	marginBottom: 4,
	padding: "4px 12px",
	minHeight: 36,
	color: isActive
		? theme.palette.sidebar.itemActiveText
		: theme.palette.sidebar.itemText,
	backgroundColor: isActive ? theme.palette.sidebar.itemActive : "transparent",
	transition: "background-color 0.2s ease-out, color 0.2s ease-out",
	"&:hover": {
		backgroundColor: isActive
			? theme.palette.sidebar.itemActiveHover
			: theme.palette.sidebar.itemHover,
	},
}));

const SidebarItemIcon = styled(ListItemIcon, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive: boolean }>(({ theme, isActive }) => ({
	minWidth: 0,
	width: 20,
	height: 20,
	marginRight: 12,
	justifyContent: "center",
	color: isActive
		? theme.palette.sidebar.itemActiveText
		: theme.palette.icon.text,
	display: "flex",
	alignItems: "center",
	transition: "color 0.2s ease",
}));

const IconImage = styled("img")(() => ({
	width: 18,
	height: 18,
	objectFit: "contain",
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
	const renderSection = (section: SettingsSection) => {
		let tourTag: string | undefined;
		switch (section.id) {
			case "general":
				tourTag = "settings-sidebar-general";
				break;
			case "radient":
				tourTag = "settings-sidebar-radient-account";
				break;
			case "integrations":
				tourTag = "settings-sidebar-integrations";
				break;
			case "appearance":
				tourTag = "settings-sidebar-appearance";
				break;
			case "credentials":
				tourTag = "settings-sidebar-api-credentials";
				break;
			case "updates":
				tourTag = "settings-sidebar-application-updates";
				break;
			default:
				tourTag = undefined;
		}

		const isActive = activeSection === section.id;

		return (
			<SidebarItemButton
				key={section.id}
				isActive={isActive}
				onClick={() => onSelectSection(section.id)}
				data-tour-tag={tourTag}
			>
				<SidebarItemIcon isActive={isActive}>
					{section.isImage ? (
						<IconImage src={section.icon as string} alt={section.label} />
					) : section.isFontAwesome ? (
						<FontAwesomeIcon
							icon={section.icon as IconDefinition}
							style={{ fontSize: 18, display: "block" }}
						/>
					) : (
						(() => {
							const IconComponent = section.icon as LucideIcon;
							return (
								<IconComponent
									size={18}
									strokeWidth={1.5}
									style={{ display: "block" }}
									aria-label={section.label}
								/>
							);
						})()
					)}
				</SidebarItemIcon>
				<ListItemText
					primary={section.label}
					primaryTypographyProps={{
						fontWeight: isActive ? 500 : 400,
						fontSize: "0.875rem",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				/>
			</SidebarItemButton>
		);
	};

	// Group sections by category for better organization
	const coreSettings = sections.filter((s) => 
		["general", "appearance"].includes(s.id)
	);
	const accountSettings = sections.filter((s) => 
		["radient", "credentials", "integrations"].includes(s.id)
	);
	const systemSettings = sections.filter((s) => 
		["updates"].includes(s.id)
	);

	return (
		<SidebarContainer elevation={0}>
			<SidebarHeader>
				<SidebarTitle>Settings</SidebarTitle>
			</SidebarHeader>

			<SidebarList>
				{/* Core Settings */}
				{coreSettings.length > 0 && (
					<SectionGroup>
						<SectionLabel>General</SectionLabel>
						{coreSettings.map(renderSection)}
					</SectionGroup>
				)}

				{/* Account Settings */}
				{accountSettings.length > 0 && (
					<SectionGroup>
						<SectionLabel>Account</SectionLabel>
						{accountSettings.map(renderSection)}
					</SectionGroup>
				)}

				{/* System Settings */}
				{systemSettings.length > 0 && (
					<SectionGroup>
						<SectionLabel>System</SectionLabel>
						{systemSettings.map(renderSection)}
					</SectionGroup>
				)}
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
		icon: Settings,
	},
	{
		id: "radient",
		label: "Radient Account",
		icon: radientIcon,
		isImage: true,
	},
	{
		id: "integrations",
		label: "Integrations",
		icon: Puzzle,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: Paintbrush,
	},
	{
		id: "credentials",
		label: "API Credentials",
		icon: Key,
	},
	{
		id: "updates",
		label: "Application Updates",
		icon: Download,
	},
];
