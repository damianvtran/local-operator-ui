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

import { BACKEND_PAIRING_SENTENCE } from "@shared/api/local-operator/backend-error";
import {
	BackendCompatibilityBannerView,
	type BackendCompatibilityBannerViewProps,
} from "@shared/components/common/backend-compatibility-banner";
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

/**
 * The pane a pill story stands in: the 40px top row, the pill's own slot, and
 * the two seeded lines the conversation carries on with.
 *
 * WHY THE TRANSCRIPT IS HERE RATHER THAN A BARE PILL. The capture rig's
 * element floor (`storyDrew`: seven own elements, minus the decorator's two)
 * rejects a story that is only a 24px pill - measured: five own elements, and
 * the run fails with `Storybook never finished preparing the story` after
 * sixty seconds. The two lines are the repo's seeded transcript's own copy, and
 * they are what the pill's contract needs beside it anyway: a collapsed strip
 * is a pane that CARRIES ON, and a frame of the pill alone shows neither what
 * it sits over nor what it leaves running.
 */
const PILL_PANE = ({ children }: { children: React.ReactNode }) => (
	<PANE>
		{children}
		<div className="px-6 py-3">
			<p className="text-body-sm text-ink">
				Say hello before the daemon drops.
			</p>
			<p className="text-body-sm text-ink-muted">
				Hello from the mock provider!
			</p>
		</div>
	</PANE>
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
			<PILL_PANE>
				<ChatStatusStripView
					display={display}
					dismissedKey={dismissed}
					onDismiss={setDismissed}
					onShow={() => setDismissed(null)}
				/>
			</PILL_PANE>
		);
	},
};

/**
 * The refused band at the narrow width, where its sentence wraps.
 *
 * WHY THIS STATE IS ITS OWN FRAME (design note § 5.1). The band's geometry has
 * a floor the wide frames cannot show: the cause-gated copy is the longest
 * sentence the strip ever carries, and at ~640px it wraps to three lines - the
 * row must still centre its 14px mark, keep `Retry` and the dismiss control on
 * one line, and hold its 4px wrapper. The wide states hide all of that behind
 * spare width. Same fixture as `RefusedCredential`, deliberately: the narrow
 * frame differs from it by the VIEWPORT alone, so the pair reads as one state
 * at two widths rather than as two sentences.
 */
export const Narrow: Story = {
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

/**
 * The warning pill: what a dismissed warning state collapses to.
 *
 * The `Dismissed` story is the danger half; the pill's dot is the one thing
 * that keeps the severity legible after the wash goes away, so both halves are
 * frames rather than one. Same transcript context as the danger pill, for the
 * same reason it is there at all.
 */
export const DismissedWarning: Story = {
	render: () => {
		const display = chatStatusDisplay({
			connectivityIssue: null,
			server: { state: "degraded", detail: null, pairing: null },
			internetOffline: false,
		});
		const [dismissed, setDismissed] = useState<string | null>(
			chatStatusKey(display),
		);
		return (
			<PILL_PANE>
				<ChatStatusStripView
					display={display}
					dismissedKey={dismissed}
					onDismiss={setDismissed}
					onShow={() => setDismissed(null)}
				/>
			</PILL_PANE>
		);
	},
};

/*
 * THE COMPOSED STACKS: one incident, one voice, measured in the pane's own
 * column (design note § 5.1, § 4's first calm).
 *
 * Each story renders the composition the APP renders for that incident - which
 * is `ChatStatusStripView` AND `BackendCompatibilityBannerView` where the
 * banner does not yield, and the ONE band where it does. The yield itself lives
 * in the banner's container (`bannerYieldsToStrip`, `backend-error-surfaces.test.mjs`),
 * so a story that rendered both bands for the refused case would photograph a
 * composition the app never shows; the absent band in the one-band frames IS
 * the fix, and the banner's own stories cover its states.
 */

/** The banner view's props, with the fields a state does not use filled in. */
const banner = (state: {
	message: string;
	severity: "danger" | "warning";
	offerUpdate?: boolean;
	offerRetry?: boolean;
	updating?: boolean;
	updateError?: string | null;
}): BackendCompatibilityBannerViewProps => ({
	offerUpdate: false,
	offerRetry: false,
	updating: false,
	updateError: null,
	onRetry: () => {},
	onUpdate: () => {},
	...state,
});

const noop = () => {};

/**
 * The operator's incident, after the fix: ONE band in the pane.
 *
 * Refused credential is reachable while the server ANSWERS, which is why the
 * strip's presence is unrelated to `online` - and why the banner needs the
 * yield rule rather than a connection check. This frame is the composed pair
 * with the banner's contribution ABSENT: see the comment above.
 */
export const ComposedRefused: Story = {
	render: () => (
		<PANE>
			<ChatStatusStripView
				display={chatStatusDisplay({
					connectivityIssue: null,
					server: {
						state: "wedged",
						detail: "The running server refused this app's key.",
						pairing: { available: false, cause: "credential-refused" },
					},
					internetOffline: false,
				})}
				dismissedKey={null}
				onDismiss={noop}
				onShow={noop}
			/>
		</PANE>
	),
};

/**
 * The operator's OTHER incident: a successor, after the fix - ONE band, the
 * banner's (the strip's successor row no longer exists; design note § 0.1).
 */
export const ComposedSuccessor: Story = {
	render: () => (
		<PANE>
			<ChatStatusStripView
				display={chatStatusDisplay({
					connectivityIssue: null,
					server: {
						state: "attached",
						detail: "Connected to the daemon.",
						pairing: { available: false, cause: "successor" },
					},
					internetOffline: false,
				})}
				dismissedKey={null}
				onDismiss={noop}
				onShow={noop}
			/>
			<BackendCompatibilityBannerView
				{...banner({
					message: BACKEND_PAIRING_SENTENCE.successor,
					severity: "warning",
					offerRetry: true,
				})}
			/>
		</PANE>
	),
};

/**
 * The blessed two-band pair: a degraded connection beside a pairing cause.
 *
 * § 2.3 names this as one that may legitimately co-render - two different
 * facts, so two bands, both warning - and this frame is what keeps the ruling
 * from reading as "never two bands": it is the case a later change must NOT
 * silently collapse to one.
 */
export const ComposedDegradedSuccessor: Story = {
	render: () => (
		<PANE>
			<ChatStatusStripView
				display={chatStatusDisplay({
					connectivityIssue: null,
					server: {
						state: "degraded",
						detail: "The daemon has not answered two probes.",
						pairing: { available: false, cause: "successor" },
					},
					internetOffline: false,
				})}
				dismissedKey={null}
				onDismiss={noop}
				onShow={noop}
			/>
			<BackendCompatibilityBannerView
				{...banner({
					message: BACKEND_PAIRING_SENTENCE.successor,
					severity: "warning",
					offerRetry: true,
				})}
			/>
		</PANE>
	),
};

/**
 * The server gone with no pairing cause: ONE band, the strip's - the case
 * § 2.3 adds to D29's yield (`cause === null && !answered`, outage-shaped).
 */
export const ComposedServerGone: Story = {
	render: () => (
		<PANE>
			<ChatStatusStripView
				display={chatStatusDisplay({
					connectivityIssue: "server_offline",
					server: {
						state: "detached",
						detail: "The daemon's process is gone.",
						pairing: null,
					},
					internetOffline: false,
				})}
				dismissedKey={null}
				onDismiss={noop}
				onShow={noop}
			/>
		</PANE>
	),
};
