/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { Box, Typography, useTheme } from "@mui/material";
import { getUserInfo } from "@shared/api/radient/auth-api";
import { RadientAuthButtons } from "@shared/components/auth";
import { apiConfig } from "@shared/config";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { useUserStore } from "@shared/store/user-store";
import { getSession, hasValidSession } from "@shared/utils/session-store";
import type { FC } from "react";
import { useCallback, useEffect } from "react";
import {
	EmojiContainer,
	SectionContainer,
	SectionDescription,
} from "../onboarding-styled"; // Added EmojiContainer

/**
 * Props for the RadientSignInStep component
 */
type RadientSignInStepProps = {
	/**
	 * Optional callback when user successfully signs in with Radient Pass
	 */
	onSignInSuccess?: () => void;
};

/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */
export const RadientSignInStep: FC<RadientSignInStepProps> = ({
	onSignInSuccess,
}) => {
	const theme = useTheme(); // Get theme context
	const handleSignInSuccess = useCallback(async () => {
		try {
			// Get the session data
			const sessionData = await getSession();

			if (sessionData) {
				// Fetch user information from Radient API
				const userInfoResponse = await getUserInfo(
					apiConfig.radientBaseUrl,
					sessionData.accessToken,
				);
				const userInfo = userInfoResponse.result;

				// Update the user profile with name and email
				if (userInfo) {
					const updateProfile = useUserStore.getState().updateProfile;
					updateProfile({
						name: userInfo.account.name,
						email: userInfo.account.email,
					});
				} else {
					console.error("User info response was empty");
				}
			} else {
				console.warn("No session data found in handleSignInSuccess");
			}
		} catch (error) {
			console.error("Error fetching user info:", error);
		}

		// Continue to agent creation step
		const { setCurrentStep } = useOnboardingStore.getState();
		setCurrentStep(OnboardingStep.CREATE_AGENT);

		// Call the onSignInSuccess callback if provided
		if (onSignInSuccess) {
			onSignInSuccess();
		}
	}, [onSignInSuccess]);

	// Check for existing session on mount
	useEffect(() => {
		const checkExistingSession = async () => {
			const hasSession = await hasValidSession();
			if (hasSession) {
				// If we already have a session, proceed to the next step
				handleSignInSuccess();
			}
		};

		checkExistingSession();
	}, [handleSignInSuccess]);

	// Use SectionContainer for the main wrapper with animation
	return (
		<SectionContainer>
			{/* Use SectionDescription for main text, adjust font size if needed */}
			<SectionDescription sx={{ mb: 3 }}>
				Sign in with your preferred method to get started with Radient Pass.
				This gives you access to web search, image generation, site crawling,
				and more.
			</SectionDescription>

			{/* Use SectionDescription for the credit info */}
			<SectionDescription sx={{ mb: 3 }}>
				Start with{" "}
				<Typography
					component="span"
					fontWeight="medium" // Use medium weight for emphasis
					color={theme.palette.primary.main} // Use theme primary color
					sx={{ fontSize: "inherit" }} // Ensure size matches parent
				>
					$1 USD
				</Typography>{" "}
				of free credit, and unlock{" "}
				<Typography
					component="span"
					fontWeight="medium" // Use medium weight
					color={theme.palette.primary.main} // Use theme primary color
					sx={{ fontSize: "inherit" }} // Ensure size matches parent
				>
					$5 USD
				</Typography>{" "}
				more with your first payment.
			</SectionDescription>

			{/* Container for the auth buttons, centered */}
			<Box
				sx={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					py: theme.spacing(2), // Consistent vertical padding
					mb: 3, // Add margin below buttons
				}}
			>
				{/* RadientAuthButtons should handle its internal styling */}
				<RadientAuthButtons
					titleText="" // Keep title/desc empty if not needed here
					descriptionText=""
					onSignInSuccess={handleSignInSuccess}
				/>
			</Box>

			{/* Use SectionDescription for the final note, centered */}
			<SectionDescription sx={{ textAlign: "center" }}>
				<EmojiContainer>💡</EmojiContainer> {/* Use EmojiContainer */}
				Your account is used for authentication and managing your Radient Pass
				subscription.
			</SectionDescription>
		</SectionContainer>
	);
};
