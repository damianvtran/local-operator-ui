/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { Box, Typography, useTheme } from "@mui/material"; // Added useTheme
import { getUserInfo } from "@shared/api/radient/auth-api";
import { RadientAuthButtons } from "@shared/components/auth";
import { apiConfig } from "@shared/config";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { useUserStore } from "@shared/store/user-store";
// Removed direct import of radientTheme, use theme context instead
import { getSession, hasValidSession } from "@shared/utils/session-store";
import type { FC } from "react";
import { useCallback, useEffect } from "react";
import { SectionContainer, SectionDescription } from "../onboarding-styled";

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

	return (
		<Box sx={{ animation: "fadeIn 0.5s ease-out" }}> {/* Consistent animation */}
			{/* Use SectionDescription for main text */}
			<SectionDescription sx={{ mb: 3, fontSize: "1rem" }}>
				Sign in with your preferred method to get started with Radient Pass.
				This gives you access to web search, image generation, site crawling, and more.
			</SectionDescription>

			<SectionDescription sx={{ mb: 3 }}>
				Start with{" "}
				<Typography
					component="span"
					fontWeight="medium"
					color={theme.palette.primary.main} // Use theme primary color
				>
					$1 USD
				</Typography>{" "}
				of free credit, and unlock{" "}
				<Typography
					component="span"
					fontWeight="medium"
					color={theme.palette.primary.main} // Use theme primary color
				>
					$5 USD
				</Typography>{" "}
				more with your first payment.
			</SectionDescription>

			<SectionContainer>
				<Box
					sx={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center", // Center the auth buttons
						py: theme.spacing(1), // Reduced padding
					}}
				>
					{/* Assuming RadientAuthButtons is styled appropriately */}
					<RadientAuthButtons
						titleText="" // Keep title/desc empty if not needed here
						descriptionText=""
						onSignInSuccess={handleSignInSuccess}
					/>
				</Box>
			</SectionContainer>

			{/* Use SectionDescription for the final note */}
			<SectionDescription sx={{ mt: 3, textAlign: 'center' }}>
				<Box component="span" sx={{ mr: 0.5 }}>💡</Box>
				Your account is used for authentication and managing your Radient Pass subscription.
			</SectionDescription>
		</Box>
	);
};
