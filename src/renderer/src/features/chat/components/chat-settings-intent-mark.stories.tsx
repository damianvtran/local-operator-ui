/**
 * The sidebar row's settings-intent dot, in its three states.
 *
 * Rendered in a row-shaped strip at the sidebar's own type size so the dot is
 * judged where it lives: inside the row's fixed locality cell, so every title
 * starts on the same x with or without a dot (design D4) - centred in a local
 * row's empty cell, a corner badge on a remote row's mark. The live
 * component reads the store; these frames pin each state through
 * `SettingsIntentDot`, the same element it renders.
 */
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import { ChatRemoteMark } from "./chat-remote-mark";
import {
	SettingsIntentDot,
	type SettingsIntentMarkState,
} from "./chat-settings-intent-mark";

const Row = ({
	state,
	title,
	remote = false,
	description,
}: {
	state: SettingsIntentMarkState;
	title: string;
	remote?: boolean;
	description?: string;
}) => (
	<div
		className={cn(
			"flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-body-sm text-ink",
		)}
	>
		{/* The row's fixed locality cell, which hosts the dot (design D4). */}
		<span className="relative flex size-3.5 shrink-0 items-center justify-center">
			{remote && <ChatRemoteMark unreachable={false} />}
			<SettingsIntentDot
				state={state}
				corner={remote}
				description={description}
			/>
		</span>
		<span className="block size-3.5 shrink-0 rounded-full bg-hairline" />
		<span className="truncate">{title}</span>
	</div>
);

const meta: Meta = {
	title: "Chat/Sidebar settings-intent dot",
	parameters: { layout: "centered" },
};
export default meta;
type Story = StoryObj;

export const States: Story = {
	render: () => (
		<div className="w-72 bg-surface p-2">
			<Row state={null} title="No change pending: today's row" />
			<Row state="applying" title="Model switch applying in the background" />
			<Row
				state="failed"
				title="Model switch failed: Retry on the composer"
				description="Couldn't switch to Claude Haiku 4.5: the session did not respond in time"
			/>
			<Row state="applying" remote title="A remote conversation, applying" />
			<Row state="failed" remote title="A remote conversation, failed" />
		</div>
	),
};
