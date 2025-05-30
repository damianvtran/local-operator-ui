/**
 * Onboarding Modal Component
 *
 * Main container for the first-time setup experience.
 * Manages the flow between different onboarding steps.
 */

import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Box, Tooltip, useTheme } from "@mui/material";
import { getUserInfo } from "@shared/api/radient/auth-api";
import { apiConfig } from "@shared/config";
import { radientUserKeys } from "@shared/hooks/use-radient-user-query";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import { useUserStore } from "@shared/store/user-store";
import { clearSession, getSession } from "@shared/utils/session-store";
import { useQueryClient } from "@tanstack/react-query";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OnboardingDialog } from "./onboarding-dialog";
import {
	CongratulationsContainer,
	CongratulationsIcon,
	CongratulationsMessage,
	CongratulationsTitle,
	PrimaryButton,
	SecondaryButton,
	SkipButton,
	StepDot,
	StepIndicatorContainer,
} from "./onboarding-styled";
import { CreateAgentStep } from "./steps/create-agent-step";
import { DefaultModelStep } from "./steps/default-model-step";
import { ModelCredentialStep } from "./steps/model-credential-step";
import { RadientChoiceStep } from "./steps/radient-choice-step";
import { RadientSignInStep } from "./steps/radient-signin-step";
import { SearchApiStep } from "./steps/search-api-step";
import { UserProfileStep } from "./steps/user-profile-step";

// Define step titles outside the component for stability
// Use Partial<> as not all steps might have explicit titles defined here anymore
const stepTitles: Partial<Record<OnboardingStep, string>> = {
	[OnboardingStep.RADIENT_CHOICE]: "Choose Your Setup Option",
	[OnboardingStep.RADIENT_SIGNIN]: "Set Up With Radient Pass",
	[OnboardingStep.USER_PROFILE]: "Set Up Your Profile",
	[OnboardingStep.MODEL_CREDENTIAL]: "Add Model Provider Credentials",
	[OnboardingStep.SEARCH_API]: "Enable Web Search (Recommended)",
	[OnboardingStep.DEFAULT_MODEL]: "Choose Your Default Model",
	[OnboardingStep.CREATE_AGENT]: "Create Your First Agent",
	[OnboardingStep.CONGRATULATIONS]: "🎉 Setup Complete!",
};

/**
 * Props for the OnboardingModal component
 */
type OnboardingModalProps = {
	/**
	 * Whether the modal is open
	 */
	open: boolean;
};

/**
 * Onboarding Modal Component
 *
 * Manages the first-time setup experience with multiple steps
 */
export const OnboardingModal: FC<OnboardingModalProps> = ({ open }) => {
	const theme = useTheme(); // Get theme for spacing
	const { currentStep, setCurrentStep, completeModalOnboarding } =
		useOnboardingStore();
	const navigate = useNavigate();

	// Track whether the user is using Radient Pass within the flow
	// Assume false initially, set to true on successful sign-in or session restore
	const [isUsingRadientPass, setIsUsingRadientPass] = useState(false);
	// State to track if the Create Agent step is valid (at least one agent added)
	const [isCreateAgentStepValid, setIsCreateAgentStepValid] = useState(false);
	// Track the previous step to detect jumps
	const previousStepRef = useRef<OnboardingStep | null>(null);

	// Get the query client for invalidating queries
	const queryClient = useQueryClient();

	// On mount, check for a persisted session, validate it, and fetch user info
	useEffect(() => {
		const tryRestoreSession = async () => {
			// No need to wait for provider auth check anymore
			const sessionData = await getSession();
			if (!sessionData) {
				return; // No session, do nothing
			}

			try {
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

					// If a valid session exists, assume Radient Pass flow was used.
					// Set the flag and navigate to the Create Agent step.
					setIsUsingRadientPass(true);
					setCurrentStep(OnboardingStep.CREATE_AGENT);

					// Invalidate queries to ensure fresh data
					queryClient.invalidateQueries({ queryKey: radientUserKeys.all });
				} else {
					// If userInfo is null/undefined despite having a JWT, the token might be invalid/expired
					console.warn(
						"JWT found but failed to fetch user info. Clearing session.",
					);
					clearSession();
				}
			} catch (error) {
				console.error("Error validating session/fetching user info:", error);
				clearSession();
			}
		};
		// Run the session check logic
		tryRestoreSession();
	}, [setCurrentStep, queryClient]);

	// Update the previous step reference whenever currentStep changes
	useEffect(() => {
		previousStepRef.current = currentStep;
	}, [currentStep]);

	// Define the sequence of steps shown in the indicator based on the flow
	const steps = useMemo(() => {
		// If we're on the choice or signin step, don't show any steps yet.
		if (
			currentStep === OnboardingStep.RADIENT_CHOICE ||
			currentStep === OnboardingStep.RADIENT_SIGNIN
		) {
			return [];
		}

		// If user is using Radient Pass and is at CREATE_AGENT or CONGRATULATIONS step,
		// only show those two steps in the indicator.
		if (
			isUsingRadientPass &&
			(currentStep === OnboardingStep.CREATE_AGENT ||
				currentStep === OnboardingStep.CONGRATULATIONS)
		) {
			return [OnboardingStep.CREATE_AGENT, OnboardingStep.CONGRATULATIONS];
		}

		// DIY path (user chose DIY from Radient Choice or didn't use Radient Pass)
		// The DIY path always starts visually from User Profile.
		const diySteps = [
			OnboardingStep.USER_PROFILE,
			OnboardingStep.MODEL_CREDENTIAL,
			OnboardingStep.SEARCH_API,
			OnboardingStep.DEFAULT_MODEL,
			OnboardingStep.CREATE_AGENT,
			OnboardingStep.CONGRATULATIONS,
		];

		return diySteps;
	}, [currentStep, isUsingRadientPass]);

	// Track visited steps for navigation
	// Initialize empty, as currentStep might be undefined during hydration
	const [visitedSteps, setVisitedSteps] = useState<Set<OnboardingStep>>(
		new Set<OnboardingStep>(),
	);

	// Detect if user has jumped from RADIENT_SIGNIN directly to CREATE_AGENT
	// This indicates they successfully used Radient Pass
	useEffect(() => {
		if (
			previousStepRef.current === OnboardingStep.RADIENT_SIGNIN &&
			currentStep === OnboardingStep.CREATE_AGENT
		) {
			setIsUsingRadientPass(true);
		}
	}, [currentStep]); // Only depends on currentStep

	/**
	 * Callback function passed to RadientSignInStep.
	 * Sets the flag indicating the user successfully used Radient Pass
	 * AND navigates to the next step.
	 */
	const handleRadientSignInSuccess = useCallback(() => {
		console.log("handleRadientSignInSuccess");
		setIsUsingRadientPass(true);
		setCurrentStep(OnboardingStep.CREATE_AGENT);
	}, [setCurrentStep]);

	// Update visited steps when currentStep changes
	useEffect(() => {
		setVisitedSteps((prev) => {
			// Don't modify if the step is already visited
			if (prev.has(currentStep)) return prev;
			// Add the new step regardless of loading state
			const updated = new Set(prev);
			updated.add(currentStep);
			return updated;
		});
	}, [currentStep]);

	// Effect to add the initial step to visitedSteps once currentStep is defined
	useEffect(() => {
		// Add the current step if it's defined and visitedSteps is still empty
		if (currentStep && visitedSteps.size === 0) {
			setVisitedSteps(new Set([currentStep]));
		}
		// This effect depends on currentStep becoming defined and visitedSteps being empty.
	}, [currentStep, visitedSteps.size]);

	/**
	 * Get the main title for the dialog based on the current step
	 */
	const dialogTitle = useMemo(() => {
		// Handle undefined currentStep during hydration
		if (!currentStep) return "Loading...";

		// Use specific titles, fallback to the tooltip title
		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
				return "Choose Your Setup Option"; // More specific title
			case OnboardingStep.CONGRATULATIONS:
				return "🎉 Setup Complete!";
			default:
				// Use the title defined for tooltips if not overridden
				return stepTitles[currentStep] || "🚀 First-Time Setup";
		}
	}, [currentStep]); // Remove stepTitles from dependency array

	/**
	 * Get the content component for the current step
	 */
	const stepContent = useMemo(() => {
		// Handle undefined currentStep during hydration
		if (!currentStep) return null;

		switch (currentStep) {
			case OnboardingStep.RADIENT_CHOICE:
				return (
					<RadientChoiceStep
						onDoItYourself={() => {
							setIsUsingRadientPass(false); // Mark as DIY path
							setCurrentStep(OnboardingStep.USER_PROFILE);
						}}
						onRadientSignIn={() => {
							// No need to set isUsingRadientPass here, sign-in success handles it
							setCurrentStep(OnboardingStep.RADIENT_SIGNIN);
						}}
					/>
				);
			case OnboardingStep.RADIENT_SIGNIN:
				// Pass the callback to notify the modal on successful sign-in
				return (
					<RadientSignInStep onSignInSuccess={handleRadientSignInSuccess} />
				);
			case OnboardingStep.USER_PROFILE:
				return <UserProfileStep />;
			case OnboardingStep.MODEL_CREDENTIAL:
				return <ModelCredentialStep />;
			case OnboardingStep.SEARCH_API:
				return <SearchApiStep />;
			case OnboardingStep.DEFAULT_MODEL:
				return <DefaultModelStep />;
			case OnboardingStep.CREATE_AGENT:
				// Pass the validity callback
				return <CreateAgentStep onValidityChange={setIsCreateAgentStepValid} />;
			case OnboardingStep.CONGRATULATIONS:
				return (
					<CongratulationsContainer>
						<CongratulationsIcon>
							<FontAwesomeIcon icon={faCheck} />
						</CongratulationsIcon>
						<CongratulationsTitle>🎉 You're all set! 🚀</CongratulationsTitle>
						<CongratulationsMessage>
							Amazing! Your Local Operator is now configured and ready to use.
							You can start chatting with your new AI assistant right away or
							explore more exciting features in the settings. Get ready for an
							incredible AI experience!
						</CongratulationsMessage>
					</CongratulationsContainer>
				);
			default:
				return null; // Should not happen
		}
		// Add handleRadientSignInSuccess to dependencies
	}, [currentStep, setCurrentStep, handleRadientSignInSuccess]);

	/**
	 * Handle moving to the next step (DIY flow)
	 */
	const handleNext = useCallback(() => {
		// DIY flow transitions (Radient Choice/Signin don't use 'Next')
		switch (currentStep) {
			case OnboardingStep.USER_PROFILE:
				setCurrentStep(OnboardingStep.MODEL_CREDENTIAL);
				break;
			case OnboardingStep.MODEL_CREDENTIAL:
				setCurrentStep(OnboardingStep.SEARCH_API);
				break;
			case OnboardingStep.SEARCH_API:
				setCurrentStep(OnboardingStep.DEFAULT_MODEL);
				break;
			case OnboardingStep.DEFAULT_MODEL:
				setCurrentStep(OnboardingStep.CREATE_AGENT);
				break;
			case OnboardingStep.CREATE_AGENT: // Applies to both DIY and Radient Pass paths
				setCurrentStep(OnboardingStep.CONGRATULATIONS);
				break;
			case OnboardingStep.CONGRATULATIONS: {
				completeModalOnboarding(); // Mark modal as complete
				// Navigate to the chat view, potentially with the newly created agent
				const createdAgentId = sessionStorage.getItem(
					"onboarding_created_agent_id",
				);
				if (createdAgentId) {
					navigate(`/chat/${createdAgentId}`);
					sessionStorage.removeItem("onboarding_created_agent_id"); // Clean up
				} else {
					navigate("/chat"); // Fallback if no agent ID found
				}
				break;
			}
			// RADIENT_CHOICE and RADIENT_SIGNIN don't use the 'Next' button
			default:
				break;
		}
	}, [currentStep, setCurrentStep, completeModalOnboarding, navigate]);

	/**
	 * Handle moving to the previous step
	 */
	const handleBack = useCallback(() => {
		switch (currentStep) {
			case OnboardingStep.RADIENT_SIGNIN:
				setCurrentStep(OnboardingStep.RADIENT_CHOICE);
				break;
			case OnboardingStep.USER_PROFILE:
				// Always go back to Radient Choice from User Profile if DIY was chosen
				setCurrentStep(OnboardingStep.RADIENT_CHOICE);
				break;
			case OnboardingStep.MODEL_CREDENTIAL:
				setCurrentStep(OnboardingStep.USER_PROFILE);
				break;
			case OnboardingStep.SEARCH_API:
				setCurrentStep(OnboardingStep.MODEL_CREDENTIAL);
				break;
			case OnboardingStep.DEFAULT_MODEL:
				setCurrentStep(OnboardingStep.SEARCH_API);
				break;
			case OnboardingStep.CREATE_AGENT:
				// If using Radient Pass, back goes nowhere (handled by canGoBack).
				// If DIY, back goes to DEFAULT_MODEL.
				if (!isUsingRadientPass) {
					setCurrentStep(OnboardingStep.DEFAULT_MODEL);
				}
				break;
			// Cannot go back from RADIENT_CHOICE or CONGRATULATIONS (and WELCOME is removed)
			default:
				break; // No action for other steps like RADIENT_CHOICE, CONGRATULATIONS
		}
	}, [currentStep, setCurrentStep, isUsingRadientPass]); // Simplified dependencies

	/**
	 * Handle skipping the current step (for optional steps like Search API, Create Agent)
	 */
	const handleSkip = useCallback(() => {
		if (currentStep === OnboardingStep.SEARCH_API) {
			setCurrentStep(OnboardingStep.DEFAULT_MODEL);
		} else if (currentStep === OnboardingStep.CREATE_AGENT) {
			// Skipping Create Agent goes directly to Congratulations
			setCurrentStep(OnboardingStep.CONGRATULATIONS);
		}
	}, [currentStep, setCurrentStep]);

	/**
	 * Determine if the current step is skippable
	 */
	const canSkip =
		currentStep === OnboardingStep.SEARCH_API ||
		currentStep === OnboardingStep.CREATE_AGENT;

	/**
	 * Determine if the 'Back' button should be shown and enabled
	 */
	const canGoBack = useMemo(() => {
		// Cannot go back if currentStep is undefined
		if (!currentStep) {
			return false;
		}

		// Cannot go back from Congratulations
		if (currentStep === OnboardingStep.CONGRATULATIONS) {
			return false;
		}

		// Cannot go back from RADIENT_CHOICE (the starting point)
		if (currentStep === OnboardingStep.RADIENT_CHOICE) {
			return false;
		}

		// If using Radient Pass, cannot go back from CREATE_AGENT (first step after sign-in)
		if (isUsingRadientPass && currentStep === OnboardingStep.CREATE_AGENT) {
			return false;
		}

		// Otherwise, can go back (e.g., from SIGNIN to CHOICE, or within DIY steps)
		return true;
	}, [currentStep, isUsingRadientPass]); // Simplified dependencies

	/**
	 * Get the text for the 'Next'/'Finish' button
	 */
	const nextButtonText =
		currentStep === OnboardingStep.CONGRATULATIONS
			? "🚀 Get Started"
			: "Next →";

	// Determine if the Next button should be disabled
	const isNextDisabled =
		// Disable on Create Agent step if it's not valid (no agents added)
		currentStep === OnboardingStep.CREATE_AGENT && !isCreateAgentStepValid;

	// Render dialog actions (Back, Skip, Next buttons)
	// Render dialog actions (Back, Skip, Next buttons) - Adjusted layout
	const dialogActions = (
		<Box
			sx={{
				display: "flex",
				justifyContent: "space-between", // Space out Back and Next/Skip
				width: "100%",
				alignItems: "center",
				gap: theme.spacing(1.5), // Consistent gap
			}}
		>
			{/* Back Button Area - Use flex-start alignment */}
			<Box sx={{ display: "flex", justifyContent: "flex-start" }}>
				{canGoBack ? (
					<SecondaryButton onClick={handleBack}>Back</SecondaryButton>
				) : (
					<Box sx={{ minWidth: 100 }} /> // Placeholder to maintain alignment
				)}
			</Box>

			{/* Skip/Next Button Area - Use flex-end alignment */}
			<Box
				sx={{
					display: "flex",
					justifyContent: "flex-end",
					gap: theme.spacing(1.5), // Consistent gap
					alignItems: "center",
				}}
			>
				{canSkip && <SkipButton onClick={handleSkip}>Skip</SkipButton>}
				{/* Hide Next button on choice/signin steps */}
				{currentStep !== OnboardingStep.RADIENT_CHOICE &&
					currentStep !== OnboardingStep.RADIENT_SIGNIN && (
						<PrimaryButton onClick={handleNext} disabled={isNextDisabled}>
							{nextButtonText}
						</PrimaryButton>
					)}
			</Box>
		</Box>
	);

	// Generate the actual dot elements or null
	const stepIndicatorDotElements = useMemo(() => {
		// If currentStep is not yet defined, or if there are no steps in the current flow
		if (!currentStep || steps.length === 0) {
			return null;
		}

		return steps.map((step) => {
			const isActive = currentStep === step;
			const isVisited = visitedSteps.has(step);
			// Allow navigation only to visited steps that are not the current one
			const canNavigate = isVisited && step !== currentStep;

			// Special case: Don't allow navigating back to CHOICE/SIGNIN via dots
			const isNonNavigableRadientStep =
				step === OnboardingStep.RADIENT_CHOICE ||
				step === OnboardingStep.RADIENT_SIGNIN;

			return (
				// @ts-ignore - Ignore potential TS issue with Tooltip wrapping custom component
				<Tooltip key={step} title={stepTitles[step]} arrow>
					{/* Wrap StepDot directly if it forwards refs, otherwise use a Box */}
					{/* The updated StepDot handles cursor styling internally */}
					<StepDot
						active={isActive}
						visited={isVisited}
						onClick={() => {
							// Navigation logic remains the same
							if (canNavigate && !isNonNavigableRadientStep) {
								setCurrentStep(step);
							}
						}}
					/>
				</Tooltip>
			);
		});
	}, [currentStep, steps, visitedSteps, setCurrentStep]); // stepTitles is stable

	// Prepare the final stepIndicators prop for OnboardingDialog
	const finalStepIndicatorsProp = useMemo(() => {
		// If there are no dot elements to render, pass null to OnboardingDialog
		if (!stepIndicatorDotElements) {
			return null;
		}
		// Otherwise, wrap the dots in the StepIndicatorContainer
		return (
			<StepIndicatorContainer>{stepIndicatorDotElements}</StepIndicatorContainer>
		);
	}, [stepIndicatorDotElements]);

	return (
		<OnboardingDialog
			open={open}
			title={dialogTitle}
			stepIndicators={finalStepIndicatorsProp} // Use the new variable
			actions={dialogActions}
			dialogProps={{
				disableEscapeKeyDown: true, // Prevent closing with Escape key
			}}
		>
			{/* Render the actual step content - Loading indicator removed */}
			{stepContent}
		</OnboardingDialog>
	);
};
