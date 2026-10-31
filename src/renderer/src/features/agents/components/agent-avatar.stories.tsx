/**
 * The agent avatar proof of concept as pictures: the roster row in its states,
 * the settings row, and a name long enough to truncate.
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT. The row is the exported
 * `AgentsSidebarItem` from `agents-sidebar.tsx`, unchanged, so what these stories
 * photograph is the component the app renders — its selection ground, its 32px
 * disc and its edge included. The `<ul>` around the rows is a stand-in for the
 * sidebar's list container (the real one is fed by `useAgents`, which needs a
 * backend) and the agent records are fixtures. The pictures are synthetic: a
 * canvas drawn to a 256px square and stored through `setAgentAvatar`, the same
 * call the settings pane makes, so what is on screen is the downscale's own
 * output shape rather than a hand-written URL.
 *
 * WHAT A FRAME DOES NOT PROVE. That a native file picker returned this file, or
 * that a real photograph downscales well. This gallery pins the STATES.
 */

import type { AgentDetails } from "@shared/api/local-operator/types";
import { TooltipProvider } from "@shared/components/ui";
import { setAgentAvatar } from "@shared/store/agent-avatar-store";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, useEffect, useState } from "react";
import { AgentAvatarField } from "./agent-avatar-field";
import { AgentsSidebarItem } from "./agents-sidebar";

/**
 * A 256px mark: two tones and a diagonal seam, drawn once per story mount.
 *
 * Neutral greys on purpose: a picture stands in for whatever a user uploads, so
 * a saturated fixture would make every frame a claim about the palette that the
 * palette does not make.
 */
const syntheticPicture = (): string => {
	const canvas = document.createElement("canvas");
	canvas.width = 256;
	canvas.height = 256;
	const context = canvas.getContext("2d");
	if (!context) return "";
	context.fillStyle = "#6b7280";
	context.fillRect(0, 0, 256, 256);
	context.fillStyle = "#d1d5db";
	context.beginPath();
	context.moveTo(0, 256);
	context.lineTo(256, 0);
	context.lineTo(256, 256);
	context.closePath();
	context.fill();
	context.fillStyle = "#374151";
	context.beginPath();
	context.arc(128, 128, 54, 0, Math.PI * 2);
	context.fill();
	return canvas.toDataURL("image/webp", 0.9);
};

const agent = (
	id: string,
	name: string,
	description: string,
): AgentDetails => ({
	id,
	name,
	description,
	created_date: "2026-10-30T00:00:00.000Z",
	version: "1",
	security_prompt: "",
	hosting: "openrouter",
	model: "openai/gpt-4o-mini",
});

const CODER = agent(
	"agent-coder",
	"coder",
	"Implements one bounded slice and reports what changed.",
);
const REVIEWER = agent(
	"agent-reviewer",
	"reviewer",
	"Reviews every pull request before it merges.",
);
const MANAGER = agent(
	"agent-manager",
	"manager",
	"Coordinates the team and keeps the record current.",
);
const LONG_NAME = agent(
	"agent-long",
	"research-and-reconciliation-analyst",
	"Reads the whole corpus before answering one question about it.",
);

const noop = () => {};

/** Stores a picture for each id the way the settings pane does, once per mount. */
const useSeededPictures = (ids: readonly string[]) => {
	const [seeded, setSeeded] = useState(false);
	useEffect(() => {
		if (seeded) return;
		const picture = syntheticPicture();
		for (const id of ids) setAgentAvatar(id, picture);
		setSeeded(true);
	}, [ids, seeded]);
};

const ROSTER_PICTURES = [CODER.id, MANAGER.id, LONG_NAME.id] as const;

const Rows: FC<{
	rows: ReadonlyArray<{ record: AgentDetails; selected: boolean }>;
}> = ({ rows }) => (
	<TooltipProvider>
		<div className="w-80 bg-surface p-2">
			<ul className="flex flex-col gap-1">
				{rows.map(({ record, selected }) => (
					<AgentsSidebarItem
						key={record.id}
						agent={record}
						isSelected={selected}
						onSelectAgent={noop}
						onChatWithAgent={noop}
						onExportAgent={noop}
						onAgentDeleted={noop}
						onUploadAgentToHub={noop}
					/>
				))}
			</ul>
		</div>
	</TooltipProvider>
);

const Roster: FC = () => {
	useSeededPictures(ROSTER_PICTURES);
	return (
		<Rows
			rows={[
				/* A picture, a fallback, the selected row WITH a picture, and a name
				 * long enough to truncate. */
				{ record: CODER, selected: false },
				{ record: REVIEWER, selected: false },
				{ record: MANAGER, selected: true },
				{ record: LONG_NAME, selected: false },
			]}
		/>
	);
};

const SettingsWithPicture: FC = () => {
	useSeededPictures([CODER.id]);
	return (
		<div className="w-96 p-6">
			<AgentAvatarField agentId={CODER.id} />
		</div>
	);
};

const meta: Meta<typeof Rows> = {
	title: "Features/Agents/Agent avatar",
	component: Rows,
};
export default meta;

type Story = StoryObj<typeof Rows>;

/** Every row state the avatar meets, side by side at the same row height. */
export const RosterStates: Story = {
	render: () => <Roster />,
};

/** The settings row, with a picture already stored. */
export const SettingsWithPictureState: Story = {
	render: () => <SettingsWithPicture />,
};

/** The settings row before anything is picked — the state a new agent is in. */
export const SettingsEmpty: Story = {
	render: () => (
		<div className="w-96 p-6">
			<AgentAvatarField agentId="agent-no-picture" />
		</div>
	),
};
