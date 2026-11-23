import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import {
	TeamBridgeEditDialog,
	type TeamBridgeEditDraft,
} from "./team-bridge-rename-dialog";

// Fixture-only frames: no desktop transport or live conversation write. The
// controlled render permits dirty/clear/retry inspection in the same dialog.
const baseline: TeamBridgeEditDraft = {
	baselineName: "launch",
	baselineTopic: "Release coordination",
	name: "launch",
	topic: "Release coordination",
	pending: false,
	error: null,
};
const meta = {
	title: "Team Bridge/Edit dialog",
	component: TeamBridgeEditDialog,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-[600px] bg-surface text-ink">
				<Story />
			</div>
		),
	],
	args: {
		kind: "channel",
		draft: baseline,
		onChange: () => {},
		onSave: () => {},
		onClose: () => {},
	},
	render: function Render(args) {
		const [draft, setDraft] = useState(args.draft);
		return <TeamBridgeEditDialog {...args} draft={draft} onChange={setDraft} />;
	},
} satisfies Meta<typeof TeamBridgeEditDialog>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Idle: Story = {};
export const Populated: Story = {};
export const Group: Story = {
	args: {
		kind: "group",
		draft: { ...baseline, baselineName: "Launch crew", name: "Launch crew" },
	},
};
export const Empty: Story = {
	args: { draft: { ...baseline, baselineTopic: "", topic: "" } },
};
export const Dirty: Story = {
	args: {
		draft: {
			...baseline,
			topic: "Release coordination\nMilestones and decisions",
		},
	},
};
export const Invalid: Story = {
	args: { draft: { ...baseline, topic: "x".repeat(513) } },
};
export const Saving: Story = {
	args: { draft: { ...baseline, topic: "New context", pending: true } },
};
export const Failure: Story = {
	args: {
		draft: { ...baseline, topic: "New context", error: { kind: "failed" } },
	},
};
export const ErrorState: Story = {
	args: { draft: { ...baseline, error: { kind: "forbidden" } } },
};
export const Clear: Story = { args: { draft: { ...baseline, topic: "" } } };
