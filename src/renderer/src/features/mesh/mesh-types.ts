/**
 * The mesh's wire shapes, read as VALUES rather than cast.
 *
 * PORTED FROM PR #498's `src/shared/mesh-shapes.ts`, which lives there because the
 * pre-redesign tree had a second consumer (the sidebar's peer sections). On main
 * the ONLY reader of these shapes is the Mesh tab, so the module moved into the
 * feature directory under the name the architecture plan gives it
 * (`mesh-types.ts`, §9). The normalisers are unchanged in behaviour; what changed
 * is where they live and which of them exist yet.
 *
 * WHY THIS FILE EXISTS AT ALL, kept from #498 because the reason is a live one:
 * `desktopResult` ends by casting its envelope's payload (`return envelope?.result
 * as T`), so a sparse reply becomes a typed object with a missing field, and the
 * first reader to touch it throws. Above `/mesh` the only boundary is the app
 * root's error boundary, so ONE null name in a catalogue replaces the entire window
 * with the error fallback - a blank app from a cosmetic omission. So every mesh
 * reply is NORMALISED where it is read, once, here:
 *
 *   - a row that cannot be keyed or described is DROPPED, never drawn as a
 *     placeholder that claims something. A peer with no `device_id` cannot be a
 *     section key; a peer with no `reachable` cannot be drawn at all, because every
 *     consumer of that field makes a claim with it and inventing one would be a
 *     statement about a device nobody asked;
 *   - every other missing field DEGRADES to the empty answer for its type - `""`,
 *     `null`, `[]` - which is what the renderers already know how to draw
 *     (`deviceLabel` falls back to the id's tail, a stat line prints `never`).
 *
 * ONE DEFINITION OF "MISSING", for the whole feature: `text`/`time`/`count`/`flags`
 * are exported and used by the pure model (`mesh-graph.ts`) that tests and stories
 * call with raw fixtures too, so the model cannot throw on a sparse member even
 * though the normaliser already stood between them. Two spellings of absent - one
 * in the normaliser, one in the reader - is how they drift apart again.
 *
 * WHAT IS NOT HERE YET, and it is a slice boundary rather than an omission. #498
 * also carried `transferReceipt`, `localityFields` and `ratio`. All three feed
 * surfaces this slice does not ship - a move's receipt and the session row's
 * locality fields - and a normaliser with no caller is code no one has exercised
 * against a real payload. They land with the drag layer and the session chips that
 * read them, in the shapes those slices actually need.
 *
 * WHY NOT ZOD HERE: the requests already go through zod (`desktopRequestSchema`),
 * and these are two read answers. A schema per shape would put the defaults in a
 * second dialect of the same rules.
 */

/* ------------------------------------------------------------- coercions */

/** A trimmed string, or `""`. NEVER throws on `undefined`/`null`/a number. */
export function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** A trimmed string, or `null` when the wire sent nothing readable. */
export function textOrNull(value: unknown): string | null {
	const trimmed = text(value);
	return trimmed ? trimmed : null;
}

/** Epoch seconds, or `null`. Rejects `NaN`/`Infinity`, which `typeof` allows. */
export function time(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A whole count, or `0`. Negative and fractional answers are not counts. */
export function count(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.floor(value));
}

export function flag(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

/** An array of strings, non-strings dropped. For `capabilities`/`endpoints`. */
export function strings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((entry): entry is string => typeof entry === "string");
}

function records(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value))
		return value.filter(
			(entry): entry is Record<string, unknown> =>
				typeof entry === "object" && entry !== null,
		);
	if (typeof value === "object" && value !== null) {
		const wrapped = (value as Record<string, unknown>).peers;
		if (Array.isArray(wrapped)) return records(wrapped);
	}
	return [];
}

/* ------------------------------------------------------------ the shapes */

/**
 * One OTHER device, collapsed across every network this device shares with it.
 *
 * ONE ROW PER DEVICE, which is the backend's own rule
 * (`local_operator/server/models/desktop_mesh.py`: the relay's peer table is one
 * entry per network MEMBERSHIP, so a device in two networks arrives twice). Taken
 * as given, that would draw two React children with one key at every reader of this
 * list.
 */
export type PeerRow = {
	device_id: string;
	name: string;
	/** True when ANY shared network reached it on this read. */
	reachable: boolean;
	/** The backend's words for why not; `""` when reachable. */
	unreachable_reason: string | null;
	last_seen_at: number | null;
	/**
	 * How many conversations that device holds, counted by the backend from the same
	 * cached projection the chat list groups on. It is the ONLY magnitude the wire
	 * publishes about a device - `size_class` is unimplemented and `PeerRow` has no
	 * `kind` - so it is what a node's size may be ranked by, and it is NOT capacity.
	 */
	session_count: number;
	/**
	 * ALWAYS `null` in this build, and honestly so: no link records a round trip, and
	 * the backend's own comment explains that the only way to fill this would be a
	 * probe per row per poll. Nothing in this app may draw a latency figure from it.
	 */
	rtt_ms: number | null;
};

export type PeerList = {
	peers: PeerRow[];
	/** This device's id, when a network record names it; absent ⇒ no claim. */
	self_device_id?: string;
	/**
	 * The session list's `degraded` vocabulary. Always empty today - the backend's
	 * route REFUSES rather than answering a partial catalogue, so there is no
	 * silently-omitted source for a token to name - and published so a client need
	 * not branch on its presence. Rendered when it is ever non-empty.
	 */
	degraded?: string[];
};

/** One device's membership of ONE network (per network, never collapsed). */
export type NetworkMember = {
	device_id: string;
	name: string;
	role: string;
	capabilities: string[];
	/** False for a tombstone: revoked, not yet pruned. */
	active: boolean;
	/** A duplicate-key security fact, which outranks reachability. */
	suspect: boolean;
	endpoints: string[];
	last_seen_at: number | null;
	reachable: boolean;
	/** In words, `""` when reachable. */
	reason: string;
};

export type NetworkSummary = {
	network_id: string;
	name: string;
	/** The membership epoch, which is what a revocation bumps. */
	epoch: number;
	trust: string;
	members: NetworkMember[];
};

export type NetworkTopology = {
	networks: NetworkSummary[];
	/** Which member is THIS device; absent ⇒ no node is drawn as "this device". */
	self_device_id?: string;
};

/* ------------------------------------------------------------ the catalogue */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * `GET /v1/desktop/peers`, normalised.
 *
 * DEDUPED BY DEVICE ID, kept from #498 (addendum 2, A) even though the backend now
 * collapses server-side: the client rule is what makes the renderer safe against a
 * backend that answers per membership, which the contract still permits. The FIRST
 * entry for a device wins - the catalogue is a set of devices, and the duplicate is
 * an artefact of the join rather than a second fact.
 */
export function peerList(value: unknown): PeerList {
	const seen = new Set<string>();
	const peers: PeerRow[] = [];
	for (const raw of records(value)) {
		const deviceId = text(raw.device_id);
		// No identity, no row: it could not be a section key or a React key.
		if (!deviceId || seen.has(deviceId)) continue;
		// No reachability answer, no row either: every reader of this field makes a
		// claim with it, and neither value is "I do not know".
		if (typeof raw.reachable !== "boolean") continue;
		seen.add(deviceId);
		peers.push({
			device_id: deviceId,
			name: text(raw.name),
			reachable: raw.reachable,
			unreachable_reason: textOrNull(raw.unreachable_reason ?? raw.reason),
			last_seen_at: time(raw.last_seen_at),
			session_count: count(raw.session_count),
			rtt_ms: time(raw.rtt_ms),
		});
	}
	const source = isRecord(value) ? value : {};
	const self = text(source.self_device_id);
	const degraded = strings(source.degraded);
	return {
		peers,
		...(self ? { self_device_id: self } : {}),
		...(degraded.length ? { degraded } : {}),
	};
}

/* ------------------------------------------------------------- the topology */

function member(raw: Record<string, unknown>): NetworkMember | null {
	const deviceId = text(raw.device_id);
	if (!deviceId) return null;
	return {
		device_id: deviceId,
		name: text(raw.name),
		role: text(raw.role),
		capabilities: strings(raw.capabilities),
		// A member that does not say it was revoked IS a member: the backend lists
		// the network's members, and a tombstone would have to be marked as one.
		active: flag(raw.active, true),
		suspect: flag(raw.suspect, false),
		endpoints: strings(raw.endpoints),
		last_seen_at: time(raw.last_seen_at),
		reachable: flag(raw.reachable, true),
		reason: text(raw.reason ?? raw.unreachable_reason),
	};
}

function network(raw: Record<string, unknown>): NetworkSummary | null {
	const id = text(raw.network_id);
	if (!id) return null;
	return {
		network_id: id,
		name: text(raw.name),
		epoch: count(raw.epoch),
		trust: text(raw.trust),
		members: records(raw.members)
			.map(member)
			.filter((entry): entry is NetworkMember => entry !== null),
	};
}

/** `GET /v1/desktop/networks`, normalised. Networks and members without ids drop. */
export function networkTopology(value: unknown): NetworkTopology {
	const source = isRecord(value) ? value : {};
	const self = text(source.self_device_id);
	return {
		networks: records(source.networks)
			.map(network)
			.filter((entry): entry is NetworkSummary => entry !== null),
		...(self ? { self_device_id: self } : {}),
	};
}

/* --------------------------------------------------------------- labels */

/**
 * A device's display label: its name, else the id's tail.
 *
 * The tail rather than the whole id because a 34-character hash does not fit a
 * 179 px title budget and says nothing a person can recognise; the tail is still
 * unique enough to tell two unnamed devices apart. ONE function for every surface
 * (canvas node, list row, summary sentence), so one device is never spelled two
 * ways on one screen.
 */
export function deviceLabel(device: {
	device_id: string;
	name: string;
}): string {
	const name = text(device.name);
	if (name) return name;
	return `device …${text(device.device_id).slice(-6)}`;
}

/** A network's display label: its name, else the id's tail. */
export function networkLabel(network: {
	network_id: string;
	name: string;
}): string {
	const name = text(network.name);
	if (name) return name;
	return `network …${text(network.network_id).slice(-6)}`;
}
