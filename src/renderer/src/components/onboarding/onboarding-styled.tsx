/**
 * Styled components for the onboarding experience
 *
 * Uses a vibrant and engaging design with background effects, animations,
 * and styling that creates an exciting first-time user experience.
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
	keyframes,
	styled,
} from "@mui/material";

// Animation keyframes
const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const pulse = keyframes`
  0% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
  }
`;

/**
 * Main onboarding dialog container
 */
export const OnboardingDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiBackdrop-root": {
		backdropFilter: "blur(12px)",
		backgroundColor: alpha(theme.palette.background.default, 0.7),
	},
	"& .MuiDialog-paper": {
		borderRadius: 16,
		maxWidth: 700,
		width: "100%",
		backgroundColor: alpha(theme.palette.background.paper, 0.95),
		boxShadow: `0 15px 50px ${alpha(theme.palette.primary.main, 0.2)}, 0 10px 40px ${alpha(theme.palette.common.black, 0.4)}`,
		border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
		overflow: "hidden",
		animation: `${fadeIn} 0.4s ease-out`,
	},
}));

/**
 * Onboarding dialog title
 */
export const OnboardingTitle = styled(DialogTitle)(({ theme }) => ({
	padding: "24px 28px 16px 28px",
	fontSize: "1.35rem",
	fontWeight: 700,
	textAlign: "center",
	borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	background: `linear-gradient(to right, ${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.background.default, 0.8)}, ${alpha(theme.palette.primary.main, 0.05)})`,
	color: theme.palette.primary.main,
}));

/**
 * Onboarding dialog content
 */
export const OnboardingContent = styled(DialogContent)(({ theme }) => ({
	padding: "20px 28px",
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(3),
	backgroundColor: theme.palette.background.default,
	animation: `${fadeIn} 0.5s ease-out`,
}));

/**
 * Onboarding dialog actions
 */
export const OnboardingActions = styled(DialogActions)(({ theme }) => ({
	padding: "16px 28px 24px 28px",
	justifyContent: "space-between",
	gap: 16,
	borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
	background: `linear-gradient(to right, ${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.background.default, 0.8)}, ${alpha(theme.palette.primary.main, 0.05)})`,
}));

/**
 * Primary action button
 */
export const PrimaryButton = styled(Button)(({ theme }) => ({
	borderRadius: 8,
	padding: "10px 24px",
	fontWeight: 600,
	textTransform: "none",
	minWidth: 120,
	backgroundColor: theme.palette.primary.main,
	color: theme.palette.primary.contrastText,
	"&:hover": {
		backgroundColor: theme.palette.primary.dark,
		boxShadow: `0 6px 16px ${alpha(theme.palette.primary.main, 0.5)}`,
		transform: "translateY(-2px)",
	},
	"&:active": {
		transform: "translateY(0)",
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Secondary action button
 */
export const SecondaryButton = styled(Button)(({ theme }) => ({
	borderRadius: 8,
	padding: "10px 24px",
	fontWeight: 500,
	textTransform: "none",
	minWidth: 120,
	borderColor: alpha(theme.palette.divider, 0.5),
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.1),
		color: theme.palette.text.primary,
		borderColor: theme.palette.primary.light,
		boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.08)}`,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Skip button
 */
export const SkipButton = styled(Button)(({ theme }) => ({
	color: theme.palette.text.secondary,
	textTransform: "none",
	fontWeight: 500,
	"&:hover": {
		backgroundColor: "transparent",
		textDecoration: "underline",
		color: theme.palette.primary.light,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Step indicator container
 */
export const StepIndicatorContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	gap: theme.spacing(1.5),
	marginBottom: theme.spacing(3),
	padding: theme.spacing(1, 0),
}));

/**
 * Step indicator dot
 */
export const StepDot = styled(Box, {
	shouldForwardProp: (prop) => prop !== "active",
})<{ active?: boolean }>(({ theme, active }) => ({
	width: active ? 12 : 10,
	height: active ? 12 : 10,
	borderRadius: "50%",
	backgroundColor: active
		? theme.palette.primary.main
		: alpha(theme.palette.primary.main, 0.25),
	boxShadow: active
		? `0 0 10px ${alpha(theme.palette.primary.main, 0.5)}`
		: "none",
	transition: "all 0.3s ease-in-out",
	animation: active ? `${pulse} 2s infinite ease-in-out` : "none",
}));

/**
 * Section container
 */
export const SectionContainer = styled(Paper)(({ theme }) => ({
	padding: theme.spacing(3.5),
	borderRadius: 12,
	boxShadow: `0 4px 20px ${alpha(theme.palette.common.black, 0.08)}`,
	border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
	background: `linear-gradient(135deg, ${alpha(theme.palette.background.paper, 0.95)} 0%, ${alpha(theme.palette.background.paper, 0.85)} 100%)`,
	animation: `${fadeIn} 0.5s ease-out`,
	transition: "transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out",
	"&:hover": {
		boxShadow: `0 6px 25px ${alpha(theme.palette.primary.main, 0.15)}`,
		transform: "translateY(-2px)",
	},
}));

/**
 * Section title
 */
export const SectionTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 700,
	marginBottom: theme.spacing(1.5),
	color: theme.palette.primary.main,
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1),
}));

/**
 * Section description
 */
export const SectionDescription = styled(Typography)(({ theme }) => ({
	fontSize: "1rem",
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(2.5),
	lineHeight: 1.6,
}));

/**
 * Form container
 */
export const FormContainer = styled(Box)(() => ({
	display: "flex",
	flexDirection: "column",
	gap: 24,
	"& .MuiTextField-root": {
		transition: "transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out",
		"&:focus-within": {
			transform: "translateY(-2px)",
		},
	},
}));

/**
 * Link text
 */
export const LinkText = styled(Typography)(({ theme }) => ({
	fontSize: "0.95rem",
	color: theme.palette.primary.main,
	cursor: "pointer",
	fontWeight: 500,
	display: "inline-flex",
	alignItems: "center",
	gap: theme.spacing(0.5),
	"&:hover": {
		textDecoration: "underline",
		color: theme.palette.primary.dark,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Congratulations container
 */
export const CongratulationsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	textAlign: "center",
	padding: theme.spacing(5, 3),
	animation: `${fadeIn} 0.6s ease-out`,
}));

/**
 * Congratulations icon
 */
export const CongratulationsIcon = styled(Box)(({ theme }) => ({
	fontSize: "4rem",
	color: theme.palette.success.main,
	marginBottom: theme.spacing(3),
	animation: `${pulse} 2s infinite ease-in-out`,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	background: `radial-gradient(circle, ${alpha(theme.palette.success.main, 0.15)} 0%, transparent 70%)`,
	borderRadius: "50%",
	padding: theme.spacing(2),
}));

/**
 * Congratulations title
 */
export const CongratulationsTitle = styled(Typography)(({ theme }) => ({
	fontSize: "2rem",
	fontWeight: 700,
	marginBottom: theme.spacing(2),
	color: theme.palette.primary.main,
	background: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.success.main} 100%)`,
	WebkitBackgroundClip: "text",
	WebkitTextFillColor: "transparent",
}));

/**
 * Congratulations message
 */
export const CongratulationsMessage = styled(Typography)(({ theme }) => ({
	fontSize: "1.1rem",
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(4),
	maxWidth: 550,
	lineHeight: 1.6,
}));

/**
 * Emoji container for consistent styling of emojis
 */
export const EmojiContainer = styled(Box)(({ theme }) => ({
	display: "inline-flex",
	marginRight: theme.spacing(1),
	fontSize: "1em",
}));
