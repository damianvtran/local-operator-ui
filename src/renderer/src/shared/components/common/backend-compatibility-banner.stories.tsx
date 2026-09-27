/**
 * The backend compatibility band, one story per state it can state.
 *
 * WHY THIS FILE EXISTS (design note § 5.1, REQUIRED). The banner's states are
 * conditions of a running daemon - a successor this app has not re-claimed, a
 * plane another program governs, a 401, a version gap - and no live capture can
 * arrange them without standing up each broken backend in turn. The operator's
 * report is exactly one of them (a successor beside a refused strip), so the
 * states the fix is about would otherwise have no frames at all.
 * `BackendCompatibilityBannerView` takes them as props for this: the container
 * reads the hooks and the suppression, and these stories hand the presenter the
 * same values the container would compute.
 *
 * THE FRAMES ARE THE PANE, not a blank page: the band now draws the strip's own
 * grammar in the strip's own column (`shrink-0 px-6 py-1`, `NOTICE_BAND`), so a
 * frame on white would say nothing about the surface it lives on. The top row
 * is the same scaffold the strip's stories use.
 *
 * `canUpdate` (the updater IPC's presence) is assumed TRUE here as it is in the
 * app; a browser-dev renderer hashes no updater and would offer no update
 * anywhere, which is not a state worth twelve frames. The COPY is the shipped
 * tables' - `BACKEND_PAIRING_SENTENCE`, `backendCompatibilityMessage`,
 * `BACKEND_UPDATE_UNEXPLAINED` - never a retyped paraphrase, so a copy change
 * moves the frames with it rather than leaving them describing an old app.
 */

import {
	BACKEND_PAIRING_SENTENCE,
	backendCompatibilityMessage,
} from "@shared/api/local-operator/backend-error";
import type { Meta, StoryObj } from "@storybook/react";
import {
	BACKEND_UPDATE_UNEXPLAINED,
	BackendCompatibilityBannerView,
} from "./backend-compatibility-banner";

const PANE = ({ children }: { children: React.ReactNode }) => (
	<div className="min-h-[220px] w-full bg-canvas p-0">
		{/* The pane's top row, so the band's own place under it is legible. */}
		<div className="flex h-10 items-center px-6 text-body-sm text-ink">
			Fix the flaky scroll-anchor test
		</div>
		{children}
	</div>
);

const noop = () => {};

const meta = {
	title: "Chat/Backend compatibility banner",
	component: BackendCompatibilityBannerView,
	parameters: { layout: "fullscreen" },
	render: (args) => (
		<PANE>
			<BackendCompatibilityBannerView {...args} />
		</PANE>
	),
} satisfies Meta<typeof BackendCompatibilityBannerView>;

export default meta;
type Story = StoryObj<typeof BackendCompatibilityBannerView>;

/** The fields every state shares; each story overrides the ones it is about. */
const base = {
	severity: "warning" as const,
	offerUpdate: false,
	offerRetry: false,
	updating: false,
	updateError: null,
	onRetry: noop,
	onUpdate: noop,
};

/**
 * The operator's incident class: a successor this app has not re-claimed. The
 * banner is the ONE band here (the strip is silent for this cause), it offers
 * re-claiming, and its severity is `warning` - a transition the app performs.
 */
export const Successor: Story = {
	args: {
		...base,
		message: BACKEND_PAIRING_SENTENCE.successor,
		offerRetry: true,
	},
};

/**
 * Another program's plane: a permanent-ish limitation with NO remedy, which is
 * why this band carries no control at all (a Retry here is the button that
 * provably cannot work).
 */
export const GovernedElsewhere: Story = {
	args: {
		...base,
		message: BACKEND_PAIRING_SENTENCE["governed-elsewhere"],
	},
};

/**
 * An install older than the handshake, unowned: the update would be the remedy
 * only for an install this app holds, so the unowned state offers nothing.
 */
export const PreHandshake: Story = {
	args: {
		...base,
		message: BACKEND_PAIRING_SENTENCE["pre-handshake"],
	},
};

/**
 * The refusal, in the severity it shares with the strip: ONE fact, ONE
 * severity. Reachable only where the strip is silent or absent - the refusal is
 * the strip's fact in the pane, and this band's own yield stands it down beside
 * a strip that speaks - so this story is the band's own state and NOT a
 * `/settings` one: `/settings` mounts neither surface (the evidence README's
 * mount-site audit; agent review round 1's MINOR-3 corrected this sentence,
 * which had claimed that page).
 */
export const CredentialRefused: Story = {
	args: {
		...base,
		message: BACKEND_PAIRING_SENTENCE["credential-refused"],
		severity: "danger",
		offerRetry: true,
	},
};

/**
 * No cause established yet: the honest fallback, with re-claiming as the one
 * act that can change it.
 */
export const Unpaired: Story = {
	args: {
		...base,
		message: BACKEND_PAIRING_SENTENCE.unpaired,
		offerRetry: true,
	},
};

/**
 * The outage the strip states one element up: no pairing cause and no payload
 * at all. This frame is the state the banner keeps for where the strip is NOT
 * mounted (and the half § 2.3's `!answered` yield suppresses in the pane); both
 * acts are offered, the update as the primary.
 */
export const UnansweredProbe: Story = {
	args: {
		...base,
		message: backendCompatibilityMessage({
			kind: "unreachable",
			unpaired: false,
			missing: [],
			answered: false,
			cause: null,
		}),
		offerUpdate: true,
		offerRetry: true,
	},
};

/**
 * The update-failed suffix: the band keeps its single `Update backend` remedy
 * and states what the updater reported, from the same fallback string the
 * container sets (`BACKEND_UPDATE_UNEXPLAINED`).
 */
export const UpdateFailed: Story = {
	args: {
		...base,
		message: BACKEND_PAIRING_SENTENCE["pre-handshake"],
		offerUpdate: true,
		updateError: BACKEND_UPDATE_UNEXPLAINED,
	},
};

/**
 * Both acts offered: a paired daemon this app holds, missing a negotiated
 * feature. `Update backend` is the primary (it is the remedying act) and
 * `Retry` demotes to `ghost` - one primary per band, ever.
 */
export const DoubleControl: Story = {
	args: {
		...base,
		message: backendCompatibilityMessage({
			kind: "unknown",
			unpaired: false,
			missing: ["mcp"],
			answered: true,
			cause: null,
		}),
		offerUpdate: true,
		offerRetry: true,
	},
};
