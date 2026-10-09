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
