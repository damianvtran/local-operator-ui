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
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowRight } from "@fortawesome/free-solid-svg-icons";
import { keyframes } from "@emotion/react";

const shimmerKeyframes = keyframes`
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
`;

const pulseKeyframes = keyframes`
  0% {
    box-shadow: 0 0 0 0 ${alpha(radientTheme.palette.primary.main, 0)};
  }
  70% {
    box-shadow: 0 0 0 10px ${alpha(radientTheme.palette.primary.main, 0.2)};
  }
  100% {
    box-shadow: 0 0 0 0 ${alpha(radientTheme.palette.primary.main, 0)};
  }
`;

const gradientAnimation = keyframes`
  0% {
    background-position: 0% 50%;
    background-size: 250% 250%;
  }
  25% {
    background-size: 300% 300%;
  }
  50% {
    background-position: 100% 50%;
    background-size: 250% 250%;
  }
  75% {
    background-size: 300% 300%;
  }
  100% {
    background-position: 0% 50%;
    background-size: 250% 250%;
  }
`;

const ChoiceCard = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isRadientOption",
})<{ isRadientOption?: boolean }>(({ theme, isRadientOption }) => ({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "space-between",
	padding: theme.spacing(4),
	paddingBottom: theme.spacing(5),
	borderRadius: 16,
	background: isRadientOption
		? `linear-gradient(135deg, 
        ${alpha(radientTheme.palette.primary.main, 0.4)} 0%, 
        ${alpha(radientTheme.palette.primary.dark, 0.6)} 35%, 
        ${alpha(radientTheme.palette.primary.dark, 0.8)} 70%, 
        ${radientTheme.palette.background.default} 100%)`
		: `linear-gradient(135deg, 
        ${alpha(theme.palette.background.paper, 0.9)} 0%, 
        ${theme.palette.background.paper} 40%, 
        ${theme.palette.background.default} 100%)`,
	backgroundSize: "300% 300%",
	animation: `${gradientAnimation} 12s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite`,
	boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.15)}`,
	cursor: "pointer",
	transition: "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
	height: "100%",
	minHeight: 320,
	position: "relative",
	overflow: "hidden",
	"&::before": isRadientOption
		? {
				content: '""',
				position: "absolute",
				top: 0,
				left: 0,
				right: 0,
				height: "2px",
				background: `linear-gradient(90deg, transparent, ${radientTheme.palette.primary.light}, transparent)`,
				backgroundSize: "200% 100%",
				animation: `${shimmerKeyframes} 3s infinite`,
				zIndex: 1,
			}
		: {},
	"&:hover": {
		transform: "translateY(-8px) scale(1.02)",
		boxShadow: isRadientOption
			? `0 16px 48px ${alpha(theme.palette.primary.main, 0.25)}, 0 0 20px ${alpha(theme.palette.primary.main, 0.15)}`
			: `0 16px 48px ${alpha(theme.palette.common.black, 0.2)}`,
		animation: isRadientOption
			? `${gradientAnimation} 8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite, ${pulseKeyframes} 3s infinite`
			: `${gradientAnimation} 8s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite`,
		borderColor: isRadientOption
			? alpha(theme.palette.primary.main, 0.4)
			: alpha(theme.palette.primary.main, 0.1),
		"& .choose-option": {
			transform: "translateY(0)",
			opacity: 1,
		},
	},
}));

const CardTitle = styled(Box)(({ theme }) => ({
	fontSize: "1.5rem",
	fontWeight: 700,
	marginBottom: theme.spacing(1),
	textAlign: "left",
	color: theme.palette.text.primary,
}));

const CardSubtitle = styled(Box)(({ theme }) => ({
	fontSize: "0.95rem",
	color: theme.palette.text.secondary,
	textAlign: "left",
	marginBottom: theme.spacing(4),
}));

const CardIcon = styled(Box)(({ theme }) => ({
	width: 90,
	height: 90,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginTop: theme.spacing(2),
}));

const RadientPassText = styled(Box)(() => ({
	fontSize: "1.5rem",
	fontWeight: 700,
	color: radientTheme.palette.primary.light,
	textAlign: "left",
}));

const FreeText = styled(Box)(({ theme }) => ({
	fontSize: "1.5rem",
	fontWeight: 700,
	color: theme.palette.text.primary,
	textAlign: "left",
}));

const ChooseOption = styled(Box, {
	shouldForwardProp: (prop) => prop !== "isRadientOption",
})<{ isRadientOption?: boolean }>(({ theme, isRadientOption }) => ({
	position: "absolute",
	bottom: 0,
	left: 0,
	right: 0,
	padding: theme.spacing(2),
	background: isRadientOption
		? `linear-gradient(to top, ${alpha(radientTheme.palette.primary.main, 0.1)}, transparent)`
		: `linear-gradient(to top, ${alpha(theme.palette.primary.main, 0.1)}, transparent)`,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	transform: "translateY(100%)",
	opacity: 0,
	transition: "all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)",
	color: isRadientOption
		? radientTheme.palette.primary.light
		: theme.palette.primary.main,
	fontWeight: 600,
	fontSize: "0.95rem",
	"& svg": {
		marginLeft: theme.spacing(1),
		transition: "transform 0.2s ease",
	},
	"&:hover svg": {
		transform: "translateX(4px)",
	},
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
						<ChoiceCard onClick={handleRadientPassChoice} isRadientOption>
							<Box sx={{ textAlign: "left" }}>
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
									, and more. Get started with one click, no credit card
									required. No rate limits, and everything you need in one
									place.
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
							<ChooseOption className="choose-option" isRadientOption>
								Choose this option <FontAwesomeIcon icon={faArrowRight} />
							</ChooseOption>
						</ChoiceCard>
					</Grid>

					{/* DIY Option */}
					<Grid item xs={12} md={6}>
						<ChoiceCard onClick={handleDiyChoice}>
							<Box sx={{ textAlign: "left" }}>
								<CardTitle>
									Set up your own keys <br />
									<FreeText>Free Forever</FreeText>
								</CardTitle>
								<CardSubtitle>
									Full flexibility for more technical users. Get your own API
									keys and mix and match providers. Handle separate transaction
									fees with providers on your own such as SERP API, OpenAI, and
									Anthropic.
								</CardSubtitle>
							</Box>
							<CardIcon sx={{ fontSize: "3rem" }}>🔧</CardIcon>
							<ChooseOption className="choose-option">
								Choose this option <FontAwesomeIcon icon={faArrowRight} />
							</ChooseOption>
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
