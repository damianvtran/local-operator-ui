/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { Box, Typography } from "@mui/material";
import { getUserInfo } from "@shared/api/radient/auth-api";
import { RadientAuthButtons } from "@shared/components/auth";
import { apiConfig } from "../../../../config";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { useUserStore } from "@shared/store/user-store";
import radientTheme from "@shared/themes/radient-theme";
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
		<Box sx={{ animation: "fadeIn 0.6s ease-out" }}>
			<Typography
				variant="body1"
				sx={{
					fontSize: "1.1rem",
					fontWeight: 500,
					lineHeight: 1.6,
					mb: 2,
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
					<RadientAuthButtons
						titleText=""
						descriptionText=""
						onSignInSuccess={handleSignInSuccess}
					/>
				</Box>
			</SectionContainer>

			<Box
				sx={{
					mt: 4,
					fontStyle: "italic",
					textAlign: "center",
					color: "text.secondary",
					fontSize: "0.875rem", // Equivalent to variant="body2"
				}}
			>
				<Box component="span" sx={{ mr: 1 }}>
					💡
				</Box>
				Your account will be used only for authentication and to manage your
				Radient Pass subscription.
			</Box>
		</Box>
	);
};
