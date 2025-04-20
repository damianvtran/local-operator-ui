import radientIcon from "@assets/radient-icon-1024x1024.png";
import {
	type IconDefinition,
	faAdjust,
	faDownload,
	faGear,
	faKey,
	type faUser,
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
	icon:
		| typeof faGear
		| typeof faKey
		| typeof faDownload
		| typeof faAdjust
		| typeof faUser
		| string;
	isImage?: boolean;
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
	backgroundColor: theme.palette.sidebar.secondaryBackground,
	boxShadow: "none",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	borderRight: `1px solid ${theme.palette.sidebar.border}`,
}));

const SidebarHeader = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3),
	borderBottom: `1px solid ${theme.palette.sidebar.border}`,
}));

const SidebarTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 600,
	fontSize: "1rem",
	color: theme.palette.text.primary,
}));

const SidebarList = styled(List)(({ theme }) => ({
	padding: theme.spacing(2),
	flexGrow: 1,
}));

const SidebarItemButton = styled(ListItemButton, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive: boolean }>(({ theme, isActive }) => ({
	borderRadius: 8,
	marginBottom: 4,
	paddingTop: 10,
	paddingBottom: 10,
	color: isActive
		? theme.palette.sidebar.itemActiveText
		: theme.palette.sidebar.itemText,
	backgroundColor: isActive ? theme.palette.sidebar.itemActive : "transparent",
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
}));

const SidebarItemIcon = styled(ListItemIcon, {
	shouldForwardProp: (prop) => prop !== "isActive",
})<{ isActive: boolean }>(({ theme, isActive }) => ({
	minWidth: 40,
	color: isActive
		? theme.palette.sidebar.itemActiveText
		: theme.palette.icon.text,
	transition: "transform 0.2s ease, color 0.2s ease",
	...(isActive && {
		transform: "scale(1.1)",
	}),
}));

const IconImage = styled("img")(() => ({
	width: 30,
	height: 30,
	marginLeft: -4,
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
							{section.isImage ? (
								<IconImage src={section.icon as string} alt={section.label} />
							) : (
								<FontAwesomeIcon
									icon={section.icon as IconDefinition}
									fixedWidth
								/>
							)}
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
		id: "radient",
		label: "Radient Account",
		icon: radientIcon,
		isImage: true,
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
];
