import type { Meta, StoryObj } from "@storybook/react";
import { expect, within } from "@storybook/test";
import type { FC } from "react";
import { meshGraph } from "./mesh-graph";
import { MeshList } from "./mesh-list";
import { networkTopology, peerList } from "./mesh-types";

const DEVICE_ONE = "d_0123456789abcdef0123456789abcdef";
const DEVICE_TWO = "d_1123456789abcdef0123456789abcde0";
const DEVICE_THREE = "d_2123456789abcdef0123456789abcde1";
const NETWORK = "n_0123456789abcdef01234567";
const LONG_NAME =
	"studio workstation with a deliberately long name that must leave the device id visible";

type MemberSpec = { id: string; name?: string };

/**
 * The real list, fed through the real wire normalisers and graph join. Only the
 * write callbacks are inert: these stories photograph and query the same member
 * rows the Mesh tab renders, not a second identity fixture component.
 */
const MemberRows: FC<{ members: MemberSpec[] }> = ({ members }) => {
	const graph = meshGraph({
		topology: networkTopology({
			self_device_id: members[0]?.id,
			networks: [
				{
					network_id: NETWORK,
					name: "identity-test-mesh",
					epoch: 3,
					trust: "active",
					members: members.map((member, index) => ({
						device_id: member.id,
						name: member.name ?? "",
						role: index === 0 ? "admin" : "drive",
						active: true,
					})),
				},
			],
		}),
		peers: peerList({
			self_device_id: members[0]?.id,
			peers: members.slice(1).map((member) => ({
				device_id: member.id,
				name: member.name ?? "",
				reachable: true,
				session_count: 0,
			})),
		}),
	});
	return (
		<div className="flex h-[520px] w-[900px] bg-canvas p-6">
			<MeshList
				graph={graph}
				nowSeconds={1_800_000_000}
				selectedDeviceId={null}
				sessions={new Map()}
				selfLabel="this device"
				canMove={false}
				onSelect={() => undefined}
				onMove={() => undefined}
				onInvite={() => undefined}
				onRemove={() => undefined}
			/>
		</div>
	);
};

const meta = {
	title: "Mesh/Member rows",
	component: MemberRows,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof MemberRows>;

export default meta;
type Story = StoryObj<typeof meta>;

function expectIdentity(
	row: HTMLElement,
	name: string,
	deviceId: string,
): void {
	const identity = row.closest("[data-mesh-device-identity]");
	expect(identity).not.toBeNull();
	expect(identity).toHaveTextContent(name);
	expect(identity).toHaveTextContent(deviceId);
}

export const OneMember: Story = {
	args: { members: [{ id: DEVICE_ONE, name: "studio-mac" }] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expectIdentity(
			await canvas.findByText('"studio-mac"'),
			'"studio-mac"',
			DEVICE_ONE,
		);
		expect(canvas.queryByText("studio-mac")).toBeNull();
	},
};

export const SeveralMembers: Story = {
	args: {
		members: [
			{ id: DEVICE_ONE, name: "studio-mac" },
			{ id: DEVICE_TWO, name: "cloud-node-1" },
			{ id: DEVICE_THREE, name: "backup-nas" },
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		for (const [id, name] of [
			[DEVICE_ONE, "studio-mac"],
			[DEVICE_TWO, "cloud-node-1"],
			[DEVICE_THREE, "backup-nas"],
		]) {
			expectIdentity(await canvas.findByText(`"${name}"`), `"${name}"`, id);
		}
	},
};

export const AbsentName: Story = {
	args: { members: [{ id: DEVICE_ONE }] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expectIdentity(
			await canvas.findByText("(unnamed device)"),
			"(unnamed device)",
			DEVICE_ONE,
		);
		expect(canvas.queryByText('""')).toBeNull();
	},
};

export const DuplicateNames: Story = {
	args: {
		members: [
			{ id: DEVICE_ONE, name: "shared-node" },
			{ id: DEVICE_TWO, name: "shared-node" },
		],
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const names = await canvas.findAllByText('"shared-node"');
		expect(names).toHaveLength(2);
		expectIdentity(names[0], '"shared-node"', DEVICE_ONE);
		expectIdentity(names[1], '"shared-node"', DEVICE_TWO);
		expect(names[0].parentElement?.textContent).not.toEqual(
			names[1].parentElement?.textContent,
		);
	},
};

export const LongName: Story = {
	args: { members: [{ id: DEVICE_ONE, name: LONG_NAME }] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		expectIdentity(
			await canvas.findByText(`"${LONG_NAME}"`),
			`"${LONG_NAME}"`,
			DEVICE_ONE,
		);
	},
};
