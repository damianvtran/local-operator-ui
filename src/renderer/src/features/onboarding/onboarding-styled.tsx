/**
 * Styled components for the onboarding experience
 *
 * Uses a vibrant and engaging design with background effects, animations,
 * and styling that creates an exciting first-time user experience.
 */

import {
	Box,
	Button,
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
	shouldForwardProp: (prop) => prop !== "active" && prop !== "visited",
})<{
	active?: boolean;
	visited?: boolean;
}>(({ theme, active, visited }) => {
	const baseSize = 10;
	const activeSize = 12;

	let backgroundColor = alpha(theme.palette.primary.main, 0.25);
	let boxShadow = "none";
	let animationStyle = "none";

	if (active) {
		backgroundColor = theme.palette.primary.main;
		boxShadow = `0 0 10px ${alpha(theme.palette.primary.main, 0.5)}`;
		animationStyle = `${pulse} 2s infinite ease-in-out`;
	} else if (visited) {
		backgroundColor = theme.palette.primary.main;
	}

	return {
		width: active ? activeSize : baseSize,
		height: active ? activeSize : baseSize,
		borderRadius: "50%",
		backgroundColor,
		boxShadow,
		transition: "all 0.3s ease-in-out",
		animation: animationStyle,
		cursor: visited ? "pointer" : "default",
		opacity: !visited && !active ? 0.4 : 1,
	};
});

/**
 * Section container
 */
export const SectionContainer = styled("div")(() => ({
	animation: `${fadeIn} 0.5s ease-out`,
	transition: "transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out",
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
 * Using Box instead of Typography to avoid DOM nesting issues
 * when content includes other Typography or Box components
 */
export const SectionDescription = styled(Box)(({ theme }) => ({
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
export const CongratulationsTitle = styled(Box)(({ theme }) => ({
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
export const CongratulationsMessage = styled(Box)(({ theme }) => ({
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
