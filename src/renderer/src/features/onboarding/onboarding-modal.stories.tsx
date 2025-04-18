import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import {
	OnboardingStep,
	useOnboardingStore,
} from "../../store/onboarding-store";
import { OnboardingModal } from "./onboarding-modal";

/**
 * Storybook stories for the OnboardingModal component.
 *
 * This showcases the full onboarding flow with mocked Zustand store state.
 * The onboarding steps are displayed inside a fullscreen modal with theme-aware styling.
 */
const meta: Meta<typeof OnboardingModal> = {
	title: "Onboarding/OnboardingModal",
	component: OnboardingModal,
	parameters: {
		layout: "fullscreen",
		viewport: {
			defaultViewport: "custom",
			viewports: {
				custom: {
					name: "Onboarding Window",
				},
			},
		},
	},
	decorators: [
		(Story) => {
			const state = useOnboardingStore.getState();
			state.resetOnboarding();
			state.setCurrentStep(OnboardingStep.WELCOME);

			// Clear the session to allow re-running the story
			window.sessionStorage.removeItem("mock-radient-session");

			return <Story />;
		},
	],
	tags: ["autodocs"],
};

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Default onboarding flow starting at the welcome step.
 */
export const Default: Story = {
	args: {
		open: true,
	},
};

/**
 * Onboarding flow showcasing the congratulations step.
 */
export const Congratulations: Story = {
	args: {
		open: true,
	},
	render: () => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(OnboardingStep.CONGRATULATIONS);

		return <OnboardingModal open={true} />;
	},
};

/**
 * Onboarding flow showcasing the Radient sign-in step.
 */
export const RadientSignIn: Story = {
	args: {
		open: true,
	},
	render: () => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(OnboardingStep.RADIENT_SIGNIN);

		return <OnboardingModal open={true} />;
	},
};
