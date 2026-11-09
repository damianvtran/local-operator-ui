import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { PasskeyNoticeView } from "../../../../../shared/browser-passkey-notice";
import { BrowserPasskeyNotice } from "./browser-passkey-notice";

/**
 * The actual recovery band, not an imitation of browser chrome. Only callbacks
 * and notice metadata are fixtures: these states prove copy, wrapping and the
 * dismiss interaction, not native authentication or external session transfer.
 * Language/theme controls come from the shared Storybook decorators.
 */
const meta = {
	title: "Browser/Passkey notice",
	component: BrowserPasskeyNotice,
	parameters: { layout: "fullscreen" },
	args: { onOpen: () => {}, onDismiss: () => {} },
	render: function InteractiveNotice(args) {
		const [dismissed, setDismissed] = useState(false);
		const [at] = useState(Date.now);
		return (
			<div className="min-h-32 bg-canvas">
				<BrowserPasskeyNotice
					{...args}
					notice={
						dismissed || !args.notice
							? null
							: { ...args.notice, at: args.notice.at === 0 ? 0 : at }
					}
					onDismiss={(notice) => {
						setDismissed(true);
						args.onDismiss(notice);
					}}
				/>
			</div>
		);
	},
} satisfies Meta<typeof BrowserPasskeyNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

function notice(overrides: Partial<PasskeyNoticeView> = {}): PasskeyNoticeView {
	return {
		tabId: 7,
		origin: "https://github.com",
		embedded: false,
		kind: "get",
		at: Date.now(),
		ownerKind: "user",
		suppressed: 0,
		...overrides,
	};
}

export const Pending: Story = { args: { notice: notice() } };
export const NotCompleted: Story = {
	args: { notice: notice({ outcome: "not-allowed" }) },
};
export const AgentFrame: Story = {
	args: {
		notice: notice({
			outcome: "not-allowed",
			embedded: true,
			ownerKind: "agent",
			origin: "https://accounts.example.com",
		}),
	},
};
export const Narrow: Story = {
	...NotCompleted,
	decorators: [
		(Story) => (
			<div style={{ width: 320 }}>
				<Story />
			</div>
		),
	],
};
export const NoRequest: Story = { args: { notice: null } };
export const Expired: Story = {
	args: { notice: notice({ at: 0 }) },
};
