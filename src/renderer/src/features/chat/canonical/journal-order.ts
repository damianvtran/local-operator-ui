import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import type { TranscriptRecord, TranscriptState } from "./transcript-reducer";

/** Raw entry identity and position; canonical tool/supplement ids can differ. */
export type JournalPosition = {
	sourceEntryId?: string;
	journalSeq?: number;
	journalGeneration?: string;
	/**
	 * The row this one ARRIVED behind, stamped once (`stampArrival`) and carried
	 * across record rebuilds. A provisional slot resolved transitively to the
	 * first placed row - not a fabricated own entry coordinate, not a timestamp.
	 */
	sourceAdmissionAnchor?: string;
	/**
	 * The row this one was LOADED IN FRONT OF: set by a continuation page
	 * (`applyHistoryPage`'s `pagedBefore`) on the rows it adds, naming the row that
	 * was at the top of the transcript when the page merged.
	 *
	 * WHY A SECOND ANCHOR. `sourceAdmissionAnchor` can only say "after": it is the
	 * live arrival fact, and a live row does arrive after what is on screen. A
	 * `before_id` page is the opposite fact - every row in it is older than every
	 * row the reader holds, because `before_id` is exclusive and is the reader's own
	 * cursor - and when the owner's index is still building (a long journal that
	 * keeps growing, `desktop_sessions.py::_journal_page`) that page carries no
	 * `journal_seq`. Stamped as an arrival, it ranked BEHIND the newest placed row
	 * and painted yesterday below this afternoon until the correction landed (the
	 * 2026-10-26 report, `scripts/reconnect-page-gap.test.mjs`). It only places a
	 * row that has no coordinate yet.
	 *
	 * THE INVARIANT THAT MAKES "AN OWN COORDINATE ALWAYS WINS" TRUE: a row that
	 * carries `sourcePrecedes` carries NO `sourceAdmissionAnchor` - it was
	 * loaded, not admitted, so `stampArrival` never stamps one and strips any it
	 * finds. The arrival anchor is what `gapSafeCoordinates` walks before it lets a
	 * row use its coordinate. A continuation row stamped as "arrived behind the
	 * tail" was a false fact. After a domain rotation the old tail rows were
	 * re-stamped behind the continuation rows, which closed a loop (y0 -> t5 ->
	 * t4 -> y3 -> ... -> y0). Every row on a loop then stayed coordinate-less for
	 * good, even once each carried a current `journal_seq` (review round 1
	 * R1-M1). Keep both anchors from ever living on one row.
	 */
	sourcePrecedes?: string;
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

/**
 * Track causal ownership from the actual message payload, never its clock.
 *
 * Records, per call id, the assistant row that owns it AND the call's index in
 * that row's `tool_calls`. The index is the sibling order the journal commits
 * (results are persisted in slot order, `harness/loop.py::_execute_batch`
 * extends `results` by slot, not by completion), so an unplaced call row can be
 * ranked where its committed twin will land even when parallel calls START or
 * END in another order - which is what makes the live order equal the committed
 * one without a per-block sequence on the wire.
 */
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
	let slots = state.journalCallSlots ?? new Map<string, number>();
	const ownersBefore = owners;
	const slotsBefore = slots;
	(message.tool_calls as Array<Record<string, unknown>>).forEach(
		(call, slot) => {
			if (!call || typeof call.id !== "string") return;
			if (owners.get(call.id) !== message.id) {
				if (owners === ownersBefore) owners = new Map(owners);
				owners.set(call.id, message.id as string);
			}
			if (slots.get(call.id) !== slot) {
				if (slots === slotsBefore) slots = new Map(slots);
				slots.set(call.id, slot);
			}
		},
	);
	return owners === ownersBefore && slots === slotsBefore
		? state
		: { ...state, journalCallOwners: owners, journalCallSlots: slots };
}

/**
 * Stamp every UNPLACED row with the row it ARRIVED behind, once, and keep it.
 *
 * WHY THIS IS A FACT OF ARRIVAL AND NOT A LOOKUP. A live row has no
 * `journal_seq` until the runtime's `journal_order_ready` wake names it, and
 * that wake trails the frame that painted the row by an unbounded number of
 * frames (`serving.py::emit_order` runs after a durable-index refresh). Until
 * it lands, the only thing that can place the row is where it joined the
 * transcript. The earlier rule stamped "the nearest PLACED predecessor at the
 * moment of derivation" and let any record rebuild (`message_end`,
 * `tool_execution_*`, `tool_call_compose` all build fresh records) drop the
 * stamp, so it was re-derived against whatever the placement state had become.
 * Two sibling unplaced rows - an assistant row and its own call - then pointed
 * at different placed rows, ranked apart, and swapped: the operator's "text hops
 * below its own tool call". Placement moves as wakes land; arrival does not.
 *
 * So the anchor is the IMMEDIATE predecessor at admission (placed or not),
 * stamped once; `upsert` carries it across rebuilds. Placement is then resolved
 * transitively by `arrivalPlacement`, so an unplaced row still ranks exactly
 * where the row it followed ranks, however the wakes interleave. No timestamp
 * is read: a placed row ranks by `journal_seq`, an unplaced one by the chain.
 *
 * A pending local echo is never stamped and ends a chain: its own position is
 * unproved, so replies behind it stay in the provisional block until the source
 * places the send (the rule the previous stamping loop also kept).
 *
 * SELF-HEALING: an anchor whose row left the list (a retired compose
 * placeholder, a removed ask row) names nothing, so the row is re-stamped
 * behind whatever precedes it now rather than falling into the unplaced suffix.
 *
 * Returns whether any record was replaced; `records` is edited in place (the
 * caller owns a copy).
 */
function stampArrival(
	records: TranscriptRecord[],
	placed: (record: TranscriptRecord) => boolean,
): boolean {
	const ids = new Set(records.map((record) => record.id));
	let changed = false;
	let previous: TranscriptRecord | undefined;
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record.kind === "user" && record.provisional === true) {
			previous = record;
			continue;
		}
		// A LOADED row is not an arrival (`JournalPosition.sourcePrecedes`): it
		// never takes an arrival anchor, and one it already carries is dropped, so
		// state written before this rule (a paint cache) heals on its next rank.
		if (record.sourcePrecedes !== undefined) {
			if (record.sourceAdmissionAnchor !== undefined) {
				const { sourceAdmissionAnchor: _arrival, ...loaded } = record;
				records[i] = loaded;
				changed = true;
			}
			previous = records[i];
			continue;
		}
		if (
			!placed(record) &&
			previous &&
			(record.sourceAdmissionAnchor === undefined ||
				!ids.has(record.sourceAdmissionAnchor))
		) {
			records[i] = { ...record, sourceAdmissionAnchor: previous.id };
			changed = true;
		}
		previous = records[i];
	}
	return changed;
}

/**
 * The `journal_seq` an unplaced row ranks behind: follow its arrival chain
 * (`stampArrival`) to the first PLACED row. Undefined when the chain ends at a
 * pending echo, at a row that left the list, or loops - the row then keeps the
 * unplaced suffix, in admission order.
 *
 * `memo` is shared across one ranking pass: a run of N unplaced rows resolves
 * in O(N) rather than walking N chains.
 */
function arrivalPlacement(
	record: TranscriptRecord,
	byId: ReadonlyMap<string, TranscriptRecord>,
	terminal: (record: TranscriptRecord) => boolean,
	seqOf: (record: TranscriptRecord | undefined) => number | undefined,
	memo: Map<string, number | undefined>,
): number | undefined {
	const path: string[] = [];
	const seen = new Set<string>();
	let at: TranscriptRecord | undefined = record;
	let answer: number | undefined;
	while (at !== undefined) {
		if (memo.has(at.id)) {
			answer = memo.get(at.id);
			break;
		}
		// `terminal` is the lane's own definition of "placed": the local lane
		// stops at any row with a coordinate, the peer lane only at an admitted
		// body (a fact-placed row without its body is not yet evidence about
		// what followed it, so the walk passes through it).
		if (terminal(at)) {
			answer = seqOf(at);
			break;
		}
		if (at.kind === "user" && at.provisional === true) break;
		if (seen.has(at.id)) break;
		seen.add(at.id);
		path.push(at.id);
		at = at.sourceAdmissionAnchor
			? byId.get(at.sourceAdmissionAnchor)
			: undefined;
	}
	for (const id of path) memo.set(id, answer);
	return answer;
}

/**
 * The rank tuple's class for a loaded row ranked BEHIND a placed row of its own
 * page (`LoadedOrder.page`). It must sort after that row's own (0), owned (1)
 * and arrival (2) classes, and a row loaded `depth` hops in front of it takes
 * `BEHIND_PAGE_MATE - depth`, which has to stay above 2 for any chain length a
 * transcript can hold.
 */
const BEHIND_PAGE_MATE = Number.MAX_SAFE_INTEGER;

/**
 * What the continuation rules (`JournalPosition.sourcePrecedes`) need, built
 * ONLY when some row was loaded by an older page (review round 2 R2-m2). A cold
 * open plus live rows carries no `sourcePrecedes`, and building this on every
 * commit cost a 3,000-row open with 300 live commits about 28% of its wall
 * time: an O(N) `seqOf` pass for `floor` (each call allocates in
 * `gapSafeCoordinates`) and an N-entry `position` map, per commit.
 */
type LoadedOrder = {
	/** `precedesPlacement`'s floor: the oldest placed row no continuation loaded. */
	floor: number | undefined;
	/** Merge position, for `precedesSuffixSlot`. */
	position: ReadonlyMap<string, number>;
	/**
	 * Unplaced loaded rows that a PLACED row of their own page can place, as the
	 * rank tuple's `seq` and class (see `pageMatePlacement`).
	 */
	page: ReadonlyMap<string, { seq: number; slot: number }>;
};

let loadedOrderPasses = 0;
/**
 * Test seam (review round 2 R2-m2): how many times a ranker built its
 * `LoadedOrder`. It pins the cold path's zero extra work as a count, not as a
 * wall-clock assertion that would flake.
 */
export function __loadedOrderPasses(): number {
	return loadedOrderPasses;
}

/**
 * Place an unplaced loaded row by the placed rows of ITS OWN PAGE (the rows
 * that share its `sourcePrecedes`, in merge position), before any chain or
 * floor rule (review round 2 R2-m1). Behind the nearest placed page-mate
 * before it, else in front of the nearest one after it.
 *
 * WHY. A correction can place only some of a page's rows: the owner sends user
 * rows first, 128 per event (`transcript_index.py::
 * journal_order_correction_batches`), or one row is missing from the index.
 * The chain rule ranked such a row in front of the row the PAGE was loaded
 * before, i.e. behind every placed row of its own page (`y0 y2 y3 y1 t4`; two
 * stacked pages after the users-first event: every assistant below its users).
 * The arrival anchor no longer holds it in place (a loaded row never takes one,
 * see `JournalPosition.sourcePrecedes`). This reads only merge position and
 * `seqOf`, never an anchor, so no walk and no loop can come of it, and the
 * same records give the same order on every commit: once ranked behind its
 * page-mate, the row stays at that position.
 */
function pageMatePlacement(
	records: readonly TranscriptRecord[],
	seqOf: (record: TranscriptRecord | undefined) => number | undefined,
): Map<string, { seq: number; slot: number }> {
	const page = new Map<string, { seq: number; slot: number }>();
	const before = new Map<string, number>();
	const after = new Map<string, number>();
	for (const record of records) {
		if (record.sourcePrecedes === undefined) continue;
		const seq = seqOf(record);
		if (seq !== undefined) before.set(record.sourcePrecedes, seq);
		else {
			const mate = before.get(record.sourcePrecedes);
			if (mate !== undefined)
				page.set(record.id, { seq: mate, slot: BEHIND_PAGE_MATE });
		}
	}
	for (let i = records.length - 1; i >= 0; i--) {
		const record = records[i];
		if (record.sourcePrecedes === undefined) continue;
		const seq = seqOf(record);
		if (seq !== undefined) after.set(record.sourcePrecedes, seq);
		else if (!page.has(record.id)) {
			const mate = after.get(record.sourcePrecedes);
			if (mate !== undefined) page.set(record.id, { seq: mate, slot: -1 });
		}
	}
	return page;
}

function loadedOrder(
	records: readonly TranscriptRecord[],
	seqOf: (record: TranscriptRecord | undefined) => number | undefined,
): LoadedOrder {
	loadedOrderPasses += 1;
	return {
		floor: precedesFloor(records, seqOf),
		position: new Map(records.map((record, index) => [record.id, index])),
		page: pageMatePlacement(records, seqOf),
	};
}

/**
 * Where a continuation-page row ranks, as the rank tuple's `seq` and class
 * (`slot`). First by its own page's placed rows (`pageMatePlacement`). Else IN
 * FRONT OF the row its `sourcePrecedes` chain reaches first that is placed,
 * directly or by its own page-mates (a page loaded in front of an earlier
 * continuation's rows points at them), `depth` hops away from it - a page
 * loaded further back has the longer chain and sorts first.
 *
 * WHEN THE CHAIN REACHES NO PLACED ROW (it ends at an unplaced row, leaves the
 * list or loops), the row ranks in front of `floor`: the oldest placed row
 * that was NOT itself loaded by a continuation. That target is still correct,
 * because a continuation is older than every row the reader held when it
 * merged. Two shapes reach it. An open page that was itself `building` (review
 * R1-m1 / QA Q3) leaves the anchor row with no coordinate. A domain rotation
 * leaves the old tail rows with the old domain's coordinates, so they count as
 * unplaced. The arrival rules cannot stand in here, because a loaded row has no
 * arrival anchor (see `JournalPosition.sourcePrecedes`). Continuation rows are
 * excluded from `floor` so that a deeper page placed in the new domain cannot
 * pull a shallower, still-unplaced one above it. Undefined only when no such
 * row is placed at all; `precedesSuffixSlot` then orders it inside the
 * unplaced suffix.
 */
function precedesPlacement(
	record: TranscriptRecord,
	byId: ReadonlyMap<string, TranscriptRecord>,
	seqOf: (record: TranscriptRecord | undefined) => number | undefined,
	loaded: LoadedOrder | undefined,
): { seq: number; slot: number } | undefined {
	if (loaded === undefined || record.sourcePrecedes === undefined)
		return undefined;
	const own = loaded.page.get(record.id);
	if (own !== undefined) return own;
	const seen = new Set<string>();
	let depth = 1;
	let at = byId.get(record.sourcePrecedes);
	while (at !== undefined && !seen.has(at.id)) {
		seen.add(at.id);
		const seq = seqOf(at);
		if (seq !== undefined) return { seq, slot: -depth };
		const mate = loaded.page.get(at.id);
		if (mate !== undefined) return { seq: mate.seq, slot: mate.slot - depth };
		depth += 1;
		at = at.sourcePrecedes ? byId.get(at.sourcePrecedes) : undefined;
	}
	return loaded.floor === undefined
		? undefined
		: { seq: loaded.floor, slot: -depth };
}

/**
 * Where a loaded row sits in the UNPLACED SUFFIX when nothing is placed at all.
 * This is the shape where the open page was itself `building` (review R1-m1 /
 * QA Q3). The row is keyed to the suffix slot of the row its `sourcePrecedes`
 * chain ends at (the first row on it that no continuation loaded), `depth`
 * hops in front of it, so the page still paints above what the reader held.
 * Undefined when the chain leaves the list or loops: the row keeps its own
 * merge position, which is the behaviour before this field existed.
 */
function precedesSuffixSlot(
	record: TranscriptRecord,
	byId: ReadonlyMap<string, TranscriptRecord>,
	loaded: LoadedOrder | undefined,
): { slot: number; depth: number } | undefined {
	if (loaded === undefined || record.sourcePrecedes === undefined)
		return undefined;
	const { position } = loaded;
	const seen = new Set<string>();
	let depth = 1;
	let at = byId.get(record.sourcePrecedes);
	while (at !== undefined && !seen.has(at.id)) {
		if (at.sourcePrecedes === undefined) {
			const slot = position.get(at.id);
			return slot === undefined ? undefined : { slot, depth };
		}
		seen.add(at.id);
		depth += 1;
		at = byId.get(at.sourcePrecedes);
	}
	return undefined;
}

/** `precedesPlacement`'s `floor`: the oldest placed row no continuation loaded. */
function precedesFloor(
	records: readonly TranscriptRecord[],
	seqOf: (record: TranscriptRecord | undefined) => number | undefined,
): number | undefined {
	let floor: number | undefined;
	for (const record of records) {
		if (record.sourcePrecedes !== undefined) continue;
		const seq = seqOf(record);
		if (seq !== undefined && (floor === undefined || seq < floor)) floor = seq;
	}
	return floor;
}

/**
 * Delay USING a coordinate when an earlier live arrival still has none.
 *
 * Owner commit wakes follow append order, but that is not a transport contract:
 * a cold desktop history read also emits corrections, in page / requested-id
 * order, in 128-row chunks. A real history route with reverse order_ids emitted
 * seqs 203..77 before 76..0. Those wakes can interleave with owner wakes after
 * reconnect. Using a later text's coordinate immediately moves it above an
 * earlier tool whose coordinate is still unknown, then back when that wake lands
 * (QA round 2 N1). Keep the coordinate as a fact, but rank the live arrival by
 * its chain until all earlier arrivals in that chain are placed. Durable rows
 * loaded without an arrival anchor keep their authoritative order immediately.
 * This never changes body provenance or source facts in the peer lane.
 */
function gapSafeCoordinates(
	byId: ReadonlyMap<string, TranscriptRecord>,
	raw: (record: TranscriptRecord | undefined) => number | undefined,
): (record: TranscriptRecord | undefined) => number | undefined {
	const ready = new Map<string, boolean>();
	return (record) => {
		if (!record) return undefined;
		const own = raw(record);
		if (own === undefined) return undefined;
		const path: string[] = [];
		const seen = new Set<string>();
		let at: TranscriptRecord | undefined = record;
		let complete = true;
		while (at) {
			if (ready.has(at.id)) {
				complete = ready.get(at.id) === true;
				break;
			}
			if (seen.has(at.id) || raw(at) === undefined) {
				complete = false;
				break;
			}
			seen.add(at.id);
			path.push(at.id);
			at =
				at.sourceAdmissionAnchor === undefined
					? undefined
					: byId.get(at.sourceAdmissionAnchor);
		}
		for (const id of path) ready.set(id, complete);
		return complete ? own : undefined;
	};
}

/**
 * Put the unplaced parallel calls of ONE assistant row in their committed slot
 * order, in the positions those calls already occupy.
 *
 * WHY A POST-PASS AND NOT A RANK TERM. Parallel calls START and END in
 * completion order, but the journal persists their results in slot order
 * (`harness/loop.py::_execute_batch` extends `results` by slot), so until their
 * wakes land the live order has to be corrected to what will be committed. The
 * first version added the slot as a rank-tuple element ahead of `index`; a
 * tuple compares EVERY row on it, and a row with no slot (text) then sorted
 * ahead of a sibling call with slot >= 1 - the next text painted between two
 * parallel calls and hopped below them when the wake landed (review R1-M1, QA
 * Q2). The slot is only meaningful between two calls of the same owner, so it
 * is applied only there: the calls swap among THEMSELVES, every other row keeps
 * the slot the arrival chain gave it, and nothing about a call's place relative
 * to text can change.
 *
 * Coordinate arrival can be out of order too (cold read corrections). All
 * known sibling slots take part: their committed slot order is valid whether
 * either result's coordinate has arrived, and remains valid when both have.
 */
function siblingSlotOrder(
	state: TranscriptState,
	ordered: TranscriptRecord[],
): TranscriptRecord[] {
	const owners = state.journalCallOwners;
	const slots = state.journalCallSlots;
	if (!owners || !slots) return ordered;
	const groups = new Map<string, number[]>();
	ordered.forEach((record, at) => {
		if (record.kind !== "tool") return;
		const owner = owners.get(record.toolCallId);
		if (owner === undefined || !slots.has(record.toolCallId)) return;
		const seats = groups.get(owner);
		if (seats) seats.push(at);
		else groups.set(owner, [at]);
	});
	let result = ordered;
	for (const seats of groups.values()) {
		if (seats.length < 2) continue;
		const bySlot = seats
			.map((at) => ordered[at])
			.sort(
				(a, b) =>
					(slots.get((a as { toolCallId: string }).toolCallId) ?? 0) -
					(slots.get((b as { toolCallId: string }).toolCallId) ?? 0),
			);
		if (bySlot.every((record, i) => record === ordered[seats[i]])) continue;
		if (result === ordered) result = ordered.slice();
		seats.forEach((at, i) => {
			result[at] = bySlot[i];
		});
	}
	return result;
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
	// Read in the pass this lane already makes, so the cold path (no older
	// page loaded) pays no extra scan for it (`LoadedOrder`, R2-m2).
	let anyLoaded = false;
	const records = input.map((record) => {
		if (record.sourcePrecedes !== undefined) anyLoaded = true;
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
	// An unplaced row keeps the slot its ARRIVAL gave it; see `stampArrival`.
	const isPlaced = (record: TranscriptRecord) =>
		record.journalGeneration === generation && ordinal(record.journalSeq);
	if (stampArrival(records, isPlaced)) changed = true;
	const chain = new Map<string, number | undefined>();
	const byId = new Map(records.map((record) => [record.id, record]));
	const seqOf = gapSafeCoordinates(byId, (record) =>
		record !== undefined &&
		record.journalGeneration === generation &&
		ordinal(record.journalSeq)
			? record.journalSeq
			: undefined,
	);
	const rankPlaced = (record: TranscriptRecord) => seqOf(record) !== undefined;
	const loaded = anyLoaded ? loadedOrder(records, seqOf) : undefined;
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
		// A negative class (-depth) sorts the row in front of the row it was loaded
		// before (class 0 at the same seq) and of that row's calls/arrivals (1, 2),
		// and an earlier page in front of a later one; `BEHIND_PAGE_MATE` sorts it
		// after a placed page-mate and everything that row owns. Within one page,
		// page order holds by `index`, because the merge adds a page's new rows in
		// page order.
		const precedes =
			owner === undefined && own === undefined
				? precedesPlacement(record, byId, seqOf, loaded)
				: undefined;
		const admitted =
			own === undefined && precedes === undefined
				? arrivalPlacement(record, byId, rankPlaced, seqOf, chain)
				: undefined;
		const placement = owner ?? own ?? precedes?.seq ?? admitted;
		if (placement === undefined) {
			// The unplaced suffix keeps merge order (`index`), except that a loaded
			// row goes in front of the row it was loaded before (`precedesSuffixSlot`).
			const suffix = precedesSuffixSlot(record, byId, loaded);
			return [1, suffix?.slot ?? index, suffix ? -suffix.depth : 0, 0, index];
		}
		return [
			0,
			placement,
			owner !== undefined
				? 1
				: own !== undefined
					? 0
					: precedes !== undefined
						? precedes.slot
						: 2,
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
		return siblingSlotOrder(state, input);
	return siblingSlotOrder(
		state,
		ranked.map((row) => row.record),
	);
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
	// Read in the pass this lane already makes (`LoadedOrder`, R2-m2).
	let anyLoaded = false;
	for (const record of input) {
		if (record.sourcePrecedes !== undefined) anyLoaded = true;
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
	const factFor = (
		record: TranscriptRecord | undefined,
	): SourceCoordinate | undefined =>
		record === undefined
			? undefined
			: (placement.get(record.id) ??
				positions?.get(record.sourceEntryId ?? record.id) ??
				positions?.get(record.id));
	let changed = false;
	const records = input.slice();
	// Stamping skips only rows that carry an admitted body's coordinate; a row
	// placed by a FACT alone is stamped too (harmless: its own coordinate wins).
	const admittedBody = (record: TranscriptRecord) =>
		record.journalGeneration === generation && ordinal(record.journalSeq);
	if (stampArrival(records, admittedBody)) changed = true;
	const chain = new Map<string, number | undefined>();
	const byId = new Map(records.map((record) => [record.id, record]));
	/*
	 * Facts rank without reattesting bodies, but a lone later fact must not cut
	 * an arrival chain ahead of an earlier unresolved row. The local lane already
	 * gates coordinate USE on that gap; peer facts need the SAME gate (R3-M1).
	 * With no compose frames and non-slot-order tool starts, a single result fact
	 * otherwise dragged the following answer between its siblings, twice when
	 * the same correction was replayed. Nothing is removed from `placement` or
	 * journalPositions and no body provenance/hold is changed by this gate.
	 */
	const seqOf = gapSafeCoordinates(byId, (record) => factFor(record)?.seq);
	const hasCoordinate = (record: TranscriptRecord) =>
		seqOf(record) !== undefined;
	const loaded = anyLoaded ? loadedOrder(records, seqOf) : undefined;
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
		// The same continuation rule as the local ranker (`precedesPlacement`).
		const precedes =
			owner === undefined && own === undefined
				? precedesPlacement(record, byId, seqOf, loaded)
				: undefined;
		const admitted =
			own === undefined && precedes === undefined
				? arrivalPlacement(record, byId, hasCoordinate, seqOf, chain)
				: undefined;
		const placementSeq = owner ?? own ?? precedes?.seq ?? admitted;
		if (placementSeq === undefined) {
			const suffix = precedesSuffixSlot(record, byId, loaded);
			return [1, suffix?.slot ?? index, suffix ? -suffix.depth : 0, 0, index];
		}
		return [
			0,
			placementSeq,
			owner !== undefined
				? 1
				: own !== undefined
					? 0
					: precedes !== undefined
						? precedes.slot
						: 2,
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
		return siblingSlotOrder(state, input);
	return siblingSlotOrder(
		state,
		ranked.map((row) => row.record),
	);
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
	if (!state.journalPositions?.has(state.oldestId ?? ""))
		requested.push(state.oldestId);
	/*
	 * AND A PROVEN ABSENCE IS NOT RE-ASKED (review round 1, M1). The union's
	 * whole point is to ask about ids that could still resolve; an id a payload
	 * answer already settled as missing (`journalSourceVoid`) has had its answer,
	 * and asking again - in the lookup or through the body owed-set it would
	 * otherwise rejoin - is the token retry loop the contract forbids
	 * ("proven-absent... never re-asked without a new causal fact"). A new fact is
	 * what clears the void: a fresh admitted body, or a rotation (which drops the
	 * whole void set).
	 *
	 * THE FILTER RUNS **AFTER** THE OLDEST-ID PUSH, DELIBERATELY (this round's
	 * M1): it used to run before it, so a proven-missing CURSOR id went straight
	 * back into the union on every flight, kept the sweep on the lookup stage
	 * (which then never reached the body stage), and starved the payload read that
	 * rotation-stamped body debt needs. One filter, after every source of id, is
	 * the invariant the comment states.
	 */
	if (state.journalSourceVoid?.size)
		for (let index = requested.length - 1; index >= 0; index--) {
			const value = requested[index];
			if (typeof value === "string" && state.journalSourceVoid.has(value))
				requested.splice(index, 1);
		}
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

/*
 * The union ids that still need source FACTS (a same-domain coordinate): the
 * metadata lookup's request set. Ids that already have a fact but still owe a
 * body are deliberately NOT here - their next read is the payload subset, not
 * another coordinate sweep ("lookup response bytes" are the cost this whole
 * lane exists to stop paying twice).
 *
 * IT ALSO EXCLUDES IDS THIS FLIGHT ALREADY ASKED (review round 1, M1): the
 * repair loop seals each dispatched kind per flight, and a caller that ignores
 * that seal (the hook's sweep asks this of the transcript alone) would keep
 * choosing `lookup` for an id already asked and answered this flight - so the
 * loop, seeing nothing NEW to ask under that kind, would end the flight and
 * the body debt stamped by rotation would never reach the payload stage. With
 * the seal honoured here, a sealed fact id drops out and the sweep falls
 * through to `payload`. `attempted` is per-flight state the caller owns; an
 * empty/absent set is the first iteration of a flight, where nothing is sealed.
 */
export function journalFactsNeeded(
	state: TranscriptState,
	attempted?: ReadonlySet<string>,
): string[] {
	const positions = state.journalPositions;
	return journalLookupIds(state).filter(
		(id) => !positions?.has(id) && !attempted?.has(id),
	);
}

export const currentOrderRevision = (state: TranscriptState): number =>
	state.orderRevision ?? 0;
