/**
 * @file radient-auth-buttons.tsx
 * @description
 * Reusable component for Radient authentication buttons.
 * Provides options for users to sign in with Google or Microsoft.
 */

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

// lucide ships no brand marks and the FontAwesome brand pack that used to supply
// these is gone, so the two provider logos are inlined. They are decorative:
// each button already carries a text label, hence aria-hidden.
const GoogleMark: FC = () => (
	<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
		<path
			fill="#4285F4"
			d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
		/>
		<path
			fill="#34A853"
			d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
		/>
		<path
			fill="#FBBC05"
			d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
		/>
		<path
			fill="#EA4335"
			d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
		/>
	</svg>
);

const MicrosoftMark: FC = () => (
	<svg width="18" height="18" viewBox="0 0 23 23" aria-hidden="true">
		<path fill="#F25022" d="M1 1h10v10H1z" />
		<path fill="#7FBA00" d="M12 1h10v10H12z" />
		<path fill="#00A4EF" d="M1 12h10v10H1z" />
		<path fill="#FFB900" d="M12 12h10v10H12z" />
	</svg>
);

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
						<GoogleMark />
					</IconContainer>
					{loading ? (
						<CircularProgress size={16} sx={{ mr: 1 }} color="inherit" />
					) : null}
					Sign in with Google
				</GoogleButton>

				<MicrosoftButton onClick={handleMicrosoftSignIn} disabled={loading}>
					<IconContainer>
						<MicrosoftMark />
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
