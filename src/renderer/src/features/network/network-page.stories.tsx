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
import { screen, userEvent } from "@storybook/test";
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

const HOME: NetworkTopology["networks"][number] = {
	network_id: "n_4a1c00000000000000000000",
	name: "home",
	epoch: 7,
	trust: "trusted",
	members: [
		member(SELF, "damian-mbp", { role: "admin", capabilities: ["*"] }),
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
		member(SELF, "damian-mbp", { role: "admin", capabilities: ["*"] }),
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
const TYPED_CONFIRMATION = /Type the network's name to confirm/;
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
			message: "The relay is not running on this device.",
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
		await screen.findByText(TYPED_CONFIRMATION);
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
