import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
/* Also imported by the Storybook preview; kept here so the file is honest
   about what it needs to render, and so it renders if run in isolation. */
import "../../../styles/index.css";
import { OnboardingModal } from "./onboarding-modal";

/**
 * The first-run flow, one story per step.
 *
 * ## Why every step has its own story
 *
 * The flow is six screens. Pacing is a property of the sequence, and you
 * cannot judge a sequence you can only enter at one end.
 *
 * ## Why `data-theme` goes on `documentElement`
 *
 * The dialog portals to `document.body`, outside any wrapper a story could
 * render. With the theme only on a wrapper every `--lo-*` read inside the
 * portal resolves to nothing and the panel comes out unstyled — while the page
 * behind it looks correct, which makes it slow to diagnose. The preview frame
 * in `.storybook/preview.tsx` puts it on the root for every story.
 *
 * ## What is not real here
 *
 * There is no backend, so the steps that read providers, credentials, models
 * or public agents render their loading or empty branch. That is the honest
 * thing to screenshot: those branches are states a real user hits too.
 */
type StoryArgs = {
	step: OnboardingStep;
};

const OnboardingFrame = ({ step }: StoryArgs) => {
	useLayoutEffect(() => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(step);
	}, [step]);

	return <OnboardingModal open={true} />;
};

const meta: Meta<StoryArgs> = {
	title: "Onboarding/OnboardingModal",
	parameters: { layout: "fullscreen" },
	argTypes: {
		step: { control: "select", options: Object.values(OnboardingStep) },
	},
	args: { step: OnboardingStep.CONNECT_PROVIDER },
	render: ({ step }) => <OnboardingFrame step={step} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** The first screen: the registry-backed provider grid. */
export const Default: Story = {};

/** Name and optional email. Two fields, one optional. */
export const UserProfile: Story = {
	args: { step: OnboardingStep.USER_PROFILE },
};

/** A skippable step in the flow. */
export const SearchApi: Story = { args: { step: OnboardingStep.SEARCH_API } };

/** Two dependent selects; renders its loading branch without a backend. */
export const DefaultModel: Story = {
	args: { step: OnboardingStep.DEFAULT_MODEL },
};

/** The last decision. Without a backend this shows the load-failure branch. */
export const CreateAgent: Story = {
	args: { step: OnboardingStep.CREATE_AGENT },
};

/** The end of the flow, and the one place the accent is spent on celebration. */
export const Congratulations: Story = {
	args: { step: OnboardingStep.CONGRATULATIONS },
};
