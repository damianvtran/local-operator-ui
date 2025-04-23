/**
 * Styled components for the onboarding experience
 *
 * Uses a modern, clean design inspired by shadcn/ui principles,
 * focusing on clarity, spacing, and theme awareness.
 */

import {
	Box,
	Button,
	Typography,
	alpha,
	keyframes,
	styled,
} from "@mui/material";

// --- Keyframes ---
// Subtle fade-in animation
const fadeIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px); // Slightly less movement
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

// --- Buttons ---

/**
 * Primary action button (shadcn-inspired)
 */
export const PrimaryButton = styled(Button)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 0.75, // Consistent radius
	padding: theme.spacing(0.75, 2), // Adjusted padding
	fontWeight: 500,
	fontSize: "0.875rem", // Consistent font size
	textTransform: "none",
	minWidth: 100, // Adjusted min-width
	backgroundColor: theme.palette.primary.main,
	color: theme.palette.primary.contrastText,
	boxShadow: "none", // Remove default shadow
	border: `1px solid ${theme.palette.primary.main}`, // Ensure border for consistency
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.9), // Slightly darken on hover
		boxShadow: "none",
		// Remove transform for flatter design
	},
	"&:active": {
		// Remove transform
	},
	"&:disabled": {
		backgroundColor: alpha(theme.palette.action.disabledBackground, 0.5),
		color: theme.palette.action.disabled,
		borderColor: theme.palette.divider,
	},
	transition: "background-color 0.2s ease-in-out, border-color 0.2s ease-in-out", // Simplified transition
}));

/**
 * Secondary action button (shadcn-inspired outline)
 */
export const SecondaryButton = styled(Button)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 0.75,
	padding: theme.spacing(0.75, 2),
	fontWeight: 500,
	fontSize: "0.875rem",
	textTransform: "none",
	minWidth: 100,
	borderColor: theme.palette.divider, // Use divider color for border
	color: theme.palette.text.primary, // Use primary text color
	backgroundColor: theme.palette.background.paper, // Use paper background
	boxShadow: "none",
	"&:hover": {
		backgroundColor: theme.palette.action.hover, // Subtle hover background
		borderColor: theme.palette.divider, // Keep border color consistent
		boxShadow: "none",
	},
	"&:disabled": {
		borderColor: theme.palette.divider,
		color: theme.palette.action.disabled,
	},
	transition: "background-color 0.2s ease-in-out, border-color 0.2s ease-in-out",
}));

/**
 * Skip button (shadcn-inspired ghost/link style)
 */
export const SkipButton = styled(Button)(({ theme }) => ({
	color: theme.palette.text.secondary,
	backgroundColor: "transparent",
	textTransform: "none",
	fontWeight: 500,
	fontSize: "0.875rem",
	padding: theme.spacing(0.75, 2),
	minWidth: "auto", // Allow button to shrink
	boxShadow: "none",
	border: "1px solid transparent", // Keep layout consistent
	"&:hover": {
		backgroundColor: theme.palette.action.hover, // Subtle background on hover
		color: theme.palette.text.primary,
		textDecoration: "none", // Remove underline
	},
	transition: "background-color 0.2s ease-in-out, color 0.2s ease-in-out",
}));

// --- Step Indicator ---

/**
 * Step indicator container
 */
export const StepIndicatorContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	gap: theme.spacing(1), // Reduced gap
	marginBottom: theme.spacing(3),
	padding: theme.spacing(1, 0),
}));

/**
 * Step indicator dot (simplified, shadcn-inspired)
 */
export const StepDot = styled(Box, {
	shouldForwardProp: (prop) => prop !== "active" && prop !== "visited",
})<{
	active?: boolean;
	visited?: boolean;
}>(({ theme, active, visited }) => {
	const size = 8; // Smaller, consistent size

	let backgroundColor = theme.palette.action.disabledBackground; // Default inactive color
	let opacity = 0.6; // Default opacity for inactive/unvisited

	if (active) {
		backgroundColor = theme.palette.primary.main;
		opacity = 1;
	} else if (visited) {
		backgroundColor = theme.palette.primary.main; // Visited but not active
		opacity = 0.8; // Slightly less prominent than active
	}

	return {
		width: size,
		height: size,
		borderRadius: "50%",
		backgroundColor,
		opacity,
		transition: "all 0.3s ease-in-out",
		cursor: visited && !active ? "pointer" : "default", // Allow clicking visited (but not active) dots
		// Removed pulse animation and shadow for cleaner look
	};
});

// --- Content Sections ---

/**
 * Section container with subtle animation
 */
export const SectionContainer = styled("div")({
	animation: `${fadeIn} 0.4s ease-out`, // Slightly faster animation
	padding: "4px 0", // Add small padding to prevent content shift during animation
});

/**
 * Section title (aligned with SettingsSectionCard title style)
 */
export const SectionTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.125rem", // ~18px, consistent with h6 or slightly larger
	fontWeight: 500,
	marginBottom: theme.spacing(1), // Reduced margin
	color: theme.palette.text.primary, // Use primary text color
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1),
}));

/**
 * Section description (aligned with SettingsSectionCard description style)
 */
export const SectionDescription = styled(Box)(({ theme }) => ({
	fontSize: "0.875rem", // ~14px
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(3), // Consistent margin
	lineHeight: 1.5,
}));

/**
 * Field Label (matches editable-field.tsx)
 */
export const FieldLabel = styled(Typography)(({ theme }) => ({
	marginBottom: 6,
	display: "flex",
	alignItems: "center",
	color: theme.palette.text.secondary,
	fontWeight: 500,
	fontSize: "0.875rem",
}));

/**
 * Label Icon Container (matches editable-field.tsx)
 */
export const LabelIcon = styled(Box)({
	marginRight: 8,
	opacity: 0.9,
	display: "flex",
	alignItems: "center",
});


/**
 * Form container
 */
export const FormContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	gap: theme.spacing(2.5), // Consistent gap
	// Remove focus transform for flatter design
}));

/**
 * Link text (subtle link style)
 */
export const LinkText = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem", // Consistent small text size
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
	transition: "color 0.2s ease-in-out",
}));

// --- Congratulations Screen ---

/**
 * Congratulations container
 */
export const CongratulationsContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	textAlign: "center",
	padding: theme.spacing(4, 2), // Adjusted padding
	animation: `${fadeIn} 0.5s ease-out`,
}));

/**
 * Congratulations icon (simplified)
 */
export const CongratulationsIcon = styled(Box)(({ theme }) => ({
	fontSize: "3rem", // Slightly smaller icon
	color: theme.palette.success.main,
	marginBottom: theme.spacing(2.5),
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	// Removed background gradient and pulse animation for cleaner look
}));

/**
 * Congratulations title (simplified)
 */
export const CongratulationsTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.75rem", // Adjusted size
	fontWeight: 600, // Slightly less bold
	marginBottom: theme.spacing(1.5),
	color: theme.palette.text.primary, // Use standard text color
	// Removed gradient text fill
}));

/**
 * Congratulations message
 */
export const CongratulationsMessage = styled(Typography)(({ theme }) => ({
	fontSize: "1rem", // Standard body text size
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(3), // Consistent margin
	maxWidth: 500, // Slightly narrower max width
	lineHeight: 1.6,
}));

/**
 * Emoji container (no changes needed, seems fine)
 */
export const EmojiContainer = styled(Box)(({ theme }) => ({
	display: "inline-flex",
	marginRight: theme.spacing(1),
	fontSize: "1em", // Inherit font size
}));
