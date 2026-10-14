import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/** Raw entry identity and position; canonical tool/supplement ids can differ. */
export type JournalPosition = {
	sourceEntryId?: string;
	journalSeq?: number;
	journalGeneration?: string;
	/** Provisional admission slot, not a fabricated own entry coordinate. */
	sourceAdmissionAnchor?: string;
};
export type SourceCoordinate = { entryId: string; seq: number };
/** A dispatch witness, not another source revision or an ordering of domains. */
export type JournalOrderRead = {
	revision: number;
	demand: TranscriptState["orderDemand"];
};
export const journalOrderRead = (state: TranscriptState): JournalOrderRead => ({
	revision: currentOrderRevision(state),
	demand: state.orderDemand,
});
const ordinal = (value: unknown): value is number =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * The domain is equality-only. Only an authoritative snapshot/reconcile may
 * install a different domain; all outstanding reads then lose their revision.
 * Missing fields (old backend/building index) do not erase proven coordinates.
 */
export function receiveJournalOrder(
	initialState: TranscriptState,
	page: Pick<
		DesktopHistoryPage,
		| "journal_generation"
		| "journal_order_state"
		| "journal_ordinals"
		| "reconcile"
	>,
	rows: Array<Record<string, unknown>>,
	authoritative: boolean,
	read?: JournalOrderRead,
	options: { peer?: boolean } = {},
): TranscriptState {
	let state = initialState;
	const generation = page.journal_generation;
	/*
	 * THE EXPLICIT RECONCILE CORRECTION (docs/DESKTOP_API.md, the purpose table):
	 * an answer that carries `reconcile` deliberately carries no joinable facts,
	 * and the contract is one-directional — "the generation rides the answer so
	 * the client knows a re-read is owed, not as an authority to install". So
	 * this branch records the debt and RETURNS, before the mismatch and install
	 * blocks any answer could reach: an `unavailable` + `reconcile` + generation
	 * answer (a lookup under a rebuilt source) must never move this transcript's
	 * domain, and the one coalesced authoritative read the repair loop owes is
	 * what settles it (a claimed domain becomes the wanted generation; a bare
	 * correction stays the generic demand). The repeat guard keeps an identical
	 * correction from minting a new demand object: demand IDENTITY is the repair
	 * loop's wake currency ("a distinct ready fact, including a generic
	 * correction, earns a fresh sweep") and a byte-identical repeat is not a new
	 * fact. `journalMode` activates because the source CAN carry facts — it just
	 * did not join this answer — which is the same reading of building/unavailable
	 * states the no-generation branch below applies.
	 */
	if (page.reconcile === true) {
		const wanted =
			typeof generation === "string" && generation.length > 0
				? generation
				: undefined;
		if (state.orderNeedsReconcile && state.orderWantedGeneration === wanted)
			return state.journalMode ? state : { ...state, journalMode: true };
		return {
			...state,
			journalMode: true,
			orderNeedsReconcile: true,
			orderWantedGeneration: wanted,
			orderDemand: wanted !== undefined ? { generation: wanted } : {},
		};
	}
	if (typeof generation !== "string" || generation.length === 0) {
		return page.journal_order_state &&
			page.journal_order_state !== "unsupported" &&
			!state.journalMode
			? { ...state, journalMode: true }
			: state;
	}
	// A fresh authority resolves the demand present when it was dispatched,
	// even if that demand named an obsolete domain. A different ready wake
	// arriving DURING the read owns a different object and stays owed. Domain
	// strings remain opaque equality tokens; no lexical freshness is inferred.
	if (
		authoritative &&
		page.journal_order_state === "ready" &&
		read &&
		state.orderNeedsReconcile &&
		state.orderDemand === read.demand
	)
		state = {
			...state,
			orderNeedsReconcile: false,
			orderWantedGeneration: undefined,
			orderDemand: undefined,
		};
	if (generation !== state.journalGeneration && !authoritative) {
		return state.orderNeedsReconcile &&
			state.orderWantedGeneration === generation
			? state
			: {
					...state,
					orderNeedsReconcile: true,
					orderWantedGeneration: generation,
					orderDemand: { generation },
				};
	}
	let next = state.journalMode ? state : { ...state, journalMode: true };
	if (generation !== state.journalGeneration) {
		next = {
			...state,
			journalMode: true,
			journalGeneration: generation,
			orderRevision: (state.orderRevision ?? 0) + 1,
			journalPositions: new Map(),
			// Only the dispatch witness above can settle debt. A generation match
			// does not say whether a generic or same-domain wake raced this read.
			orderNeedsReconcile: state.orderNeedsReconcile,
			orderWantedGeneration: state.orderWantedGeneration,
			orderDemand: state.orderDemand,
		};
		/*
		 * PEER: EVERY LOADED BODY WAS READ UNDER THE DOMAIN BEING REPLACED.
		 *
		 * A generation is equality-only, and a rewrite/full-rebuild/cache loss
		 * remints it: the rows on screen were projected from the old journal, so
		 * under the new domain their text is suspect until a same-generation body
		 * read re-admits them one by one (docs/DESKTOP_API.md: "stale-domain
		 * loaded bodies remain payload-owed"; the rotate case of the assessment's
		 * proof matrix: "old bodies remain owed; only fresh g1 bodies +
		 * coordinates atomically release them"). The debt is stamped on RAW ids,
		 * not on records, so it never relabels anything it owes. A proven absence
		 * under the old domain dies with that domain too - the new one has not
		 * spoken yet.
		 */
		if (options.peer === true) {
			const revision = (state.orderRevision ?? 0) + 1;
			const owed = new Map<string, number>();
			for (const record of state.records) {
				const id =
					record.sourceEntryId ??
					(record.kind === "tool" || record.kind === "supplement"
						? null
						: record.id);
				if (typeof id === "string" && id.length > 0 && id.length <= 128)
					owed.set(id, revision);
			}
			next = {
				...next,
				...(owed.size > 0 ? { journalBodyOwed: owed } : {}),
				journalSourceVoid: undefined,
			};
		}
	}
	let positions = next.journalPositions ?? new Map<string, SourceCoordinate>();
	const previousPositions = positions;
	const put = (key: string, entryId: string, seq: unknown) => {
		if (!ordinal(seq)) return;
		const previous = positions.get(key);
		// Supplement versions normalize to one anchor key. A late descriptor for
		// an older version cannot regress that block's own entry coordinate.
		if (previous && previous.seq >= seq) return;
		if (positions === previousPositions) positions = new Map(positions);
		positions.set(key, { entryId, seq });
	};
	for (const [id, seq] of Object.entries(page.journal_ordinals ?? {}))
		put(id, id, seq);
	for (const row of rows) {
		if (typeof row.id !== "string") continue;
		put(row.id, row.id, row.journal_seq);
		if (row.role === "tool" && typeof row.tool_call_id === "string")
			put(`tool:${row.tool_call_id}`, row.id, row.journal_seq);
		if (typeof row.anchor === "string")
			put(`supplement:${row.anchor}`, row.id, row.journal_seq);
	}
	if (positions !== previousPositions)
		next = { ...next, journalPositions: positions };
	return next;
}

/** Track causal ownership from the actual message payload, never its clock. */
export function rememberJournalCalls(
	state: TranscriptState,
	message: Record<string, unknown>,
): TranscriptState {
	if (
		!state.journalMode ||
		typeof message.id !== "string" ||
		!Array.isArray(message.tool_calls)
	)
		return state;
	let owners = state.journalCallOwners ?? new Map<string, string>();
	const before = owners;
	for (const call of message.tool_calls as Array<Record<string, unknown>>) {
		if (
			!call ||
			typeof call.id !== "string" ||
			owners.get(call.id) === message.id
		)
			continue;
		if (owners === before) owners = new Map(owners);
		owners.set(call.id, message.id);
	}
	return owners === before ? state : { ...state, journalCallOwners: owners };
}

/**
 * One transitive tuple policy, never an ordinal/time pairwise hybrid. Confirmed
 * rows use same-domain source positions; causal children use their verified
 * owner position plus their OWN ordinal. Unknown rows keep admission order in
 * an explicit suffix until proof arrives. No clock is consulted in this lane.
 * An ordinal is not fabricated for an unknown child: its anchor only places
 * its block; journalSeq still remains absent until that child is durable.
 */
export function journalOrderedRecords(
	state: TranscriptState,
	input: TranscriptRecord[],
): TranscriptRecord[] {
	if (!state.journalMode) return input;
	if (state.journalPeerSource === true)
		return journalOrderedPeerRecords(state, input);
	const generation = state.journalGeneration;
	const positions = state.journalPositions;
	let changed = false;
	const records = input.map((record) => {
		const candidates = [
			positions?.get(record.sourceEntryId ?? record.id),
			positions?.get(record.id),
		];
		let fact = candidates
			.filter((value): value is SourceCoordinate => value !== undefined)
			.sort((a, b) => b.seq - a.seq)[0];
		if (
			record.journalGeneration === generation &&
			ordinal(record.journalSeq) &&
			(!fact || record.journalSeq > fact.seq)
		)
			fact = {
				entryId: record.sourceEntryId ?? record.id,
				seq: record.journalSeq,
			};
		if (!fact || !generation) return record;
		const delivered =
			record.kind === "user" &&
			(record.provisional === true || record.local === true);
		if (
			!delivered &&
			record.sourceEntryId === fact.entryId &&
			record.journalSeq === fact.seq &&
			record.journalGeneration === generation
		)
			return record;
		changed = true;
		let next: TranscriptRecord = {
			...record,
			sourceEntryId: fact.entryId,
			journalSeq: fact.seq,
			journalGeneration: generation,
		};
		if (next.kind === "user") {
			// Index truth is stronger than an RPC failure/streamed settle. Keep the
			// user's message protected, but no longer retract it as a local echo.
			const { provisional: _held, local: _echo, ...durable } = next;
			next = durable;
			// The source lane never seals rows using a clock cutoff.
		}
		return next;
	});
	// Keep an unknown admission with the block it followed, rather than pinning
	// every old streamed reply below all newer confirmed windows. This is an
	// explicit provisional slot, not source authority; exact carriage/metadata
	// supersedes it. No timestamp or pairwise mixed comparator is involved.
	let admissionAnchor: string | undefined;
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record.kind === "user" && record.provisional === true) {
			// A fresh send's own position is still unproved. Keep its replies
			// in that provisional block until source metadata places the send.
			admissionAnchor = record.id;
		} else if (
			record.journalGeneration === generation &&
			ordinal(record.journalSeq)
		) {
			admissionAnchor = record.id;
		} else if (!record.sourceAdmissionAnchor && admissionAnchor) {
			records[i] = { ...record, sourceAdmissionAnchor: admissionAnchor };
			changed = true;
		}
	}
	const byId = new Map(records.map((record) => [record.id, record]));
	const seqOf = (record: TranscriptRecord | undefined): number | undefined =>
		record !== undefined &&
		record.journalGeneration === generation &&
		ordinal(record.journalSeq)
			? record.journalSeq
			: undefined;
	const rank = (record: TranscriptRecord, index: number): number[] => {
		const own = seqOf(record);
		if (
			record.kind === "user" &&
			record.provisional === true &&
			own === undefined
		)
			return [1, 0, 0, 0, index];
		const anchor =
			record.kind === "supplement"
				? record.anchor
				: record.kind === "tool"
					? (state.journalCallOwners?.get(record.toolCallId) ??
						state.argsByCall.get(record.toolCallId)?.anchorId)
					: undefined;
		const owner =
			typeof anchor === "string" ? seqOf(byId.get(anchor)) : undefined;
		const admitted = record.sourceAdmissionAnchor
			? seqOf(byId.get(record.sourceAdmissionAnchor))
			: undefined;
		const placement = owner ?? own ?? admitted;
		return placement === undefined
			? [1, 0, 0, 0, index]
			: [
					0,
					placement,
					owner !== undefined ? 1 : own !== undefined ? 0 : 2,
					own ?? Number.MAX_SAFE_INTEGER,
					index,
				];
	};
	const ranked = records.map((record, index) => ({
		record,
		index,
		rank: rank(record, index),
	}));
	ranked.sort((a, b) => {
		for (let i = 0; i < a.rank.length; i++) {
			const difference = a.rank[i] - b.rank[i];
			if (difference) return difference;
		}
		return 0;
	});
	if (!changed && ranked.every((row, index) => row.index === index))
		return input;
	return ranked.map((row) => row.record);
}

/**
 * The peer-mode ranker: source FACTS rank; admitted BODIES own.
 *
 * THE ONE RULE THIS EXISTS FOR: a coordinate is not a body. In this lane the
 * metadata producers - the facts-only lookup, the authority bootstrap, a ready
 * wake's descriptors - prove where a row sits in the current domain and
 * NOTHING about the loaded text, and the complete contract forbids exactly
 * what the single ranker above would do with them: "Lookup coordinates do not
 * reattest a loaded old body or release a provisional/local user"
 * (docs/DESKTOP_API.md complete-contract section). Copying a fact onto a
 * record's `journalGeneration`/`journalSeq` IS the reattestation - it made a
 * stale body look admitted (the RED authority reading: `OLD BODY` stamped
 * `g1`/seq 4 while the page's fresh body was never adopted), released a held
 * echo on coordinates alone (the RED lookup reading), and stamped a delta's
 * unverified text with an old coordinate. Here the record's own coordinate
 * fields are written ONLY by the commits that carry its body (a page's rows,
 * the declared delta family, the payload subset), so in this lane
 * `record.journalGeneration === the current generation` means exactly "this
 * body was admitted under this domain" - and facts take a separate placement
 * channel that never touches the record. Ranking OUTPUT is deliberately
 * identical to the legacy ranker for the same inputs; only the record
 * mutation and the hold release are gone.
 */
function journalOrderedPeerRecords(
	state: TranscriptState,
	input: TranscriptRecord[],
): TranscriptRecord[] {
	const generation = state.journalGeneration;
	const positions = state.journalPositions;
	/*
	 * Placement: the same fact selection as the legacy ranker (positions for
	 * both the raw and the record key, an admitted own coordinate winning when
	 * newer), with no generation gate on positions - the map is cleared by
	 * every install, so its entries are current-domain by construction, and a
	 * fact is precisely what a not-yet-admitted row must still be ranked by.
	 */
	const placement = new Map<string, SourceCoordinate>();
	for (const record of input) {
		const candidates = [
			positions?.get(record.sourceEntryId ?? record.id),
			positions?.get(record.id),
		];
		let fact = candidates
			.filter((value): value is SourceCoordinate => value !== undefined)
			.sort((a, b) => b.seq - a.seq)[0];
		if (
			record.journalGeneration === generation &&
			ordinal(record.journalSeq) &&
			(!fact || record.journalSeq > fact.seq)
		)
			fact = {
				entryId: record.sourceEntryId ?? record.id,
				seq: record.journalSeq,
			};
		if (fact) placement.set(record.id, fact);
	}
	/*
	 * THE FACT-MAP'S REVERSE INDEX, AND WHY IT IS NOT THE FORWARD ONE.
	 *
	 * `placement` is keyed by RECORD id, which for a supplement is the synthetic
	 * `supplement:<anchor>` — so looking an ANCHOR's own record up by the anchor
	 * id finds nothing, and a fact-placed supplement would fall to the unplaced
	 * suffix even though its anchor is on screen. The legacy ranker reads the
	 * committed `journalPositions` for exactly this and kept the behaviour; this
	 * lane must too, or "facts rank" would quietly stop for supplements and
	 * reviews that sit beside a still-pending body.
	 */
	const factFor = (record: TranscriptRecord | undefined): SourceCoordinate | undefined =>
		record === undefined
			? undefined
			: (placement.get(record.id) ??
				positions?.get(record.sourceEntryId ?? record.id) ??
				positions?.get(record.id));
	let changed = false;
	const records = input.slice();
	let admissionAnchor: string | undefined;
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record.kind === "user" && record.provisional === true) {
			// A fresh send's own position is still unproved. Keep its replies
			// in that provisional block until source metadata places the send.
			admissionAnchor = record.id;
		} else if (
			record.journalGeneration === generation &&
			ordinal(record.journalSeq)
		) {
			// ONLY an admitted body anchors its replies here: a fact-placed row
			// without its body is not yet evidence about its neighbours.
			admissionAnchor = record.id;
		} else if (!record.sourceAdmissionAnchor && admissionAnchor) {
			records[i] = { ...record, sourceAdmissionAnchor: admissionAnchor };
			changed = true;
		}
	}
	const byId = new Map(records.map((record) => [record.id, record]));
	const seqOf = (record: TranscriptRecord | undefined): number | undefined =>
		factFor(record)?.seq;
	const rank = (record: TranscriptRecord, index: number): number[] => {
		const own = seqOf(record);
		if (
			record.kind === "user" &&
			record.provisional === true &&
			own === undefined
		)
			return [1, 0, 0, 0, index];
		const anchor =
			record.kind === "supplement"
				? record.anchor
				: record.kind === "tool"
					? (state.journalCallOwners?.get(record.toolCallId) ??
						state.argsByCall.get(record.toolCallId)?.anchorId)
					: undefined;
		const owner =
			typeof anchor === "string" ? seqOf(byId.get(anchor)) : undefined;
		const admitted = record.sourceAdmissionAnchor
			? seqOf(byId.get(record.sourceAdmissionAnchor))
			: undefined;
		const placementSeq = owner ?? own ?? admitted;
		return placementSeq === undefined
			? [1, 0, 0, 0, index]
			: [
					0,
					placementSeq,
					owner !== undefined ? 1 : own !== undefined ? 0 : 2,
					own ?? Number.MAX_SAFE_INTEGER,
					index,
				];
	};
	const ranked = records.map((record, index) => ({
		record,
		index,
		rank: rank(record, index),
	}));
	ranked.sort((a, b) => {
		for (let i = 0; i < a.rank.length; i++) {
			const difference = a.rank[i] - b.rank[i];
			if (difference) return difference;
		}
		return 0;
	});
	if (!changed && ranked.every((row, index) => row.index === index))
		return input;
	return ranked.map((row) => row.record);
}

/** Raw IDs only: the index cannot resolve a virtual `tool:...` record key. */
export function journalLookupIds(state: TranscriptState): string[] {
	const pending = state.records.filter(
		(record) => record.kind === "user" && record.provisional === true,
	);
	const unresolved = state.records.filter(
		(record) =>
			record.journalGeneration !== state.journalGeneration ||
			!ordinal(record.journalSeq),
	);
	const requested = [...pending, ...unresolved].map(
		(record) =>
			// A raw ID may contain ':' (even 'tool:'). Only these canonical
			// kinds synthesize keys; durable sourceEntryId always wins.
			record.sourceEntryId ??
			(record.kind === "tool" || record.kind === "supplement"
				? null
				: record.id),
	);
	/*
	 * THE UNION, BEFORE ANY GUARD SEES IT (docs/DESKTOP_API.md: "Raw-ID lookup
	 * demand unions canonical, quarantined and loaded-body-owed IDs BEFORE the
	 * no-debt/no-generation guard"). A row can be fully PLACED and still owe a
	 * body - a family-less recovery delta replaced its text with unattested
	 * content - and that row is in neither `unresolved` set above, so without
	 * this union the debt would be invisible to every sweep and the fresh text
	 * would never be verified against the owner. Only ids some record still
	 * carries are asked about; an id whose record is gone (a cleared view) has
	 * nothing to admit and is not a lookup question.
	 */
	requested.push(...journalBodyOwedIds(state));
	/*
	 * AND A PROVEN ABSENCE IS NOT RE-ASKED. The union's whole point is to ask
	 * about ids that could still resolve; an id a payload answer already settled
	 * as missing (`journalSourceVoid`) has had its answer, and asking again - in
	 * the lookup or through the body owed-set it would otherwise rejoin - is the
	 * token retry loop the contract forbids ("proven-absent... never re-asked
	 * without a new causal fact"). A new fact is what clears the void: a fresh
	 * admitted body, or a rotation (which drops the whole void set). Rows the
	 * void covers therefore simply drop out of this union.
	 */
	if (state.journalSourceVoid?.size)
		for (let index = requested.length - 1; index >= 0; index--) {
			const value = requested[index];
			if (typeof value === "string" && state.journalSourceVoid.has(value))
				requested.splice(index, 1);
		}
	if (!state.journalPositions?.has(state.oldestId ?? ""))
		requested.push(state.oldestId);
	return [
		...new Set(
			requested.filter(
				(value): value is string =>
					typeof value === "string" && value.length > 0 && value.length <= 128,
			),
		),
	];
}

/**
 * The raw ids this view still carries whose loaded body is NOT admitted under
 * the current source domain: the payload fallback's request set.
 *
 * VALUE = the order revision the debt was stamped at. Absent for a local-lane
 * conversation (nothing is ever owed there: facts admit, byte-for-byte legacy)
 * and for ids a proven-absent answer has already settled (`journalSourceVoid`
 * - retrying them would be the token retry loop the contract forbids; a new
 * domain or a fresh admitted body is a new causal fact and clears the void).
 */
export function journalBodyOwedIds(state: TranscriptState): string[] {
	if (state.journalPeerSource !== true || !state.journalBodyOwed) return [];
	const carried = new Set<string>();
	for (const record of state.records) {
		const id =
			record.sourceEntryId ??
			(record.kind === "tool" || record.kind === "supplement"
				? null
				: record.id);
		if (typeof id === "string" && id.length > 0 && id.length <= 128)
			carried.add(id);
	}
	const ids: string[] = [];
	for (const id of state.journalBodyOwed.keys()) {
		if (id.length < 1 || id.length > 128) continue;
		if (!carried.has(id)) continue;
		if (state.journalSourceVoid?.has(id)) continue;
		ids.push(id);
	}
	return ids;
}

/**
 * The union ids that still need source FACTS (a same-domain coordinate): the
 * metadata lookup's request set. Ids that already have a fact but still owe a
 * body are deliberately NOT here - their next read is the payload subset, not
 * another coordinate sweep ("lookup response bytes" are the cost this whole
 * lane exists to stop paying twice).
 */
export function journalFactsNeeded(state: TranscriptState): string[] {
	const positions = state.journalPositions;
	return journalLookupIds(state).filter((id) => !positions?.has(id));
}

export const currentOrderRevision = (state: TranscriptState): number =>
	state.orderRevision ?? 0;
