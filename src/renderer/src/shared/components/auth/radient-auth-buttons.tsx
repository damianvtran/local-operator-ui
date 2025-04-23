/**
 * @file radient-auth-buttons.tsx
 * @description
 * Reusable component for Radient authentication buttons.
 * Provides options for users to sign in with Google or Microsoft.
 */

import { faGoogle, faMicrosoft } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Box,
	Button,
	CircularProgress,
	Typography,
	// alpha, // No longer needed for shadow
	styled,
	useTheme, // Import useTheme
} from "@mui/material";
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
import { radientUserKeys } from "@shared/hooks/use-radient-user-query";
import { hasValidSession } from "@shared/utils/session-store";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { FC } from "react";

/**
 * Props for the RadientAuthButtons component
 */
type RadientAuthButtonsProps = {
	/**
	 * Optional callback function to be called after successful sign-in
	 */
	onSignInSuccess?: () => void;
	/**
	 * Optional title text to display above the buttons
	 */
	titleText?: string;
	/**
	 * Optional description text to display above the buttons
	 */
	descriptionText?: string;
};

// --- Styled Components (shadcn-inspired) ---

// Base button style, similar to SecondaryButton in onboarding-styled
const SignInButton = styled(Button)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center", // Center content
	padding: theme.spacing(0.75, 2), // Consistent padding
	borderRadius: theme.shape.borderRadius * 0.75, // Consistent radius
	fontSize: "0.875rem", // Standard font size
	fontWeight: 500, // Standard weight
	textTransform: "none",
	marginBottom: theme.spacing(1.5), // Reduced margin between buttons
	width: "100%",
	maxWidth: 320, // Keep max width for centering effect
	border: `1px solid ${theme.palette.divider}`, // Standard border
	backgroundColor: theme.palette.background.paper, // Standard background
	color: theme.palette.text.primary, // Standard text color
	boxShadow: "none", // Remove shadow
	transition:
		"background-color 0.2s ease-in-out, border-color 0.2s ease-in-out", // Standard transition
	"&:hover": {
		backgroundColor: theme.palette.action.hover, // Standard hover
		borderColor: theme.palette.divider, // Keep border consistent on hover
		boxShadow: "none", // Ensure no shadow on hover
		// transform: "none", // Ensure no transform
	},
	"&:disabled": {
		borderColor: theme.palette.divider,
		color: theme.palette.action.disabled,
		backgroundColor: theme.palette.action.disabledBackground,
	},
}));

// Specific button styles are now minimal, inheriting from SignInButton
const GoogleButton = styled(SignInButton)({}); // Inherits all styles

const MicrosoftButton = styled(SignInButton)({}); // Inherits all styles

const IconContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginRight: theme.spacing(1), // Reduced margin
	fontSize: "1rem", // Slightly smaller icon to fit button style
	width: 20, // Explicit width/height for alignment
	height: 20,
}));

const ButtonsContainer = styled(Box)(() => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	width: "100%",
}));

/**
 * RadientAuthButtons component
 *
 * Provides buttons for signing in with Google or Microsoft to access Radient services.
 */
export const RadientAuthButtons: FC<RadientAuthButtonsProps> = ({
	onSignInSuccess,
	titleText = "Sign in to Radient",
	descriptionText = "Choose your preferred sign-in method to access Radient services.",
}) => {
	const theme = useTheme(); // Get theme for sx props
	const { signInWithGoogle, signInWithMicrosoft, loading, error } =
		useOidcAuth();

	const queryClient = useQueryClient();

	// Check for successful sign-in
	useEffect(() => {
		const checkSignInSuccess = async () => {
			// Only proceed if not loading and no error
			if (!loading && !error) {
				// Check if we have a valid session after sign-in
				const hasSession = await hasValidSession();
				if (hasSession) {
					// Force a refetch of the user information
					await queryClient.invalidateQueries({
						queryKey: radientUserKeys.all,
					});
					await queryClient.refetchQueries({ queryKey: radientUserKeys.all });

					// Call the success callback if provided
					if (onSignInSuccess) {
						onSignInSuccess();
					}
				}
			}
		};

		checkSignInSuccess();
	}, [loading, error, onSignInSuccess, queryClient]);

	const handleGoogleSignIn = () => {
		signInWithGoogle();
	};

	const handleMicrosoftSignIn = () => {
		signInWithMicrosoft();
	};

	return (
		<Box sx={{ width: "100%", maxWidth: 320, margin: "0 auto" }}>
			{" "}
			{/* Center the whole component */}
			{/* Title - Use styles similar to SectionTitle */}
			{titleText && (
				<Typography
					// Use sx prop for finer control, aligning with SectionTitle style
					sx={{
						fontSize: "1.125rem", // ~18px
						fontWeight: 500,
						marginBottom: theme.spacing(1), // Reduced margin
						color: theme.palette.text.primary,
						textAlign: "center", // Center title
					}}
				>
					{titleText}
				</Typography>
			)}
			{/* Description - Use styles similar to SectionDescription */}
			{descriptionText && (
				<Typography
					// Use sx prop aligning with SectionDescription style
					sx={{
						fontSize: "0.875rem", // ~14px
						color: theme.palette.text.secondary,
						marginBottom: theme.spacing(3), // Consistent margin
						lineHeight: 1.5,
						textAlign: "center", // Center description
					}}
				>
					{descriptionText}
				</Typography>
			)}
			<ButtonsContainer>
				{/* Google Button */}
				<GoogleButton onClick={handleGoogleSignIn} disabled={loading}>
					<IconContainer>
						<FontAwesomeIcon icon={faGoogle} />
					</IconContainer>
					{loading ? (
						<CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> // Smaller spinner
					) : null}
					Sign in with Google
				</GoogleButton>

				{/* Microsoft Button */}
				<MicrosoftButton onClick={handleMicrosoftSignIn} disabled={loading}>
					<IconContainer>
						<FontAwesomeIcon icon={faMicrosoft} />
					</IconContainer>
					{loading ? (
						<CircularProgress size={16} sx={{ mr: 1 }} color="inherit" /> // Smaller spinner
					) : null}
					Sign in with Microsoft
				</MicrosoftButton>

				{/* Error Message */}
				{error && (
					<Typography
						variant="body2"
						color="error"
						sx={{ mt: 2, textAlign: "center" }}
					>
						Error signing in: {error}
					</Typography>
				)}
			</ButtonsContainer>
		</Box>
	);
};
