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
	DialogTitle,
	alpha,
	styled,
	useTheme,
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

/**
 * Styled root dialog container.
 * Uses a standard backdrop and centers the content container.
 */
const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiBackdrop-root": {
		background:
			"linear-gradient(135deg, rgba(40,40,40,1), rgba(15,15,15,0.95), rgba(5,5,5,1), rgba(56,201,106,0.15))",
		opacity: 1.0,
	},
	"& .MuiDialog-container": {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		padding: theme.spacing(2),
	},
	"& .MuiPaper-root": {
		backgroundColor: "transparent",
		boxShadow: "none",
		overflow: "visible",
		margin: 0,
		maxWidth: "none",
		maxHeight: "none",
		width: "auto",
		height: "auto",
	},
}));

/**
 * The main content area styled like a shadcn card/dialog.
 * Constrains width/height, adds background, border-radius, padding, etc.
 */
const ContentContainer = styled(Box)(({ theme }) => ({
	width: "100%",
	height: "100%",
	maxWidth: "650px",
	maxHeight: "calc(100vh - 64px)",
	boxSizing: "border-box",
	display: "flex",
	flexDirection: "column",
	backgroundColor: theme.palette.background.paper,
	borderRadius: theme.shape.borderRadius * 1.5,
	border: `1px solid ${theme.palette.divider}`,
	boxShadow: theme.shadows[4],
	overflow: "hidden",
	padding: 0,
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
	padding: theme.spacing(2, 3),
	color: theme.palette.text.primary,
	fontSize: "1.25rem",
	fontWeight: 600,
	borderBottom: `1px solid ${theme.palette.divider}`,
	marginBottom: theme.spacing(1),
	flexShrink: 0,
}));

/**
 * Styled actions area with padding and border.
 */
const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
	padding: theme.spacing(2, 3),
	borderTop: `1px solid ${theme.palette.divider}`,
	backgroundColor: alpha(theme.palette.background.default, 0.5),
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	width: "100%",
	boxSizing: "border-box",
	flexShrink: 0,
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
	stepIndicators,
	children,
	actions,
	dialogProps = {},
}: OnboardingDialogProps): ReactNode => {
	const theme = useTheme();

	return (
		<StyledDialog
			open={open}
			onClose={() => {}}
			disableEscapeKeyDown
			{...dialogProps}
		>
			<ContentContainer>
				{title && <StyledDialogTitle>{title}</StyledDialogTitle>}
				{stepIndicators && (
					<Box sx={{ px: 3, pt: 0, pb: 0, mb: 0 }}>{stepIndicators}</Box>
				)}
				<Box
					sx={{
						padding: theme.spacing(0, 3, 1),
						flexGrow: 1,
						overflowY: "auto",
						"&::-webkit-scrollbar": {
							width: "8px",
							height: "8px",
						},
						"&::-webkit-scrollbar-track": {
							backgroundColor: "transparent",
						},
						"&::-webkit-scrollbar-thumb": {
							backgroundColor: alpha(theme.palette.text.primary, 0.2),
							borderRadius: "4px",
							border: "2px solid transparent",
							backgroundClip: "padding-box",
							"&:hover": {
								backgroundColor: alpha(theme.palette.text.primary, 0.3),
							},
						},
					}}
				>
					{children}
				</Box>
				{actions && <StyledDialogActions>{actions}</StyledDialogActions>}
			</ContentContainer>
		</StyledDialog>
	);
};
