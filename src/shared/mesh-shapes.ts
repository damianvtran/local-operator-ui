/**
 * The mesh's wire shapes, read as VALUES rather than asserted.
 *
 * WHY THIS FILE EXISTS (round-1 agent review, M3; addendum 2, D). `desktopResult`
 * ends by casting its envelope's payload (`return envelope?.result as T`), so a
 * sparse reply became a typed object with a missing field, and the first reader to
 * touch it threw: `member.reason.trim()` in `layoutTopology` and `peer.name.trim()`
 * in `deviceLabel` both raised `TypeError: Cannot read properties of undefined
 * (reading 'trim')` on a row the producer had not filled in. Above `ChatSidebar`
 * and `/network` the only boundary is the app ROOT's error boundary, so ONE null
 * name in a catalogue replaced the entire window with the error fallback - a blank
 * app from a cosmetic omission.
 *
 * THE NESTED `peer` KEY IS IGNORED, DELIBERATELY (addendum 3, point 3). The
 * backend's row declares one and sends `null` on every row; the grouping and
 * labelling contract is the FLAT fields (`locality`, `owner_device`,
 * `owner_device_name`, ...). Anything reading `row.peer.device_id` files every
 * remote row under `""` - the round-1 review reproduced exactly that.
 *
 * So every mesh reply is NORMALISED where it is read, once, here:
 *
 *   - a row that cannot be keyed or described is DROPPED, never drawn as a
 *     placeholder that claims something. A peer with no `device_id` cannot be a
 *     section key; a peer with no `reachable` cannot be drawn at all, because
 *     every consumer of that field makes a claim with it (the section suffix, the
 *     mark's shape, whether `Move a chat here…` is offered) and inventing one
 *     would be a statement about a device nobody asked;
 *   - every other missing field DEGRADES to the empty answer for its type - `""`,
 *     `null`, `[]` - which is what the renderers already know how to draw
 *     (`deviceLabel` falls back to the id's tail, the card prints `never`).
 *
 * ONE DEFINITION OF "MISSING", for the whole app: `text`/`time`/`count`/`flags`
 * are exported and used by the pure helpers that other code (tests, stories) calls
 * with raw fixtures too, so `layoutTopology` cannot throw on a sparse member even
 * though the normaliser already stood between them. Two spellings of absent - one
 * in the normaliser, one in the reader - is how they drift apart again.
 *
 * WHY NOT ZOD HERE: the requests already go through zod (`desktopRequestSchema`),
 * and these are two read answers plus a receipt. A schema per shape would put the
 * defaults in a second dialect of the same rules.
 */

import type {
	NetworkMember,
	NetworkSummary,
	NetworkTopology,
	PeerList,
	PeerRow,
	SessionLocalityFields,
	SessionTransferReceipt,
} from "./desktop-session-contract";

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

/* ------------------------------------------------------------ the catalogue */

/**
 * `GET /v1/desktop/peers`, normalised.
 *
 * DEDUPED BY DEVICE ID (addendum 2, A). The producer reads the relay's
 * `peer_status`, which answers one entry per (network, member), so a device in two
 * networks arrives twice; taken as given, that drew TWO peer sections holding the
 * same conversations and two React children with one key. The FIRST entry for a
 * device wins, because the catalogue is a set of devices and the duplicate is an
 * artefact of the join rather than a second fact - and a device whose entries
 * disagree about reachability keeps the first answer, which is the same answer the
 * section's own `reachable` fallback would pick.
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
	const self = text((value as { self_device_id?: unknown })?.self_device_id);
	const degraded = strings((value as { degraded?: unknown })?.degraded);
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
	const source = (value ?? {}) as Record<string, unknown>;
	const self = text(source.self_device_id);
	return {
		networks: records(source.networks)
			.map(network)
			.filter((entry): entry is NetworkSummary => entry !== null),
		...(self ? { self_device_id: self } : {}),
	};
}

/* ------------------------------------------------------- the transfer answer */

/**
 * The move's single answer, or `null` when the reply carries nothing readable.
 *
 * `null` is a REAL state for the caller: the request was answered, but not with a
 * receipt this app can read, so the row's new locality is UNKNOWN - the store
 * refetches and says the outcome is unconfirmed rather than moving the row on a
 * guess (round-1 agent review, M4's sibling case).
 */
export function transferReceipt(value: unknown): SessionTransferReceipt | null {
	if (typeof value !== "object" || value === null) return null;
	const raw = value as Record<string, unknown>;
	const locality =
		raw.locality === "remote"
			? "remote"
			: raw.locality === "local"
				? "local"
				: null;
	if (!locality) return null;
	return {
		locality,
		owner_device: text(raw.owner_device),
		source_retired: flag(raw.source_retired, false),
		...(Array.isArray(raw.phases)
			? {
					phases: records(raw.phases).map((phase) => ({
						phase: text(phase.phase),
						peer: text(phase.peer),
						progress: count(phase.progress),
					})),
				}
			: {}),
	};
}

/* --------------------------------------------------- a session row's locality */

/**
 * The flat locality fields of ONE session row (addendum 2, B), normalised to THIS
 * app's spelling: `""` rather than `null` for an absent owner.
 *
 * Only the keys the row actually claims are returned, because the store's merge is
 * `{...current, ...incoming}` under "an absent key is not a claim" - defaulting a
 * field the backend did not send would write a claim the row never made.
 */
export function localityFields(row: unknown): SessionLocalityFields {
	if (typeof row !== "object" || row === null) return {};
	const raw = row as Record<string, unknown>;
	const fields: SessionLocalityFields = {};
	if (raw.locality === "local" || raw.locality === "remote")
		fields.locality = raw.locality;
	if ("owner_device" in raw) fields.owner_device = text(raw.owner_device);
	if ("owner_device_name" in raw)
		fields.owner_device_name = text(raw.owner_device_name);
	if (typeof raw.reachable === "boolean") fields.reachable = raw.reachable;
	if ("unreachable_reason" in raw)
		fields.unreachable_reason = text(raw.unreachable_reason);
	if ("last_synced_at" in raw) fields.last_synced_at = time(raw.last_synced_at);
	/*
	 * `placement` and `origin` are OBJECTS or `null` (addendum 3, point 1) - never
	 * strings - and a null is a VALUE here rather than an absence: the store's merge
	 * is `{...current, ...incoming}` under "an absent key is not a claim", so a
	 * conversation that moved home and back without its placement would keep the
	 * stale one forever. A remote row is what the backend sends null for, which is
	 * exactly why the key is written.
	 */
	if ("placement" in raw)
		fields.placement =
			raw.placement && typeof raw.placement === "object"
				? (raw.placement as SessionLocalityFields["placement"])
				: null;
	if ("origin" in raw)
		fields.origin =
			raw.origin && typeof raw.origin === "object"
				? (raw.origin as SessionLocalityFields["origin"])
				: null;
	return fields;
}
