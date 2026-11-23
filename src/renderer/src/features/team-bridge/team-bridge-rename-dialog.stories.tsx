import type { Meta, StoryObj } from "@storybook/react";
import { TeamBridgeRenameDialog } from "./team-bridge-rename-dialog";

/*
 * RENAME A CHANNEL OR GROUP (operator 2026-11-20). The dialog is seeded OPEN
 * because a portal cannot be opened from a still; each state is one props
 * change. The behaviour (prefill + select, Enter submits, Save disabled when
 * unchanged/empty/too long, inline refusals) is pinned in
 * `scripts/team-bridge-conversation-menu.test.mjs`; these are the frames the
 * design round reads.
 */
const meta = {
	title: "Team Bridge/Rename dialog",
	component: TeamBridgeRenameDialog,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-[480px] bg-surface text-ink">
				<Story />
			</div>
		),
	],
	args: {
		open: true,
		kind: "channel",
		currentName: "launch",
		pending: false,
		error: null,
		onSave: () => {},
		onClose: () => {},
	},
} satisfies Meta<typeof TeamBridgeRenameDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Prefilled with the current name; Save waits for a change. */
export const Default: Story = {};
export const Group: Story = {
	args: { kind: "group", currentName: "Launch crew" },
};
/** The hub's 409 `conversation_name_taken`, naming the room that has it. */
export const NameTaken: Story = {
	args: { error: { kind: "taken", name: "launch-crew" } },
};
/** In flight: Save reads "Saving…" and is disabled. */
export const Submitting: Story = { args: { pending: true } };
/** Any refusal the dialog has no sentence for. */
export const GenericError: Story = { args: { error: { kind: "failed" } } };
export const Archived: Story = { args: { error: { kind: "archived" } } };
export const Forbidden: Story = { args: { error: { kind: "forbidden" } } };
export const InvalidCharacters: Story = {
	args: { error: { kind: "characters" } },
};
/** Over the 64-code-point bound: the reason is said inline and Save is off
   (design round 1, D5). */
export const TooLong: Story = {
	args: { currentName: "launch-".repeat(10) },
};
/*
 * Right to left (design round 1, D2/D5): `#launch-crew` stays one token in the
 * Urdu sentence because the name renders inside a `<bdi>`. `locale` is the
 * preview's global arg (see `.storybook/preview.tsx`), not a dialog prop, so it
 * is passed through an untyped spread.
 */
export const NameTakenUrdu: Story = {
	args: {
		error: { kind: "taken", name: "launch-crew" },
		...({ locale: "ur" } as Record<string, unknown>),
	},
};
