/**
 * The Networks tab's graph, as data: which nodes exist, where they sit, and which
 * edges join them.
 *
 * A PURE MODULE so the one claim this tab exists to make - "a device in two
 * networks is ONE node with TWO edges" - is exercised by calling it
 * (`network-topology.test.mjs`), not by reading pixels.
 *
 * THE MODEL (`mesh-ui.md` §2.8, decision 2): nodes are networks and devices, an
 * edge is a MEMBERSHIP. The backend answers per network (`GET /v1/desktop/networks`
 * builds each entry from `network_detail`), so the same device id appears in each
 * network's member list; this module collapses those appearances into one device
 * node and keeps every membership as its own edge. Collapsing the other way - one
 * node per (network, device) pair - would draw the same laptop twice and hide the
 * fact the operator asked the view to show.
 *
 * THE LAYOUT is a bipartite column pair in the spirit of Grafana's node graph:
 * networks on the left, devices on the right, each column in a stable order (by
 * label, then id) so a poll that changes nothing moves nothing. No force
 * simulation and no graph library: the graph is two columns, and a layout that
 * reshuffled on every 30 s poll would be a view the user cannot keep their place
 * in.
 */

import type {
	NetworkMember,
	NetworkTopology,
} from "../../../../shared/desktop-session-contract";
import { deviceLabel } from "../chat/peers-store";

/**
 * A device node's state, in the order the tab's legend names them.
 *
 * `self` outranks everything (this device is always reachable from itself, and
 * the question the colour answers for it is "which one am I"); `suspect` outranks
 * reachability because a suspected identity is a security fact about the member
 * record (a duplicate key, `network/types.py MemberRecord.suspect`) that matters
 * whether or not it answered this poll.
 */
export type DeviceState = "self" | "suspect" | "unreachable" | "reachable";

export type Membership = {
	networkId: string;
	networkName: string;
	role: string;
	capabilities: string[];
	active: boolean;
};

export type DeviceNode = {
	id: string;
	label: string;
	state: DeviceState;
	memberships: Membership[];
	/** Reachable through ANY membership: the relay dials a device, not a network. */
	reachable: boolean;
	/** The backend's words for why not, from the first membership that has one. */
	reason: string;
	suspect: boolean;
	lastSeenAt: number | null;
	endpoints: string[];
	x: number;
	y: number;
};

export type NetworkNode = {
	id: string;
	label: string;
	epoch: number;
	trust: string;
	memberCount: number;
	x: number;
	y: number;
};

export type Edge = {
	/** `<network id>:<device id>` - one per membership, so unique by construction. */
	key: string;
	networkId: string;
	deviceId: string;
	/** An inactive member (revoked, not yet pruned) draws a dashed edge. */
	active: boolean;
};

export type TopologyLayout = {
	networks: NetworkNode[];
	devices: DeviceNode[];
	edges: Edge[];
	width: number;
	height: number;
};

/*
 * Geometry, in CSS pixels. A node is one 40 px card, wide enough for a 24-char
 * name before it truncates; the column gap is the edges' room to fan out, which
 * is what keeps two edges from one network readable as two lines rather than a
 * smear.
 */
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 44;
const ROW_GAP = 16;
const COLUMN_GAP = 200;
const PAD = 16;

const byLabel = (a: { label: string; id: string }, b: typeof a) =>
	a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

function networkLabel(network: { network_id: string; name: string }) {
	return network.name.trim() || `network …${network.network_id.slice(-6)}`;
}

function stateOf(
	id: string,
	selfId: string | undefined,
	suspect: boolean,
	reachable: boolean,
): DeviceState {
	if (selfId && id === selfId) return "self";
	if (suspect) return "suspect";
	return reachable ? "reachable" : "unreachable";
}

export function layoutTopology(topology: NetworkTopology): TopologyLayout {
	const networks: NetworkNode[] = topology.networks
		.map((network) => ({
			id: network.network_id,
			label: networkLabel(network),
			epoch: network.epoch,
			trust: network.trust,
			memberCount: network.members.filter((member) => member.active).length,
			x: PAD,
			y: 0,
		}))
		.sort(byLabel);

	const members = new Map<
		string,
		{ member: NetworkMember; networkId: string; networkName: string }[]
	>();
	const edges: Edge[] = [];
	for (const network of topology.networks) {
		for (const member of network.members) {
			const list = members.get(member.device_id) ?? [];
			list.push({
				member,
				networkId: network.network_id,
				networkName: networkLabel(network),
			});
			members.set(member.device_id, list);
			edges.push({
				key: `${network.network_id}:${member.device_id}`,
				networkId: network.network_id,
				deviceId: member.device_id,
				active: member.active,
			});
		}
	}

	const devices: DeviceNode[] = [...members.entries()]
		.map(([id, list]) => {
			const reachable = list.some((entry) => entry.member.reachable);
			const suspect = list.some((entry) => entry.member.suspect);
			const seen = list
				.map((entry) => entry.member.last_seen_at)
				.filter((value): value is number => typeof value === "number");
			const named = list.find((entry) => entry.member.name.trim());
			return {
				id,
				label: deviceLabel({
					device_id: id,
					name: named?.member.name ?? "",
				}),
				state: stateOf(id, topology.self_device_id, suspect, reachable),
				memberships: list.map((entry) => ({
					networkId: entry.networkId,
					networkName: entry.networkName,
					role: entry.member.role,
					capabilities: entry.member.capabilities,
					active: entry.member.active,
				})),
				reachable,
				reason: reachable
					? ""
					: (list.find((entry) => entry.member.reason.trim())?.member.reason ??
						""),
				suspect,
				lastSeenAt: seen.length ? Math.max(...seen) : null,
				endpoints: [
					...new Set(list.flatMap((entry) => entry.member.endpoints)),
				],
				x: PAD + NODE_WIDTH + COLUMN_GAP,
				y: 0,
			};
		})
		.sort(byLabel);

	const rows = Math.max(networks.length, devices.length, 1);
	const height = PAD * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP;
	/*
	 * Each column is CENTRED on the taller one, so one network beside five devices
	 * sits at the middle of its fan rather than at the top of it.
	 */
	const place = <T extends { y: number }>(column: T[]) => {
		const span =
			column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * ROW_GAP;
		const top = (height - span) / 2;
		column.forEach((node, index) => {
			node.y = top + index * (NODE_HEIGHT + ROW_GAP);
		});
	};
	place(networks);
	place(devices);
	return {
		networks,
		devices,
		edges,
		width: PAD * 2 + NODE_WIDTH * 2 + COLUMN_GAP,
		height,
	};
}

/** A cubic from a network's right edge to a device's left edge. */
export function edgePath(
	from: { x: number; y: number },
	to: { x: number; y: number },
): string {
	const x1 = from.x + NODE_WIDTH;
	const y1 = from.y + NODE_HEIGHT / 2;
	const x2 = to.x;
	const y2 = to.y + NODE_HEIGHT / 2;
	const mid = (x1 + x2) / 2;
	return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}
