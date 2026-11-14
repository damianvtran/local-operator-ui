/**
 * The phone pairing popup in every state core can put it in (pairing design v2
 * §4.2; local-operator #3949). Presentational: each story pins the card and the
 * clock, so a frame is the same on every render and the design and UX rounds can
 * compare like with like. The live wiring (`PhonePairingHost`) is exercised by
 * `scripts/phone-pairing.test.mjs`.
 *
 * The popup is `position: fixed` at the window's bottom-right, as it is in the
 * app, so each story renders over a plain page rather than in a padded box.
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type { PairingCard } from "./pairing-model";
import { PairingPopupView, type PairingPopupViewProps } from "./pairing-popup";
import "../../styles/index.css";

const NOW = 1_763_100_000;
const DIGEST = `sha256:${"a".repeat(64)}`;

const confirmCard: PairingCard = {
	approvalId: "ap_0123456789abcdef",
	mode: "confirm",
	phoneName: "Ana's iPhone",
	phoneNameFull: "Ana's iPhone",
	platform: "ios",
	sas: "482913",
	expiresAt: NOW + 4 * 60 + 12,
	reason: "waiting",
	triesLeft: 3,
	account: "acct_01",
	requestDigest: DIGEST,
	disclosureDigest: DIGEST,
	assurance: "presence",
	gesture:
		"Your Mac will ask for Touch ID or its login password — that's your Mac confirming, not your Radient password.",
};

const typedCard: PairingCard = {
	...confirmCard,
	mode: "code",
	sas: null,
	account: null,
	platform: "web",
	phoneName: "Chrome on Pixel 8",
	phoneNameFull: "Chrome on Pixel 8",
};

const noop = () => {};

const Frame: FC<Partial<PairingPopupViewProps> & { card: PairingCard }> = (
	props,
) => (
	<div className="min-h-[560px] bg-canvas">
		<PairingPopupView
			now={NOW}
			onApprove={noop}
			onDeny={noop}
			onRetry={noop}
			onClose={noop}
			{...props}
		/>
	</div>
);

const meta: Meta<typeof Frame> = {
	title: "Phone pairing/Popup",
	component: Frame,
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof Frame>;

/** Requested through the owner's Radient account: compare the codes. */
export const AttestedConfirm: Story = { args: { card: confirmCard } };

/** Requested over a custom tunnel: the code is typed, never shown here. */
export const TypedEntry: Story = { args: { card: typedCard } };

export const WrongCode: Story = {
	args: {
		card: { ...typedCard, triesLeft: 2 },
		error: { kind: "wrong_code", triesLeft: 2 },
	},
};

export const LastTry: Story = {
	args: {
		card: { ...typedCard, triesLeft: 1 },
		error: { kind: "wrong_code", triesLeft: 1 },
	},
};

export const StrikesExhausted: Story = {
	args: {
		card: { ...typedCard, reason: "strikes_exhausted" },
		outcome: "strikes",
	},
};

/** The press is in flight: Touch ID (or the OS's own prompt) is up. */
export const Signing: Story = {
	args: { card: { ...confirmCard, reason: "signing" }, busy: "approve" },
};

export const AdminPromptOpen: Story = {
	args: {
		card: { ...confirmCard, reason: "admin_prompt_open" },
		busy: "approve",
	},
};

export const CancelledTryAgain: Story = {
	args: { card: { ...confirmCard, reason: "failed_retryable" } },
};

export const Connected: Story = {
	args: { card: { ...confirmCard, reason: "paired" }, outcome: "paired" },
};

export const Denied: Story = {
	args: {
		card: { ...confirmCard, reason: "denied_by_user" },
		outcome: "denied",
	},
};

/** Expired under the person's own press (an untouched card simply disappears). */
export const ExpiredWhileDeciding: Story = {
	args: { card: { ...typedCard, reason: "expired" }, outcome: "expired" },
};

/** Deny pressed, its answer not back yet: both buttons hold still. */
export const BusyDenying: Story = {
	args: { card: confirmCard, busy: "deny" },
};

export const ChangedSinceShown: Story = {
	args: { card: confirmCard, error: { kind: "changed" } },
};

/** The name is what the phone sent: clamped, bidi-stripped, full form on demand. */
export const LongName: Story = {
	args: {
		card: {
			...confirmCard,
			phoneName: "Ana's iPhone (work) — personal device for the finance te…",
			phoneNameFull:
				"Ana's iPhone (work) — personal device for the finance team rota",
		},
	},
};

/** Phone approvals are not on yet; `features.operator_setup` offers the fix. */
export const NotSetUp: Story = {
	args: {
		card: { ...confirmCard, assurance: null, sas: null },
		setup: { running: false, onTurnOn: noop },
	},
};

export const NotSetUpTurningOn: Story = {
	args: {
		card: { ...confirmCard, assurance: null, sas: null },
		setup: { running: true, onTurnOn: noop },
	},
};

/** An older backend with no setup route: says where to turn it on instead. */
export const NotSetUpNoSetupRoute: Story = {
	args: { card: { ...confirmCard, assurance: null, sas: null }, setup: null },
};
