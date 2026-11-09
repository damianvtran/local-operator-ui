/**
 * The sidebar row's settings-intent dot, in its three states.
 *
 * Rendered in a row-shaped strip at the sidebar's own type size so the dot is
 * judged where it lives: beside the status mark, before the title. The live
 * component reads the store; these frames pin each state through
 * `SettingsIntentDot`, the same element it renders.
 */
import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import "../../../styles/index.css";
import {
	SettingsIntentDot,
	type SettingsIntentMarkState,
} from "./chat-settings-intent-mark";

const Row = ({
	state,
	title,
}: {
	state: SettingsIntentMarkState;
	title: string;
}) => (
	<div
		className={cn(
			"flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-body-sm text-ink",
		)}
	>
		<span className="block size-3.5 shrink-0 rounded-full bg-hairline" />
		<SettingsIntentDot state={state} />
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
			<Row state="failed" title="Model switch failed: Retry on the composer" />
		</div>
	),
};
