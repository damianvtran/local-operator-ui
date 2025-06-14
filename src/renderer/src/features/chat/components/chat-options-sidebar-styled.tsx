/**
 * Styled components for the Chat Options Sidebar
 */

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	IconButton,
	Paper,
	Typography,
	alpha,
	styled,
} from "@mui/material";

export const SidebarContainer = styled(Box)(({ theme }) => ({
	width: 380,
	height: "100%",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper,
	boxShadow:
		theme.palette.mode === "light"
			? `-4px 0 20px ${alpha(theme.palette.common.black, 0.15)}`
			: `-4px 0 20px ${alpha(theme.palette.common.black, 0.2)}`,
	border:
		theme.palette.mode === "light"
			? `1px solid ${alpha(theme.palette.grey[300], 0.5)}`
			: "none",
}));

export const SidebarHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: theme.spacing(2, 3),
	borderBottom: `1px solid ${alpha(
		theme.palette.divider,
		theme.palette.mode === "light" ? 0.2 : 0.1,
	)}`,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.grey[100], 0.5)
			: "transparent",
}));

export const HeaderTitle = styled(Box)({
	display: "flex",
	flexDirection: "column",
});

export const CloseButton = styled(IconButton)(({ theme }) => ({
	color: theme.palette.text.secondary,
	width: 36,
	height: 36,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

export const SidebarContent = styled(Box)(() => ({
	flexGrow: 1,
	overflowY: "auto",
	padding: "16px 24px",
}));

export const SectionTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 600,
	marginBottom: theme.spacing(2),
	marginTop: theme.spacing(3),
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
}));

export const TitleIcon = styled(FontAwesomeIcon)(({ theme }) => ({
	marginRight: 10,
	color: theme.palette.primary.main,
	padding: theme.spacing(0.5),
	borderRadius: theme.shape.borderRadius,
	backgroundColor: alpha(theme.palette.primary.main, 0.1),
}));

export const InfoButton = styled(IconButton)(({ theme }) => ({
	marginLeft: theme.spacing(1),
	color: theme.palette.primary.main,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.08),
	},
}));

export const ModelHostingSection = styled(Box)(({ theme }) => ({
	marginBottom: theme.spacing(2),
	padding: theme.spacing(2),
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.grey[200], 0.7)
			: alpha(theme.palette.background.default, 0.4),
	border:
		theme.palette.mode === "light"
			? `1px solid ${alpha(theme.palette.grey[300], 0.5)}`
			: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	borderRadius: theme.shape.borderRadius * 1.5, // Adjusted border radius
}));

// --- Styles for UnsetSliderSetting and similar "unset" cards ---

export const UnsetContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2), // Adjusted padding
	borderRadius: theme.shape.borderRadius * 1.5, // Adjusted border radius (consistent with SliderSetting)
	backgroundColor: theme.palette.background.paper, // Use paper background
	border: `1px solid ${theme.palette.divider}`, // Use theme divider color
	transition: "border-color 0.2s ease", // Simplified transition
	marginBottom: theme.spacing(2),
	display: "flex",
	flexDirection: "column",
	// Removed hover effect for consistency
}));

export const LabelWrapper = styled(Box)(({ theme }) => ({
	marginBottom: theme.spacing(1), // Adjusted margin (consistent with SliderSetting)
}));

export const LabelText = styled(Typography)(({ theme }) => ({
	fontWeight: 500, // Slightly reduced weight (consistent with SliderSetting)
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
	marginBottom: theme.spacing(0.5), // Add small margin below label (consistent with SliderSetting)
}));

export const DescriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.8rem", // Slightly smaller description (consistent with SliderSetting)
	color: theme.palette.text.secondary, // Use secondary text color
	lineHeight: 1.4,
	marginBottom: theme.spacing(1.5), // Adjusted margin (consistent with SliderSetting)
}));
