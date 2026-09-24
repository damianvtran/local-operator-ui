/**
 * The chat pane's one connection surface, in each of the four states it exists
 * for (§F2; design round 1's D3, which found the app mounting TWO bands above the
 * window instead).
 *
 * WHY THIS IS A STORY AND NOT ONLY A TEST. `scripts/chat-status-strip.test.mjs`
 * drives the table with its inputs and pins the surface's contract from the
 * source; what it cannot say is what the strip LOOKS like where it lives - the
 * wash against the `canvas` the transcript sits on, the one-line/two-line bound,
 * the pill in its dismissed state. Those are pixels, and every state here is a
 * condition of a running daemon, so no live capture can arrange them without
 * standing up a broken backend. `ChatStatusStripView` takes the readings as
 * props for exactly this: the container reads the hooks, and these stories hand
 * the presenter the same values the table would compute.
 *
 * The frames are taken over `canvas` rather than a blank page, because the strip
 * is a block of the conversation: a wash measured against white would say nothing
 * about the surface it is drawn on.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { chatStatusDisplay, chatStatusKey } from "../chat-status";
import { ChatStatusStripView } from "./chat-status-strip";

const PANE = ({ children }: { children: React.ReactNode }) => (
	<div className="min-h-[220px] w-full bg-canvas p-0">
		{/* The pane's top row, so the strip's own place under it is legible. */}
		<div className="flex h-10 items-center px-6 text-body-sm text-ink">
			Fix the flaky scroll-anchor test
		</div>
		{children}
	</div>
);

const meta = {
	title: "Chat/Chat status strip",
	component: ChatStatusStripView,
	parameters: { layout: "fullscreen" },
	render: (args) => (
		<PANE>
			<ChatStatusStripView {...args} />
		</PANE>
	),
} satisfies Meta<typeof ChatStatusStripView>;

export default meta;
type Story = StoryObj<typeof ChatStatusStripView>;

/** The `display` a state resolves to, from the shipped table rather than by hand. */
const shown = (input: Parameters<typeof chatStatusDisplay>[0]) => ({
	display: chatStatusDisplay(input),
	dismissedKey: null,
	onDismiss: () => {},
	onShow: () => {},
});

export const Unreachable: Story = {
	args: shown({
		connectivityIssue: "server_offline",
		server: { state: "detached", detail: null, pairing: null },
		internetOffline: false,
	}),
};

export const RefusedCredential: Story = {
	args: shown({
		connectivityIssue: null,
		server: {
			state: "wedged",
			detail: "The running server refused this app's key.",
			pairing: { available: false, cause: "credential-refused" },
		},
		internetOffline: false,
	}),
};

export const Degraded: Story = {
	args: shown({
		connectivityIssue: null,
		server: { state: "degraded", detail: null, pairing: null },
		internetOffline: false,
	}),
};

export const InternetOffline: Story = {
	args: shown({
		connectivityIssue: "internet_offline",
		server: null,
		internetOffline: true,
	}),
};

/** The Retry's own progress and outcome, which U7's report was about. */
export const Retrying: Story = {
	args: {
		...shown({
			connectivityIssue: "server_offline",
			server: { state: "detached", detail: null, pairing: null },
			internetOffline: false,
		}),
		retrying: true,
	},
};

export const RetryOutcome: Story = {
	args: {
		...shown({
			connectivityIssue: "server_offline",
			server: { state: "detached", detail: null, pairing: null },
			internetOffline: false,
		}),
		outcome: "Still unreachable.",
	},
};

/**
 * Dismissed: the 24px pill that re-expands, and the state it stands for.
 *
 * The dismissal is keyed on the state the reader dismissed rather than on a
 * boolean, so the pill is what remains of THAT state; a later root cause brings
 * the strip back. Both are shown so a reviewer can see the pill is not a
 * disappearance.
 */
export const Dismissed: Story = {
	render: () => {
		const display = chatStatusDisplay({
			connectivityIssue: "server_offline",
			server: { state: "detached", detail: null, pairing: null },
			internetOffline: false,
		});
		/*
		 * THE STORY STARTS DISMISSED, keyed on the state's own key rather than on a
		 * hand-written string: an earlier revision started with `null` and therefore
		 * photographed the EXPANDED strip a second time - a frame whose name claims a
		 * state it does not show, which is the same class of defect as a frame
		 * stamped with a tree it was not built from (design round 1, D4). `Show`
		 * re-expands it, because the pill's contract is that the strip is one press
		 * away.
		 */
		const [dismissed, setDismissed] = useState<string | null>(
			chatStatusKey(display),
		);
		return (
			<PANE>
				<ChatStatusStripView
					display={display}
					dismissedKey={dismissed}
					onDismiss={setDismissed}
					onShow={() => setDismissed(null)}
				/>
			</PANE>
		);
	},
};
