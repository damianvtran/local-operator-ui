/**
 * Styled components for the Chat Options Sidebar
 */

import {
	Box,
	IconButton,
	Paper,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

export const SidebarContainer = styled(Box)(({ theme }) => ({
	width: 380,
	height: "100%",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper,
	boxShadow: "-4px 0 20px rgba(0,0,0,0.1)",
}));

export const SidebarHeader = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: theme.spacing(2, 3),
	borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
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

export const SidebarContent = styled(Box)({
	flexGrow: 1,
	overflowY: "auto",
	padding: "16px 24px",
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: "rgba(255, 255, 255, 0.1)",
		borderRadius: "4px",
	},
});

export const SectionTitle = styled(Typography)(({ theme }) => ({
	fontWeight: 600,
	marginBottom: theme.spacing(2),
	marginTop: theme.spacing(3),
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.primary,
}));

export const TitleIcon = styled(FontAwesomeIcon)({
	marginRight: 10,
	color: "#f2f2f3",
});

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
	backgroundColor: alpha(theme.palette.background.default, 0.4),
	borderRadius: theme.shape.borderRadius * 2,
}));

export const UnsetContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(2.5),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor: alpha(theme.palette.background.default, 0.7),
	transition: "all 0.2s ease",
	marginBottom: theme.spacing(2),
	display: "flex",
	flexDirection: "column",
	"&:hover": {
		backgroundColor: alpha(theme.palette.background.default, 0.9),
		boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
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
