/**
 * Radient Choice Step Component
 *
 * Presents the user with two options for onboarding:
 * 1. Get started with Radient Pass (managed option)
 * 2. Set up their own keys (DIY option)
 */

import radientLogo from "@assets/radient-icon-1024x1024.png";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Grid, Typography, alpha, styled } from "@mui/material"; // Removed useTheme
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { radientTheme } from "@shared/themes"; // Keep for Radient specific colors if needed
import type { FC } from "react";
import { useCallback } from "react";
import { SectionContainer, SectionDescription } from "../onboarding-styled";

// --- Styled Components (Simplified for shadcn aesthetic) ---

const ChoiceCard = styled(Box)(({ theme }) => ({
	display: "flex",
	flexDirection: "column",
	// alignItems: "center", // Align items to start for better text layout
	justifyContent: "space-between", // Keep space-between
	padding: theme.spacing(3), // Consistent padding
	borderRadius: theme.shape.borderRadius * 1.5, // Slightly larger radius
	border: `1px solid ${theme.palette.divider}`, // Standard border
	backgroundColor: theme.palette.background.paper, // Use paper background
	cursor: "pointer",
	transition:
		"transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out, border-color 0.2s ease-in-out", // Smooth transitions
	height: "100%",
	minHeight: 300, // Adjusted min height
	position: "relative", // Keep for potential absolute elements if needed later
	overflow: "hidden", // Keep overflow hidden
	"&:hover": {
		transform: "translateY(-4px)", // Subtle lift
		boxShadow: theme.shadows[3], // Subtle shadow
		borderColor: theme.palette.primary.main, // Highlight border on hover
		// Make the "Choose Option" text visible on hover
		"& .choose-option": {
			opacity: 1,
		},
	},
}));

// Specific styling for the Radient option card
const RadientChoiceCard = styled(ChoiceCard)(({ theme }) => ({
	// Use a subtle gradient or border to differentiate if desired, or keep consistent
	borderColor: alpha(radientTheme.palette.primary.main, 0.5), // Example: Use Radient color for border
	"&:hover": {
		transform: "translateY(-4px)",
		boxShadow: theme.shadows[3],
		borderColor: radientTheme.palette.primary.main, // Stronger Radient border on hover
		"& .choose-option": {
			opacity: 1,
		},
	},
}));

const CardTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem", // Adjusted size
	fontWeight: 600, // Slightly less bold
	marginBottom: theme.spacing(0.5), // Reduced margin
	color: theme.palette.text.primary,
	lineHeight: 1.3,
}));

const CardSubtitle = styled(Typography)(({ theme }) => ({
	fontSize: "0.875rem", // Consistent small text size
	color: theme.palette.text.secondary,
	marginBottom: theme.spacing(3), // Consistent margin
	lineHeight: 1.5,
}));

const CardIcon = styled(Box)(({ theme }) => ({
	width: 80, // Smaller icon size
	height: 80,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginTop: "auto", // Push icon towards the bottom before the 'Choose' text
	marginBottom: theme.spacing(4), // Space above the 'Choose' text
	alignSelf: "center", // Center the icon horizontally
}));

// Use Typography for Radient Pass text, potentially with specific color
const RadientPassText = styled(Typography)(() => ({
	fontSize: "1.25rem",
	fontWeight: 600,
	color: radientTheme.palette.primary.main, // Use Radient primary color
	display: "inline", // Keep inline if needed within CardTitle
}));

// Use Typography for Free text
const FreeText = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 600,
	color: theme.palette.text.primary, // Standard text color
	display: "inline",
}));

// Simplified "Choose Option" text, appears on hover
const ChooseOption = styled(Typography)(({ theme }) => ({
	position: "absolute",
	bottom: theme.spacing(2), // Positioned at the bottom
	left: 0,
	right: 0,
	textAlign: "center",
	opacity: 0, // Hidden by default
	transition: "opacity 0.2s ease-in-out", // Fade in/out
	color: theme.palette.primary.main, // Use primary color
	fontWeight: 500,
	fontSize: "0.875rem",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: theme.spacing(0.5),
	"& svg": {
		transition: "transform 0.2s ease",
	},
	// Remove hover effect on the text itself, rely on card hover
}));

/**
 * Radient Choice Step Component
 *
 * Presents the user with two options for onboarding:
 * 1. Get started with Radient Pass (managed option)
 * 2. Set up their own keys (DIY option)
 *
 * @param props - Optional callbacks for handling card selection.
 *   - onDoItYourself: Called when the DIY card is clicked.
 *   - onRadientSignIn: Called when the Radient Pass card is clicked.
 */
type RadientChoiceStepProps = {
	/**
	 * Called when the user selects the DIY option.
	 */
	onDoItYourself?: () => void;
	/**
	 * Called when the user selects the Radient Pass option.
	 */
	onRadientSignIn?: () => void;
};

export const RadientChoiceStep: FC<RadientChoiceStepProps> = ({
	onDoItYourself,
	onRadientSignIn,
}) => {
	const { setCurrentStep } = useOnboardingStore();

	/**
	 * Handle selection of the Radient Pass option
	 */
	const handleRadientPassChoice = useCallback(() => {
		if (onRadientSignIn) {
			onRadientSignIn();
		} else {
			setCurrentStep(OnboardingStep.RADIENT_SIGNIN);
		}
	}, [onRadientSignIn, setCurrentStep]);

	/**
	 * Handle selection of the DIY option
	 */
	const handleDiyChoice = useCallback(() => {
		if (onDoItYourself) {
			onDoItYourself();
		} else {
			// Navigate to User Profile as Welcome step is removed
			setCurrentStep(OnboardingStep.USER_PROFILE);
		}
	}, [onDoItYourself, setCurrentStep]);

	return (
		<Box sx={{ animation: "fadeIn 0.6s ease-out" }}>
			{/* Use SectionDescription for introductory text (defaults to 0.875rem) */}
			<SectionDescription sx={{ mb: 3 }}>
				Choose how you'd like to get started:
			</SectionDescription>

			<SectionContainer>
				<Grid container spacing={2.5}>
					{" "}
					{/* Slightly reduced spacing */}
					{/* Radient Pass Option */}
					<Grid item xs={12} md={6}>
						{/* Use the specific RadientChoiceCard */}
						<RadientChoiceCard onClick={handleRadientPassChoice}>
							<Box>
								{" "}
								{/* Wrap text content */}
								<CardTitle variant="h6">
									{" "}
									{/* Use variant */}
									Get started for free with {/* Removed component="span" */}
									<RadientPassText>Radient Pass</RadientPassText>
								</CardTitle>
								<CardSubtitle variant="body2">
									Designed for best speed, accuracy, and performance with Local
									Operator. Get access to all tools and models at once, with potential savings when Radient picks the best model to handle each step. Two-click setup, no credit card required.
								</CardSubtitle>
							</Box>
							<CardIcon>
								<img
									src={radientLogo}
									alt="Radient Logo"
									style={{
										width: "100%",
										height: "100%",
										objectFit: "contain",
									}}
								/>
							</CardIcon>
							{/* Simplified ChooseOption text */}
							<ChooseOption className="choose-option">
								Choose Radient Pass{" "}
								<FontAwesomeIcon icon={faArrowRight} size="sm" />
							</ChooseOption>
						</RadientChoiceCard>
					</Grid>
					{/* DIY Option */}
					<Grid item xs={12} md={6}>
						<ChoiceCard onClick={handleDiyChoice}>
							<Box>
								{" "}
								{/* Wrap text content */}
								<CardTitle variant="h6">
									Set up your own keys {/* Removed component="span" */}
									<FreeText>(Free Forever)</FreeText>
								</CardTitle>
								<CardSubtitle variant="body2">
									Full flexibility for technical users. Bring your own API keys
									for providers like OpenAI, Anthropic, Tavily API, etc., and
									manage billing separately.
								</CardSubtitle>
							</Box>
							{/* Use Typography for emoji for better control */}
							<CardIcon>
								<Typography fontSize="3.5rem">🔧</Typography>
							</CardIcon>
							<ChooseOption className="choose-option">
								Choose DIY Setup{" "}
								<FontAwesomeIcon icon={faArrowRight} size="sm" />
							</ChooseOption>
						</ChoiceCard>
					</Grid>
				</Grid>
			</SectionContainer>

			{/* Use standard SectionDescription styling */}
			<SectionDescription sx={{ mt: 3, textAlign: "center" }}>
				<Box component="span" sx={{ mr: 0.5 }}>
					💡
				</Box>
				You can always change your setup later in Settings.
			</SectionDescription>
		</Box>
	);
};
