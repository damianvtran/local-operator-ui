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
		"journal_generation" | "journal_order_state" | "journal_ordinals"
	>,
	rows: Array<Record<string, unknown>>,
	authoritative: boolean,
	read?: JournalOrderRead,
): TranscriptState {
	let state = initialState;
	const generation = page.journal_generation;
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
			// A ready fact may race an authoritative read captured before it.
			// Installing that read must not erase the distinct domain still owed.
			orderNeedsReconcile:
				state.orderWantedGeneration !== undefined &&
				state.orderWantedGeneration !== generation,
			orderWantedGeneration:
				state.orderWantedGeneration === generation
					? undefined
					: state.orderWantedGeneration,
			orderDemand:
				state.orderWantedGeneration === generation
					? undefined
					: state.orderDemand,
		};
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
	if (
		authoritative &&
		next.orderNeedsReconcile &&
		(!next.orderWantedGeneration || next.orderWantedGeneration === generation)
	)
		next = {
			...next,
			orderNeedsReconcile: false,
			orderWantedGeneration: undefined,
			orderDemand: undefined,
		};
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

export const currentOrderRevision = (state: TranscriptState): number =>
	state.orderRevision ?? 0;
