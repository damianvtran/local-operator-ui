import type { DesktopHistoryPage } from "../../../../../shared/desktop-session-contract";
import { journalOrderIdBatch } from "../../../../../shared/journal-order-query";
import {
	type JournalOrderRead,
	currentOrderRevision,
	journalBodyOwedIds,
	journalFactsNeeded,
	journalLookupIds,
	journalOrderRead,
} from "./journal-order";
import type { TranscriptState } from "./transcript-reducer";

/**
 * Resolve cached IDs in bounded same-source batches on the existing snapshot
 * route. A 512-ID wire limit is not a limit on the cache's ordering guarantee.
 * Missing IDs are tried once per sweep; a distinct ready fact, including a
 * generic correction, earns a fresh sweep. Each flight services at most ONE
 * additional wake; later facts remain owed for the caller's next admitted flight.
 * This bounds work under a continuously changing source without token polling.
 * Building/unsupported responses otherwise stop. Never poll on
 * tokens or guess positions for a backend that cannot attest to this source.
 *
 * THREE READ KINDS, ONE LOOP. A conversation whose subscription declared the
 * complete peer-source contract walks its debt in the order the contract
 * names it: the authoritative session GET for a sweep that owes a reconcile
 * ("an unmatched non-authoritative domain asks for ONE COALESCED AUTHORITATIVE
 * SNAPSHOT rather than switching generations"); the FACTS-ONLY lookup
 * (`source_read=metadata`) while any union id still lacks a same-domain fact;
 * and the typed PAYLOAD subset (`source_read=payload`, the fence required)
 * for ids that are placed but still owe their bodies. A local conversation
 * (or a peer opened before the catalogue placed it) keeps the single
 * authoritative read, byte-for-byte. The lookup commits are
 * non-authoritative on the other side of `commit`, so no install or demand
 * settle rides them; only the authority read settles.
 *
 * WHY THE PAYLOAD STAGE IS PART OF THIS LOOP AND NOT A SECOND ONE: body debt
 * and fact debt are the same sweep's progression, and the flight bound, the
 * per-generation attempted seal and the one-extra-wake rule all already
 * exist here. A second driver would duplicate exactly those three bounds.
 * `sweep` decides the kind AND the request set each iteration (`idsOf`), so
 * a lookup can never be asked for payload ids nor a payload for unplaced
 * ones; an answer that leaves ids budget-deferred serves ONE explicitly
 * smaller follow-up (`source_retry_ids`, "never a silent truncation") and
 * then stops until a new causal fact.
 */
export async function repairJournalOrder<T>(deps: {
	getTranscript: () => TranscriptState;
	isCurrent: () => boolean;
	read: (
		ids: string[],
		kind: "authority" | "lookup" | "payload",
	) => Promise<T>;
	page: (response: T) => DesktopHistoryPage;
	commit: (response: T, revision: number, read: JournalOrderRead) => void;
	/** Exact fixed target/query of the existing GET lookup route. */
	lookupPath: string;
	/**
	 * The read THIS sweep will take, known before the batch is cut so the byte
	 * budget measures the request actually sent (path + every fixed query
	 * field, ids excluded). `undefined` keeps the historical single-read shape
	 * (the local lane: one authoritative GET). `none` states that a peer
	 * sweep has no dispatchable debt this iteration - never a dead read, and
	 * never the authority fallback a bare `undefined` means.
	 */
	sweep?: (
		state: TranscriptState,
	) =>
		| {
				kind: "authority" | "lookup" | "payload" | "none";
				path: string;
				query: URLSearchParams;
		  }
		| undefined;
}): Promise<
	| { kind: "complete"; transcript: TranscriptState }
	| { kind: "waiting" | "stale" }
> {
	/* One attempted seal per read kind: facts and bodies are separate debts. */
	const attempted = new Map<string, Set<string>>();
	const attemptedIds = (kind: string): Set<string> => {
		let set = attempted.get(kind);
		if (!set) {
			set = new Set();
			attempted.set(kind, set);
		}
		return set;
	};
	const idsOf = (state: TranscriptState, kind: string): string[] =>
		kind === "payload"
			? journalBodyOwedIds(state)
			: kind === "lookup"
				? journalFactsNeeded(state)
				: journalLookupIds(state);
	let attemptedGeneration = deps.getTranscript().journalGeneration;
	let wakeRetries = 0;
	let payloadRetries = 0;
	for (;;) {
		if (!deps.isCurrent()) return { kind: "stale" };
		const before = deps.getTranscript();
		const read = journalOrderRead(before);
		const revision = read.revision;
		const shape = deps.sweep?.(before);
		if (shape?.kind === "none") return { kind: "complete", transcript: before };
		const kind = shape?.kind ?? "authority";
		const ids = journalOrderIdBatch(
			idsOf(before, kind).filter((id) => !attemptedIds(kind).has(id)),
			shape?.path ?? deps.lookupPath,
			shape?.query ?? new URLSearchParams({ journal_order: "1" }),
		);
		const response = await deps.read(ids, kind);
		if (
			!deps.isCurrent() ||
			currentOrderRevision(deps.getTranscript()) !== revision
		)
			return { kind: "stale" };
		deps.commit(response, revision, read);
		if (!deps.isCurrent()) return { kind: "stale" };
		const latest = deps.getTranscript();
		const page = deps.page(response);
		if (
			page.journal_order_state === "ready" &&
			page.journal_generation === latest.journalGeneration
		) {
			if (page.journal_generation !== attemptedGeneration) {
				attempted.clear();
				attemptedGeneration = page.journal_generation;
			}
			for (const id of ids) attemptedIds(kind).add(id);
			if (latest.orderNeedsReconcile) {
				if (latest.orderDemand === read.demand || wakeRetries === 1)
					return { kind: "waiting" };
				wakeRetries++;
				// This response predates the new signal: its "missing" set cannot seal
				// identities the correction may now attest, even in the SAME domain.
				attempted.clear();
				continue;
			}
			if (kind === "payload") {
				/*
				 * THE OWNER'S EXPLICIT SMALLER-BATCH RETRY, once per sweep: the
				 * retry ids leave the seal so the next iteration re-asks for
				 * exactly them (never the identical full set - "never a silent
				 * truncation"). A single-id batch is not re-asked: the
				 * follow-up would be the identical request. Everything else the
				 * answer left budget-deferred stays sealed for this sweep; a
				 * new causal fact is what earns it another attempt.
				 */
				const retry = (page.source_retry_ids ?? []).filter(
					(id): id is string =>
						typeof id === "string" && id.length > 0 && id.length <= 128,
				);
				if (retry.length > 0 && ids.length > 1 && payloadRetries === 0) {
					payloadRetries++;
					for (const id of retry) attemptedIds("payload").delete(id);
					continue;
				}
			}
			const nextShape = deps.sweep?.(latest);
			if (nextShape?.kind === "none")
				return { kind: "complete", transcript: latest };
			const nextKind = nextShape?.kind ?? "authority";
			if (
				idsOf(latest, nextKind).some((id) => !attemptedIds(nextKind).has(id))
			)
				continue;
			return { kind: "complete", transcript: latest };
		}
		// The same dispatch-identity rule covers a notification racing a cold
		// response; domain spelling alone is not notification provenance.
		if (
			!latest.orderNeedsReconcile ||
			latest.orderDemand === read.demand ||
			wakeRetries === 1
		)
			return { kind: "waiting" };
		wakeRetries++;
		attempted.clear();
	}
}
