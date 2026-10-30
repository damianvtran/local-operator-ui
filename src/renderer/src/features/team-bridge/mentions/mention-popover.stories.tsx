import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import { useMemo, useState } from "react";
import type { MentionCandidateRow } from "./candidates";
import { rankMentionCandidates } from "./matcher";
import { MentionPopover } from "./mention-popover";

/**
 * The @-mention popover, transport-free: the list the composer opens at the
 * caret, rendered in place (`inline`) so a capture shows it at rest. Each
 * state has a light and a dark story; `theme` is the preview's own arg, so
 * any other theme is one URL arg away.
 *
 * The seed is the brief's own examples: members first, then the org; humans
 * then agents; a person with a title, an agent with its owner line, a
 * non-member and a bridge-off person.
 */
const rows: MentionCandidateRow[] = [
	{
		kind: "human",
		accountId: "acct_ben",
		label: "Ben Tran",
		secondary: "Head of data",
		member: true,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "acct_ada",
		label: "Ada Lovelace",
		secondary: "Analyst",
		member: true,
		bridgeOff: false,
	},
	{
		kind: "agent",
		accountId: "acct_ben",
		endpointId: "bep_aida",
		label: "Aida (Ben Tran)",
		aliases: ["Aida", "Ben Tran"],
		secondary: "chief of staff of Ben Tran",
		member: true,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "acct_sherman",
		label: "Sherman Tsui",
		secondary: "COO",
		member: false,
		bridgeOff: false,
	},
	{
		kind: "human",
		accountId: "acct_tara",
		label: "Tara Bentley",
		member: false,
		bridgeOff: true,
	},
	{
		kind: "agent",
		accountId: "acct_sherman",
		endpointId: "bep_cos",
		label: "Sherman Tsui’s chief of staff",
		aliases: ["Sherman Tsui"],
		secondary: "chief of staff of Sherman Tsui",
		member: false,
		bridgeOff: false,
	},
];

function Harness({
	query,
	active: initial,
}: { query: string; active: number }) {
	const ranked = useMemo(() => rankMentionCandidates(query, rows), [query]);
	const [active, setActive] = useState(initial);
	return (
		<div className="flex min-h-[520px] items-end bg-canvas p-6">
			<div className="flex flex-col gap-2">
				<MentionPopover
					inline
					listboxId="story-mentions"
					sections={ranked.sections}
					active={active}
					query={query}
					onActive={setActive}
					onPick={() => {}}
					position={null}
				/>
				<div className="w-[22rem] rounded-md border border-control bg-elevated px-3 py-2 text-[14px] text-ink">
					@{query}
				</div>
			</div>
		</div>
	);
}

const meta = {
	title: "Team Bridge/Mention popover",
	component: Harness,
	parameters: { layout: "fullscreen" },
	args: { query: "", active: 0 },
} satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

const LIGHT = "localOperatorLight";
const DARK = "localOperatorDark";

export const OpenLight: Story = {
	args: { theme: LIGHT } as Story["args"],
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getAllByRole("option")).toHaveLength(rows.length);
	},
};
export const OpenDark: Story = { args: { theme: DARK } as Story["args"] };
export const FilteringLight: Story = {
	args: { query: "ben", theme: LIGHT } as Story["args"],
	play: async ({ canvasElement }) => {
		const options = within(canvasElement).getAllByRole("option");
		await expect(options[0]).toHaveTextContent("Ben Tran");
	},
};
export const FilteringDark: Story = {
	args: { query: "ben", theme: DARK } as Story["args"],
};
export const SelectedLight: Story = {
	args: { query: "", active: 2, theme: LIGHT } as Story["args"],
	play: async ({ canvasElement }) => {
		const selected = within(canvasElement).getByRole("option", {
			selected: true,
		});
		await expect(selected).toHaveTextContent("Aida (Ben Tran)");
	},
};
export const SelectedDark: Story = {
	args: { query: "", active: 2, theme: DARK } as Story["args"],
};
export const NoResultsLight: Story = {
	args: { query: "zzq", theme: LIGHT } as Story["args"],
	play: async ({ canvasElement }) => {
		await expect(within(canvasElement).queryAllByRole("option")).toHaveLength(
			0,
		);
	},
};
export const NoResultsDark: Story = {
	args: { query: "zzq", theme: DARK } as Story["args"],
};
/* Only the rest of the organization: every row carries a quiet tag. */
export const NonMemberLight: Story = {
	args: { query: "sherman", theme: LIGHT } as Story["args"],
	play: async ({ canvasElement }) => {
		await expect(
			within(canvasElement).getAllByText("not in this channel").length,
		).toBeGreaterThan(0);
	},
};
export const NonMemberDark: Story = {
	args: { query: "sherman", theme: DARK } as Story["args"],
};
