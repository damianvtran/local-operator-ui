/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */

import { Box, CircularProgress, styled, Typography, useTheme } from "@mui/material";
import { RadientAuthButtons } from "@shared/components/auth";
import { useRadientPricesQuery } from "@shared/hooks/use-radient-prices-query";
import type { FC } from "react";
import {
	EmojiContainer,
	SectionContainer,
	SectionDescription,
} from "../onboarding-styled";
import { radientTheme } from "@shared/themes";

/**
 * Props for the RadientSignInStep component
 */
type RadientSignInStepProps = {
	/**
	 * Optional callback when user successfully signs in with Radient Pass
	 */
	onSignInSuccess?: () => void;
};

// Styled span for Radient bold text
const RadientBoldTextSpan = styled("span")(() => ({
	fontWeight: "bold",
	color: radientTheme.palette.primary.main,
}));

/**
 * Radient Sign In Step Component
 *
 * Provides options for users to sign in with Google or Microsoft
 * to set up their Radient Pass account.
 */
export const RadientSignInStep: FC<RadientSignInStepProps> = ({
	onSignInSuccess,
}) => {
	const theme = useTheme();
	const { prices, isLoading, error } = useRadientPricesQuery();

	// Format currency helper (simple USD formatting)
	const formatCurrency = (amount: number | undefined) => {
		if (typeof amount !== "number") return "$..."; // Fallback for loading/error
		return `$${amount.toFixed(2)} USD`; // Basic USD formatting
	};

	// Use SectionContainer for the main wrapper with animation
	return (
		<SectionContainer>
			{/* Use SectionDescription for main text, adjust font size if needed */}
			<SectionDescription sx={{ mb: 3 }}>
				Access <RadientBoldTextSpan>hundreds of models</RadientBoldTextSpan> updated in
				real time, <RadientBoldTextSpan>cost-saving and performance enhancements</RadientBoldTextSpan> with Radient Automatic, web search, image generation,
				site crawling, and more all in Local Operator.
        <br />
        <br />
        It is often <RadientBoldTextSpan>cheaper</RadientBoldTextSpan> to use Radient Pass Credits compared to using an API key from any single provider due to automatic cost reduction when Radient Automatic picks the best model for your agents.
        <br />
        <br />
        You can also use your Radient Pass with other agentic tools such as <RadientBoldTextSpan>Cline, Cursor, and more</RadientBoldTextSpan>.  Sign in with your preferred method to get started with Radient Pass in a
				couple clicks. 
			</SectionDescription>

			{/* Use SectionDescription for the credit info */}
			<SectionDescription sx={{ mb: 3 }}>
				Start with{" "}
				<Typography
					component="span"
					fontWeight="medium" // Use medium weight for emphasis
					color={radientTheme.palette.primary.main} 
					sx={{ fontSize: "inherit" }}
				>
					{/* Display loading indicator or fetched value */}
					{isLoading ? (
						<CircularProgress size={16} sx={{ mr: 0.5 }} />
					) : (
						formatCurrency(prices?.default_new_credits)
					)}
				</Typography>{" "}
				of free credit, and unlock{" "}
				<Typography
					component="span"
					fontWeight="medium"
					color={radientTheme.palette.primary.main}
					sx={{ fontSize: "inherit" }}
				>
					{/* Display loading indicator or fetched value */}
					{isLoading ? (
						<CircularProgress size={16} sx={{ mr: 0.5 }} />
					) : (
						formatCurrency(prices?.default_registration_credits)
					)}
				</Typography>{" "}
				more with your first payment.
				{/* Optionally display an error message */}
				{error && (
					<Typography color="error" variant="caption" display="block" mt={1}>
						Could not load credit information.
					</Typography>
				)}
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
