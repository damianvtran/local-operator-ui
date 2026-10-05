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
	subagents_running?: number | null;
	subagents_queued?: number | null;
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
			subagents_running: time(raw.subagents_running),
			subagents_queued: time(raw.subagents_queued),
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

/** A refusal as the surface must render it: the code, and the author's sentence. */
export type MeshRefusal = {
	/** The machine contract: a `MOVE_REFUSAL_CODES` member, or the transport's own. */
	code: string;
	/** The route's OWN sentence. Never paraphrased, never composed over. */
	sentence: string;
	status: number | null;
	/** True when the outcome is unknown and the request must not be repeated. */
	unconfirmed: boolean;
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
	return {
		code,
		sentence: text(held?.message) || "the move was refused",
		status,
		// A 503 IS the unconfirmed answer whatever code it carries, and a code with no
		// status is one this process synthesised (the renderer's own deadline), which is
		// unconfirmed by definition: nothing here observed the backend.
		unconfirmed: status === 503 || MOVE_UNCONFIRMED_CODES.has(code),
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
