/**
 * OnboardingDialog Component
 *
 * A modern, optimized full-screen dialog specifically designed for the onboarding flow.
 * Provides a polished, immersive experience distinct from generic dialogs.
 * Theme-aware, responsive, and streamlined for multi-step onboarding.
 */

import {
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	alpha,
	styled,
} from "@mui/material";
import type { ReactNode } from "react";
import React from "react";

/**
 * Props for the OnboardingDialog component
 */
export type OnboardingDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Dialog title content (can be string or JSX)
	 */
	title?: ReactNode;
	/**
	 * Dialog main content
	 */
	children: ReactNode;
	/**
	 * Dialog action buttons (e.g., next, back)
	 */
	actions?: ReactNode;
	/**
	 * Optional additional props to pass to MUI Dialog
	 */
	dialogProps?: Record<string, unknown>;
};

/**
 * Styled root dialog with onboarding-specific full-screen styles
 */
const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiBackdrop-root": {
		// Apply gradient to the backdrop for full screen effect
		background:
			"linear-gradient(135deg, rgba(30,30,30,1), rgba(15,15,15,0.95), rgba(5,5,5,1), rgba(56,201,106,0.1))",
		opacity: 1.0,
	},
	"& .MuiPaper-root": {
		margin: 0,
		width: "100%",
		height: "100%",
		display: "flex",
		flexDirection: "column",
		justifyContent: "center",
		alignItems: "center",
		backgroundColor: "transparent",
		backgroundImage: "none",
		boxShadow: "none",
		overflow: "hidden",
		[theme.breakpoints.down("sm")]: {
			padding: theme.spacing(3, 2, 2),
		},
		[theme.breakpoints.up("xs")]: {
			minWidth: "300px",
		},
		[theme.breakpoints.up("sm")]: {
			minWidth: "400px",
		},
		[theme.breakpoints.up("md")]: {
			minWidth: "500px",
		},
	},
	"& .MuiDialogContent-root": {
		// Remove explicit background to let parent gradient show through
		"&:first-of-type": {
			paddingTop: 16,
		},
		overflow: "auto",
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
	},
}));

/**
 * Container to constrain content width and provide responsive centering
 */
const ContentContainer = styled("div")(() => ({
	width: "100%",
	height: "100%",
	maxWidth: "780px",
	maxHeight: "680px",
	boxSizing: "border-box",
	display: "flex",
	flexDirection: "column",
	flexGrow: 1,
}));

/**
 * Styled title area
 */
const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
	margin: 0,
	paddingLeft: theme.spacing(3), // Add horizontal padding
	paddingRight: theme.spacing(3), // Add horizontal padding
	color: theme.palette.text.primary,
	// Remove explicit background
	"& .MuiTypography-root": {
		fontWeight: 400,
		fontSize: "2rem",
	},
}));

/**
 * Styled content area with responsive constraints
 */
const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
	paddingLeft: theme.spacing(3), // Add horizontal padding
	paddingRight: theme.spacing(3), // Add horizontal padding
	flexGrow: 1,
	overflowY: "auto",
	width: "100%", // Ensure it takes full width before padding
	boxSizing: "border-box",
}));

/**
 * Styled actions area with responsive constraints
 */
const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
	paddingLeft: theme.spacing(3), // Add horizontal padding
	paddingRight: theme.spacing(3), // Add horizontal padding
	marginTop: theme.spacing(2),
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	width: "100%",
	boxSizing: "border-box",
	// Remove explicit background
}));

/**
 * OnboardingDialog component
 *
 * @param props - OnboardingDialogProps
 * @returns ReactNode
 */
export const OnboardingDialog = ({
	open,
	title,
	children,
	actions,
	dialogProps = {},
}: OnboardingDialogProps): ReactNode => {
	return (
		<StyledDialog
			open={open}
			onClose={() => {}}
			fullScreen
			disableEscapeKeyDown
			{...dialogProps}
		>
			<ContentContainer>
				{title && <StyledDialogTitle>{title}</StyledDialogTitle>}
				<StyledDialogContent>{children}</StyledDialogContent>
				{actions && <StyledDialogActions>{actions}</StyledDialogActions>}
			</ContentContainer>
		</StyledDialog>
	);
};
