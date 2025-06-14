import { GlobalStyles, alpha, useTheme } from "@mui/material";
import type { FC } from "react";

/**
 * Injects global styles to customize Shepherd.js tour elements
 * to match the application's Shadcn/MUI theme.
 */
export const OnboardingTourGlobalStyles: FC = () => {
	const theme = useTheme();

	const styles = {
		// General modal style
		".shepherd-element": {
			backgroundColor: alpha(theme.palette.background.paper, 0.95),
			borderRadius: "6px", // Reduced border radius
			boxShadow: `0 8px 30px ${alpha(theme.palette.common.black, 0.35)}`, // Slightly adjusted shadow
			border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
			maxWidth: "500px",
			maxHeight: "95vh",
			overflowY: "auto",
			"&.shepherd-has-title .shepherd-content .shepherd-header": {
				borderTopLeftRadius: "6px", // Adjusted
				borderTopRightRadius: "6px", // Adjusted
			},
			".shepherd-content": {
				// Ensure content respects border radius
				borderRadius: "6px", // Adjusted
			},
		},
		".shepherd-arrow::before": {
			backgroundColor: alpha(theme.palette.background.paper, 0.95),
			border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
		},

		// Header
		".shepherd-header": {
			backgroundColor: `${alpha(theme.palette.background.paper, 0.95)} !important`, // Same as modal body
			padding: "2px 16px", // Reduced padding
			backgroundImage: "none",
			borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
		},
		".shepherd-title": {
			color: theme.palette.text.primary,
			fontWeight: 600,
			fontSize: "1.25rem", // h5 equivalent
		},
		".shepherd-cancel-icon": {
			color: theme.palette.text.secondary,
			fontSize: "1.5rem", // Increased size for better clickability
			padding: "4px", // Add some padding around the icon
			"&:hover": {
				color: theme.palette.text.secondary,
				backgroundColor: alpha(theme.palette.action.hover, 0.1),
				borderRadius: "4px",
			},
		},

		// Content
		".shepherd-text": {
			backgroundColor: theme.palette.background.default,
			padding: "16px 20px",
			color: theme.palette.text.secondary,
			fontSize: "0.875rem", // body1 equivalent
			lineHeight: 1.5,
			"& p": {
				// Ensure paragraphs within text are styled correctly
				margin: 0,
				padding: 0,
				color: "inherit",
				fontSize: "inherit",
				lineHeight: "inherit",
			},
		},

		// Footer
		".shepherd-footer": {
			backgroundColor: alpha(theme.palette.background.paper, 0.95), // Same as modal body
			padding: "12px 16px", // Adjusted padding to match header
			borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
			borderBottomLeftRadius: "6px", // Adjusted
			borderBottomRightRadius: "6px", // Adjusted
			display: "flex",
			justifyContent: "space-between", // For Back (left) and Next/Finish (right)
			alignItems: "center",
			gap: "12px", // Consistent gap from onboarding-modal.tsx
		},

		// Buttons - general
		".shepherd-button": {
			borderRadius: "6px",
			textTransform: "none",
			fontWeight: 500,
			padding: "8px 20px", // Consistent with DialogButton
			minWidth: "100px", // Consistent with DialogButton
			transition: "all 0.2s ease-in-out",
			border: "1px solid transparent",
			fontSize: "0.875rem",
			lineHeight: "1.25rem",
			cursor: "pointer",
			"&:focus-visible": {
				outline: `2px solid ${theme.palette.primary.main}`,
				outlineOffset: "2px",
			},
		},

		// Primary button style (e.g., Next, Finish)
		".shepherd-button.shepherd-button-primary": {
			backgroundColor: theme.palette.primary.main,
			color: theme.palette.primary.contrastText,
			"&:hover": {
				backgroundColor: theme.palette.primary.dark,
				color: theme.palette.primary.contrastText,
			},
		},

		// Secondary button style (e.g., Back)
		".shepherd-button.shepherd-button-secondary": {
			borderColor: alpha(theme.palette.divider, 0.5),
			color: theme.palette.text.secondary,
			"&:hover": {
				backgroundColor: alpha(theme.palette.action.hover, 0.1),
				borderColor: theme.palette.primary.light, // Or a slightly darker divider
				color: theme.palette.primary.contrastText,
			},
		},
		// Ensure single button in footer takes full primary style if no class is set (fallback)
		// However, we will be setting classes explicitly.
		".shepherd-footer .shepherd-button:only-child:not(.shepherd-button-primary):not(.shepherd-button-secondary)":
			{
				backgroundColor: theme.palette.primary.main,
				color: theme.palette.primary.contrastText,
				"&:hover": {
					backgroundColor: theme.palette.primary.dark,
				},
			},
	};

	return <GlobalStyles styles={styles} />;
};
