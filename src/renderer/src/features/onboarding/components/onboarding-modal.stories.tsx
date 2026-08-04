import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useLayoutEffect } from "react";
/* Storybook's preview does not load the app's stylesheet, so a story that
   renders ported components has to bring it or it renders with no utilities. */
import "../../../styles/index.css";
import { OnboardingModal } from "./onboarding-modal";

/**
 * The first-run flow, one story per step.
 *
 * ## Why every step has its own story
 *
 * The flow is eight screens and only three of them used to be reachable here,
 * so the four form steps — where the control heights, the label rhythm and the
 * help-text register actually live — were reviewed by clicking through the
 * running app or not at all. Pacing is a property of the sequence, and you
 * cannot judge a sequence you can only enter at one end.
 *
 * ## Why `data-theme` goes on `documentElement`
 *
 * The dialog portals to `document.body`, outside any wrapper a story could
 * render. With the theme only on a wrapper every `--lo-*` read inside the
 * portal resolves to nothing and the panel comes out unstyled — while the page
 * behind it looks correct, which makes it slow to diagnose.
 *
 * ## What is not real here
 *
 * There is no backend, so the steps that read credentials, models or public
 * agents render their loading or empty branch. That is the honest thing to
 * screenshot: those branches are states a real user hits too.
 */
const THEME_IDS = [
	"localOperatorDark",
	"localOperatorLight",
	"dracula",
	"dune",
	"sage",
	"monokai",
	"tokyoNight",
	"iceberg",
	"radient",
	"neon",
	"obsidian",
	"synth",
] as const;

type StoryArgs = {
	theme: (typeof THEME_IDS)[number];
	step: OnboardingStep;
};

const OnboardingFrame = ({ theme, step }: StoryArgs) => {
	useLayoutEffect(() => {
		const previous = document.documentElement.dataset.theme;
		document.documentElement.dataset.theme = theme;

		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(step);
		// Cleared so the modal's session-restore effect does not jump the flow
		// to Create agent on every re-render of a story.
		window.sessionStorage.removeItem("mock-radient-session");

		return () => {
			if (previous === undefined) {
				document.documentElement.removeAttribute("data-theme");
			} else {
				document.documentElement.dataset.theme = previous;
			}
		};
	}, [theme, step]);

	return (
		<div data-theme={theme} className="min-h-screen bg-canvas font-sans">
			<OnboardingModal open={true} />
		</div>
	);
};

const meta: Meta<StoryArgs> = {
	title: "Onboarding/OnboardingModal",
	parameters: { layout: "fullscreen" },
	argTypes: {
		theme: { control: "select", options: THEME_IDS },
		step: { control: "select", options: Object.values(OnboardingStep) },
	},
	args: { theme: "localOperatorDark", step: OnboardingStep.RADIENT_CHOICE },
	render: (args) => <OnboardingFrame {...args} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** The first screen: two options, one recommended, nothing else. */
export const Default: Story = {};

/** What Radient Pass is, and the two ways in. */
export const RadientSignIn: Story = {
	args: { step: OnboardingStep.RADIENT_SIGNIN },
};

/** First step of the do-it-yourself path. Two fields, one optional. */
export const UserProfile: Story = {
	args: { step: OnboardingStep.USER_PROFILE },
};

/** A select and a password field at the large control size. */
export const ModelCredential: Story = {
	args: { step: OnboardingStep.MODEL_CREDENTIAL },
};

/** The one skippable step in the flow. */
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
