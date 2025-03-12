/**
 * Styled components for the onboarding experience
 *
 * Uses a sleek and modern design with background blur effects
 * and styling consistent with the application's design system.
 */

import {
	Box,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Paper,
	Typography,
	alpha,
	styled,
} from "@mui/material";

/**
 * Main onboarding dialog container
 */
export const OnboardingDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiBackdrop-root": {
		backdropFilter: "blur(8px)",
		backgroundColor: alpha(theme.palette.background.default, 0.7),
	},
	"& .MuiDialog-paper": {
		borderRadius: 8,
		maxWidth: 700,
		width: "100%",
		backgroundColor: alpha(theme.palette.background.paper, 0.9),
		boxShadow: `0 10px 40px ${alpha(theme.palette.common.black, 0.4)}`,
		border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	},
}));

/**
 * Onboarding dialog title
 */
export const OnboardingTitle = styled(DialogTitle)(({ theme }) => ({
	padding: "20px 24px 12px 24px",
	fontSize: "1.25rem",
	fontWeight: 600,
	textAlign: "center",
	borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	backgroundColor: theme.palette.background.default,
}));

/**
 * Onboarding dialog content
 */
export const OnboardingContent = styled(DialogContent)(({ theme }) => ({
	padding: "16px 24px",
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(3),
	backgroundColor: theme.palette.background.default,
}));

/**
 * Onboarding dialog actions
 */
export const OnboardingActions = styled(DialogActions)(({ theme }) => ({
	padding: "12px 24px 20px 24px",
	justifyContent: "space-between",
	gap: 12,
	borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	backgroundColor: theme.palette.background.default,
}));

/**
 * Primary action button
 */
export const PrimaryButton = styled(Button)(({ theme }) => ({
	borderRadius: 6,
	padding: "8px 20px",
	fontWeight: 500,
	textTransform: "none",
	minWidth: 100,
	backgroundColor: theme.palette.primary.main,
	color: theme.palette.primary.contrastText,
	"&:hover": {
		backgroundColor: theme.palette.primary.dark,
		boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.4)}`,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Secondary action button
 */
export const SecondaryButton = styled(Button)(({ theme }) => ({
	borderRadius: 6,
	padding: "8px 20px",
	fontWeight: 500,
	textTransform: "none",
	minWidth: 100,
	borderColor: alpha(theme.palette.divider, 0.5),
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.1),
		color: theme.palette.text.primary,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Skip button
 */
export const SkipButton = styled(Button)(({ theme }) => ({
	color: theme.palette.text.secondary,
	textTransform: "none",
	"&:hover": {
		backgroundColor: "transparent",
		textDecoration: "underline",
	},
}));

/**
 * Step indicator container
 */
export const StepIndicatorContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	gap: theme.spacing(1),
	marginBottom: theme.spacing(2),
}));

/**
 * Step indicator dot
 */
export const StepDot = styled(Box, {
	shouldForwardProp: (prop) => prop !== "active",
})<{ active?: boolean }>(({ theme, active }) => ({
	width: 8,
	height: 8,
	borderRadius: "50%",
	backgroundColor: active
		? theme.palette.primary.main
		: alpha(theme.palette.primary.main, 0.3),
	transition: "all 0.2s ease-in-out",
}));

/**
 * Section container
 */
export const SectionContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(3),
	borderRadius: 8,
	boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, 0.08)}`,
	border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	backgroundColor: alpha(theme.palette.background.paper, 0.8),
}));

/**
 * Section title
 */
export const SectionTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.1rem",
	fontWeight: 600,
	marginBottom: theme.spacing(1),
	color: theme.palette.text.primary,
}));

/**
 * Section description
 */
export const SectionDescription = styled(Typography)(({ theme }) => ({
	fontSize: "0.9rem",
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(2),
}));

/**
 * Form container
 */
export const FormContainer = styled(Box)({
	display: "flex",
	flexDirection: "column",
	gap: 20,
});

/**
 * Link text
 */
export const LinkText = styled(Typography)(({ theme }) => ({
	fontSize: "0.9rem",
	color: theme.palette.primary.main,
	cursor: "pointer",
	"&:hover": {
		textDecoration: "underline",
	},
}));

/**
 * Congratulations container
 */
export const CongratulationsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	textAlign: "center",
	padding: theme.spacing(4, 2),
}));

/**
 * Congratulations icon
 */
export const CongratulationsIcon = styled(Box)(({ theme }) => ({
	fontSize: "3rem",
	color: theme.palette.success.main,
	marginBottom: theme.spacing(2),
}));

/**
 * Congratulations title
 */
export const CongratulationsTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.5rem",
	fontWeight: 600,
	marginBottom: theme.spacing(1),
	color: theme.palette.text.primary,
}));

/**
 * Congratulations message
 */
export const CongratulationsMessage = styled(Typography)(({ theme }) => ({
	fontSize: "1rem",
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(3),
	maxWidth: 500,
}));
