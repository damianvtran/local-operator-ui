/**
 * The mesh's MODEL: which nodes exist, which edges join them, and what each node
 * is allowed to claim. Positions are NOT solved here - `mesh-positions.ts` owns
 * them, because a position is a fact about the viewport's history rather than
 * about the topology (a node keeps the slot it already had, so a poll cannot move
 * a node under the pointer).
 *
 * A PURE MODULE so the claims this tab exists to make are exercised by CALLING it
 * rather than by reading pixels:
 *
 *   - a device in two networks is ONE node with TWO edges (the backend answers per
 *     network, so the same device id arrives once per membership);
 *   - the node count is `networks + devices`, which is what bounds the DOM - the
 *     test asserts it, because "bounded by construction" is the kind of claim that
 *     stops being true quietly;
 *   - "unreachable" and "unknown" are different claims, so a missing answer is
 *     never rendered as a zero.
 *
 * THE THREE ENTITY CLASSES, one containment (`mesh-ui.md` §2.8, the plan's §1):
 * networks contain memberships; a device is a member; a session is held by exactly
 * one device and is therefore a CHILD of that device rather than a node - an
 * ownership edge would connect a thing to the only thing that can hold it. A
 * session's home is `PeerRow.session_count` and, later, the session rows
 * themselves. Sessions do not appear in this module's node list at all.
 *
 * WHAT A DEVICE NODE MAY SAY, and where each fact comes from:
 *
 *   - reachability and its reason come from the JOIN of both reads. The networks
 *     read answers per membership ("is this device there on THIS network"), the
 *     peers read answers per device ("did ANY shared network reach it") - so a
 *     device is unreachable only when every answer says so, and the peers read's
 *     own sentence wins when it has one, because the relay dials a device rather
 *     than a network.
 *   - `session_count` comes from the peers read alone, because it is the only
 *     place the wire publishes it. `null` when the peers read did not name this
 *     device: `0` would be a claim that a device this app cannot ask holds no
 *     conversations.
 *   - `suspect` is a security fact about the MEMBER record (a duplicate key) and
 *     outranks reachability, because a suspected identity matters whether or not
 *     it answered this poll.
 *   - role and capabilities are PER MEMBERSHIP (`NetworkMember`), so a device's
 *     role is a join across the networks read - this module never claims to have
 *     seen a device-level role, and nothing renders one as if it were.
 */

import {
	type NetworkMember,
	type NetworkTopology,
	type PeerList,
	type PeerRow,
	deviceLabel,
	networkLabel,
	strings,
	text,
	textOrNull,
} from "./mesh-types";

/**
 * A device node's state, in the order the legend names them.
 *
 * `self` outranks everything (this device is always reachable from itself, and the
 * question the colour answers for it is "which one am I"); `suspect` outranks
 * reachability because a suspected identity is a security fact about the member
 * record; then unreachable, then reachable.
 */
export type DeviceState = "self" | "suspect" | "unreachable" | "reachable";

export type Membership = {
	networkId: string;
	networkName: string;
	role: string;
	capabilities: string[];
	active: boolean;
};

export type MeshDevice = {
	id: string;
	label: string;
	state: DeviceState;
	/** One per network this device is a member of, never collapsed. */
	memberships: Membership[];
	/** Reachable through ANY membership, refined by the peer catalogue. */
	reachable: boolean;
	/** The backend's words for why not; `""` when reachable or unanswered. */
	reason: string;
	suspect: boolean;
	/** The newest stamp any read carries, or `null` for "never". */
	lastSeenAt: number | null;
	endpoints: string[];
	/**
	 * Conversations this device holds, or `null` when the peer catalogue did not
	 * name it. NEVER defaulted to `0` - see this file's header.
	 */
	sessionCount: number | null;
};

export type MeshNetwork = {
	id: string;
	label: string;
	epoch: number;
	trust: string;
	/** Members that have not been revoked: what the node's stat line counts. */
	/**
	 * How many MEMBERS the network holds, revoked tombstones included.
	 *
	 * ALL members, not the active ones, because the summary line above the canvas
	 * counts device NODES and a revoked member is still a node: a network node
	 * reading "3 devices" beside a summary reading "4 devices" is one screen making
	 * two claims about one quantity, which is how the first capture of this set
	 * looked. `revokedCount` carries the difference, in words.
	 */
	memberCount: number;
	/** Members whose membership is revoked (a tombstone the relay still lists). */
	revokedCount: number;
};

export type MeshEdge = {
	/** `<network id>:<device id>` - one per membership, so unique by construction. */
	key: string;
	networkId: string;
	deviceId: string;
	/** An inactive member (revoked, not yet pruned) draws a dashed edge. */
	active: boolean;
};

export type MeshGraph = {
	networks: MeshNetwork[];
	devices: MeshDevice[];
	edges: MeshEdge[];
	/**
	 * Devices the peer catalogue named that NO membership of any local network
	 * holds. Not nodes - an edge needs two memberships - and not silence either:
	 * the list view says so, because a device the relay can reach but this
	 * device's own records do not contain is a real condition rather than noise.
	 */
	unmatchedPeers: PeerRow[];
	/** Which member is THIS device, or `null` when no read answered. */
	selfDeviceId: string | null;
};

const byLabel = (a: { label: string; id: string }, b: typeof a) =>
	a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

function stateOf(
	id: string,
	selfId: string | null,
	suspect: boolean,
	reachable: boolean,
): DeviceState {
	if (selfId !== null && id === selfId) return "self";
	if (suspect) return "suspect";
	return reachable ? "reachable" : "unreachable";
}

/** Epoch seconds, or `null` - a member's stamp and a peer's stamp are the same kind. */
function newest(a: number | null, b: number | null): number | null {
	if (a === null) return b;
	if (b === null) return a;
	return Math.max(a, b);
}

/**
 * Both reads, as one graph.
 *
 * `self_device_id` is read from the NETWORKS answer first because that read owns
 * the membership rows this module groups on; the peers answer carries the same
 * fact and is used only when the networks answer did not name it. "Absent" is a
 * missing fact rather than a wrong one: no node is drawn as this device, and the
 * summary line says which device this is only when a read said so.
 */
export function meshGraph(input: {
	topology: NetworkTopology;
	peers: PeerList;
}): MeshGraph {
	const { topology, peers } = input;

	const networks: MeshNetwork[] = topology.networks
		.map((network) => ({
			id: network.network_id,
			label: networkLabel(network),
			epoch: network.epoch,
			trust: network.trust,
			memberCount: network.members.length,
			revokedCount: network.members.filter((member) => !member.active).length,
		}))
		.sort(byLabel);

	const peerByDevice = new Map(
		peers.peers.map((peer) => [peer.device_id, peer]),
	);

	const memberships = new Map<
		string,
		{ member: NetworkMember; networkId: string; networkName: string }[]
	>();
	const edges: MeshEdge[] = [];
	for (const network of topology.networks) {
		const label = networkLabel(network);
		// A member with no id cannot be a node: it would key under `undefined` and
		// draw a device nobody can name.
		for (const member of network.members.filter((entry) =>
			text(entry.device_id),
		)) {
			const list = memberships.get(member.device_id) ?? [];
			list.push({ member, networkId: network.network_id, networkName: label });
			memberships.set(member.device_id, list);
			edges.push({
				key: `${network.network_id}:${member.device_id}`,
				networkId: network.network_id,
				deviceId: member.device_id,
				active: member.active,
			});
		}
	}

	const selfDeviceId =
		textOrNull(topology.self_device_id) ?? textOrNull(peers.self_device_id);

	const devices: MeshDevice[] = [...memberships.entries()]
		.map(([id, list]) => {
			const peer = peerByDevice.get(id);
			const anyMemberReachable = list.some((entry) => entry.member.reachable);
			const peerSaysReachable = peer ? peer.reachable : null;
			/*
			 * The JOIN, stated once: unreachable only when nothing said otherwise.
			 * Every membership is consulted, and the peer row - which is the
			 * collapsed, per-device answer - can only ever confirm reachability.
			 */
			const reachable = anyMemberReachable || peerSaysReachable === true;
			const suspect = list.some((entry) => entry.member.suspect);
			const named = list.find((entry) => text(entry.member.name));
			return {
				id,
				label: deviceLabel({ device_id: id, name: text(named?.member.name) }),
				state: stateOf(id, selfDeviceId, suspect, reachable),
				memberships: list.map((entry) => ({
					networkId: entry.networkId,
					networkName: entry.networkName,
					role: text(entry.member.role),
					capabilities: strings(entry.member.capabilities),
					active: entry.member.active,
				})),
				reachable,
				reason: reachable
					? ""
					: (peer?.unreachable_reason ??
						text(
							list.find((entry) => text(entry.member.reason))?.member.reason,
						)),
				suspect,
				lastSeenAt: list.reduce<number | null>(
					(seen, entry) => newest(seen, entry.member.last_seen_at),
					peer?.last_seen_at ?? null,
				),
				endpoints: [
					...new Set(list.flatMap((entry) => strings(entry.member.endpoints))),
				],
				sessionCount: peer ? peer.session_count : null,
			};
		})
		.sort(byLabel);

	const unmatchedPeers = peers.peers
		.filter((peer) => !memberships.has(peer.device_id))
		.sort((a, b) => a.device_id.localeCompare(b.device_id));

	return { networks, devices, edges, unmatchedPeers, selfDeviceId };
}

/** The node count this graph draws: what the DOM bound is asserted against. */
export function meshNodeCount(graph: MeshGraph): number {
	return graph.networks.length + graph.devices.length;
}

/**
 * How long ago, in words a node's stat line can carry: "seen 4m ago".
 *
 * The sentence is SHORT on purpose - the register is a 179 px stat line beside a
 * name, not a settings row - and coarse on purpose: the only claim is "this device
 * was heard from recently".
 *
 * WHAT THE STAMP IS NOT, stated here because a reader will assume otherwise:
 * `last_seen_at` is written by a ROTATION frame rather than by a heartbeat, so a
 * healthy mesh usually publishes `None` - "a rotation timestamp wearing a
 * heartbeat's name". A node whose stamp is absent therefore says nothing about
 * time at all, and this function is never asked to render one. The liveness signal
 * itself is a backend change (the plan's § 7), not something a sentence here may
 * repair: an age computed from a stamp that is not a heartbeat would be false
 * precision, which is why the absence is rendered as absence.
 */
export function seenSentence(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	if (s < 60) return "seen just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `seen ${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 48) return `seen ${h}h ago`;
	return `seen ${Math.floor(h / 24)}d ago`;
}

/**
 * How many conversations a device holds, in the ONE noun this feature uses.
 *
 * "CONVERSATION" RATHER THAN "CHAT", everywhere on this surface (design review round 1,
 * D5): the same row printed "4 chats" in one column and "4 conversations" in the next,
 * which is two names for the unit a drag carries on a feature whose stated principle is
 * the protocol's own vocabulary. Pluralised here rather than interpolated at the call
 * site, because "1 conversations" is what a bare template produced.
 */
function conversationsSentence(count: number): string {
	return count === 1 ? "1 conversation" : `${count} conversations`;
}

/**
 * The node's ONE stat line, after its title: the fact a reader most needs about
 * this device, in the order they need it.
 *
 * The resting state is the ONE that reports work (`2 chats · seen 4m ago`,
 * `branding.md` § 2's `ink-dim` register for metadata); the three states that mean
 * something say so in words and spend no line on counts. That is the plan's §5
 * node contract - "stat = '2 chats · seen 4m ago', or 'unreachable (<reason>)'" -
 * and it is also what keeps colour from being the only channel: a node whose state
 * matters never carries it in a stripe alone.
 *
 * `nowSeconds` is INJECTED rather than read from the clock here, so a story or a
 * test gets the same sentence at any moment (the frames in `docs/evidence/mesh-tab/`
 * are captured from this same function).
 */
export function deviceStatLine(device: MeshDevice, nowSeconds: number): string {
	/*
	 * REVOKED OUTRANKS THE REST, because it is not a link state at all: the device is
	 * not a member of any network this app can name, and a burned device id is never
	 * admitted again. Rendering it as a neutral "no sessions reported" node - which is
	 * what the first capture of this set did - left the one node the tab exists to
	 * make obvious wearing the same clothes as a healthy one.
	 */
	if (
		device.memberships.length > 0 &&
		device.memberships.every((m) => !m.active)
	)
		return "revoked membership";
	switch (device.state) {
		case "self":
			return device.sessionCount === null
				? "this device"
				: `this device · ${conversationsSentence(device.sessionCount)}`;
		case "suspect":
			return "identity suspect";
		case "unreachable":
			/*
			 * THE WORD AT NODE WIDTH, THE REASON WHERE THERE IS ROOM (design review round 1,
			 * D6). Measured on `misconfigured` at the pinned width, the node printed
			 * `unreachable (no route t…` - and the parenthetical is the ONLY thing that
			 * distinguishes one unreachable device from another, so a cut version of it spends
			 * the line and answers nothing. The stat line says the word; the panel's own column
			 * (`deviceStateWords`), the node's accessible name and the hover tooltip carry the
			 * reason in full.
			 */
			return "unreachable";
		default: {
			const parts: string[] = [];
			if (device.sessionCount !== null)
				parts.push(conversationsSentence(device.sessionCount));
			if (device.lastSeenAt !== null)
				parts.push(seenSentence(nowSeconds - device.lastSeenAt));
			/*
			 * Nothing to count and no stamp to read is a REAL state - a device that has
			 * never been seen and whose sessions the relay did not count - and it says
			 * which of the two is missing rather than drawing an empty line.
			 */
			return parts.length ? parts.join(" · ") : "no sessions reported";
		}
	}
}

/**
 * What is drawn beside the state, in the state's own words.
 *
 * Colour is never the only channel (`branding.md` § 2, WCAG 1.4.1): every node
 * carries its state as text as well as a stripe, and an unreachable node carries
 * the backend's reason when there is one.
 */
export function deviceStateWords(device: MeshDevice): string {
	switch (device.state) {
		case "self":
			return "this device";
		case "suspect":
			return "identity suspect";
		case "unreachable":
			return device.reason ? `unreachable (${device.reason})` : "unreachable";
		default:
			return "";
	}
}

/**
 * The sentence above the canvas, which is also the canvas region's accessible name
 * (`branding.md` § 8's plain-language rule; the plan §5's summary line).
 *
 * It states only what the reads answered: a device with no session count is not
 * counted as holding none, and "this device is X" appears only when a read named
 * this device. A machine in no network gets the empty state instead, so this
 * sentence is never asked to describe nothing.
 */
export function meshSummary(graph: MeshGraph): string {
	const parts: string[] = [];
	parts.push(
		`${graph.networks.length} ${graph.networks.length === 1 ? "network" : "networks"}`,
	);
	parts.push(
		`${graph.devices.length} ${graph.devices.length === 1 ? "device" : "devices"}`,
	);
	const unreachable = graph.devices.filter(
		(device) => device.state === "unreachable",
	).length;
	if (unreachable) parts.push(`${unreachable} unreachable`);
	if (graph.selfDeviceId !== null) {
		const self = graph.devices.find(
			(device) => device.id === graph.selfDeviceId,
		);
		parts.push(`this device is ${self ? self.label : graph.selfDeviceId}`);
	}
	return parts.join(" · ");
}

/**
 * The devices' conversations, as the ONLY magnitude the wire publishes.
 *
 * Ranked rather than measured: `session_count` is a count of conversations and not
 * a capacity (`size_class` is unimplemented and `PeerRow` has no `kind`), so a node
 * rendered larger says "this device holds more conversations", never "this device is
 * more powerful". `null` - a device the peer catalogue did not name - ranks as
 * absent rather than as zero.
 */
export function sessionCountRank(
	devices: readonly MeshDevice[],
): Map<string, number> {
	const known = devices
		.map((device) => device.sessionCount)
		.filter((count): count is number => count !== null)
		.sort((a, b) => a - b);
	const rank = new Map<string, number>();
	for (const device of devices) {
		const count = device.sessionCount;
		if (count === null) continue;
		// The share of devices at or below this one, in [0, 1]. Ties share a rank,
		// which is what keeps the canvas from "breathing" when two devices hold the
		// same number of conversations.
		const below = known.filter((value) => value <= count).length;
		rank.set(device.id, known.length ? below / known.length : 0);
	}
	return rank;
}
