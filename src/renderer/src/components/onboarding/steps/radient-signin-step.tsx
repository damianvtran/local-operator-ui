/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { faGoogle, faMicrosoft } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Button, Typography, alpha, styled } from "@mui/material";
import { useOnboardingStore } from "@renderer/store/onboarding-store";
import type { FC } from "react";
import { useCallback } from "react";
import { SectionContainer, SectionDescription } from "../onboarding-styled";
import { radientTheme } from "@renderer/themes";

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

/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */
export const RadientSignInStep: FC = () => {
	const { completeOnboarding } = useOnboardingStore();

	/**
	 * Handle Google sign-in (stub for future implementation)
	 */
	const handleGoogleSignIn = useCallback(() => {
		// This is a stub for future implementation
		console.log("Google sign-in clicked - to be implemented");

		// For now, just complete the onboarding
		completeOnboarding();
	}, [completeOnboarding]);

	/**
	 * Handle Microsoft sign-in (stub for future implementation)
	 */
	const handleMicrosoftSignIn = useCallback(() => {
		// This is a stub for future implementation
		console.log("Microsoft sign-in clicked - to be implemented");

		// For now, just complete the onboarding
		completeOnboarding();
	}, [completeOnboarding]);

	return (
		<Box sx={{ animation: "fadeIn 0.6s ease-out" }}>
			<Typography
				variant="body1"
				paragraph
				sx={{
					fontSize: "1.1rem",
					fontWeight: 500,
					lineHeight: 1.6,
				}}
			>
				Sign in to set up your Radient account
			</Typography>

			<SectionDescription sx={{ mb: 4 }}>
				Choose your preferred sign-in method to get started with Radient Pass.
				This will give you access to web search, image generation, site
				crawling, and more.
				<br />
				<br />
				Start with{" "}
				<span
					style={{ fontWeight: 600, color: radientTheme.palette.primary.light }}
				>
					$1 USD
				</span>{" "}
				of free credit, and unlock{" "}
				<span
					style={{ fontWeight: 600, color: radientTheme.palette.primary.light }}
				>
					$5 USD
				</span>{" "}
				more with your first payment.
			</SectionDescription>

			<SectionContainer>
				<Box
					sx={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
						py: 2,
					}}
				>
					<GoogleButton onClick={handleGoogleSignIn}>
						<IconContainer>
							<FontAwesomeIcon icon={faGoogle} />
						</IconContainer>
						Sign in with Google
					</GoogleButton>

					<MicrosoftButton onClick={handleMicrosoftSignIn}>
						<IconContainer>
							<FontAwesomeIcon icon={faMicrosoft} />
						</IconContainer>
						Sign in with Microsoft
					</MicrosoftButton>
				</Box>
			</SectionContainer>

			<Typography
				variant="body2"
				sx={{
					mt: 4,
					fontStyle: "italic",
					textAlign: "center",
					color: "text.secondary",
				}}
			>
				<Box component="span" sx={{ mr: 1 }}>
					💡
				</Box>
				Your account will be used only for authentication and to manage your
				Radient Pass subscription.
			</Typography>
		</Box>
	);
};
