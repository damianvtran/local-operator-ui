/**
 * The composer's "cannot send" line (D4) and a failed message's fix (D3),
 * onboarding friction 2026-11.
 *
 * The line is the production `SendBlockedLineView`; the in-context frames are
 * `Chat/Composer band` (`EmptyChatNoProvider`, `BlockedNoModel`,
 * `BlockedServerOffline`). The undelivered rows render the production
 * `UndeliveredLine` with fixture failures: with no desktop bridge in Storybook
 * the live provider/health reads stay unknown, so each row's fix comes from its
 * own code and sentence, which is the path a real failure takes.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { UndeliveredLine } from "../canonical/canonical-transcript";
import { SendBlockedLineView } from "./send-recovery-action";
import "../../../styles/index.css";

const meta: Meta = { title: "Chat/Send recovery" };
export default meta;
type Story = StoryObj;

const Frame = ({ children }: { children: React.ReactNode }) => (
	<div className="flex w-[640px] flex-col gap-6 bg-canvas p-6">{children}</div>
);
const noop = () => {};

export const BlockedLines: Story = {
	render: () => (
		<Frame>
			<SendBlockedLineView block="no_provider" onFix={noop} />
			<SendBlockedLineView block="no_provider" emphasis onFix={noop} />
			<SendBlockedLineView block="no_model" onFix={noop} />
			<SendBlockedLineView block="offline" onFix={noop} />
			<SendBlockedLineView block="offline" busy onFix={noop} />
			<SendBlockedLineView
				block="offline"
				outcome="Still not responding · checked at 2:32:07 PM"
				onFix={noop}
			/>
		</Frame>
	),
};

const row = (over: Record<string, unknown>) => ({
	recordId: "r1",
	onSendAgain: noop,
	onEdit: noop,
	...over,
});

export const FailedSends: Story = {
	render: () => (
		<Frame>
			<UndeliveredLine
				undelivered={row({
					message:
						"No model provider is configured yet. Connect one in Settings > Providers, then send the message again.",
					retry: false,
					code: "runtime_unreachable",
				})}
			/>
			<UndeliveredLine
				undelivered={row({
					message:
						"No model is selected for this session. Pick one with /model, then send the message again.",
					retry: false,
					code: "runtime_unreachable",
				})}
			/>
			<UndeliveredLine
				undelivered={row({
					message:
						"Couldn't reach Local Operator. Your message may not have been sent.",
					retry: true,
					code: "transport.failed",
				})}
			/>
			<UndeliveredLine
				undelivered={row({
					message:
						"Couldn't confirm your message was sent. Sending it again is safe.",
					retry: true,
				})}
			/>
		</Frame>
	),
};
