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

export const SidebarContent = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	overflowY: "auto",
	padding: "16px 24px",
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: alpha(
			theme.palette.mode === "dark"
				? theme.palette.common.white
				: theme.palette.common.black,
			0.1,
		),
		borderRadius: "4px",
	},
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
	borderRadius: theme.shape.borderRadius * 2,
}));

export const UnsetContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2.5),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor:
		theme.palette.mode === "light"
			? alpha(theme.palette.grey[100], 0.8)
			: alpha(theme.palette.background.default, 0.7),
	border:
		theme.palette.mode === "light"
			? `1px solid ${alpha(theme.palette.grey[300], 0.5)}`
			: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	transition: "all 0.2s ease",
	marginBottom: theme.spacing(2),
	display: "flex",
	flexDirection: "column",
	"&:hover": {
		backgroundColor:
			theme.palette.mode === "light"
				? alpha(theme.palette.grey[100], 1)
				: alpha(theme.palette.background.default, 0.9),
		boxShadow:
			theme.palette.mode === "light"
				? `0 4px 12px ${alpha(theme.palette.common.black, 0.08)}`
				: `0 4px 12px ${alpha(theme.palette.common.black, 0.2)}`,
		border:
			theme.palette.mode === "light"
				? `1px solid ${alpha(theme.palette.primary.main, 0.2)}`
				: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
	},
}));

export const LabelWrapper = styled(Box)({
	marginBottom: 8,
});

export const LabelText = styled(Typography)(({ theme }) => ({
	marginBottom: 4,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
	fontWeight: 600,
}));

export const DescriptionText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem",
	lineHeight: 1.5,
	marginBottom: theme.spacing(2),
}));
