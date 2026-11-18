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

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import { t } from "../../../../i18n/messages";
import type {
	PeerAttempt,
	PeerLinkFacts,
	PeerLinkState,
	PeerRelayState,
} from "../../../../shared/desktop-session-contract";

/*
 * The peer LINK vocabulary is the shared contract's (see
 * `desktop-session-contract.ts`), re-exported here because this file is the
 * feature's public wire-shape module: every mesh consumer imports the shapes from
 * one place, and a second definition beside the contract is how the two dialects
 * would drift apart.
 */
export type {
	PeerAttempt,
	PeerLinkState,
	PeerRelayState,
} from "../../../../shared/desktop-session-contract";

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

/** A nullable whole count: absence is not a measured zero. */
export function nullableCount(value: unknown): number | null {
	return typeof value === "number" &&
		Number.isFinite(value) &&
		value >= 0 &&
		Number.isInteger(value)
		? value
		: null;
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
export type PeerRow = PeerLinkFacts & {
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
	session_count: number | null;
	/**
	 * The relay's verdict on a LOST link it is redialling (core `network/redial.py`),
	 * or absent when the backend predates it or the link is up. `reconnecting` holds
	 * for the relay's grace window (90 s AND three failed redials); only `down` is an
	 * escalation. Absent is "no claim", never "connected".
	 */
	redial?: PeerRedial;
	/**
	 * ALWAYS `null` in this build, and honestly so: no link records a round trip, and
	 * the backend's own comment explains that the only way to fill this would be a
	 * probe per row per poll. Nothing in this app may draw a latency figure from it.
	 */
	rtt_ms: number | null;
};

export type PeerRedial = {
	state: "reconnecting" | "down";
	attempts: number;
	/** The lost link's last frame, epoch seconds: the tooltip's "last seen". */
	last_frame_at: number | null;
	next_retry_at: number | null;
	/** The last redial failure in the backend's words; `""` when none yet. */
	last_error: string;
};

/** A redial block, or `undefined` for `connected`/unknown/malformed. */
function redial(value: unknown): PeerRedial | undefined {
	if (!isRecord(value)) return undefined;
	const state = value.state;
	if (state !== "reconnecting" && state !== "down") return undefined;
	return {
		state,
		attempts: count(value.attempts),
		last_frame_at: time(value.last_frame_at),
		next_retry_at: time(value.next_retry_at),
		last_error: text(value.last_error),
	};
}

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
	/**
	 * The operator's DECLARED scope for this membership, or `""` for none.
	 *
	 * THE WIRE HAS NO SUCH FIELD YET, and it is normalised anyway so the client half of
	 * the declared boundary exists before the backend half does (the mesh redesign's T2:
	 * "build the client side so it renders when the field appears"). A missing key reads
	 * as `""` - the same rule every optional field here follows - so an older backend
	 * cannot make a declared boundary appear out of nothing.
	 */
	scope: string;
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
 * The link verdicts a CONFORMING backend may send.
 *
 * `unreachable_legacy` is deliberately absent: it is this client's fallback for a
 * backend that predates `link_state`, and accepting it off the wire would let the
 * backend claim a derivation only this reader is entitled to make.
 */
const WIRE_LINK_STATES: readonly PeerLinkState[] = [
	"reachable",
	"relay_down",
	"address_unreachable",
	"handshake_refused",
	"not_attempted",
	"no_endpoint",
	"not_a_member",
];

/**
 * A peer's link verdict, derived ONLY when the wire did not send one.
 *
 * The fallback is exactly as strong as the old boolean: reachable, or an
 * unclassified failure. It deliberately does NOT try to read refused-vs-timeout
 * out of the aggregate `unreachable_reason` string - that would turn a sentence
 * into an observed transport fact, and an unrecognised sentence or a new spelling
 * would silently become a diagnosis. An unrecognised `link_state` from a newer
 * backend falls back for the same reason: absent and unknown are both "not known".
 */
function linkState(value: unknown, reachable: boolean): PeerLinkState {
	const state = text(value);
	if ((WIRE_LINK_STATES as readonly string[]).includes(state))
		return state as PeerLinkState;
	return reachable ? "reachable" : "unreachable_legacy";
}

const RELAY_STATES: readonly PeerRelayState[] = [
	"running",
	"not_listening",
	"unknown",
];

/** The relay reading when the wire sent one; absent stays absent (not a guess). */
function remoteRelay(value: unknown): PeerRelayState | undefined {
	const state = text(value);
	return (RELAY_STATES as readonly string[]).includes(state)
		? (state as PeerRelayState)
		: undefined;
}

/**
 * The per-address attempts, normalised, or `undefined` when the field is absent.
 *
 * AN EMPTY ARRAY IS NOT THE SAME AS AN ABSENT FIELD: the first says the backend
 * dialled nothing (or reported nothing it dialled), the second says this backend
 * has no attempts vocabulary at all. The renderer treats both as "no evidence" and
 * falls back to the older single sentence, but the distinction is preserved so a
 * future surface can tell the two apart. Entries without an endpoint are dropped -
 * they name no address and cannot be evidence for one.
 */
function linkAttempts(value: unknown): PeerAttempt[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter(isRecord)
		.map((raw) => ({
			endpoint: text(raw.endpoint),
			/* `true` ONLY when the wire said so: a missing flag is not a connection. */
			connected: raw.connected === true,
			detail: text(raw.detail),
			latency_ms: time(raw.latency_ms),
		}))
		.filter((attempt) => attempt.endpoint !== "");
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
		const relay = remoteRelay(raw.remote_relay);
		const attempts = linkAttempts(raw.attempts);
		const redialing = raw.reachable ? undefined : redial(raw.redial);
		peers.push({
			device_id: deviceId,
			name: text(raw.name),
			reachable: raw.reachable,
			// Always present on a normalised row: an absent wire verdict is DERIVED as
			// `reachable`/`unreachable_legacy`, never left as a silent default.
			link_state: linkState(raw.link_state, raw.reachable),
			...(relay ? { remote_relay: relay } : {}),
			...(attempts ? { attempts } : {}),
			...(redialing ? { redial: redialing } : {}),
			unreachable_reason: textOrNull(raw.unreachable_reason ?? raw.reason),
			last_seen_at: time(raw.last_seen_at),
			session_count: nullableCount(raw.session_count),
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
		scope: text(raw.scope),
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

/* ------------------------------------------------------------- the sessions */

/**
 * One conversation, as the Mesh tab needs it: WHAT it is, and WHERE it lives.
 *
 * A NARROWER ROW THAN THE SIDEBAR'S, on purpose. The tab never renders a preview,
 * never sorts by pin and never reads a transcript, so the fields it does not use
 * are not carried - the row exists to key a chip, to name it, and to say which
 * device holds it and whether that device is answering.
 *
 * `locality` IS THE ONLY FIELD THAT ANSWERS "WHERE", and the backend's own model
 * is emphatic about why: the nested `peer` block is `null` on every row this shape
 * describes, so "no nested block" must never be read as "local". `owner_device`
 * is empty on a row this device holds (`locality: "local"`), which is a real
 * answer rather than a missing one - the device that owns it is the one asking.
 *
 * `live_state` is the backend's own vocabulary (`busy`/`attached`/`idle`, plus the
 * registry's `wedged`), and it is what makes the drag HONEST rather than
 * optimistic: a `busy` session refuses a move instead of being interrupted, and
 * the chip can say so BEFORE the drop rather than after the refusal.
 */
export type MeshSessionRow = {
	id: string;
	name: string;
	mtime: number;
	/** `local`/`remote`: which device holds it. Always answered on every row. */
	locality: "local" | "remote";
	/** The owning device's id; `""` on a local row, whose owner is this device. */
	owner_device: string;
	owner_device_name: string;
	/** Whether the owning device answered the poll that produced this row. */
	reachable: boolean;
	/** The backend's own sentence when it did not; `""` otherwise. */
	unreachable_reason: string;
	/** The backend's liveness word for the session itself. */
	live_state: string;
	/** Off the default listing; carried so the tab can say so rather than hide it. */
	archived: boolean;
	/*
	 * THE FIELDS THE SIDEBAR'S ROW READS BESIDE THE TAB'S, carried on this row
	 * because ONE read feeds both surfaces now: the ambient peers-inclusive
	 * catalogue (`mesh-store.ts`'s `useMeshSessions`) is where a remote row's
	 * whole life comes from, and `toCatalogueRow` hands these to the canonical
	 * store so a remote row draws exactly as a local one does - the same status
	 * glyph, the same marks, the same flyout. The tab ignores them.
	 *
	 * `status` is how a remote row reaches the RUNNING bin (`busy`, `approval`
	 * and the rest of `chat-list-sections.ts`'s set) and `created_at` is the
	 * Created basis's own clock; `mtime` cannot stand in for either. `pinned` is
	 * carried WITHOUT being forced false, so the day an owner forwards pin state
	 * it arrives; today the wire reads false for every remote row (the pin index
	 * prunes ids with no local directory; see `settlePeerCatalogue`'s note in
	 * `canonical-sessions-store.ts`). `attention` is deliberately NOT carried:
	 * the wire's remote rows do not send it, and a synthesized one would draw an
	 * unread mark nobody wrote.
	 */
	status?: { code: string; label: string };
	created_at?: number | null;
	pinned?: boolean;
	binding?: { agent: string | null; team: string | null };
	opened_by?: {
		agent: string | null;
		label: string | null;
		session: string | null;
	};
	active?: boolean;
	waiting_on?: number | null;
	jobs_running?: number | null;
	subagents_running?: number | null;
	subagents_queued?: number | null;
	/** Core's derived "work still running" flag; absent on an older peer. */
	background_work?: boolean;
};

/**
 * A session row's `live_state`, when the row carried one that means "do not touch".
 *
 * ONLY `busy` IS READ, and it is read as a REFUSAL rather than as a display state:
 * the route refuses a move of a session with a turn in flight (`busy` is in
 * `MOVE_REFUSAL_CODES`, "the source has a turn in flight; message is its idle
 * reason verbatim"), so a drop that offered itself here would be an offer the
 * backend declines. Everything else - `attached`, `idle`, `wedged`, an unknown word
 * from a newer backend - is not a client-side refusal, because the client does not
 * own that decision: the route answers, and its sentence is what the user reads.
 */
export function sessionIsBusy(row: MeshSessionRow): boolean {
	return row.live_state.trim().toLowerCase() === "busy";
}

/**
 * `GET /v1/desktop/sessions?include_peers=true`, normalised.
 *
 * A ROW WITH NO ID OR NO NAMED-AND-ABSENT LOCALITY IS DROPPED, per this file's own
 * rule: a session with no id cannot be a chip's React key, and a row whose locality
 * arrived as neither `local` nor `remote` cannot be filed anywhere - drawing it as
 * local would put another device's conversation in this device's node, which is a
 * wrong claim rather than a degraded one. Every other missing field degrades:
 * an unnamed session prints its id's tail, `live_state` prints nothing rather than
 * a word nobody said, and `reachable` defaults to `true` ONLY because the backend
 * sends it on every row and a row that arrived without it described a LOCAL one
 * ("always true for a local row").
 *
 * THE ORDER IS THE BACKEND'S and is not re-sorted here: the catalogue's ranking is
 * recency, and a chip row that re-sorted it would disagree with the list beside it.
 *
 * THE WIDENING: this normaliser used to carry the TAB's narrow row alone; it now
 * also carries the fields the sidebar's row reads, because the ambient read that
 * feeds the sidebar IS this read (`mesh-store.ts`), and a second normaliser
 * beside this one would be the defect rather than the saving.
 */
export function sessionRows(value: unknown): MeshSessionRow[] {
	const rows: MeshSessionRow[] = [];
	const seen = new Set<string>();
	/*
	 * THE ENVELOPE'S OWN KEY, unwrapped here rather than in `records`: the wire's
	 * `SessionList` carries its page as `sessions` (and its `degraded`/`truncated`
	 * beside it), while a stored or stubbed answer may be the bare array. `records`
	 * knows only the peer catalogue's `peers`, which is the shape IT was written for -
	 * so the unwrapping lives with the reader that knows which key it is asking about.
	 */
	const page = Array.isArray(value)
		? value
		: ((value as { sessions?: unknown } | null)?.sessions ?? value);
	for (const raw of records(page)) {
		const id = text(raw.id);
		if (!id || seen.has(id)) continue;
		const locality =
			raw.locality === "remote"
				? "remote"
				: text(raw.locality) === "local"
					? "local"
					: null;
		if (!locality) continue;
		seen.add(id);
		/*
		 * THE EXTRAS DEGRADE THE SAME WAY THE NARROW FIELDS DO: an object that did
		 * not arrive is NOT a claim (the key is omitted, and the store's merge
		 * leaves whatever it held), while a present object is normalised member by
		 * member so a null inside it stays null rather than becoming "".
		 */
		const status = isRecord(raw.status)
			? { code: text(raw.status.code), label: text(raw.status.label) }
			: null;
		const binding = isRecord(raw.binding)
			? {
					agent: textOrNull(raw.binding.agent),
					team: textOrNull(raw.binding.team),
				}
			: null;
		const openedBy = isRecord(raw.opened_by)
			? {
					agent: textOrNull(raw.opened_by.agent),
					label: textOrNull(raw.opened_by.label),
					session: textOrNull(raw.opened_by.session),
				}
			: null;
		rows.push({
			id,
			name: text(raw.name),
			mtime: time(raw.mtime) ?? 0,
			locality,
			owner_device: text(raw.owner_device),
			owner_device_name: text(raw.owner_device_name),
			reachable: flag(raw.reachable, true),
			unreachable_reason: text(raw.unreachable_reason),
			live_state: text(raw.live_state),
			archived: flag(raw.archived, false),
			created_at: time(raw.created_at),
			pinned: flag(raw.pinned, false),
			...(typeof raw.active === "boolean" ? { active: raw.active } : {}),
			waiting_on: nullableCount(raw.waiting_on),
			jobs_running: nullableCount(raw.jobs_running),
			subagents_running: nullableCount(raw.subagents_running),
			subagents_queued: nullableCount(raw.subagents_queued),
			...(typeof raw.background_work === "boolean"
				? { background_work: raw.background_work }
				: {}),
			...(status ? { status } : {}),
			...(binding ? { binding } : {}),
			...(openedBy ? { opened_by: openedBy } : {}),
		});
	}
	return rows;
}

/**
 * One federated row in the CANONICAL store's own vocabulary.
 *
 * THE SAME RENAME `projectRows` APPLIES to a plain page's row - id to
 * `session_id`, name to `title`, mtime to `updated_at` - spelled where this
 * read's normaliser lives, because the two reads share one row vocabulary and
 * this is the boundary between them. Everything else rides through: the
 * store's row is this one, one field-rename away.
 */
export function toCatalogueRow(row: MeshSessionRow): CanonicalSessionRow {
	const { id, name, mtime, ...rest } = row;
	return { ...rest, session_id: id, title: name, updated_at: mtime };
}

/* ------------------------------------------------------------ the transfer */

/**
 * A finished move, in the backend's own words (`TransferReceipt`).
 *
 * THE RECEIPT IS THE ONLY THING THAT MAY MOVE A CHIP. Optimistic OWNERSHIP is
 * refused by design (the plan §3): a move may hold an HTTP request for up to 415 s
 * and may still be refused after it starts, so painting a conversation on a device
 * that may never receive it puts a row in front of a user that lies about where
 * their work is. The GESTURE is optimistic (the chip says `moving…` immediately);
 * the OUTCOME is this structure or nothing.
 */
export type TransferReceipt = {
	/** Where the session lives NOW: `local` when it landed here. */
	locality: "local" | "remote";
	/** The device that holds it now - this device's id when it landed here. */
	owner_device: string;
	/** True when the source's copy is gone (a `move`); a `keep` never retires it. */
	source_retired: boolean;
	session_id: string;
	/** The id to OPEN: equal to `session_id` for a move, freshly minted for `keep`. */
	new_session_id: string;
	mode: "move" | "keep";
	/** The phases the move reached, in order, as the backend recorded them. */
	phases: { phase: string; peer: string; progress: number }[];
	/**
	 * Whether the destination STARTED the conversation on arrival (core
	 * `mobility.py` `receipt["engagement"]`: `{engaged, reason, detail}`; an
	 * active-mid-turn move resumes there with `reason: "active"`). `null` when
	 * the receipt carries no such block - an older core, or an offload whose
	 * engage is the destination's own later work - and then no surface claims a
	 * resume it cannot observe.
	 */
	// Optional only so hand-built fixtures predating the field still type-check.
	engagement?: { engaged: boolean; reason: string } | null;
};

/**
 * A move's receipt, normalised - or `null` when the answer was not one.
 *
 * WHY `null` IS THE RIGHT ANSWER FOR A SPARSE RECEIPT rather than a row of
 * defaults: the store applies this by MOVING A CHIP, and a receipt with no session
 * id or no `new_session_id` cannot say WHICH chip moved or WHAT to open. Defaulting
 * through that would move the wrong row or silently point the user at nothing; a
 * `null` leaves the chip where it is and the caller re-reads the row, which is the
 * honest state after an answer nobody can act on.
 */
export function transferReceipt(value: unknown): TransferReceipt | null {
	if (!isRecord(value)) return null;
	const sessionId = text(value.session_id);
	if (!sessionId) return null;
	const mode = value.mode === "keep" ? "keep" : "move";
	/*
	 * A `keep` RECEIPT WITHOUT `new_session_id` IS NOT A RECEIPT, and defaulting it
	 * to the source id is what this function's own header refuses (agent review
	 * round 1, F6). The fork mints a NEW id at the destination, so the id the copy
	 * lives under is the only thing that says which chip moved and what the undo
	 * acts on: carrying the source id would make the report name the original as
	 * the copy and point the undo at the conversation that never left. A `move`
	 * legitimately has no new id (the receipt documents it as equal to the source),
	 * so only the `keep` arm is refused.
	 */
	const newSessionId =
		text(value.new_session_id) || (mode === "move" ? sessionId : "");
	if (!newSessionId) return null;
	return {
		locality: value.locality === "local" ? "local" : "remote",
		owner_device: text(value.owner_device),
		source_retired: flag(value.source_retired, mode === "move"),
		session_id: sessionId,
		new_session_id: newSessionId,
		mode,
		phases: records(value.phases).map((phase) => ({
			phase: text(phase.phase),
			peer: text(phase.peer),
			progress: typeof phase.progress === "number" ? phase.progress : 0,
		})),
		engagement:
			isRecord(value.engagement) &&
			typeof value.engagement.engaged === "boolean"
				? {
						engaged: value.engagement.engaged,
						reason: text(value.engagement.reason),
					}
				: null,
	};
}

/* ------------------------------------------------------------- the refusal */

/**
 * The move's own unconfirmed codes, mirrored from `_MOVE_UNCONFIRMED_CODES`.
 *
 * A REFUSAL AND AN UNKNOWN OUTCOME ARE DIFFERENT INSTRUCTIONS, and conflating them
 * is how a user retries into a second move of something that already moved. These
 * three (a relay that went away, a deadline that fired, a peer that stopped
 * replying after the request arrived) all mean "the request WAS sent and this device
 * never learned the outcome", so the surface re-reads the row and says so; every
 * other code means nothing changed and the id is still usable.
 *
 * `deadline_exceeded` is here because the APP can produce it itself: the transport's
 * give-up sentence (`desktopRequestDeadlineDetail`) carries this code, so a move that
 * outran the app's own deadline is reported as unconfirmed rather than as a refusal
 * nobody made.
 */
const MOVE_UNCONFIRMED_CODES: ReadonlySet<string> = new Set([
	"relay_unavailable",
	"deadline_exceeded",
	"peer_unreachable",
]);

/* ------------------------------------------------------------ working set */

/**
 * The four refusals that carry a FRESH manifest (`working_set` on the refusal
 * body, design move-working-set §11.1). All are `changed:false`: nothing moved,
 * and the manifest is what the user has to look at again before re-confirming.
 */
export const WORKING_SET_REFUSAL_CODES: ReadonlySet<string> = new Set([
	"working_set_unconfirmed",
	"working_set_changed",
	"working_set_over_cap",
	"working_set_unsupported",
	// The owner could not compute the manifest at all; the only way forward is
	// the explicit "move without working files" consent.
	"working_set_unknown",
]);

/** One dependency tree the destination has to recreate, as the core states it. */
export type WorkingSetRecipe = { kind: string; run: string; cwd: string };

/**
 * One worktree in the manifest, reduced to what the consent needs.
 *
 * WHAT IS DELIBERATELY NOT HERE: file lists, contents, secret values. The
 * preflight carries metadata only (paths, branch, counts, sizes, withheld
 * reasons), and this type is the boundary that keeps a future wider answer from
 * reaching the dialog by accident.
 */
export type WorkingSetWorktree = {
	/** Home-relative (`~/…`) on the source. */
	path: string;
	/** Home-relative on the destination; differs from `path` only on a conflict. */
	destPath: string | null;
	repo: string;
	/** `null` on a detached HEAD. */
	branch: string | null;
	head: string;
	unpushedCommits: number;
	staged: number;
	unstaged: number;
	untracked: number;
	/** Bundle plus snapshot: what crosses the link for this tree. */
	bytes: number;
	/** `planned` | `carried` | `restored` | `pending_restore` | `left_behind`. */
	state: string;
	/** The machine reason code when `left_behind` (`history_secret`, `contended`, …). */
	reason: string | null;
	recipes: WorkingSetRecipe[];
	/**
	 * The destination lacks the primary checkout and will CLONE it from origin
	 * (manager decision Q1: listed, sized, and confirmed like everything else).
	 * `null` when no clone is planned. Read defensively from either `clone:
	 * {url, bytes|estimated_bytes}` or `clone_bytes`, because the core contract
	 * is being written concurrently and the field's final spelling is the core's.
	 */
	clone: { url: string; bytes: number | null } | null;
	/**
	 * The core's `clone_check`: `pending_destination` means whether the
	 * destination must (and can) clone the primary is the DESTINATION's answer,
	 * not known at preflight; the review says so rather than promising a clone.
	 */
	cloneCheck: string | null;
	remoteUrl: string | null;
	/** This row IS the primary checkout rather than a linked worktree. */
	primary: boolean;
	/*
	 * THE DESTINATION PROBE's per-row answer (`session_transfer_working_set_probe`,
	 * core `network/workset_probe.py` `apply_probe`). The destination itself ran
	 * `git ls-remote` and a `push --dry-run` against `remote_url` with ITS OWN
	 * credentials, so `cloneCheck` becomes `ok` / `destination_cannot_fetch` /
	 * `destination_cannot_push` / `destination_cannot_clone` / `no_remote` /
	 * `unknown_destination`. A probe failure FLAGS a row, it never moves it to
	 * `left_behind` (the gate re-computes without re-probing), which is why these
	 * are read beside `state`, not instead of it. All four are absent on a backend
	 * without the probe; the renderer additionally gates on the capability.
	 */
	/**
	 * The probe's FIXED failure code (`url_refused`, `git_missing`, `timeout`, …),
	 * rendered through `probeDetailSentence`, or `null`. Anything that is not a
	 * code-shaped token - git's raw stderr, which the first core revision sent - is
	 * dropped at the parser: peer-authored text never renders inside the consent
	 * dialog's warnings (agent review round 1, R2 / design D3 / UX U6).
	 */
	cloneDetail: string | null;
	/** The SSH remote failed but its HTTPS twin answered: an offer, never applied here. */
	httpsRewrite: { url: string; push: boolean } | null;
	/**
	 * The exact command that grants access, and where it must run - ONLY when it
	 * is one of the two shapes the core emits (see `remedyOf`). `kind` picks the
	 * sentence that says which device runs it (UX round 1, U5).
	 */
	remedy: WorkingSetRemedy | null;
	/** Toolchains this worktree's markers need that the destination's PATH lacks. */
	missingTools: string[];
};

/**
 * A probe remedy the UI will show and copy. `include`: a GitHub share to the
 * destination exists and the repository must be added to it; `share`: no share
 * exists yet and one must be created. Both run on a device OTHER than the
 * destination (the one whose GitHub login is lent).
 */
export type WorkingSetRemedy = {
	runOn: string;
	command: string;
	kind: "include" | "share";
};

/** A path withheld from the transfer because it looks like a secret. */
export type WorkingSetExclusion = { path: string; why: string };

/** A path the transfer leaves behind on purpose (deps, build output, …). */
export type WorkingSetLeftBehind = {
	path: string;
	kind: string;
	recipe: WorkingSetRecipe | null;
};

/** The preflight's manifest, as the move dialog renders it. */
export type WorkingSet = {
	/** What the transfer's `confirm_working_set` must echo. */
	scopeDigest: string;
	/** `preflight`, or `unsupported` (only `without_working_set` can proceed). */
	state: string;
	/**
	 * Whether this backend actually SENDS the files. False on the first core
	 * release (the move is gated on consent but the worktrees stay on the source),
	 * true once the transfer half lands. The review's copy is opposite in the two
	 * cases, so this is read, never assumed: absent reads as false, because
	 * claiming files travel when they do not is the exact surprise this exists to
	 * prevent.
	 */
	carriesFiles: boolean;
	/**
	 * The route's `confirmation_required` when it sent one (the authority), else
	 * whether the block lists anything at all.
	 */
	confirmationRequired: boolean;
	destination: { deviceId: string; name: string };
	/**
	 * The device that holds the files now (core `Manifest.to_dict` `source`). Named
	 * where the files STAY, so "stays where it is" says which machine. `null` on a
	 * block without it.
	 */
	source: { deviceId: string; name: string } | null;
	/**
	 * The destination probe's block-level answer, `null` when the backend has no
	 * probe. `state: "unknown_destination"` means the destination could not be
	 * asked (an older lop there): every row then reads `unknown_destination`, which
	 * is "could not check", never a failure. `missingTools` is the union of the
	 * rows'; `teamBridge` is present only when the source saw the conversation use
	 * Team Bridge. Both prerequisites WARN, they never block the move.
	 */
	destinationProbe: {
		state: string;
		missingTools: string[];
		teamBridge: { needed: boolean; enrolled: boolean } | null;
	} | null;
	totals: {
		worktrees: number;
		unpushedCommits: number;
		dirtyFiles: number;
		bytes: number;
		capBytes: number | null;
	};
	worktrees: WorkingSetWorktree[];
	excluded: WorkingSetExclusion[];
	leftBehind: WorkingSetLeftBehind[];
};

const SCOPE_DIGEST = /^sha256:[0-9a-f]{64}$/;

function recipe(value: unknown): WorkingSetRecipe | null {
	if (!isRecord(value)) return null;
	const run = peerText(value.run);
	if (!run) return null;
	return { kind: text(value.kind) || "none", run, cwd: peerText(value.cwd) };
}

function cloneOf(raw: Record<string, unknown>): WorkingSetWorktree["clone"] {
	const held = raw.clone;
	if (isRecord(held)) {
		return {
			url:
				peerText(held.url) ||
				peerText(held.remote_url) ||
				peerText(raw.remote_url),
			bytes: nullableCount(held.bytes) ?? nullableCount(held.estimated_bytes),
		};
	}
	const bytes = nullableCount(raw.clone_bytes);
	return bytes === null ? null : { url: peerText(raw.remote_url), bytes };
}

/** A string array from the wire: non-strings and blanks dropped, never throws. */
function names(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter(
				(item): item is string => typeof item === "string" && item.length > 0,
			)
		: [];
}

function httpsRewriteOf(value: unknown): WorkingSetWorktree["httpsRewrite"] {
	if (!isRecord(value)) return null;
	const url = peerText(value.url);
	return url ? { url, push: value.push === true } : null;
}

/*
 * DISPLAY HYGIENE FOR PEER STRINGS (agent review round 1, R1). Everything in a
 * working-set block was computed on ANOTHER device, and the review is a consent
 * screen: a C0/C1 control or a bidi override (U+202A-202E, U+2066-2069, the
 * marks) can make a rendered path or command read differently from its bytes.
 * Display fields are stripped of them; the copyable remedy, whose bytes go to a
 * shell, is REJECTED outright instead (see `remedyOf`).
 */
const UNSAFE_DISPLAY = /[\p{Cc}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;

/** `text()` minus control and bidi-override code points, for rendered peer strings. */
function peerText(value: unknown): string {
	return text(value).replace(UNSAFE_DISPLAY, "");
}

/** `peerText()`, or `null` when nothing readable is left. */
function peerTextOrNull(value: unknown): string | null {
	return peerText(value) || null;
}

/*
 * THE ONLY TWO REMEDIES THE CORE EMITS (`network/workset_probe.py` `_remedy`),
 * matched whole with a strict charset. The command is shown with a Copy button
 * under "run this on <your trusted, credentialed device>", and the first core
 * revision copied the DESTINATION's remedy into the row verbatim - so a hostile
 * destination could otherwise hand the user `curl … | sh` as "the fix". A token
 * may not start with `-` (no smuggled flags). Anything else: no remedy at all.
 */
const REMEDY_INCLUDE =
	/^lop network credential github include [A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;
const REMEDY_SHARE =
	/^lop network credential share github --with [A-Za-z0-9_.][A-Za-z0-9_.-]{0,127}$/;

export function remedyOf(value: unknown): WorkingSetRemedy | null {
	if (!isRecord(value) || typeof value.command !== "string") return null;
	// Checked on the RAW string: `text()` trims, and a trailing control byte is
	// still a byte the clipboard would carry.
	if (new RegExp(UNSAFE_DISPLAY.source, "u").test(value.command)) return null;
	const command = value.command;
	const kind = REMEDY_INCLUDE.test(command)
		? "include"
		: REMEDY_SHARE.test(command)
			? "share"
			: null;
	return kind ? { runOn: text(value.run_on), command, kind } : null;
}

/** A fixed probe code, or `null` for anything else (raw stderr, class names). */
const PROBE_DETAIL_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function probeDetailOf(value: unknown): string | null {
	const code = text(value);
	return PROBE_DETAIL_CODE.test(code) ? code : null;
}

function destinationProbeOf(value: unknown): WorkingSet["destinationProbe"] {
	if (!isRecord(value)) return null;
	const state = text(value.state);
	if (!state) return null;
	const bridge = isRecord(value.team_bridge) ? value.team_bridge : null;
	return {
		state,
		missingTools: names(value.missing_tools),
		teamBridge:
			bridge && bridge.needed === true
				? { needed: true, enrolled: bridge.enrolled === true }
				: null,
	};
}

function worktree(raw: Record<string, unknown>): WorkingSetWorktree | null {
	const path = peerText(raw.path);
	if (!path) return null;
	return {
		path,
		destPath: peerTextOrNull(raw.dest_path),
		repo: peerText(raw.repo),
		branch: peerTextOrNull(raw.branch),
		head: text(raw.head),
		unpushedCommits: count(raw.unpushed_commits),
		staged: count(raw.staged),
		unstaged: count(raw.unstaged),
		untracked: count(raw.untracked),
		bytes: count(raw.bundle_bytes) + count(raw.snapshot_bytes),
		state: text(raw.state) || "planned",
		reason: textOrNull(raw.reason),
		recipes: (Array.isArray(raw.recipes) ? raw.recipes : [])
			.map(recipe)
			.filter((entry): entry is WorkingSetRecipe => entry !== null),
		clone: cloneOf(raw),
		cloneCheck: textOrNull(raw.clone_check),
		remoteUrl: peerTextOrNull(raw.remote_url),
		primary: raw.primary === true,
		cloneDetail: probeDetailOf(raw.clone_detail),
		httpsRewrite: httpsRewriteOf(raw.https_rewrite),
		remedy: remedyOf(raw.remedy),
		missingTools: names(raw.missing_tools),
	};
}

function rows(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * The working-set block of a preflight answer or a refusal body, or `null`.
 *
 * NULL MEANS "NO CONSENT CAN BE ASKED FOR", and that is why a block without a
 * well-formed `scope_digest` is null rather than a half-parsed object: the
 * transfer's consent IS the digest, so a manifest without one cannot be
 * confirmed, and the dialog must not offer a checkbox whose tick sends nothing.
 * Accepts the block itself, a `{working_set}` wrapper (preflight result, refusal
 * detail) and a `{result: {working_set}}` envelope, because the three reach
 * this from different layers. Never throws: the boundary owns the narrowing.
 */
export function workingSet(value: unknown): WorkingSet | null {
	if (!isRecord(value)) return null;
	if (isRecord(value.result)) return workingSet(value.result);
	if (isRecord(value.working_set)) {
		const inner = workingSet(value.working_set);
		// The preflight's own verdict wins over the block's rows when it is stated.
		if (inner && typeof value.confirmation_required === "boolean")
			return { ...inner, confirmationRequired: value.confirmation_required };
		return inner;
	}
	const scopeDigest = text(value.scope_digest);
	if (!SCOPE_DIGEST.test(scopeDigest)) return null;
	const destination = isRecord(value.destination) ? value.destination : {};
	const source = isRecord(value.source) ? value.source : null;
	const totals = isRecord(value.totals) ? value.totals : {};
	const worktrees = rows(value.worktrees)
		.map(worktree)
		.filter((entry): entry is WorkingSetWorktree => entry !== null);
	const excluded = rows(value.excluded)
		.map((raw) => ({ path: peerText(raw.path), why: text(raw.why) }))
		.filter((entry) => entry.path.length > 0);
	const leftBehind = rows(value.left_behind)
		.map((raw) => ({
			path: peerText(raw.path),
			kind: text(raw.kind) || "loose_file",
			recipe: recipe(raw.recipe),
		}))
		.filter((entry) => entry.path.length > 0);
	const state = text(value.state) || "preflight";
	return {
		scopeDigest,
		state,
		carriesFiles: value.carries_files === true,
		confirmationRequired:
			state === "unsupported" ||
			worktrees.length > 0 ||
			excluded.length > 0 ||
			leftBehind.length > 0,
		destination: {
			deviceId: text(destination.device_id),
			name: peerText(destination.name),
		},
		source:
			source && peerText(source.name)
				? { deviceId: text(source.device_id), name: peerText(source.name) }
				: null,
		destinationProbe: destinationProbeOf(value.destination_probe),
		totals: {
			worktrees: count(totals.worktrees),
			unpushedCommits: count(totals.unpushed_commits),
			dirtyFiles: count(totals.dirty_files),
			bytes: count(totals.bytes),
			capBytes: nullableCount(totals.cap_bytes),
		},
		worktrees,
		excluded,
		leftBehind,
	};
}

/**
 * Whether a manifest has anything to confirm.
 *
 * An EMPTY working set (a chat-only session, `confirmation_required: false`)
 * keeps today's dialog exactly: no warning, no checkbox, no consent sent.
 * "Anything" includes a withheld or left-behind tree, because telling the user
 * what will NOT arrive is the half of the operator's requirement that stops "I
 * moved it and my work is gone".
 */
export function workingSetHasFiles(set: WorkingSet | null): boolean {
	return set?.confirmationRequired ?? false;
}

/**
 * A manifest the move dialog must show INSTEAD of asking the preflight: the fresh
 * one a `working_set_unconfirmed` / `working_set_changed` refusal carried.
 * `changed` says the user already confirmed an older list, which the review
 * states before asking again.
 */
export type MoveWorkingSetSeed = {
	/** `null` only for `working_set_unknown`: the owner could not compute one. */
	workingSet: WorkingSet | null;
	changed: boolean;
	/**
	 * The route refused `working_set_unconfirmed`: the user pressed Move and the
	 * same title came back, so the review says why it is asking (UX round 1, U2).
	 */
	unconfirmed: boolean;
	/**
	 * The working set cannot be sent at all (`working_set_unknown`, or an
	 * `unsupported` manifest): the dialog offers ONLY the explicit "move without
	 * the working files" consent.
	 */
	withoutOnly: boolean;
};

/**
 * Whether a move refusal should REOPEN the move dialog, and with what.
 *
 * The consent refusals are answered by asking again, not by a notice the user
 * has to decode:
 *   - `working_set_unconfirmed` (the move reached the route without a reviewed
 *     list: a drop the dialog never saw, a failed preflight) and
 *     `working_set_changed` (the list moved after the tick) reopen with the
 *     FRESH manifest the refusal carried, un-ticked;
 *   - `working_set_unsupported` (the manifest says `unsupported`) and
 *     `working_set_unknown` (the owner could not compute one) reopen offering
 *     ONLY the explicit "move without the working files" consent.
 * `working_set_over_cap` is not reopened: no tick makes it succeed, so it stays
 * an ordinary refusal notice with the route's own sentence and remedy.
 */
export function workingSetReopen(
	refusal: MeshRefusal | null | undefined,
): MoveWorkingSetSeed | null {
	if (!refusal) return null;
	const fresh = refusal.workingSet ?? null;
	switch (refusal.code) {
		case "working_set_unknown":
		case "working_set_unsupported":
			return {
				workingSet: fresh,
				changed: false,
				unconfirmed: false,
				withoutOnly: true,
			};
		case "working_set_unconfirmed":
		case "working_set_changed":
			if (!fresh || !workingSetHasFiles(fresh)) return null;
			return {
				workingSet: fresh,
				changed: refusal.code === "working_set_changed",
				unconfirmed: refusal.code === "working_set_unconfirmed",
				withoutOnly: fresh.state === "unsupported",
			};
		default:
			return null;
	}
}

/** A refusal as the surface must render it: the code, and the author's sentence. */
export type MeshRefusal = {
	/** The machine contract: a `MOVE_REFUSAL_CODES` member, or the transport's own. */
	code: string;
	/** The route's OWN sentence. Never paraphrased, never composed over. */
	sentence: string;
	/**
	 * The reach word of the device the refusal is about, when this client synthesised
	 * the refusal with that device in hand (`mesh-drop.ts`'s pre-flight refusals).
	 * Absent on a refusal from the route: there the sentence is the route's own, and
	 * this client has no reach reading to add. The notice shows this in place of the
	 * machine `code` when present, so `relay not running` and `address unreachable`
	 * do not both arrive as the single word `unreachable`.
	 */
	reach?: string;
	status: number | null;
	/** True when the outcome is unknown and the request must not be repeated. */
	unconfirmed: boolean;
	/**
	 * The FRESH manifest a `working_set_*` refusal carries, so the dialog can
	 * re-render what the move would now send and ask again. Absent otherwise.
	 */
	workingSet?: WorkingSet;
};

/**
 * A desktop refusal, as the mesh surfaces read it.
 *
 * THE SENTENCE TRAVELS VERBATIM. Every mesh refusal is authored for this surface -
 * `busy` carries the session's own idle reason, `unreachable` names the device -
 * and a client that composed its own sentence would be paraphrasing a remedy the
 * machine already stated. The code is kept BESIDE it because the two answer
 * different questions: the sentence is for the person, the code decides what the
 * surface offers next (a `busy` refusal gets "wait for the turn to finish"; a 503
 * gets "read it again").
 */
export function meshRefusal(error: unknown): MeshRefusal {
	const held = error as {
		code?: unknown;
		status?: unknown;
		message?: unknown;
	} | null;
	const code = text(held?.code) || "move_refused";
	const status = typeof held?.status === "number" ? held.status : null;
	// Read ONLY for the working-set codes: the body is the transport's untyped
	// `detail`, and no other refusal's manifest-shaped field is this one.
	const fresh = WORKING_SET_REFUSAL_CODES.has(code)
		? workingSet((error as { detail?: unknown } | null)?.detail)
		: null;
	return {
		code,
		sentence: text(held?.message) || t("ui.mesh.errors.move_refused"),
		status,
		// A 503 IS the unconfirmed answer whatever code it carries, and a code with no
		// status is one this process synthesised (the renderer's own deadline), which is
		// unconfirmed by definition: nothing here observed the backend.
		unconfirmed: status === 503 || MOVE_UNCONFIRMED_CODES.has(code),
		...(fresh ? { workingSet: fresh } : {}),
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
	return t("ui.mesh.mesh_types.device_suffix", {
		suffix: text(device.device_id).slice(-6),
	});
}

/**
 * The name half of the security identity: real names are quoted, absence is not.
 * JSON quoting also prevents a stored quote or newline from forging a second row.
 */
export function deviceDisplayName(device: { name?: string }): string {
	const name = text(device.name);
	return name ? JSON.stringify(name) : t("ui.mesh.mesh_types.unnamed_device");
}

/**
 * A compact id that is unique within the graph being painted, not merely short.
 * Eight leading hex digits are the normal budget; a shared prefix widens only the
 * colliding ids until they differ. Without the displayed graph there is no sound
 * way to abbreviate, so the full id is the fail-safe rather than a 32-bit guess.
 */
export function compactDeviceId(
	deviceId: string,
	displayedDeviceIds?: readonly string[],
): string {
	const id = text(deviceId);
	if (!displayedDeviceIds) return id;
	const others = displayedDeviceIds
		.map(text)
		.filter((candidate) => candidate.length > 0 && candidate !== id);
	let length = Math.min(10, id.length);
	while (
		length < id.length &&
		others.some((candidate) => candidate.startsWith(id.slice(0, length)))
	) {
		length += 1;
	}
	return length < id.length ? `${id.slice(0, length)}…` : id;
}

/** The one inline name+id spelling used by sentences, menus and dialogs. */
export function deviceIdentityText(
	device: { id: string; name?: string },
	displayedDeviceIds?: readonly string[],
	compact = false,
): string {
	const id = compact
		? compactDeviceId(device.id, displayedDeviceIds)
		: text(device.id);
	return `${deviceDisplayName(device)} ${id}`;
}

/** A network's display label: its name, else the id's tail. */
export function networkLabel(network: {
	network_id: string;
	name: string;
}): string {
	const name = text(network.name);
	if (name) return name;
	return t("ui.mesh.mesh_types.network_suffix", {
		suffix: text(network.network_id).slice(-6),
	});
}
