import {
	Box,
	Button,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	Typography,
	alpha,
	styled,
} from "@mui/material";
import type { FC, ReactNode } from "react";

/**
 * Props for the BaseDialog component
 */
export type BaseDialogProps = {
	/**
	 * Whether the dialog is open
	 */
	open: boolean;
	/**
	 * Callback when the dialog is closed
	 */
	onClose: () => void;
	/**
	 * Title of the dialog
	 */
	title: ReactNode;
	/**
	 * Content of the dialog
	 */
	children: ReactNode;
	/**
	 * Actions to display at the bottom of the dialog
	 * If not provided, no actions will be displayed
	 */
	actions?: ReactNode;
	/**
	 * Maximum width of the dialog
	 * @default "sm"
	 */
	maxWidth?: "xs" | "sm" | "md" | "lg" | "xl" | false;
	/**
	 * Whether the dialog should take up the full width
	 * @default false
	 */
	fullWidth?: boolean;
	/**
	 * Additional props to pass to the Dialog component
	 */
	dialogProps?: Record<string, unknown>;
	/**
	 * Data tour tag for the dialog
	 */
	dataTourTag?: string;
};
/**
 * Styled Dialog component with consistent styling
 */
export const StyledDialog = styled(Dialog)(({ theme }) => ({
	"& .MuiBackdrop-root": {
		backdropFilter: "blur(8px)",
		backgroundColor: alpha(theme.palette.background.default, 0.7),
	},
	"& .MuiPaper-root": {
		borderRadius: 8,
		backgroundColor: alpha(theme.palette.background.paper, 0.9),
		boxShadow: `0 10px 40px ${alpha(theme.palette.common.black, 0.4)}`,
		border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
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
	"& .MuiDialogTitle-root": {
		padding: "20px 24px 12px 24px",
		borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
		backgroundColor: theme.palette.background.default,
	},
	"& .MuiDialogContent-root": {
		padding: "16px 24px",
		backgroundColor: theme.palette.background.default,
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
	"& .MuiDialogActions-root": {
		backgroundColor: theme.palette.background.default,
	},
}));

/**
 * Styled DialogActions component with consistent padding
 */
export const StyledDialogActions = styled(DialogActions)(({ theme }) => ({
	padding: "12px 24px 20px 24px",
	gap: 12,
	borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
}));

/**
 * Styled Button component for dialog actions
 */
export const DialogButton = styled(Button)(() => ({
	borderRadius: 6,
	textTransform: "none",
	fontWeight: 500,
	padding: "8px 20px",
	minWidth: 100,
}));

/**
 * Title container with icon support
 */
export const TitleContainer = styled(Box)({
	display: "flex",
	alignItems: "center",
	gap: 12,
});

/**
 * Base dialog component with consistent styling
 *
 * This component provides a foundation for all dialogs in the application
 * to ensure a consistent look and feel.
 */
export const BaseDialog: FC<BaseDialogProps> = ({
	open,
	onClose,
	title,
	children,
	actions,
	maxWidth = "sm",
	fullWidth = false,
	dialogProps = {},
	dataTourTag,
}) => {
	return (
		<StyledDialog
			open={open}
			onClose={onClose}
			maxWidth={maxWidth}
			fullWidth={fullWidth}
			{...dialogProps}
		>
			<DialogTitle>
				{typeof title === "string" ? (
					<Typography variant="h6" fontWeight={600}>
						{title}
					</Typography>
				) : (
					title
				)}
			</DialogTitle>
			<DialogContent data-tour-tag={dataTourTag}>{children}</DialogContent>
			{actions && <StyledDialogActions>{actions}</StyledDialogActions>}
		</StyledDialog>
	);
};

/**
 * Primary action button for dialogs
 */
export const PrimaryButton = styled(DialogButton)(({ theme }) => ({
	backgroundColor: theme.palette.primary.main,
	color: theme.palette.primary.contrastText,
	"&:hover": {
		backgroundColor: theme.palette.primary.dark,
		boxShadow: `0 4px 12px ${alpha(theme.palette.primary.main, 0.4)}`,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Secondary action button for dialogs
 */
export const SecondaryButton = styled(DialogButton)(({ theme }) => ({
	borderColor: alpha(theme.palette.divider, 0.5),
	color: theme.palette.text.secondary,
	"&:hover": {
		backgroundColor: alpha(theme.palette.action.hover, 0.1),
		color: theme.palette.text.primary,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Danger action button for dialogs
 */
export const DangerButton = styled(DialogButton)(({ theme }) => ({
	backgroundColor: theme.palette.error.main,
	color: theme.palette.error.contrastText,
	"&:hover": {
		backgroundColor: theme.palette.error.dark,
		boxShadow: `0 4px 12px ${alpha(theme.palette.error.main, 0.4)}`,
	},
	transition: "all 0.2s ease-in-out",
}));

/**
 * Form container for dialog forms
 */
export const FormContainer = styled(Box)({
	display: "flex",
	flexDirection: "column",
	gap: 20,
});
