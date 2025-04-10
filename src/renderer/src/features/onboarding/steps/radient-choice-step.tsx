/**
 * Radient Choice Step Component
 *
 * Presents the user with two options for onboarding:
 * 1. Get started with Radient Pass (managed option)
 * 2. Set up their own keys (DIY option)
 */

import radientLogo from "@assets/radient-icon-1024x1024.png";
import { Box, Grid, Typography, alpha, styled } from "@mui/material";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@renderer/store/onboarding-store";
import { radientTheme } from "@renderer/themes";
import type { FC } from "react";
import { useCallback } from "react";
import { SectionContainer, SectionDescription } from "../onboarding-styled";

// Styled components for the choice cards
const ChoiceCard = styled(Box, {
	shouldForwardProp: (prop) => prop !== "selected",
})<{ selected?: boolean }>(({ theme, selected }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "flex-start",
	padding: theme.spacing(4),
	borderRadius: 12,
	backgroundColor: selected
		? alpha(theme.palette.primary.main, 0.05)
		: "transparent",
	border: `1px solid ${selected ? theme.palette.primary.main : alpha(theme.palette.divider, 0.5)}`,
	boxShadow: selected
		? `0 8px 24px ${alpha(theme.palette.primary.main, 0.15)}`
		: `0 4px 12px ${alpha(theme.palette.common.black, 0.05)}`,
	cursor: "pointer",
	transition: "all 0.3s ease-in-out",
	height: "100%",
	minHeight: 280,
	position: "relative",
	overflow: "hidden",
	"&:hover": {
		transform: "translateY(-4px)",
		borderColor: theme.palette.primary.main,
	},
}));

const CardTitle = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 700,
	marginBottom: theme.spacing(1),
	textAlign: "center",
	color: theme.palette.text.primary,
}));

const CardSubtitle = styled(Typography)(({ theme }) => ({
	fontSize: "0.95rem",
	color: theme.palette.text.secondary,
	textAlign: "center",
}));

const CardIcon = styled(Box)(({ theme }) => ({
	width: 100,
	height: 100,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginBottom: theme.spacing(3),
	borderRadius: "50%",
	border: `1px solid ${theme.palette.primary.main}`,
	padding: theme.spacing(2),
}));

const RadientPassText = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 700,
	marginBottom: theme.spacing(1),
	color: radientTheme.palette.primary.light,
}));

const FreeText = styled(Typography)(({ theme }) => ({
	fontSize: "1.25rem",
	fontWeight: 700,
	marginBottom: theme.spacing(1),
	color: theme.palette.text.primary,
	textAlign: "center",
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
			setCurrentStep(OnboardingStep.WELCOME);
		}
	}, [onDoItYourself, setCurrentStep]);

	return (
		<Box sx={{ animation: "fadeIn 0.6s ease-out" }}>
			<Typography
				variant="body1"
				paragraph
				sx={{
					fontSize: "1.1rem",
					fontWeight: 500,
					mb: 3,
				}}
			>
				Choose how you'd like to get started:
			</Typography>

			<SectionContainer>
				<Grid container spacing={3}>
					{/* Radient Pass Option */}
					<Grid item xs={12} md={6}>
						<ChoiceCard
							onClick={handleRadientPassChoice}
							sx={{
								"&:hover": {
									borderColor: radientTheme.palette.primary.main,
								},
							}}
						>
							<CardIcon
								sx={{
									borderColor: radientTheme.palette.primary.light,
								}}
							>
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
							<CardTitle>
								Get started for free with <br />
								<RadientPassText>Radient Pass</RadientPassText>
							</CardTitle>
							<CardSubtitle>
								Batteries included with{" "}
								<span
									style={{
										fontWeight: 700,
										color: radientTheme.palette.primary.light,
									}}
								>
									agentic web search, image generation, site crawling, an
									assortment of models
								</span>
								, and more. Get started with one click, no credit card required.
								No rate limits, and everything you need in one place.
							</CardSubtitle>
						</ChoiceCard>
					</Grid>

					{/* DIY Option */}
					<Grid item xs={12} md={6}>
						<ChoiceCard onClick={handleDiyChoice}>
							<CardIcon sx={{ fontSize: "2.5rem" }}>🔧</CardIcon>
							<CardTitle>
								Set up your own keys <br />
								<FreeText>Free Forever</FreeText>
							</CardTitle>
							<CardSubtitle>
								Full flexibility for more technical users. Get your own API keys
								and mix and match providers. May incur provider fees and rate
								limits with services like SERP API, OpenAI, and Anthropic.
							</CardSubtitle>
						</ChoiceCard>
					</Grid>
				</Grid>
			</SectionContainer>

			<SectionDescription sx={{ mt: 3, fontStyle: "italic" }}>
				<Box component="span" sx={{ mr: 1 }}>
					💡
				</Box>
				You can always change your setup later in the Settings page.
			</SectionDescription>
		</Box>
	);
};
