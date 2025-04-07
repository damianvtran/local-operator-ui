import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import type { Meta, StoryObj } from "@storybook/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import theme from "../../theme";
import { OnboardingModal } from "./onboarding-modal";
import {
	useOnboardingStore,
	OnboardingStep,
} from "../../store/onboarding-store";

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
			// Reset onboarding store and set to welcome step before rendering
			const state = useOnboardingStore.getState();
			state.resetOnboarding();
			state.setCurrentStep(OnboardingStep.WELCOME);

			const queryClient = new QueryClient();

			return (
				<QueryClientProvider client={queryClient}>
					<MemoryRouter>
						<ThemeProvider theme={theme}>
							<CssBaseline />
							<Story />
						</ThemeProvider>
					</MemoryRouter>
				</QueryClientProvider>
			);
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
