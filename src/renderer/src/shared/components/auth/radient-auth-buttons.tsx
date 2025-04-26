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
	styled,
	useTheme,
} from "@mui/material";
import { useOidcAuth } from "@shared/hooks/use-oidc-auth";
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
	 * Optional callback to be called after RADIENT_API_KEY is set/updated.
	 * Use this to force a model refresh and/or credentials refetch after Radient sign-in.
	 */
	onAfterCredentialUpdate?: () => void;
	/**
	 * Optional title text to display above the buttons
	 */
	titleText?: string;
	/**
	 * Optional description text to display above the buttons
	 */
	descriptionText?: string;
};

// Base button style, similar to SecondaryButton in onboarding-styled
const SignInButton = styled(Button)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: theme.spacing(0.75, 2),
	borderRadius: theme.shape.borderRadius * 0.75,
	fontSize: "0.875rem",
	fontWeight: 500,
	textTransform: "none",
	marginBottom: theme.spacing(1.5),
	width: "100%",
	maxWidth: 320,
	border: `1px solid ${theme.palette.divider}`,
	backgroundColor: theme.palette.background.paper,
	color: theme.palette.text.primary,
	boxShadow: "none",
	transition:
		"background-color 0.2s ease-in-out, border-color 0.2s ease-in-out",
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
		borderColor: theme.palette.divider,
		boxShadow: "none",
	},
	"&:disabled": {
		borderColor: theme.palette.divider,
		color: theme.palette.action.disabled,
		backgroundColor: theme.palette.action.disabledBackground,
	},
}));

const GoogleButton = styled(SignInButton)({});

const MicrosoftButton = styled(SignInButton)({});

const IconContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginRight: theme.spacing(1),
	fontSize: "1rem",
	width: 20,
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
	onAfterCredentialUpdate,
	titleText = "Sign in to Radient",
	descriptionText = "Choose your preferred sign-in method to access Radient services.",
}) => {
	const theme = useTheme(); // Get theme for sx props
	const { signInWithGoogle, signInWithMicrosoft, loading, error } = useOidcAuth(
		{
			onAfterCredentialUpdate,
			onSuccess: onSignInSuccess,
		},
	);

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
			{titleText && (
				<Typography
					sx={{
						fontSize: "1.125rem",
						fontWeight: 500,
						marginBottom: theme.spacing(1),
						color: theme.palette.text.primary,
						textAlign: "center",
					}}
				>
					{titleText}
				</Typography>
			)}
			{descriptionText && (
				<Typography
					sx={{
						fontSize: "0.875rem",
						color: theme.palette.text.secondary,
						marginBottom: theme.spacing(3),
						lineHeight: 1.5,
						textAlign: "center",
					}}
				>
					{descriptionText}
				</Typography>
			)}
			<ButtonsContainer>
				<GoogleButton onClick={handleGoogleSignIn} disabled={loading}>
					<IconContainer>
						<FontAwesomeIcon icon={faGoogle} />
					</IconContainer>
					{loading ? (
						<CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />
					) : null}
					Sign in with Google
				</GoogleButton>

				<MicrosoftButton onClick={handleMicrosoftSignIn} disabled={loading}>
					<IconContainer>
						<FontAwesomeIcon icon={faMicrosoft} />
					</IconContainer>
					{loading ? (
						<CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />
					) : null}
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
