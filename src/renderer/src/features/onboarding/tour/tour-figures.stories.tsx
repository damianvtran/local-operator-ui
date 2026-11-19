import type { Meta, StoryObj } from "@storybook/react";
/* The preview's theme reaches `documentElement`; these imports make the story
   honest about the CSS it needs and keep it renderable in isolation. */
import "../../../styles/index.css";
import "../onboarding-tour.css";
import { TOUR_BODIES, renderTourBody } from "./tour-copy";

/**
 * The two wordless figures that replaced the onboarding screenshots.
 *
 * This is a BODY preview, not the Shepherd overlay: the tour is opened by
 * `OnboardingProvider` in the live app, and its title/footer/spotlight are
 * Shepherd's own DOM. What a designer can judge here is the changed surface -
 * the figure inside the real `.shepherd-text` box, on whichever theme the
 * Storybook toolbar selects. The full tour still needs a rendered app frame.
 */
type StoryArgs = {
	body: "welcome" | "agent_capabilities";
};

const FigureFrame = ({ body }: StoryArgs) => (
	<div className="shepherd-element">
		<div
			className="shepherd-text"
			// The same HTML `renderTourBody` hands to Shepherd; the figures carry
			// no text nodes, so the only copy is the block's accessible label.
			// biome-ignore lint/security/noDangerouslySetInnerHtml: renderTourBody is the same escaped HTML the Shepherd runtime injects
			dangerouslySetInnerHTML={{ __html: renderTourBody(TOUR_BODIES[body]) }}
		/>
	</div>
);

const meta: Meta<StoryArgs> = {
	title: "Onboarding/TourFigures",
	parameters: { layout: "centered" },
	argTypes: {
		body: { control: "select", options: ["welcome", "agent_capabilities"] },
	},
	args: { body: "welcome" },
	render: (args) => <FigureFrame {...args} />,
};

export default meta;
type Story = StoryObj<StoryArgs>;

/** The chat-window figure in step 1. */
export const Welcome: Story = {};

/** The three-step work-sequence figure in step 6. */
export const AgentCapabilities: Story = {
	args: { body: "agent_capabilities" },
};
