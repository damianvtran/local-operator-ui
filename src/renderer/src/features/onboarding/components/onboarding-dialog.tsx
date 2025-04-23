/**
 * OnboardingDialog Component
 *
 * A modern, optimized full-screen dialog specifically designed for the onboarding flow.
 * Provides a polished, immersive experience distinct from generic dialogs.
 * Theme-aware, responsive, and streamlined for multi-step onboarding.
 */

import {
	Box,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	alpha,
	styled,
} from "@mui/material";
import type { ReactNode } from "react";

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
	 * Optional step indicators (e.g., dots)
	 */
	stepIndicators?: ReactNode;
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

// --- Shadcn-inspired Dialog Styles ---

/**
 * Styled root dialog container.
 * Uses a standard backdrop and centers the content container.
 */
const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiBackdrop-root": {
		// Restore original gradient backdrop
		background:
			"linear-gradient(135deg, rgba(40,40,40,1), rgba(15,15,15,0.95), rgba(5,5,5,1), rgba(56,201,106,0.15))",
		opacity: 1.0, // Ensure full opacity for the gradient
	},
	"& .MuiDialog-container": {
		// Center the content container vertically and horizontally
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: theme.spacing(2), // Add some padding around the container
	},
	"& .MuiPaper-root": {
		// Remove default Paper styles, we style ContentContainer instead
		backgroundColor: "transparent",
		boxShadow: "none",
		overflow: "visible", // Allow ContentContainer shadow/border
		margin: 0, // Reset margin
		maxWidth: "none", // Let ContentContainer control width
		maxHeight: "none", // Let ContentContainer control height
		width: "auto", // Adjust based on ContentContainer
		height: "auto", // Adjust based on ContentContainer
	},
}));

/**
 * The main content area styled like a shadcn card/dialog.
 * Constrains width/height, adds background, border-radius, padding, etc.
 */
const ContentContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	height: "100%",
	maxWidth: "650px", // Adjusted max width for a more standard dialog feel
	maxHeight: "calc(100vh - 64px)", // Max height relative to viewport height
	boxSizing: "border-box",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper, // Use paper background
	borderRadius: theme.shape.borderRadius * 1.5, // Slightly larger radius
	border: `1px solid ${theme.palette.divider}`, // Subtle border
	boxShadow: theme.shadows[4], // Add a subtle shadow
	overflow: "hidden", // Hide overflow from the container itself
	padding: 0, // Reset padding, apply to inner elements
	// Responsive adjustments if needed
	[theme.breakpoints.down("sm")]: {
		maxWidth: "95vw",
		maxHeight: "90vh",
	},
}));

/**
 * Styled title area - consistent with shadcn headers.
 */
const StyledDialogTitle = styled(DialogTitle)(({ theme }) => ({
	margin: 0,
	padding: theme.spacing(2, 3), // Consistent padding (top/bottom, left/right)
	color: theme.palette.text.primary,
	fontSize: "1.25rem", // Smaller, standard header size
	fontWeight: 600, // Bolder
	borderBottom: `1px solid ${theme.palette.divider}`, // Separator line
	flexShrink: 0, // Prevent shrinking
}));

/**
 * Styled content area with padding and custom scrollbar.
 */
const StyledDialogContent = styled(DialogContent)(({ theme }) => ({
	padding: theme.spacing(3), // Consistent padding
	flexGrow: 1,
	overflowY: "auto", // Enable vertical scrolling
	// Custom scrollbar styles (shadcn-like)
	"&::-webkit-scrollbar": {
		width: "8px",
		height: "8px",
	},
	"&::-webkit-scrollbar-track": {
		backgroundColor: "transparent", // Track background
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: alpha(theme.palette.text.primary, 0.2), // Thumb color
		borderRadius: "4px",
		border: "2px solid transparent", // Creates padding around thumb - Fixed template literal
		backgroundClip: "padding-box",
		"&:hover": {
			backgroundColor: alpha(theme.palette.text.primary, 0.3),
		},
	},
	// Ensure first-child padding is handled correctly if needed (might not be necessary now)
	// "&:first-of-type": {
	//  paddingTop: theme.spacing(3),
	// },
}));

/**
 * Styled actions area with padding and border.
 */
const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
	padding: theme.spacing(2, 3), // Consistent padding
	borderTop: `1px solid ${theme.palette.divider}`, // Separator line
	backgroundColor: alpha(theme.palette.background.default, 0.5), // Slightly different bg
	display: "flex", // Keep flex for internal alignment if needed by parent
	justifyContent: "space-between", // Let parent control main justification
	alignItems: "center",
	width: "100%", // Take full width of the container
	boxSizing: "border-box",
	flexShrink: 0, // Prevent shrinking
}));

// --- Component Implementation ---

/**
 * OnboardingDialog component
 *
 * @param props - OnboardingDialogProps
 * @returns ReactNode
 */
export const OnboardingDialog = ({
	open,
	title,
	stepIndicators,
	children,
	actions,
	dialogProps = {},
}: OnboardingDialogProps): ReactNode => {
	return (
		<StyledDialog
			open={open}
			onClose={() => {}} // Keep onClose empty or handle appropriately
			// Remove fullScreen prop, container handles sizing
			disableEscapeKeyDown
			{...dialogProps}
			// Removed complex PaperProps merging logic.
			// StyledDialog already handles making the default Paper transparent.
		>
			<ContentContainer>
				{title && <StyledDialogTitle>{title}</StyledDialogTitle>}
				{/* Step indicators might need specific styling or placement adjustment */}
				{stepIndicators && (
					<Box sx={{ px: 3, pt: 1, pb: 0 }}>{stepIndicators}</Box>
				)}
				<StyledDialogContent>{children}</StyledDialogContent>
				{actions && <StyledDialogActions>{actions}</StyledDialogActions>}
			</ContentContainer>
		</StyledDialog>
	);
};
