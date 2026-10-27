import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, screen, userEvent, waitFor } from "@storybook/test";
import { useState } from "react";
import type { TeamBridgeDirectoryMember } from "../../../../shared/team-bridge-contract";
import type { TeamBridgeTarget } from "./team-bridge-model";
import {
	ChiefRailRow,
	PersonRailRow,
	RailSection,
	isTargetRow,
} from "./team-bridge-rail";

/**
 * The Team Bridge rail's People rows, live: click and hover them.
 *
 * WHY THIS STORY. Operator report 2026-10-26: clicking a person showed their
 * profile card instead of opening the conversation. The board mounts the
 * SHIPPED `PersonRailRow` / `ChiefRailRow` with real selection state, so the
 * review questions are answered by doing, not by reading a frame:
 *
 *  - click a row: it becomes the selected row at once and no card appears;
 *  - rest the pointer on a row: nothing until ~1.2 s, then the card;
 *  - rest it on the avatar: the card at the usual 400 ms;
 *  - Tab to a row: no card; Shift+F10 opens it with focus inside.
 *
 * The selected row is echoed under the rail so a capture shows the selection
 * without relying on the row's subtle selected ground alone. Avatars render
 * their initial: Storybook has no daemon to serve private avatar bytes.
 */

const people: TeamBridgeDirectoryMember[] = [
	{
		account_id: "acct_self",
		display_label: "Damian Tran",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active",
	},
	{
		account_id: "acct_bea",
		display_label: "Bea Okafor",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		profile: {
			display_name: "Bea Okafor",
			title: "Design lead",
			description: "",
			pronouns: "she/her",
			timezone: "Europe/London",
		},
	},
	{
		account_id: "acct_cy",
		display_label: "Cy Marsh",
		role: "member",
		bridge_enabled: true,
		bridge_state: "paused",
	},
	{
		account_id: "acct_dee",
		display_label: "Dee Park",
		role: "member",
		bridge_enabled: false,
		bridge_state: "disabled",
	},
];

const chief = {
	person: {
		account_id: "acct_atlas",
		display_label: "Atlas",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { endpoint_id: "ep_atlas", name: "Atlas", state: "active" },
	} satisfies TeamBridgeDirectoryMember,
	endpointId: "ep_atlas",
	agentName: "Atlas",
	paused: false,
};

const RailRows = ({ identityKnown }: { identityKnown: boolean }) => {
	const [target, setTarget] = useState<TeamBridgeTarget | null>(null);
	return (
		<div className="flex h-screen bg-canvas">
			{/* The page's own rail ground and width (`team-bridge-page.tsx`). */}
			<nav className="w-72 bg-surface py-2">
				<RailSection id="rail-chiefs" title={t("ui.teamBridge.section.chiefs")}>
					<ul>
						<ChiefRailRow
							chief={chief}
							label="Atlas"
							selected={isTargetRow(target, "chief", chief.person.account_id)}
							dm={null}
							readOnly={false}
							onSelect={() =>
								setTarget({
									type: "chief",
									accountId: chief.person.account_id,
								})
							}
							onStartGroup={() => {}}
						/>
					</ul>
				</RailSection>
				<RailSection id="rail-people" title={t("ui.teamBridge.people.title")}>
					<ul>
						{people.map((member) => (
							<PersonRailRow
								key={member.account_id}
								member={member}
								selfAccountId="acct_self"
								identityKnown={identityKnown}
								selected={isTargetRow(target, "person", member.account_id)}
								dm={null}
								readOnly={false}
								onSelect={() =>
									setTarget({
										type: "person",
										accountId: member.account_id,
									})
								}
								onStartGroup={() => {}}
							/>
						))}
					</ul>
				</RailSection>
			</nav>
			{/* Story-only readout of the selection (not product copy). */}
			<output
				data-story-selection=""
				className="m-4 self-start text-body-sm text-ink-muted"
			>
				{target && "accountId" in target
					? `selected: ${target.type} ${target.accountId}`
					: "selected: none"}
			</output>
		</div>
	);
};

const meta = {
	title: "Team Bridge/Rail rows",
	component: RailRows,
	parameters: { layout: "fullscreen" },
	args: { identityKnown: true },
} satisfies Meta<typeof RailRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Self, reachable, paused and bridge-off people, plus a chief of staff. */
export const People: Story = {};
/** Identity still loading: every row is inert, yet each card is a dwell away. */
export const IdentityLoading: Story = { args: { identityKnown: false } };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cardOpen = () => document.querySelector("[data-profile-card]") !== null;

/**
 * The pointer rests on Bea's NAME. `userEvent.hover` dispatches the
 * pointerover/mouseover/mouseenter the row listens on. Asserted on both sides of
 * the dwell, so the frame shows a card that waited, not one that was already
 * open: nothing at 900 ms, the card after 1.2 s.
 */
export const LongHoverOpensCard: Story = {
	play: async () => {
		const row = await screen.findByRole("button", {
			name: "Message Bea Okafor",
		});
		const name = [...row.querySelectorAll("span")].find(
			(span) => span.textContent === "Bea Okafor",
		);
		await userEvent.hover(name ?? row);
		await sleep(900);
		await expect(cardOpen()).toBe(false);
		await waitFor(() => expect(cardOpen()).toBe(true), { timeout: 1_000 });
	},
};

/** The pointer rests on Bea's AVATAR: the card at the usual 400 ms. */
export const AvatarHoverOpensCard: Story = {
	play: async () => {
		const row = await screen.findByRole("button", {
			name: "Message Bea Okafor",
		});
		const avatar = row.querySelector("[data-team-bridge-avatar]");
		await userEvent.hover(avatar ?? row);
		await sleep(250);
		await expect(cardOpen()).toBe(false);
		await waitFor(() => expect(cardOpen()).toBe(true), { timeout: 500 });
	},
};
