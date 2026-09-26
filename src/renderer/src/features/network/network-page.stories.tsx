/**
 * The Networks tab (`/network`) in each of its states: loading, empty, error,
 * populated, a device in two networks, an unreachable device, and the two
 * dialogs its hover card opens.
 *
 * The stories render `NetworkView` - the page minus its data hook - with a
 * fixture topology in the exact shape `GET /v1/desktop/networks` answers (plan
 * §3.1). The hover card is opened at mount through `openDeviceId` because a story
 * cannot enter `:hover`; in the app the same card opens on pointer hover and on
 * keyboard focus of the node.
 *
 * `nowSeconds` is pinned so "last seen 4m ago" is the same in every capture.
 */

import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent, waitFor } from "@storybook/test";
import type {
	NetworkMember,
	NetworkTopology,
} from "../../../../shared/desktop-session-contract";
import { NetworkView, type NetworkViewProps } from "./network-page";

const NOW = 1_789_400_240;
const SELF = "d_5b0e00112233445566778899aabbccdd";
const LAPTOP = "d_9c02f1e4a7b3c6d5e8f9a0b1c2d3e4f5";
const STUDIO = "d_7e11a2b3c4d5e6f708192a3b4c5d6e7f";
const EC2 = "d_31aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c";

const member = (
	device_id: string,
	name: string,
	over: Partial<NetworkMember> = {},
): NetworkMember => ({
	device_id,
	name,
	role: "drive",
	capabilities: ["list", "view", "prompt", "steer", "stop", "slash"],
	active: true,
	suspect: false,
	endpoints: ["192.168.1.20:47100"],
	last_seen_at: NOW - 30,
	reachable: true,
	reason: "",
	...over,
});

/**
 * What an `admin` membership actually carries, from the backend's own table
 * (`network/types.py`, `CAPABILITIES`): ten names, no synonyms, and the role is
 * RESOLVED at admission rather than derived at read time.
 *
 * The fixture used to say `["*"]`, which no producer emits - the card printed it
 * raw, so the frame showed a capability no user can hold (round-1 review, m4).
 */
const ADMIN_CAPABILITIES = [
	"list",
	"view",
	"prompt",
	"steer",
	"stop",
	"slash",
	"delete",
	"move",
	"broker_credential",
	"admin",
];

const HOME: NetworkTopology["networks"][number] = {
	network_id: "n_4a1c00000000000000000000",
	name: "home",
	epoch: 7,
	trust: "trusted",
	members: [
		member(SELF, "damian-mbp", {
			role: "admin",
			capabilities: ADMIN_CAPABILITIES,
		}),
		member(LAPTOP, "devon-laptop"),
		member(STUDIO, "studio-mini", { endpoints: ["192.168.1.31:47100"] }),
	],
};

const WORK: NetworkTopology["networks"][number] = {
	network_id: "n_9f2c00000000000000000000",
	name: "work",
	epoch: 3,
	trust: "trusted",
	members: [
		member(SELF, "damian-mbp", {
			role: "admin",
			capabilities: ADMIN_CAPABILITIES,
		}),
		member(LAPTOP, "devon-laptop", {
			role: "read",
			capabilities: ["list", "view"],
		}),
		member(EC2, "build-box-ec2", {
			endpoints: [
				"10.0.4.12:47100",
				"ec2-3-91-12-4.compute-1.amazonaws.com:47100",
			],
		}),
	],
};

const base: Omit<NetworkViewProps, "state"> = {
	nowSeconds: NOW,
	onRetry: () => undefined,
	onRemove: async () => undefined,
	onInvite: async () => ({
		token_path:
			"/Users/damian/.local-operator/network/invites/inv_7c1f2e3d.token",
		expires_at: NOW + 3600,
	}),
};

/*
 * The two sentences the dialogs are asserted through, hoisted to module scope:
 * biome's `useTopLevelRegex` is a request not to rebuild a literal inside a
 * function, and a play function is one.
 */
const TYPED_CONFIRMATION = /Type .* to confirm/;
const REDEEM_SENTENCE = /must redeem it itself/;

const meta = {
	title: "Network/Networks tab",
	component: NetworkView,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-screen bg-canvas text-ink">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof NetworkView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
	args: { ...base, state: { kind: "loading" } },
};

/** This device is in no network: the empty state names the CLI verbs. */
export const Empty: Story = {
	args: {
		...base,
		state: { kind: "ready", topology: { networks: [], self_device_id: SELF } },
	},
};

export const ErrorState: Story = {
	name: "Error",
	args: {
		...base,
		state: {
			kind: "error",
			/*
			 * THE BACKEND'S OWN SENTENCE, verbatim (design round 1, D13). The fixture used
			 * to carry "The relay is not running on this device.", which this app invented -
			 * so the frame showed copy the product never renders. This is the relay
			 * surface's string as the backend writes it (local-operator
			 * `network/cli.py:2622`, `feat/mesh-network`), and it carries the remedy: the
			 * retry beside it is meaningful precisely because starting the relay makes the
			 * read succeed.
			 */
			message: "the relay is not running; start it with `lop network start`",
		},
	},
};

/** One network, three devices; this device marked in the accent role. */
export const Populated: Story = {
	args: {
		...base,
		state: {
			kind: "ready",
			topology: { networks: [HOME], self_device_id: SELF },
		},
	},
};

/**
 * devon-laptop is in BOTH networks: one node, two edges, and its card lists
 * both memberships with their different roles.
 *
 * THE CARD OFFERS NO INVITE HERE (design round 1, D7): there is no network left to
 * add it to, so the link used to open a dialog whose only possible answer was "is
 * already in every network this device belongs to". The play asserts the link is
 * gone and the fact is stated instead, which is what this frame is for.
 */
export const DeviceInTwoNetworks: Story = {
	args: {
		...base,
		openDeviceId: LAPTOP,
		state: {
			kind: "ready",
			topology: { networks: [HOME, WORK], self_device_id: SELF },
		},
	},
	play: async () => {
		await screen.findByText("In every network this device belongs to");
		if (screen.queryByText("Add to network…"))
			throw new Error("the card still offers an invite it cannot redeem (D7)");
	},
};

/**
 * A device that was REMOVED from both networks: the card offers NO invite, and says
 * why in its own words rather than in the member-everywhere sentence.
 *
 * A BURNED ID IS NEVER ADMITTED AGAIN (QA round 1, Q5): `canInvite` and this dialog
 * used to test `member.active`, so a REVOKED membership counted as "not a member"
 * and the card offered `Add to network…` - an invite whose redemption is refused on
 * the other device (`device_id_conflict: a burned id is never admitted again,
 * however the invite is minted`). The rule is now "any membership row blocks",
 * which is a fact about the id rather than about its state, and the two reasons a
 * card can have nothing to offer are spelled differently.
 */
export const RevokedMemberNoInvite: Story = {
	args: {
		...base,
		openDeviceId: EC2,
		state: {
			kind: "ready",
			topology: {
				networks: [
					{
						...HOME,
						members: [
							...HOME.members,
							// A REVOKED row: the network still lists the device, which is
							// exactly why the card must not offer to add it again.
							member(EC2, "build-box-ec2", { active: false }),
						],
					},
					{
						...WORK,
						members: [
							...WORK.members.filter((row) => row.device_id !== EC2),
							member(EC2, "build-box-ec2", { active: false }),
						],
					},
				],
				self_device_id: SELF,
			},
		},
	},
	play: async () => {
		await screen.findByText(
			"A device removed from its networks needs a new identity before it can be invited again",
		);
		if (screen.queryByText("Add to network…"))
			throw new Error(
				"the card offers an invite a burned device id cannot redeem",
			);
	},
};

/** studio-mini unreachable: warning stripe, the backend's reason in words. */
export const Unreachable: Story = {
	args: {
		...base,
		openDeviceId: STUDIO,
		state: {
			kind: "ready",
			topology: {
				self_device_id: SELF,
				networks: [
					{
						...HOME,
						members: HOME.members.map((entry) =>
							entry.device_id === STUDIO
								? {
										...entry,
										reachable: false,
										reason: "no address of it answered",
										last_seen_at: NOW - 4 * 60,
									}
								: entry,
						),
					},
				],
			},
		},
	},
};

/** "Remove from network…": the typed confirmation, before anything is typed. */
export const RemoveConfirmation: Story = {
	args: {
		...base,
		openDeviceId: STUDIO,
		state: {
			kind: "ready",
			topology: { networks: [HOME], self_device_id: SELF },
		},
	},
	play: async () => {
		await userEvent.click(await screen.findByText("Remove from network…"));
		/*
		 * THE SENTENCE IS SPLIT ACROSS NODES, so an exact whole-element `findByText`
		 * never matches it (design round 4, D26): the confirmation renders the network's
		 * name in its own element, which is what a reader needs. The guard therefore
		 * waits for the dialog and reads ITS text - and it throws on absence, because a
		 * predicate that returns a null node resolves on the first tick and asserts
		 * against a dialog that has not mounted.
		 */
		const dialog = await waitFor(() => {
			const node = document.querySelector("[data-network-remove-dialog]");
			if (!node) throw new Error("no removal dialog yet");
			return node;
		});
		await waitFor(() => {
			/* `TYPED_CONFIRMATION` is a REGEX and the dialog's sentence is split across
			   nodes, which is why the whole-element `findByText` never matched it: match
			   the regex against the dialog's own text. */
			if (!TYPED_CONFIRMATION.test(dialog.textContent ?? ""))
				throw new Error(
					`the typed confirmation is not in the dialog: "${dialog.textContent?.slice(0, 160)}"`,
				);
		});
	},
};

/** "Add to network…" after the invite is minted: the path and the redeem sentence. */
export const InviteMinted: Story = {
	args: {
		...base,
		openDeviceId: EC2,
		state: {
			kind: "ready",
			topology: { networks: [HOME, WORK], self_device_id: SELF },
		},
	},
	play: async () => {
		await userEvent.click(await screen.findByText("Add to network…"));
		await userEvent.click(await screen.findByText("Create invite"));
		await screen.findByText(REDEEM_SENTENCE);
	},
};
