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
	alpha,
	styled,
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

// Styled components for the sign-in buttons
const SignInButton = styled(Button)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(2, 4),
	borderRadius: 8,
	fontSize: "1rem",
	fontWeight: 600,
	textTransform: "none",
	marginBottom: theme.spacing(2),
	width: "100%",
	maxWidth: 320,
	transition: "all 0.2s ease-in-out",
	boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.1)}`,
	"&:hover": {
		transform: "translateY(-2px)",
		boxShadow: `0 6px 16px ${alpha(theme.palette.common.black, 0.15)}`,
	},
}));

const GoogleButton = styled(SignInButton)(() => ({
	backgroundColor: "#ffffff",
	color: "#444444",
	border: "1px solid #dddddd",
	"&:hover": {
		backgroundColor: "#f8f8f8",
	},
}));

const MicrosoftButton = styled(SignInButton)(() => ({
	backgroundColor: "#2f2f2f",
	color: "#ffffff",
	"&:hover": {
		backgroundColor: "#1f1f1f",
	},
}));

const IconContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginRight: theme.spacing(2),
	fontSize: "1.25rem",
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
		<Box>
			{titleText && (
				<Typography
					variant="body1"
					sx={{
						fontSize: "1.1rem",
						fontWeight: 500,
						lineHeight: 1.6,
						mb: 2,
					}}
				>
					{titleText}
				</Typography>
			)}

			{descriptionText && (
				<Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
					{descriptionText}
				</Typography>
			)}

			<ButtonsContainer>
				<GoogleButton onClick={handleGoogleSignIn} disabled={loading}>
					<IconContainer>
						<FontAwesomeIcon icon={faGoogle} />
					</IconContainer>
					{loading ? <CircularProgress size={20} sx={{ mr: 2 }} /> : null}
					Sign in with Google
				</GoogleButton>

				<MicrosoftButton onClick={handleMicrosoftSignIn} disabled={loading}>
					<IconContainer>
						<FontAwesomeIcon icon={faMicrosoft} />
					</IconContainer>
					{loading ? <CircularProgress size={20} sx={{ mr: 2 }} /> : null}
					Sign in with Microsoft
				</MicrosoftButton>

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
