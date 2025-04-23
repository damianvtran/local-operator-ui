/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { Box, Typography, useTheme } from "@mui/material";
import { RadientAuthButtons } from "@shared/components/auth";
import type { FC } from "react";
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
	onSignInSuccess, // This prop comes from OnboardingModal
}) => {
	const theme = useTheme(); // Get theme context

	// Remove internal handleSignInSuccess logic
	// const handleSignInSuccess = useCallback(async () => { ... });

	// Remove session check useEffect
	// useEffect(() => { ... });

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
				{/* Pass the onSignInSuccess prop directly to RadientAuthButtons */}
				<RadientAuthButtons
					titleText="" // Keep title/desc empty if not needed here
					descriptionText=""
					onSignInSuccess={onSignInSuccess} // Pass down the prop from parent
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
