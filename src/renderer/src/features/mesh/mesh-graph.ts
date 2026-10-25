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
 *     never rendered as a zero;
 *   - a REVOKED membership is not a node: the device id is burned, the wire never
 *     asks it anything, and drawing it as a peer that did not answer is a claim the
 *     backend never made. It is an audit row (`revoked`) instead, and only live
 *     memberships become nodes and edges.
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

import { formatRelativeTime } from "../../../../i18n/format";
import { t } from "../../../../i18n/messages";
import { deviceReach, reachWords } from "./mesh-reach";
import {
	type NetworkMember,
	type NetworkTopology,
	type PeerAttempt,
	type PeerLinkState,
	type PeerList,
	type PeerRelayState,
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
 * record; then `relay_down` / `handshake_refused`, which are the wire's observed
 * transport verdicts; then `unreachable` for every negative the wire could not
 * classify further; then reachable.
 *
 * `relay_down` AND `unreachable` ARE NOT SYNONYMS. A refused TCP connection proves
 * the host is up and nothing is listening on that port; a timeout proves nothing
 * answered on that address; a closed handshake proves the peer's process is there
 * but will not admit this device. They call for different operator actions, and the
 * old union had only one amber bucket for all three.
 */
export type DeviceState =
	| "self"
	| "suspect"
	| "relay_down"
	| "handshake_refused"
	| "unreachable"
	| "reachable";

export type Membership = {
	networkId: string;
	networkName: string;
	role: string;
	capabilities: string[];
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
	/** The stored name before display quoting; empty or absent means unnamed. */
	name?: string;
	label: string;
	state: DeviceState;
	/**
	 * One per network this device is a LIVE member of, never collapsed. A revoked
	 * membership is not one of these - it is a row in `MeshGraph.revoked` - because
	 * a membership the relay withdrew is not a link the canvas may draw.
	 */
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
	/**
	 * The peer row's observed link verdict, or `null` when no peer row named this
	 * device. A normalised row always carries one (`unreachable_legacy` when the
	 * backend predates the field), which is how a surface can tell "the old boolean
	 * said no" from "no read named it" without guessing.
	 */
	linkState: PeerLinkState | null;
	/** The backend's derived relay reading; `null` when it sent none. */
	remoteRelay: PeerRelayState | null;
	/**
	 * The per-address evidence behind `linkState`, or `null` when the backend sent
	 * no attempts vocabulary. An empty array is evidence of nothing dialled; `null`
	 * is evidence of nothing REPORTED. The renderer treats both as "no evidence"
	 * and falls back to the older single sentence, but the distinction is preserved
	 * so a future surface can tell the two apart.
	 */
	attempts: PeerAttempt[] | null;
};

export type MeshNetwork = {
	id: string;
	label: string;
	epoch: number;
	trust: string;
	/**
	 * How many LIVE members the network holds: the device nodes drawn under it.
	 *
	 * Revoked tombstones are NOT counted here, because they are not nodes any
	 * more. The tab used to draw each tombstone as a peer that had not answered,
	 * and this count had to include them so the lane and the summary agreed; now
	 * the lane counts what is drawn and `revokedCount` carries the rest. The two
	 * numbers still add up to the member rows the relay sent, which is what keeps
	 * one screen from making two claims about one quantity.
	 */
	memberCount: number;
	/**
	 * Revoked memberships the relay still lists for this network: the audit rows
	 * behind `MeshGraph.revoked`. The relay prunes a tombstone after 90 days on
	 * its own; nothing in this app deletes one, by design.
	 */
	revokedCount: number;
};

export type MeshEdge = {
	/** `<network id>:<device id>` - one per LIVE membership, unique by construction. */
	key: string;
	networkId: string;
	deviceId: string;
};

/**
 * A membership the relay still lists with `active: false`: a revoked tombstone.
 *
 * NOT A DEVICE NODE, and the difference is the whole point of this type. The
 * device id is burned - it can never be admitted again - and the wire never
 * asked it anything, so drawing it as a peer whose answer is missing says
 * something the wire did not. What survives is the audit fact: which network,
 * the name the membership was recorded under, the id that was burned and the
 * role it held. The relay prunes the row after 90 days; this app cannot delete
 * it, by design.
 */
export type RevokedMembership = {
	networkId: string;
	networkName: string;
	deviceId: string;
	/** The member's recorded name, or the burned id when the row carried none. */
	label: string;
	role: string;
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
	/**
	 * The revoked memberships the reads still carry, one row per network
	 * membership. NOT nodes: the list's revoked count opens these, and no surface
	 * may draw them as devices - see `RevokedMembership`.
	 */
	revoked: RevokedMembership[];
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
	linkState: PeerLinkState | null,
): DeviceState {
	if (selfId !== null && id === selfId) return "self";
	if (suspect) return "suspect";
	if (reachable) return "reachable";
	/*
	 * ONLY A NEGATIVE VERDICT CAN REFINE THE STATE. `reachable` is the aggregate across
	 * every shared network and every membership, and a positive answer from any of them
	 * outranks a peer-row negative (the existing join rule). Once nothing answered, the
	 * wire's own transport verdict may say WHY: relay down and handshake refused keep
	 * their own states; `address_unreachable`, `not_attempted`, `no_endpoint`,
	 * `not_a_member` and `unreachable_legacy` share `unreachable`, because the app has
	 * no separate action for them and must not invent one.
	 */
	if (linkState === "relay_down") return "relay_down";
	if (linkState === "handshake_refused") return "handshake_refused";
	return "unreachable";
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

	/*
	 * THE AUDIT ROWS ARE COLLECTED BEFORE THE NODES, because the node pass must
	 * skip exactly the memberships this pass keeps. A tombstone with no device id
	 * cannot be named in either place: the same rule the node pass states below.
	 *
	 * A MEMBER IS REVOKED ONLY WHEN IT SAYS SO (agent review round 1, F1). The
	 * parser this graph is built from defaults a MISSING `active` to live
	 * (`mesh-types.ts`: `flag(raw.active, true)`), so `member.active` here read an
	 * absent field as a tombstone - a member the parser had called live vanished
	 * from the nodes and reappeared as a revoked audit row. `!== false` is the
	 * parser's rule: only an explicit `false` is revoked. The three `active` reads
	 * in this file (here, the node's own memberships, and the peer's) all use it.
	 */
	const revoked: RevokedMembership[] = [];
	for (const network of topology.networks) {
		const networkName = networkLabel(network);
		for (const member of network.members) {
			if (!text(member.device_id) || member.active !== false) continue;
			revoked.push({
				networkId: network.network_id,
				networkName,
				deviceId: member.device_id,
				label: deviceLabel({
					device_id: member.device_id,
					name: text(member.name),
				}),
				role: text(member.role),
			});
		}
	}
	const revokedByNetwork = new Map<string, number>();
	for (const member of revoked) {
		const count = revokedByNetwork.get(member.networkId) ?? 0;
		revokedByNetwork.set(member.networkId, count + 1);
	}

	const networks: MeshNetwork[] = topology.networks
		.map((network) => ({
			id: network.network_id,
			label: networkLabel(network),
			epoch: network.epoch,
			trust: network.trust,
			memberCount: network.members.filter(
				(member) => member.active !== false && text(member.device_id),
			).length,
			revokedCount: revokedByNetwork.get(network.network_id) ?? 0,
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
		/*
		 * A member with no id cannot be a node: it would key under `undefined` and
		 * draw a device nobody can name. A REVOKED member is not a node either: the
		 * id is burned, the wire never asks it anything, and drawing it beside a
		 * live peer made the tab report a silence that never happened. Its one home
		 * is `revoked`, collected above.
		 */
		for (const member of network.members.filter(
			(entry) => text(entry.device_id) && entry.active !== false,
		)) {
			const list = memberships.get(member.device_id) ?? [];
			list.push({ member, networkId: network.network_id, networkName: label });
			memberships.set(member.device_id, list);
			edges.push({
				key: `${network.network_id}:${member.device_id}`,
				networkId: network.network_id,
				deviceId: member.device_id,
			});
		}
	}

	const selfDeviceId =
		textOrNull(topology.self_device_id) ?? textOrNull(peers.self_device_id);

	const devices: MeshDevice[] = [...memberships.entries()]
		.map(([id, list]) => {
			const peer = peerByDevice.get(id);
			const anyMemberReachable = list.some((entry) => entry.member.reachable);
			/*
			 * A POSITIVE VERDICT CONFIRMS LIKE A POSITIVE BOOLEAN. The peers-read boolean and
			 * its `link_state` are two readings of one link, and a backend that sends
			 * `link_state: reachable` has observed an answer - the same confirmatory fact the
			 * boolean carries. Neither can WITHDRAW reachability a membership reported; both
			 * can add it.
			 */
			const peerSaysReachable = peer
				? peer.reachable || peer.link_state === "reachable"
				: null;
			/*
			 * A per-device peer answer overrides cached membership reachability.
			 * Otherwise a network read from before link loss would keep both
			 * conversation surfaces claiming a disconnected device is reachable.
			 */
			const reachable = peerSaysReachable ?? anyMemberReachable;
			const suspect = list.some((entry) => entry.member.suspect);
			const named = list.find((entry) => text(entry.member.name));
			return {
				id,
				name: text(named?.member.name),
				label: deviceLabel({ device_id: id, name: text(named?.member.name) }),
				state: stateOf(
					id,
					selfDeviceId,
					suspect,
					reachable,
					peer?.link_state ?? null,
				),
				memberships: list.map((entry) => ({
					networkId: entry.networkId,
					networkName: entry.networkName,
					role: text(entry.member.role),
					capabilities: strings(entry.member.capabilities),
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
				linkState: peer?.link_state ?? null,
				remoteRelay: peer?.remote_relay ?? null,
				attempts: peer?.attempts ?? null,
			};
		})
		.sort(byLabel);

	/*
	 * A TOMBSTONE'S PEER ROW IS NOT AN UNMATCHED PEER. It used to match a node;
	 * now that the node is gone, filing it here would claim this device's records
	 * lack a device they in fact hold a revoked membership for. The audit list is
	 * where that row is named, so `revoked` is the exclusion set.
	 */
	const revokedIds = new Set(revoked.map((member) => member.deviceId));
	const unmatchedPeers = peers.peers
		.filter(
			(peer) =>
				!memberships.has(peer.device_id) && !revokedIds.has(peer.device_id),
		)
		.sort((a, b) => a.device_id.localeCompare(b.device_id));

	return {
		networks,
		devices,
		edges,
		revoked,
		unmatchedPeers,
		selfDeviceId,
	};
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
	if (s < 60) return t("ui.mesh.mesh_graph.just_now");
	const m = Math.floor(s / 60);
	if (m < 60) return formatRelativeTime(-m, "minute");
	const h = Math.floor(m / 60);
	if (h < 48) return formatRelativeTime(-h, "hour");
	const d = Math.floor(h / 24);
	return formatRelativeTime(-d, "day");
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
	return t("ui.mesh.mesh_graph.last_status_frame", {
		age: agoSentence(seconds),
	});
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
	if (count === null) return t("ui.mesh.mesh_graph.conversations_not_reported");
	return t("ui.mesh.mesh_graph.conversation_unit", { count });
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
	return t("ui.mesh.mesh_card.conversation_count", { count });
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
	switch (device.state) {
		case "self":
			return device.sessionCount === null
				? t("ui.mesh.mesh_drop.this_device")
				: t("ui.mesh.mesh_graph.self_conversations", {
						conversations: conversationsSentence(device.sessionCount),
					});
		case "suspect":
			return t("ui.mesh.mesh_graph.identity_suspect");
		case "relay_down":
		case "handshake_refused":
		case "unreachable":
			/*
			 * THE WORD COMES FROM THE REACH MODEL, which is what stops this sentence telling the
			 * reader that a machine failed when it was never asked (design round's D2). The three
			 * observed transport failures keep their own words now: `relay not running`,
			 * `handshake refused` and `no answer` are different operator actions, and a derived
			 * (legacy) state may never borrow one of the specific two.
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
			return parts.length
				? parts.join(" · ")
				: t("ui.mesh.mesh_graph.no_sessions_reported");
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
 * single-sentence answer. `no answer` and `not asked` are counted apart now, and so
 * are `relay not running` and `handshake refused` (mesh link resilience): a mixed
 * failure never collapses into one `unreachable` count, because the operator's next
 * action differs. A device nobody asked is never filed under a failure.
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
		t("ui.mesh.mesh_graph.network_count", { count: graph.networks.length }),
	);
	parts.push(
		t("ui.mesh.mesh_graph.device_count", { count: graph.devices.length }),
	);
	const reaches = graph.devices.map((device) => deviceReach(device));
	const suspected = graph.devices.filter((device) => device.suspect).length;
	const reached = reaches.filter((reach) => reach === "reached").length;
	const relayDown = reaches.filter((reach) => reach === "relay-down").length;
	const handshakeRefused = reaches.filter(
		(reach) => reach === "handshake-refused",
	).length;
	const addressUnreachable = reaches.filter(
		(reach) => reach === "address-unreachable",
	).length;
	const noEndpoint = reaches.filter((reach) => reach === "no-endpoint").length;
	const notAMember = reaches.filter((reach) => reach === "not-a-member").length;
	const unanswered = reaches.filter((reach) => reach === "unanswered").length;
	const notAsked = reaches.filter((reach) => reach === "not-attempted").length;
	const unknown = reaches.filter((reach) => reach === "unknown").length;
	if (suspected)
		parts.push(t("ui.mesh.mesh_graph.suspected_count", { count: suspected }));
	if (reached)
		parts.push(t("ui.mesh.mesh_graph.reached_count", { count: reached }));
	/*
	 * EVERY OBSERVED FAILURE IS NAMED APART (mesh link resilience). They all count as
	 * "not reached", but folding them into one `unreachable` would put the tab's own
	 * summary back to the conflation the panel now separates - a relay that is not
	 * running is an action on the peer, a closed handshake is an action on the
	 * membership, an unanswered address is an action on the route, and `no_endpoint` /
	 * `not_a_member` are not transport failures at all. Each class is counted once, so
	 * the census still adds up.
	 */
	if (relayDown)
		parts.push(t("ui.mesh.mesh_graph.relay_down_count", { count: relayDown }));
	if (handshakeRefused)
		parts.push(
			t("ui.mesh.mesh_graph.handshake_refused_count", {
				count: handshakeRefused,
			}),
		);
	if (addressUnreachable)
		parts.push(
			t("ui.mesh.mesh_graph.address_unreachable_count", {
				count: addressUnreachable,
			}),
		);
	if (noEndpoint)
		parts.push(
			t("ui.mesh.mesh_graph.no_endpoint_count", { count: noEndpoint }),
		);
	if (notAMember)
		parts.push(
			t("ui.mesh.mesh_graph.not_a_member_count", { count: notAMember }),
		);
	if (unanswered)
		parts.push(t("ui.mesh.mesh_graph.no_answer_count", { count: unanswered }));
	if (notAsked)
		parts.push(t("ui.mesh.mesh_graph.not_asked_count", { count: notAsked }));
	if (unknown)
		parts.push(t("ui.mesh.mesh_graph.unknown_count", { count: unknown }));
	if (graph.selfDeviceId !== null) {
		const self = graph.devices.find(
			(device) => device.id === graph.selfDeviceId,
		);
		parts.push(
			t("ui.mesh.mesh_graph.self_identity", {
				device: self ? self.label : graph.selfDeviceId,
			}),
		);
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
