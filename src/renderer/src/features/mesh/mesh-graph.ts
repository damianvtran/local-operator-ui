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

import { deviceReach, reachWords } from "./mesh-reach";
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
	/**
	 * The operator's DECLARED scope for this membership, or `""` for none.
	 *
	 * THE WIRE HAS NO SUCH FIELD YET (the backend ask behind the scope layer's
	 * `declared` tier): there is no per-member or per-network scope today, so this is
	 * empty in every install and the declared boundary renders never. The client half
	 * is here so that the day the field arrives the boundary appears with the
	 * operator's own word on it and no renderer change - and so that nothing can be
	 * drawn as `declared` out of arithmetic, which is the failure the tier exists to
	 * exclude.
	 */
	scope: string;
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
					scope: entry.member.scope,
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
 * The sentence is SHORT on purpose - the register is a 147 px stat line beside a
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
 *
 * AND THE WORDS SAY WHICH STAMP IT IS (mesh redesign, D4). This read `seen 9m ago`
 * on the node and in the panel - a heartbeat's name on a rotation stamp, which is
 * the one thing the field cannot support. `Last status frame` is the same fact under
 * the name the wire's own writer gives it, and it is the label the panel's Status
 * section uses, so the two surfaces cannot describe one stamp two ways.
 */
export function agoSentence(seconds: number): string {
	const s = Math.max(0, Math.round(seconds));
	if (s < 60) return "just now";
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
	const h = Math.floor(m / 60);
	if (h < 48) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
	const d = Math.floor(h / 24);
	return `${d} ${d === 1 ? "day" : "days"} ago`;
}

/**
 * The age with the noun the wire's own writer gives it: `last status frame 9 minutes ago`.
 *
 * This is the sentence for a surface that prints a WHOLE line (the list view's stat, the
 * canvas node's accessible name and its tooltip). The panel's own Status section has the
 * noun in its row LABEL, so it prints `agoSentence`'s value alone - one fact, one label,
 * one place, which is the defect the redesign's own panel frame caught (the age used to be
 * printed twice, once under a heartbeat's name).
 */
export function lastStatusFrameSentence(seconds: number): string {
	return `last status frame ${agoSentence(seconds)}`;
}

/**
 * The conversation count as a sentence or a phrase, and one HOME for its words.
 *
 * `null` is "the relay did not name this device" and never zero: this is the
 * `null`-is-not-`0` rule the join and the chip cap already follow
 * (`deviceSessionTotal`), which is why the not-reported case is a SENTENCE rather than a
 * zero with a dimmed unit - the node's metric rail draws the same words beside an en
 * dash, and neither surface invents a count.
 */
export function conversationUnit(count: number | null): string {
	if (count === null) return "conversations not reported";
	return count === 1 ? "conversation" : "conversations";
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
	return `${count} ${conversationUnit(count)}`;
}

/**
 * The node's ONE stat line, after its title.
 *
 * The resting state reports the facts (`6 conversations · last status frame 4 minutes
 * ago`); the states that mean something say so in words and spend no line on counts.
 * That is the plan's §5 node contract, and it is also what keeps colour from being
 * the only channel: a node whose state matters never carries it in a stripe alone.
 *
 * IT IS NO LONGER PAINTED ON THE CANVAS NODE (mesh redesign, D4/D6). The node draws a
 * metric rail and a state line instead, and this sentence is what its accessible name
 * and its tooltip carry - the two places a full sentence still has a reader, and the
 * reason the empty chip band no longer needs a sentence of its own.
 *
 * `nowSeconds` is INJECTED rather than read from the clock here, so a story or a
 * test gets the same sentence at any moment (the frames in `docs/evidence/mesh-tab/`
 * are captured from this same function).
 *
 * ONE BUILDER, ONE WIDTH: the list view and the panel both call it, so two columns
 * cannot drift into two descriptions of one device.
 */
function statLine(device: MeshDevice, nowSeconds: number): string {
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
			 * THE WORD COMES FROM THE REACH MODEL, which is what stops this sentence telling the
			 * reader that a machine failed when it was never asked (design round's D2). It used to
			 * say `unreachable`, which the relay's own join cannot support: three different
			 * `false` cases arrive as one boolean, so `unreachable` here named a state the wire
			 * never published. `mesh-reach.ts` owns the classification and its debt note.
			 */
			return reachWords(deviceReach(device));
		default: {
			const parts: string[] = [];
			if (device.sessionCount !== null)
				parts.push(conversationsSentence(device.sessionCount));
			if (device.lastSeenAt !== null)
				parts.push(lastStatusFrameSentence(nowSeconds - device.lastSeenAt));
			/*
			 * Nothing to count and no stamp to read is a REAL state - a device that has
			 * never been seen and whose sessions the relay did not count - and it says
			 * which of the two is missing rather than drawing an empty line.
			 */
			return parts.length ? parts.join(" · ") : "no sessions reported";
		}
	}
}

/** The full sentence, for every surface with room for it. */
export function deviceStatLine(device: MeshDevice, nowSeconds: number): string {
	return statLine(device, nowSeconds);
}

/*
 * `deviceNodeStatLine` and `conversationsAtNodeWidth` are GONE with the node's stat
 * line (mesh redesign, D4/D6): the node no longer paints a sentence, so a second
 * rendering of one had no reader. The count it used to carry is the metric rail's now
 * - a monospace number at a fixed x, which is the glance affordance a sentence could
 * not be - and the sentence itself survives for the surfaces with room for it
 * (`deviceStatLine`, which the node's accessible name and tooltip carry).
 *
 * `deviceStateWords` is gone with it, and the reason is the defect this change exists
 * for: its `unreachable (reason)` branch was a SECOND vocabulary for one state, and it
 * was the one that told readers a machine had failed when the machine was never asked
 * (D2). Where those words are still wanted, `mesh-reach.ts` owns them.
 */

/**
 * The sentence above the canvas, which is also the canvas region's accessible name
 * (`branding.md` § 8's plain-language rule; the plan §5's summary line).
 *
 * It states only what the reads answered: a device with no session count is not
 * counted as holding none, and "this device is X" appears only when a read named
 * this device. A machine in no network gets the empty state instead, so this
 * sentence is never asked to describe nothing.
 *
 * IT COUNTS BY REACH, NOT BY `state` (design round's D3). Counting
 * `state === "unreachable"` printed `2 unreachable` over a canvas where one of the
 * two had never been dialled - the node's own conflation one layer up, in the tab's
 * single-sentence answer. `no answer` and `not asked` are counted apart now, so a
 * device nobody asked is never filed under a failure.
 *
 * AND THE COUNTS ARE A CENSUS NOW, NOT A SELECTION (UX review round 1, U4). The
 * sentence used to read `2 no answer · 1 not asked · 1 suspected` over six devices:
 * the suspect device was counted TWICE (once by reach, once as though "suspected"
 * were a sixth kind of device - the counts read like a breakdown and did not add up),
 * and `unknown` and `reached` were counted nowhere, so a reader could not tell an
 * ordinary device from a blind spot. Every device is now in exactly one class, or
 * named at the end as this device: `N of them suspected` is a QUALIFIER on the
 * census (the overlay it is - the reach model's own rule), `reached` is counted with
 * the rest, and naming `unknown` is the deliberate reversal of this comment's old
 * rule - the reach model gives it a neutral word and no hue, so it reads as a fact
 * rather than as one more failure mode, and leaving it out is what made the
 * arithmetic uncheckable.
 */
export function meshSummary(graph: MeshGraph): string {
	const parts: string[] = [];
	parts.push(
		`${graph.networks.length} ${graph.networks.length === 1 ? "network" : "networks"}`,
	);
	parts.push(
		`${graph.devices.length} ${graph.devices.length === 1 ? "device" : "devices"}`,
	);
	const reaches = graph.devices.map((device) => deviceReach(device));
	const suspected = graph.devices.filter((device) => device.suspect).length;
	const reached = reaches.filter((reach) => reach === "reached").length;
	const unanswered = reaches.filter((reach) => reach === "unanswered").length;
	const notAsked = reaches.filter((reach) => reach === "not-attempted").length;
	const unknown = reaches.filter((reach) => reach === "unknown").length;
	if (suspected) parts.push(`${suspected} of them suspected`);
	if (reached) parts.push(`${reached} reached`);
	if (unanswered) parts.push(`${unanswered} no answer`);
	if (notAsked) parts.push(`${notAsked} not asked`);
	if (unknown) parts.push(`${unknown} unknown`);
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
