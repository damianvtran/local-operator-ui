/**
 * Styled components for the onboarding experience
 *
 * Uses a modern, clean design inspired by shadcn/ui principles,
 * focusing on clarity, spacing, and theme awareness.
 */

import {
	Box,
	Button,
	type Theme,
	Typography,
	alpha,
	keyframes,
	styled,
} from "@mui/material";

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

/**
 * Primary action button (shadcn-inspired)
 */
export const PrimaryButton = styled(Button)(({ theme }) => ({
	borderRadius: theme.shape.borderRadius * 0.75,
	padding: theme.spacing(0.75, 2),
	fontWeight: 500,
	fontSize: "0.875rem",
	textTransform: "none",
	minWidth: 100,
	backgroundColor: theme.palette.primary.main,
	color: theme.palette.primary.contrastText,
	boxShadow: "none",
	border: `1px solid ${theme.palette.primary.main}`,
	"&:hover": {
		backgroundColor: alpha(theme.palette.primary.main, 0.9),
		boxShadow: "none",
	},
	"&:active": {
		boxShadow: "none",
	},
	"&:disabled": {
		backgroundColor: alpha(theme.palette.action.disabledBackground, 0.5),
		color: theme.palette.action.disabled,
		borderColor: theme.palette.divider,
	},
	transition:
		"background-color 0.2s ease-in-out, border-color 0.2s ease-in-out",
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
	borderColor: theme.palette.divider,
	color: theme.palette.text.primary,
	backgroundColor: theme.palette.background.paper,
	boxShadow: "none",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
		borderColor: theme.palette.divider,
		boxShadow: "none",
	},
	"&:disabled": {
		borderColor: theme.palette.divider,
		color: theme.palette.action.disabled,
	},
	transition:
		"background-color 0.2s ease-in-out, border-color 0.2s ease-in-out",
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
	minWidth: "auto",
	boxShadow: "none",
	border: "1px solid transparent",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
		color: theme.palette.text.primary,
		textDecoration: "none",
	},
	transition: "background-color 0.2s ease-in-out, color 0.2s ease-in-out",
}));

/**
 * Step indicator container
 */
export const StepIndicatorContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	justifyContent: "center",
	gap: theme.spacing(1),
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
	const size = 8;

	let backgroundColor = theme.palette.action.disabledBackground;
	let opacity = 0.6;

	if (active) {
		backgroundColor = theme.palette.primary.main;
		opacity = 1;
	} else if (visited) {
		backgroundColor = theme.palette.primary.main;
		opacity = 0.8;
	}

	return {
		width: size,
		height: size,
		borderRadius: "50%",
		backgroundColor,
		opacity,
		transition: "all 0.3s ease-in-out",
		cursor: visited && !active ? "pointer" : "default",
	};
});

/**
 * Section container with subtle animation
 */
export const SectionContainer = styled("div")({
	animation: `${fadeIn} 0.4s ease-out`,
	padding: "4px 0",
});

/**
 * Section title (aligned with SettingsSectionCard title style)
 */
export const SectionTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.125rem",
	fontWeight: 500,
	marginBottom: theme.spacing(1),
	color: theme.palette.text.primary,
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
 * Rendered as a 'label' for semantic correctness and to avoid nesting issues.
 */
export const FieldLabel = styled("label")(({ theme }) => ({
	...theme.typography.body2,
	marginBottom: 6,
	display: "flex",
	alignItems: "center",
	fontSize: "0.875rem",
	fontWeight: 500,
	color: theme.palette.text.secondary,
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
	fontSize: "0.875rem", // Consistent body text size (shadcn)
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

/**
 * Reusable styles for Select dropdown menu items (shadcn-inspired)
 * @param theme - The MUI theme object
 */
export const menuItemSx = (theme: Theme) => ({
	fontSize: "0.875rem",
	padding: theme.spacing(1, 1.5),
	borderRadius: theme.shape.borderRadius * 0.75,
	margin: theme.spacing(0.5, 1),
	minHeight: "auto",
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.08),
	},
	"&.Mui-selected": {
		backgroundColor: alpha(theme.palette.primary.main, 0.1),
		fontWeight: 500,
		"&:hover": {
			backgroundColor: alpha(theme.palette.primary.main, 0.15),
		},
	},
});

/**
 * Reusable MenuProps for Select dropdowns (shadcn-inspired)
 * Applies styles to the dropdown paper and uses menuItemSx for items.
 * @param theme - The MUI theme object
 */
export const menuPropsSx = (theme: Theme) => ({
	PaperProps: {
		sx: {
			mt: 0.5,
			borderRadius: theme.shape.borderRadius * 0.75,
			border: `1px solid ${theme.palette.divider}`,
			boxShadow:
				"0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
			backgroundColor: theme.palette.background.paper,
			"& .MuiMenuItem-root": menuItemSx(theme),
		},
	},
});
