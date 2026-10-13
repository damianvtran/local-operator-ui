/**
 * The session band's model-access statement, in the states it can be in.
 *
 * These render the PRODUCTION `SessionModelAccessBand` (the same component the
 * composer's band mounts) with a `modelAccessReading` value, so what is judged
 * is what ships. The two stories are the two widths the composer band has: the
 * shipped column and the narrow view, where the sentence wraps and the two
 * actions wrap with it.
 *
 * What to look for, since these frames are the design review:
 *
 * - The sentence names the PROVIDER, not a selector; if a model id appears in
 *   it, the copy has drifted back to the machine register.
 * - Both actions are underlined at rest. `variant="link"` underlines only on
 *   hover, so an underline that is missing at rest is the affordance carried
 *   by colour alone, which this repository's contract says is not one.
 * - The block is the composer band's horizontal inset (`px-4`, or `px-2` in
 *   the small view), the same edge every other standing block shares - a
 *   callout whose border sits on a different edge than the sentence under it
 *   reads as unrelated chrome.
 *
 * What these frames do NOT show: the composer beneath the band, and the fact
 * that this block renders nothing at all unless the host published
 * `model_access: signed_out` (`modelAccessReading` is where that rule lives,
 * asserted in `scripts/session-status.test.mjs`).
 */

import type { Meta, StoryObj } from "@storybook/react";
import type { CanonicalEffectiveAccessState } from "../../../../../shared/desktop-session-contract";
import { modelAccessReading } from "./session-model";
import { SessionModelAccessBand } from "./session-model-access";

const noop = () => {};

const meta: Meta<typeof SessionModelAccessBand> = {
	title: "Chat/Session model access band",
	component: SessionModelAccessBand,
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj<typeof SessionModelAccessBand>;

/** The band at the composer column's width. */
export const SignedOut: Story = {
	render: (args) => (
		<div className="w-[880px] bg-canvas p-6">
			<SessionModelAccessBand {...args} />
		</div>
	),
	args: {
		access: { provider: "anthropic", label: "Anthropic (Claude Pro/Max)" },
		onSwitchModel: noop,
		onConnect: noop,
	},
};

/** The narrow view: the same sentence and actions at the small-view inset. */
export const SignedOutNarrow: Story = {
	render: (args) => (
		<div className="w-[420px] bg-canvas p-4">
			<SessionModelAccessBand {...args} />
		</div>
	),
	args: {
		...SignedOut.args,
		isSmallView: true,
	},
};

/** Baseline reader: owner-outage facts used to collapse into this legacy copy. */
export const LegacyOwnerUnavailable: Story = {
	...SignedOut,
	args: {
		...SignedOut.args,
		access: {
			provider: "openai",
			label: "OpenAI",
			state: "temporarily_unavailable",
		},
	},
};

const nativeStates: [CanonicalEffectiveAccessState, string][] = [
	["pending", "Waiting for access"],
	["eligible_borrow_unverified", "Permission, not yet verified"],
	["effective_borrow", "Borrowed access"],
	["expired", "Refresh needed"],
	["withdrawn", "Access withdrawn"],
	["owner_unavailable", "Owner unavailable"],
	["device_bound", "Device-bound login"],
	["absent", "No access"],
];

/**
 * Real reader + real band, synthetic keyless host frames. No provider mode is
 * invented and no selector/effort change is dispatched while access converges.
 * Local access and an older host's silence render no band (covered by contracts).
 */
export const NativeAccessMatrix: Story = {
	parameters: { layout: "fullscreen" },
	render: (args) => {
		const observed = Math.floor(Date.now() / 1000);
		return (
			<div className="bg-canvas p-6">
				<h1 className="mb-2 text-lg font-semibold text-ink">
					Remote provider access
				</h1>
				<p className="mb-6 text-body-sm text-ink-muted">
					Selected openai/gpt-6.1-sol · High effort · Synthetic host frames
				</p>
				<div
					className={
						args.isSmallView
							? "grid grid-cols-1 gap-6"
							: "grid grid-cols-1 gap-6 lg:grid-cols-2"
					}
				>
					{nativeStates.map(([state, heading]) => {
						const hasHistory = [
							"effective_borrow",
							"expired",
							"owner_unavailable",
							"withdrawn",
						].includes(state);
						const access = modelAccessReading({
							selected_model: {
								provider: "openai",
								model_id: "gpt-6.1-sol",
								reasoning_effort: "high",
							},
							model_access: {
								provider: "openai",
								label: "OpenAI",
								effective_state: state,
								state:
									state === "effective_borrow"
										? "ok"
										: "temporarily_unavailable",
								owner_device: "synthetic-owner",
								owner_label: "Work laptop",
								observed_at: observed,
								last_grant_at: hasHistory ? observed - 180 : undefined,
								last_grant_expires_at: hasHistory
									? observed + (state === "effective_borrow" ? 600 : -120)
									: undefined,
							},
						} as Parameters<typeof modelAccessReading>[0]);
						return (
							<section key={state}>
								<h2 className="mb-2 text-body-sm font-medium text-ink-muted">
									{heading}
								</h2>
								{access && (
									<SessionModelAccessBand
										access={access}
										isSmallView={args.isSmallView}
										onConnect={noop}
										onSwitchModel={noop}
									/>
								)}
							</section>
						);
					})}
				</div>
			</div>
		);
	},
};
