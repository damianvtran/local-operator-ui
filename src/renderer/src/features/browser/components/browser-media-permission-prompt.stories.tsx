import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { MediaPermissionView } from "../../../../../shared/browser-media-permission";
import { BrowserMediaPermissionPrompt } from "./browser-media-permission-prompt";

/**
 * The real camera/microphone band, not an imitation of browser chrome. Only the
 * callback and the view are fixtures: these states prove copy, wrapping and
 * the answer interaction, not that main grants (that is
 * `scripts/browser-media-permissions.test.mjs` and the app-level run).
 * Language/theme controls come from the shared Storybook decorators.
 */
const meta = {
	title: "Browser/Camera and microphone prompt",
	component: BrowserMediaPermissionPrompt,
	parameters: { layout: "fullscreen" },
	args: { onDecide: () => {} },
	render: function InteractivePrompt(args) {
		const [answered, setAnswered] = useState(false);
		return (
			<div className="min-h-32 bg-canvas">
				<BrowserMediaPermissionPrompt
					{...args}
					view={answered ? null : args.view}
					onDecide={(view, decision, trusted) => {
						setAnswered(true);
						args.onDecide(view, decision, trusted);
					}}
				/>
			</div>
		);
	},
} satisfies Meta<typeof BrowserMediaPermissionPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

function prompt(
	overrides: Partial<Extract<MediaPermissionView, { kind: "prompt" }>> = {},
): MediaPermissionView {
	return {
		kind: "prompt",
		tabId: 7,
		id: "story-prompt",
		origin: "https://meet.google.com",
		kinds: ["audio", "video"],
		ownerKind: "user",
		at: 0,
		...overrides,
	};
}

export const CameraAndMicrophone: Story = { args: { view: prompt() } };
export const MicrophoneOnly: Story = {
	args: { view: prompt({ kinds: ["audio"] }) },
};
export const CameraOnly: Story = {
	args: { view: prompt({ kinds: ["video"] }) },
};
/** On an agent-driven tab an allow is one-shot, and the band says so. */
export const AgentTab: Story = {
	args: { view: prompt({ ownerKind: "agent" }) },
};
/** The user allowed, but macOS has the app's camera turned off. */
export const SystemBlocked: Story = {
	args: {
		view: {
			kind: "system-blocked",
			tabId: 7,
			id: "story-blocked",
			origin: "https://meet.google.com",
			kinds: ["video"],
			at: 0,
		},
	},
};
